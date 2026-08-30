import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseMidi, writeMidi, type Note } from "@keyspilli/midi";
import {
  buildLocalReferenceListening,
  localReferenceListeningJson,
} from "../src/local-reference-listening.js";
import type { MidiAudioRenderer, MidiRenderResult } from "../src/midi-renderer.js";

const temporaryDirectories: string[] = [];

function wavPcm16(samples: number[], sampleRate = 8_000): Uint8Array {
  const data = new Uint8Array(samples.length * 2);
  const dataView = new DataView(data.buffer);
  samples.forEach((sample, index) => dataView.setInt16(index * 2, sample, true));
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + data.length, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, data.length, true);
  return new Uint8Array([...new Uint8Array(header), ...data]);
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fakeRenderer(
  failingRoles: ReadonlySet<string> = new Set(),
  reportedRenderer: { id: string; version: string } = { id: "fluidsynth", version: "pcm16-v1" },
): MidiAudioRenderer {
  return {
    id: "fluidsynth",
    version: "pcm16-v1",
    async render(input): Promise<MidiRenderResult> {
      const role = basename(input.outputPath).replace(/\.wav$/, "");
      if (failingRoles.has(role)) throw new Error(`synthetic renderer failed for ${role}`);
      const midiBytes = new Uint8Array(await readFile(input.midiPath));
      const parsed = parseMidi(midiBytes);
      const wavBytes = wavPcm16([0, 10_000, -20_000, 30_000]);
      await writeFile(input.outputPath, wavBytes);
      const expectedSeconds = parsed.durationBeats * 60 / parsed.tempoBpm;
      return {
        renderer: {
          id: reportedRenderer.id as MidiRenderResult["renderer"]["id"],
          version: reportedRenderer.version as MidiRenderResult["renderer"]["version"],
          executable: "/private/bin/fluidsynth", sampleRate: 8_000, gain: 1, targetPeak: 0.95,
        },
        midi: { path: input.midiPath, sha256: hash(midiBytes), tempoBpm: parsed.tempoBpm, durationBeats: parsed.durationBeats, expectedSeconds },
        soundfont: { path: "C:\\Users\\reidar\\private\\evaluation.sf2", bytes: 17, sha256: "a".repeat(64) },
        wav: {
          path: input.outputPath,
          bytes: wavBytes.byteLength,
          sampleRate: 8_000,
          channels: 1,
          bitsPerSample: 16,
          frameCount: 4,
          sampleCount: 4,
          durationSeconds: 4 / 8_000,
          peak: 30_000 / 32_768,
          rms: 0.4,
          silenceRatio: 0.25,
          clippingCount: 0,
          sha256: hash(wavBytes),
        },
        duration: {
          expectedSeconds,
          renderedSeconds: 4 / 8_000,
          deltaSeconds: expectedSeconds - 4 / 8_000,
          toleranceSeconds: 2,
          status: "warning",
        },
      };
    },
  };
}

