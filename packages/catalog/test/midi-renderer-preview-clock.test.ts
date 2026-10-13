/** Actual MIDI parser + renderer; the backend emits controlled PCM, not listening evidence. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFluidSynthRenderer, type ExecFilePromise } from "../src/midi-renderer.js";

type Tempo = readonly [beat: number, microsecondsPerQuarter: number];
const RATE = 8_000;

function vlq(value: number): number[] {
  const bytes = [value & 127];
  for (let n = value >>> 7; n; n >>>= 7) bytes.unshift((n & 127) | 128);
  return bytes;
}

// Build raw SMF bytes without calling the writer or duration converter under test.
function sourceMidi(tempos: readonly Tempo[], endBeat: number, noteEndBeat = endBeat): Buffer {
  const events = tempos.map(([beat, us]) => ({ tick: Math.round(beat * 480), order: 0,
    bytes: [0xff, 0x51, 3, (us >>> 16) & 255, (us >>> 8) & 255, us & 255] }));
  events.push({ tick: 0, order: 1, bytes: [0x90, 60, 80] },
    { tick: Math.round(noteEndBeat * 480), order: 2, bytes: [0x80, 60, 0] },
    { tick: Math.round(endBeat * 480), order: 3, bytes: [0xff, 0x2f, 0] });
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  let last = 0;
  const data = events.flatMap(event => {
    const bytes = [...vlq(event.tick - last), ...event.bytes]; last = event.tick; return bytes;
  });
  const track = Buffer.alloc(8); track.write("MTrk"); track.writeUInt32BE(data.length, 4);
  return Buffer.concat([Buffer.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224]), track, Buffer.from(data)]);
}

function pcm(seconds: number): Buffer {
  const frames = Math.round(seconds * RATE), wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) wav.writeInt16LE(i % 2 ? 1000 : -1000, 44 + i * 2);
  return wav;
}

async function render(tempos: readonly Tempo[], endBeat: number, renderedSeconds: number, noteEndBeat = endBeat) {
  const dir = await mkdtemp(join(tmpdir(), "keyspilli-preview-clock-"));
  try {
    const midiPath = join(dir, "source.mid"), soundfontPath = join(dir, "software-control.sf2");
    const input = sourceMidi(tempos, endBeat, noteEndBeat);
    await writeFile(midiPath, input); await writeFile(soundfontPath, "Synthetic backend fixture, not a sound bank");
    const execFile: ExecFilePromise = async (_file, args) => {
      await writeFile(args[args.indexOf("-F") + 1]!, pcm(renderedSeconds));
      return { stdout: "", stderr: "" };
    };
    const result = await createFluidSynthRenderer({ execFile, sampleRate: RATE })
      .render({ midiPath, soundfontPath, outputPath: join(dir, "preview.wav") });
    expect(await readFile(midiPath)).toEqual(input);
    return result;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe("preview duration follows the complete native MIDI clock", () => {
  it.each([
    { name: "constant tempo", tempos: [[0, 500000]] as Tempo[], end: 16, seconds: 8 },
    { name: "default tempo without meta", tempos: [] as Tempo[], end: 16, seconds: 8 },
    // Four beats at 120 BPM + twelve beats at 60 BPM = 2 + 12 seconds.
    { name: "slower second section", tempos: [[0, 500000], [4, 1000000]] as Tempo[], end: 16, seconds: 14 },
    // Four beats at 60 BPM + twelve beats at 120 BPM = 4 + 6 seconds.
    { name: "faster second section", tempos: [[0, 1000000], [4, 500000]] as Tempo[], end: 16, seconds: 10 },
    { name: "first tempo appears after beat zero", tempos: [[4, 1000000]] as Tempo[], end: 16, seconds: 14 },
    // 2 seconds + 4 seconds + 6 seconds; durations are independently specified.
    { name: "three tempo regions", tempos: [[0, 500000], [4, 1000000], [8, 750000]] as Tempo[], end: 16, seconds: 12 },
    { name: "terminal tempo changes no preceding time", tempos: [[0, 500000], [16, 1000000]] as Tempo[], end: 16, seconds: 8 },
  ])("accepts complete $name output with the correct expected duration", async ({ tempos, end, seconds }) => {
    const result = await render(tempos, end, seconds);
    expect(result.midi.expectedSeconds).toBeCloseTo(seconds, 6);
    expect(result.duration).toMatchObject({ expectedSeconds: seconds, renderedSeconds: seconds, status: "pass" });
  });

  it("includes a slower terminal rest rather than stopping at the last note release", async () => {
    const result = await render([[0, 500000], [8, 1000000]], 16, 12, 8);
    expect(result.midi).toMatchObject({ durationBeats: 16, expectedSeconds: 12 });
    expect(result.duration.status).toBe("pass");
  });

  it("fails a clip cut at the old scalar-BPM estimate", async () => {
    const result = await render([[0, 500000], [4, 1000000]], 16, 8);
    expect(result.duration).toMatchObject({ expectedSeconds: 14, renderedSeconds: 8, status: "fail" });
  });

  it("does not credit four PCM frames as a complete half-second source", async () => {
    const result = await render([[0, 500000]], 1, 4 / RATE);
    expect(result.duration.status).toBe("fail");
  });

  it("allows a five-millisecond frame boundary shortfall", async () => {
    const result = await render([[0, 500000]], 2, 0.995);
    expect(result.duration.status).toBe("pass");
  });

  it("retains the existing allowance for a half-second piano release tail", async () => {
    const result = await render([[0, 500000]], 2, 1.5);
    expect(result.duration.status).toBe("pass");
  });
});
