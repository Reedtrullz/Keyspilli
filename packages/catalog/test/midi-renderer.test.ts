import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeMidi } from "@keyspilli/midi";
import {
  MidiRendererError,
  buildFluidSynthArgs,
  createFluidSynthRenderer,
  resolveFluidSynthConfig,
  type ExecFilePromise,
} from "../src/midi-renderer.js";

function wavPcm16(samples: number[], sampleRate = 44_100, channels = 1): Uint8Array {
  const data = new Uint8Array(samples.length * 2);
  const view = new DataView(data.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  const header = new ArrayBuffer(44);
  const h = new DataView(header);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => h.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  h.setUint32(4, 36 + data.length, true);
  text(8, "WAVE");
  text(12, "fmt ");
  h.setUint32(16, 16, true);
  h.setUint16(20, 1, true);
  h.setUint16(22, channels, true);
  h.setUint32(24, sampleRate, true);
  h.setUint32(28, sampleRate * channels * 2, true);
  h.setUint16(32, channels * 2, true);
  h.setUint16(34, 16, true);
  text(36, "data");
  h.setUint32(40, data.length, true);
  return new Uint8Array([...new Uint8Array(header), ...data]);
}

async function fixture(): Promise<{ dir: string; midiPath: string; soundfontPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "keyspilli-midi-renderer-"));
  const midiPath = join(dir, "candidate.mid");
  const soundfontPath = join(dir, "piano.sf2");
  await writeFile(midiPath, writeMidi([{ midi: 60, start: 0, dur: 1, vel: 100 }], { tempoBpm: 120 }));
  await writeFile(soundfontPath, Buffer.from("synthetic-soundfont"));
  return { dir, midiPath, soundfontPath };
}

describe("FluidSynth MIDI renderer", () => {
  it("resolves explicit settings before environment defaults", () => {
    expect(resolveFluidSynthConfig({ soundfontPath: "/explicit/piano.sf2", executable: "/explicit/fluidsynth", sampleRate: 48_000 }, {
      KEYSPILLI_SOUNDFONT: "/env/piano.sf2",
      KEYSPILLI_FLUIDSYNTH: "/env/fluidsynth",
    })).toMatchObject({
      soundfontPath: "/explicit/piano.sf2",
      executable: "/explicit/fluidsynth",
      sampleRate: 48_000,
    });
    expect(resolveFluidSynthConfig(undefined, {
      KEYSPILLI_SOUNDFONT: "/env/piano.sf2",
      KEYSPILLI_FLUIDSYNTH: "/env/fluidsynth",
    })).toMatchObject({ soundfontPath: "/env/piano.sf2", executable: "/env/fluidsynth", sampleRate: 44_100 });
  });

  it("builds a shell-free, fixed FluidSynth command", () => {
    expect(buildFluidSynthArgs({
      midiPath: "/tmp/candidate.mid",
      outputPath: "/tmp/candidate.wav",
      soundfontPath: "/tmp/piano.sf2",
      sampleRate: 48_000,
      gain: 0.8,
    })).toEqual([
      "-ni", "-q", "-T", "wav", "-r", "48000", "-g", "0.8", "-F", "/tmp/candidate.wav",
      "/tmp/piano.sf2", "/tmp/candidate.mid",
    ]);
  });

  it("reports missing soundfont configuration clearly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keyspilli-midi-renderer-missing-sf-"));
    try {
      const renderer = createFluidSynthRenderer({ env: {} });
      await expect(renderer.render({ midiPath: join(dir, "missing.mid"), outputPath: join(dir, "out.wav") }))
        .rejects.toMatchObject({ code: "SOUNDFONT_UNAVAILABLE" });
      await expect(renderer.render({ midiPath: join(dir, "missing.mid"), outputPath: join(dir, "out.wav") }))
        .rejects.toThrow("Set KEYSPILLI_SOUNDFONT");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("classifies an unavailable FluidSynth executable without affecting normal imports", async () => {
    const f = await fixture();
    try {
      const execFile: ExecFilePromise = async () => {
        const error = Object.assign(new Error("spawn fluidsynth ENOENT"), { code: "ENOENT" });
        throw error;
      };
      const renderer = createFluidSynthRenderer({ executable: "/missing/fluidsynth", execFile });
      await expect(renderer.render({ midiPath: f.midiPath, outputPath: join(f.dir, "out.wav"), soundfontPath: f.soundfontPath }))
        .rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
      await expect(renderer.render({ midiPath: f.midiPath, outputPath: join(f.dir, "out.wav"), soundfontPath: f.soundfontPath }))
        .rejects.toThrow("Install FluidSynth or set KEYSPILLI_FLUIDSYNTH");
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  });

  it("renders canonical normalized PCM16 WAV and validates MIDI duration", async () => {
    const f = await fixture();
    const first = join(f.dir, "first.wav");
    const second = join(f.dir, "second.wav");
    const execFile: ExecFilePromise = async (_file, args) => {
      const outputIndex = args.indexOf("-F");
      await writeFile(args[outputIndex + 1]!, wavPcm16([0, 10_000, -20_000, 32_767]));
      return { stdout: "", stderr: "" };
    };
    try {
      const renderer = createFluidSynthRenderer({ executable: "fluidsynth", execFile, targetPeak: 0.95 });
      const a = await renderer.render({ midiPath: f.midiPath, outputPath: first, soundfontPath: f.soundfontPath });
      const b = await renderer.render({ midiPath: f.midiPath, outputPath: second, soundfontPath: f.soundfontPath });
      expect(a.wav).toMatchObject({ sampleRate: 44_100, channels: 1, bitsPerSample: 16, frameCount: 4 });
      expect(a.wav.peak).toBeCloseTo(0.95, 3);
      expect(a.wav.clippingCount).toBe(0);
      expect(a.duration.status).toBe("pass");
      expect(a.duration.expectedSeconds).toBeCloseTo(0.5, 6);
      expect(a.duration.renderedSeconds).toBeCloseTo(4 / 44_100, 6);
      expect(a.wav.sha256).toBe(b.wav.sha256);
      expect(await readFile(first)).toEqual(await readFile(second));
      expect(a.renderer.sampleRate).toBe(44_100);
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed or colliding MIDI/output inputs before invoking the backend", async () => {
    const f = await fixture();
    try {
      const calls: string[][] = [];
      const execFile: ExecFilePromise = async (_file, args) => {
        calls.push([...args]);
        return { stdout: "", stderr: "" };
      };
      const badMidi = join(f.dir, "bad.mid");
      await writeFile(badMidi, Buffer.from("not-midi"));
      const renderer = createFluidSynthRenderer({ execFile });
      await expect(renderer.render({ midiPath: badMidi, outputPath: join(f.dir, "bad.wav"), soundfontPath: f.soundfontPath }))
        .rejects.toBeInstanceOf(MidiRendererError);
      await expect(renderer.render({ midiPath: f.midiPath, outputPath: f.midiPath, soundfontPath: f.soundfontPath }))
        .rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(calls).toHaveLength(0);
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  });
});
