import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeMidi, type Note } from "@keyspilli/midi";
import { buildPianoSectionListeningBundle } from "../scripts/build-piano-section-listening.js";

const temporaryDirectories: string[] = [];

function sourceMidi(notes: Note[]): Uint8Array {
  return writeMidi(notes, {
    tempoBpm: 120,
    title: "local piano candidate",
    tracks: [{ name: "Imported piano", notes }],
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local piano section listening bundle", () => {
  it("writes the seven local MIDI artifacts and a path-free pending manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-section-listening-"));
    temporaryDirectories.push(directory);
    const cPath = join(directory, "c.mid");
    const dPath = join(directory, "d.mid");
    const cEasyPath = join(directory, "c-easy.mid");
    const soundfontPath = join(directory, "evaluation-piano.sf2");
    const soundfontBytes = Buffer.from("synthetic soundfont");
    const notes: Note[] = [
      { midi: 72, start: 0, dur: 1, vel: 110 },
      { midi: 74, start: 1, dur: 1, vel: 110 },
      { midi: 48, start: 0, dur: 2, vel: 70 },
      { midi: 52, start: 0, dur: 2, vel: 70 },
      { midi: 55, start: 0, dur: 2, vel: 70 },
      { midi: 76, start: 2, dur: 1, vel: 110 },
      { midi: 74, start: 3, dur: 1, vel: 110 },
    ];
    await Promise.all([
      writeFile(cPath, sourceMidi(notes)),
      writeFile(dPath, sourceMidi(notes.map((note) => ({ ...note, midi: note.midi + 12 })))),
      writeFile(cEasyPath, sourceMidi(notes)),
      writeFile(soundfontPath, soundfontBytes),
    ]);

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = await buildPianoSectionListeningBundle({
      out: join(directory, "bundle"),
      cMidi: cPath,
      dMidi: dPath,
      cOriginalEasy: cEasyPath,
      windows: [{ id: "opening", startBeat: 0, endBeat: 4 }],
      dAlignment: { offsetBeats: 0, scale: 1, transposeSemitones: -12 },
      soundfont: soundfontPath,
      sampleRate: 44_100,
      gain: 1,
      targetPeak: 0.89,
      noRender: true,
    });

    expect(result.outputs).toEqual([
      "C-original-easy",
      "C-melody-only",
      "C-revoiced-easy",
      "C-revoiced-medium",
      "CD-selected-melody-only",
      "CD-fused-easy",
      "CD-fused-medium",
    ]);
    const outputDirectory = join(directory, "bundle");
    expect((await readdir(join(outputDirectory, "midi"))).sort()).toEqual([
      "C-melody-only.mid",
      "C-original-easy.mid",
      "C-revoiced-easy.mid",
      "C-revoiced-medium.mid",
      "CD-fused-easy.mid",
      "CD-fused-medium.mid",
      "CD-selected-melody-only.mid",
    ]);
    const manifest = JSON.parse(await readFile(join(outputDirectory, "manifest.json"), "utf8")) as Record<string, unknown>;
    expect(manifest.humanEvaluation).toMatchObject({ status: "pending", ratings: null });
    expect(manifest.renderer).toMatchObject({
      id: "fluidsynth",
      version: "pcm16-v1",
      backend: "fluidsynth",
      sampleRate: 44_100,
      channels: 2,
      gain: 1,
      targetPeak: 0.89,
      renderStatus: "not-rendered",
      soundfont: {
        status: "configured",
        identifier: "evaluation-piano.sf2",
        bytes: soundfontBytes.byteLength,
        sha256: createHash("sha256").update(soundfontBytes).digest("hex"),
      },
    });
    expect((manifest.renderer as Record<string, unknown>).executable).toBeUndefined();
    expect(manifest.normalization).toMatchObject({
      method: "peak",
      targetPeak: 0.89,
      targetPeakDb: expect.closeTo(20 * Math.log10(0.89), 0.000001),
      format: "pcm16",
      sampleRate: 44_100,
      channels: 2,
    });
    expect(JSON.stringify(manifest)).not.toContain(directory);
    expect(JSON.stringify(manifest)).not.toContain("/Users/");
    expect(manifest.excerpts).toEqual({});
    const canonical = await readFile(join(outputDirectory, "manifest.canonical.json"), "utf8");
    expect(canonical).not.toContain(directory);
    expect(canonical).toContain('"kind": "local-piano-section-listening-bundle"');
    const listening = await readFile(join(outputDirectory, "LISTENING.md"), "utf8");
    expect(listening).toContain("- A: [WAV](blind/A.wav)");
    expect(listening).not.toMatch(/- A:.*C-original-easy/);
    expect(result.rendered).toBe(false);
  });

  it("rejects window ids that could escape the bundle directory", async () => {
    await expect(buildPianoSectionListeningBundle({
      out: "/private/tmp/unused-keyspilli-bundle",
      cMidi: "/private/tmp/missing-c.mid",
      dMidi: "/private/tmp/missing-d.mid",
      windows: [{ id: "../../escape", startBeat: 0, endBeat: 4 }],
      dAlignment: { offsetBeats: 0, scale: 1, transposeSemitones: 0 },
      sampleRate: 44_100,
      gain: 1,
      targetPeak: 0.89,
      noRender: true,
    })).rejects.toThrow(/path-safe id/);
  });
});