function referenceMidi(): Uint8Array {
  const melody: Note[] = [
    { midi: 72, start: 0, dur: 1, vel: 100, hand: "R" },
    { midi: 74, start: 1, dur: 1, vel: 100, hand: "R" },
    { midi: 76, start: 2, dur: 1, vel: 100, hand: "R" },
  ];
  const accompaniment: Note[] = [
    { midi: 48, start: 0, dur: 2, vel: 70, hand: "L" },
    { midi: 52, start: 0, dur: 2, vel: 70, hand: "L" },
    { midi: 55, start: 0, dur: 2, vel: 70, hand: "L" },
    { midi: 50, start: 2, dur: 1, vel: 70, hand: "L" },
  ];
  return writeMidi([...melody, ...accompaniment], {
    tempoBpm: 120,
    timeSig: [4, 4],
    title: "Synthetic reference",
    tracks: [
      { name: "Reference right hand melody", notes: melody },
      { name: "Reference left hand accompaniment", notes: accompaniment },
    ],
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local reference listening bundle", () => {
  it("renders full, melody, accompaniment, and an opening excerpt with path-free metadata", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-source-"));
    const outputRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-listening-"));
    temporaryDirectories.push(sourceRoot, outputRoot);
    const sourcePath = join(sourceRoot, "reference.mid");
    await writeFile(sourcePath, referenceMidi());

    const first = await buildLocalReferenceListening({
      scoreId: "synthetic-reference",
      title: "Synthetic Reference",
      referenceMidiPath: sourcePath,
      reviewQueue: {
        unresolvedRegions: ["measure-2"],
        items: [{
          id: "review-1", page: 1, system: 2, measureId: "measure-2", measureNumber: "2", role: "melody",
          evidence: ["check contour at /Users/reidar/private/page.png"], reasonCategory: "pitch",
          backendValues: { audiveris: ["F4"], homr: ["F#4"] },
          backendInterpretations: { audiveris: ["melody"], homr: ["sharp accidental"] },
          context: { keySignature: 0, timeSignature: [4, 4], startBeat: 4, durationBeats: 4, structural: { agreement: 0.5, evidence: ["path: /private/source.png"] } },
          recommendedAction: "Listen against the source.",
        } as never],
      },
    }, { outputRoot, repositoryRoot: process.cwd(), renderer: fakeRenderer() });

    expect(first.status).toBe("RENDERED");
    expect(first.source).toMatchObject({ roleBasis: "midi-hand", melodyNoteCount: 3, accompanimentNoteCount: 4 });
    expect(first.renders.map((render) => render.role)).toEqual(["accompaniment", "full", "melody"]);
    expect(first.outputs.openingExcerptWav).toBe("scores/synthetic-reference/listening/reference-opening.wav");
    expect(first.renderer).toMatchObject({
      id: "fluidsynth", version: "pcm16-v1", sampleRate: 8_000, channels: 1, gain: 1, targetPeak: 0.95,
      soundfont: { identifier: "evaluation.sf2", bytes: 17, sha256: "a".repeat(64) },
    });
    expect(first.determinism).toMatchObject({
      basis: "path-free-report-without-determinism",
      canonicalSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(first)).not.toContain(sourceRoot);
    expect(JSON.stringify(first)).not.toContain("/private/bin");
    expect(JSON.stringify(first)).not.toContain("/Users/reidar");
    expect(JSON.stringify(first)).not.toContain("C:\\Users\\reidar");
    expect(first.review.items[0]).toMatchObject({
      id: "review-1", importance: "melody", page: 1, system: 2, measureId: "measure-2",
      backendValues: { audiveris: ["F4"], homr: ["F#4"] },
      backendInterpretations: { audiveris: ["melody"], homr: ["sharp accidental"] },
      context: { startBeat: 4, durationBeats: 4, structural: { agreement: 0.5 } },
    });
    expect(first.review.items[0]?.reason).not.toContain("/Users/reidar");

    const listeningRoot = join(outputRoot, "scores", "synthetic-reference", "listening");
    for (const file of [
      "reference.mid", "reference-full.wav", "reference-opening.wav", "reference-melody.mid", "reference-melody.wav",
      "reference-accompaniment.mid", "reference-accompaniment.wav", "review-queue.json", "manifest.json", "LISTENING.md", "LISTENING.html",
    ]) await expect(stat(join(listeningRoot, file))).resolves.toBeTruthy();
    expect(await readdir(listeningRoot)).toEqual(expect.arrayContaining(["reference-full.wav", "reference-opening.wav"]));
    expect(await readFile(join(listeningRoot, "LISTENING.md"), "utf8")).toContain("review-queue.json");
    expect(JSON.parse(await readFile(join(listeningRoot, "review-queue.json"), "utf8"))).toMatchObject({
      kind: "local-score-reference-review-queue",
      items: [{ id: "review-1" }],
    });
    expect(await readFile(join(listeningRoot, "LISTENING.html"), "utf8")).toContain("audio");
    const melody = parseMidi(new Uint8Array(await readFile(join(listeningRoot, "reference-melody.mid"))));
    const accompaniment = parseMidi(new Uint8Array(await readFile(join(listeningRoot, "reference-accompaniment.mid"))));
    expect(melody.notes).toHaveLength(3);
    expect(accompaniment.notes).toHaveLength(4);

    const second = await buildLocalReferenceListening({
      scoreId: "synthetic-reference",
      title: "Synthetic Reference",
      referenceMidiPath: sourcePath,
      reviewQueue: {
        unresolvedRegions: ["measure-2"],
        items: [{
          id: "review-1", page: 1, system: 2, measureId: "measure-2", measureNumber: "2", role: "melody",
          evidence: ["check contour at /Users/reidar/private/page.png"], reasonCategory: "pitch",
          backendValues: { audiveris: ["F4"], homr: ["F#4"] },
          backendInterpretations: { audiveris: ["melody"], homr: ["sharp accidental"] },
          context: { keySignature: 0, timeSignature: [4, 4], startBeat: 4, durationBeats: 4, structural: { agreement: 0.5, evidence: ["path: /private/source.png"] } },
          recommendedAction: "Listen against the source.",
        } as never],
      },
    }, {
      outputRoot, repositoryRoot: process.cwd(), renderer: fakeRenderer(),
    });
    expect(localReferenceListeningJson(first)).toBe(localReferenceListeningJson(second));
  });

  it("does not leave stale WAVs visible after a rerun loses its renderer", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-stale-source-"));
    const outputRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-stale-output-"));
    temporaryDirectories.push(sourceRoot, outputRoot);
    const sourcePath = join(sourceRoot, "reference.mid");
    await writeFile(sourcePath, referenceMidi());

    await buildLocalReferenceListening({ scoreId: "stale-render", referenceMidiPath: sourcePath }, {
      outputRoot, repositoryRoot: process.cwd(), renderer: fakeRenderer(),
    });
    const listeningRoot = join(outputRoot, "scores", "stale-render", "listening");
    await expect(stat(join(listeningRoot, "reference-full.wav"))).resolves.toBeTruthy();

    // The second input has no lower role. A stale accompaniment artifact must
    // disappear even though the current run has no accompaniment target.
    await writeFile(sourcePath, writeMidi([
      { midi: 72, start: 0, dur: 1, vel: 100, hand: "R" },
    ], { tempoBpm: 120 }));
    const rerun = await buildLocalReferenceListening({ scoreId: "stale-render", referenceMidiPath: sourcePath }, {
      outputRoot, repositoryRoot: process.cwd(), renderer: fakeRenderer(new Set(["reference-full", "reference-melody"])),
    });
    expect(rerun.status).toBe("UNAVAILABLE");
    await expect(stat(join(listeningRoot, "reference-full.wav"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(listeningRoot, "reference-opening.wav"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(listeningRoot, "reference-accompaniment.mid"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(listeningRoot, "reference-accompaniment.wav"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses a pitch split when hand metadata is absent", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-pitch-source-"));
    const outputRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-pitch-output-"));
    temporaryDirectories.push(sourceRoot, outputRoot);
    const sourcePath = join(sourceRoot, "reference.mid");
    await writeFile(sourcePath, writeMidi([
      { midi: 72, start: 0, dur: 1, vel: 100 }, { midi: 55, start: 0, dur: 1, vel: 70 },
    ], { tempoBpm: 120, tracks: [{ name: "Track A", notes: [{ midi: 72, start: 0, dur: 1, vel: 100 }] }, { name: "Track B", notes: [{ midi: 55, start: 0, dur: 1, vel: 70 }] }] }));
    const report = await buildLocalReferenceListening({ scoreId: "pitch-reference", referenceMidiPath: sourcePath }, { outputRoot, repositoryRoot: process.cwd(), renderer: fakeRenderer() });
    expect(report.source.roleBasis).toBe("pitch-threshold-60");
    expect(report.source.melodyNoteCount).toBe(1);
    expect(report.source.accompanimentNoteCount).toBe(1);
  });

  it("keeps derived artifacts and indexes when rendering is unavailable", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-fail-source-"));
    const outputRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-fail-output-"));
    temporaryDirectories.push(sourceRoot, outputRoot);
    const sourcePath = join(sourceRoot, "reference.mid");
    await writeFile(sourcePath, referenceMidi());
    const report = await buildLocalReferenceListening({ scoreId: "failed-reference", referenceMidiPath: sourcePath }, {
      outputRoot, repositoryRoot: process.cwd(), renderer: fakeRenderer(new Set(["reference-full", "reference-melody", "reference-accompaniment"])),
    });
    expect(report.status).toBe("UNAVAILABLE");
    expect(report.renderer).toBeNull();
    expect(report.renders).toHaveLength(0);
    expect(report.errors).toHaveLength(3);
    expect(report.outputs.fullWav).toBeNull();
    expect(report.outputs.melodyWav).toBeNull();
    expect(report.outputs.accompanimentWav).toBeNull();
    expect(report.outputs.openingExcerptWav).toBeNull();
    for (const file of ["reference.mid", "reference-melody.mid", "reference-accompaniment.mid"]) {
      await expect(stat(join(outputRoot, "scores", "failed-reference", "listening", file))).resolves.toBeTruthy();
    }
    for (const file of ["reference-full.wav", "reference-melody.wav", "reference-accompaniment.wav", "reference-opening.wav"]) {
      await expect(stat(join(outputRoot, "scores", "failed-reference", "listening", file))).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(stat(join(outputRoot, "scores", "failed-reference", "listening", "manifest.json"))).resolves.toBeTruthy();
    expect(JSON.stringify(report)).not.toContain(sourceRoot);
  });

  it("keeps renderer identity logical and path-free", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-renderer-source-"));
    const outputRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-renderer-output-"));
    temporaryDirectories.push(sourceRoot, outputRoot);
    const sourcePath = join(sourceRoot, "reference.mid");
    await writeFile(sourcePath, referenceMidi());

    const report = await buildLocalReferenceListening({ scoreId: "renderer-labels", referenceMidiPath: sourcePath }, {
      outputRoot,
      repositoryRoot: process.cwd(),
      renderer: fakeRenderer(new Set(), { id: "/Users/reidar/bin/fluidsynth", version: "../private/renderer" }),
    });

    expect(report.renderer).toMatchObject({ id: "renderer", version: "unknown" });
    expect(JSON.stringify(report)).not.toContain("/Users/reidar");
    expect(JSON.stringify(report)).not.toContain("../private/renderer");
  });

  it("fails closed for repository paths, symlinked output roots, and unsafe logical IDs", async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-path-source-"));
    const outputRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-path-output-"));
    const repositoryRoot = await mkdtemp(join(tmpdir(), "keyspilli-reference-path-repository-"));
    temporaryDirectories.push(sourceRoot, outputRoot, repositoryRoot);
    const sourcePath = join(sourceRoot, "reference.mid");
    await writeFile(sourcePath, referenceMidi());

    await expect(buildLocalReferenceListening({ scoreId: "../escape", referenceMidiPath: sourcePath }, {
      outputRoot, repositoryRoot, renderer: fakeRenderer(),
    })).rejects.toThrow("path-safe logical id");
    await expect(buildLocalReferenceListening({ scoreId: "safe", referenceMidiPath: sourcePath }, {
      outputRoot: join(repositoryRoot, "derived"), repositoryRoot, renderer: fakeRenderer(),
    })).rejects.toThrow("outside the repository");

    const outputLink = join(sourceRoot, "output-link");
    await symlink(outputRoot, outputLink);
    await expect(buildLocalReferenceListening({ scoreId: "safe", referenceMidiPath: sourcePath }, {
      outputRoot: outputLink, repositoryRoot, renderer: fakeRenderer(),
    })).rejects.toThrow("must not be a symbolic link");

    const inRepositorySource = join(repositoryRoot, "reference.mid");
    await writeFile(inRepositorySource, referenceMidi());
    await expect(buildLocalReferenceListening({ scoreId: "safe", referenceMidiPath: inRepositorySource }, {
      outputRoot, repositoryRoot, renderer: fakeRenderer(),
    })).rejects.toThrow("reference MIDI must be outside the repository");
  });
});
