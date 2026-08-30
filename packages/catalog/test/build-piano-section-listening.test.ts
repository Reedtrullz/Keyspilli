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
      coverage: {
        candidates: {
          C: [{
            windowId: "opening", startBeat: 0, endBeat: 4, hasSourceMaterial: true,
            alignmentConfidence: 0.92, chromaAgreement: 0.88, attackAgreement: 0.86,
            melodicAgreement: 0.9, usable: true, rejectionReasons: [],
          }],
          D: [{
            windowId: "opening", startBeat: 0, endBeat: 4, hasSourceMaterial: true,
            alignmentConfidence: 0.1, chromaAgreement: 0.1, attackAgreement: 0.1,
            melodicAgreement: 0.1, usable: false, rejectionReasons: ["unrelated candidate"],
          }],
        },
        gate: {},
      },
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
    expect(await readdir(join(outputDirectory, "source-midi"))).toEqual(expect.arrayContaining([
      "C-accompaniment-only.mid",
      "C-melody-only.mid",
      "C-raw.mid",
      "D-accompaniment-only.mid",
      "D-melody-only.mid",
      "D-raw.mid",
    ]));
    const manifest = JSON.parse(await readFile(join(outputDirectory, "manifest.json"), "utf8")) as Record<string, unknown>;
    expect(manifest.humanEvaluation).toMatchObject({
      status: "pending",
      ratings: null,
      priorCandidateReviews: [
        expect.objectContaining({ candidateId: "C", priorLabel: "PianoPaul05", status: "context-only" }),
        expect.objectContaining({ candidateId: "D", priorLabel: "Pøsle", status: "context-only" }),
      ],
    });
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
    expect(listening).toContain("## Human listening worksheet");
    expect(listening).toContain("Is the main melody recognizable?");
    expect(listening).toContain("blind-map.json");
    const blind = JSON.parse(await readFile(join(outputDirectory, "blind-map.json"), "utf8")) as Record<string, { candidateId: string; sha256: string; midiSha256: string; recoveredFromManifestSha256: string }>;
    expect(Object.keys(blind).sort()).toEqual(["A", "B", "C", "D"]);
    expect(Object.values(blind).map((entry) => entry.candidateId).sort()).toEqual([
      "C-original-easy",
      "C-revoiced-easy",
      "CD-fused-easy",
      "CD-fused-medium",
    ].sort());
    expect(Object.values(blind).map((entry) => entry.candidateId)).toEqual([
      "C-original-easy",
      "C-revoiced-easy",
      "CD-fused-easy",
      "CD-fused-medium",
    ]);
    expect(Object.values(blind).every((entry) => entry.recoveredFromManifestSha256 === "4a63a62fac7e195f995439d8311fe43c24fb0e9b75069e66c6311a7c7e2a7ff8")).toBe(true);
    expect(Object.values(blind).every((entry) => typeof entry.sha256 === "string" && entry.sha256.length === 64)).toBe(true);
    expect(Object.values(blind).every((entry) => entry.midiSha256 === entry.sha256)).toBe(true);
    expect(JSON.parse(await readFile(join(outputDirectory, "coverage-map.json"), "utf8"))).toMatchObject({
      schemaVersion: 1,
      windows: [{ id: "opening", startBeat: 0, endBeat: 4, selectedMelodySource: "C", fallbackUsed: false }],
    });
    expect(JSON.parse(await readFile(join(outputDirectory, "selected-region-map.json"), "utf8"))).toHaveProperty("coverage");
    expect(JSON.parse(await readFile(join(outputDirectory, "evidence-manifest.json"), "utf8"))).toMatchObject({
      coverageMap: "coverage-map.json",
      blindMap: "blind-map.json",
    });
    expect(JSON.parse(await readFile(join(outputDirectory, "manifest.json"), "utf8"))).toMatchObject({
      sourceIsolation: { openingWindowId: "opening" },
      newCandidates: { opening: {}, full: {} },
    });
    expect(listening).toContain("## Opening source isolation");
    expect(listening).toContain("## New candidate renders");
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
