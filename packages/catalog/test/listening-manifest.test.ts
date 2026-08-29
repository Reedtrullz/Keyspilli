import { describe, expect, it } from "vitest";
import {
  DEFAULT_LISTENING_NORMALIZATION,
  LISTENING_WORKSHEET_DIMENSIONS,
  canonicalListeningManifestJson,
  createBlindAliases,
  createBlankListeningWorksheet,
  createListeningManifest,
  durationDiagnostics,
  normalizeExcerptRanges,
  renderListeningWorksheetMarkdown,
  validateExcerptRanges,
  type ListeningCandidateInput,
} from "../src/listening-manifest.js";

const candidates: ListeningCandidateInput[] = [
  {
    id: "metal-medium",
    label: "Direct metal — Medium",
    sourceType: "direct-metal",
    midiPath: "/private/tmp/evaluation/metal-medium.mid",
    wavPath: "/private/tmp/evaluation/metal-medium.wav",
    expectedDurationSeconds: 253.125,
    renderedDurationSeconds: 253.18,
    renderedSampleCount: 11_165_238,
  },
  {
    id: "piano-gabi",
    label: "Piano cover — Gabi",
    sourceType: "piano-cover-video",
    midiPath: "/Users/reidar/Downloads/piano-gabi.mid",
    wavPath: "/Users/reidar/Downloads/piano-gabi.wav",
    expectedDurationSeconds: 230.9,
    renderedDurationSeconds: 230.9,
    renderedSampleCount: 10_194_690,
  },
];

describe("listening manifest helpers", () => {
  it("creates candidate records with duration diagnostics and deterministic ordering", () => {
    const manifest = createListeningManifest({
      renderer: { backend: "fluidsynth", version: "2.3.5", sampleRate: 44_100, channels: 2 },
      candidates: [...candidates].reverse(),
      excerpts: [{ id: "opening", startSeconds: 0, endSeconds: 12, label: "Opening" }],
    });

    expect(manifest.candidates.map((candidate) => candidate.id)).toEqual(["metal-medium", "piano-gabi"]);
    expect(manifest.candidates[0]?.duration).toMatchObject({
      expectedSeconds: 253.125,
      actualSeconds: 253.18,
      status: "ok",
    });
    expect(manifest.candidates[0]?.renderedSampleCount).toBe(11_165_238);
    expect(manifest.excerpts).toEqual([{ id: "opening", label: "Opening", startSeconds: 0, endSeconds: 12 }]);
  });

  it("produces the same blind aliases regardless of candidate input order", () => {
    const first = createBlindAliases(["piano-gabi", "metal-medium"]);
    const second = createBlindAliases(["metal-medium", "piano-gabi"]);
    expect(first).toEqual(second);
    expect(first).toEqual([
      { alias: "A", candidateId: "metal-medium" },
      { alias: "B", candidateId: "piano-gabi" },
    ]);
    expect(createBlindAliases(["candidate-26", ...Array.from({ length: 26 }, (_, i) => `candidate-${i}`)]).at(-1)?.alias).toBe("AA");
  });

  it("rejects malformed, overlapping, duplicate, and out-of-range excerpts", () => {
    const errors = validateExcerptRanges([
      { id: "bad", startSeconds: 8, endSeconds: 4 },
      { id: "bad", startSeconds: 4, endSeconds: 9 },
      { id: "negative", startSeconds: -1, endSeconds: 2 },
      { id: "late", startSeconds: 10, endSeconds: 12 },
    ], { durationSeconds: 10 });
    expect(errors).toEqual(expect.arrayContaining([
      "excerpt bad must end after it starts",
      "duplicate excerpt id: bad",
      "excerpt negative startSeconds must be non-negative",
      "excerpt late ends after the available duration",
    ]));

    expect(() => normalizeExcerptRanges([{ id: "bad", startSeconds: 0, endSeconds: 0 }])).toThrow(/invalid listening excerpts/i);
    expect(normalizeExcerptRanges([
      { id: "z", startSeconds: 4, endSeconds: 8 },
      { id: "a", startSeconds: 0, endSeconds: 2 },
    ])).toEqual([
      { id: "a", startSeconds: 0, endSeconds: 2 },
      { id: "z", startSeconds: 4, endSeconds: 8 },
    ]);
  });

  it("keeps canonical manifest records path-safe and deterministic", () => {
    const manifest = createListeningManifest({
      renderer: {
        backend: "fluidsynth",
        version: "2.3.5",
        sampleRate: 44_100,
        channels: 2,
        soundfont: { identifier: "evaluation-piano", sha256: "a".repeat(64), path: "/Users/reidar/secret/piano.sf2" },
      },
      candidates,
      blind: true,
    });
    const canonical = canonicalListeningManifestJson(manifest);
    expect(canonical).not.toContain("/private/tmp");
    expect(canonical).not.toContain("/Users/reidar");
    expect(canonical).toContain("metal-medium.mid");
    expect(canonical).toContain("piano-gabi.wav");
    expect(canonical).toContain('"sampleRate":44100');
    expect(canonical).toBe(canonicalListeningManifestJson(createListeningManifest({
      renderer: manifest.renderer,
      candidates: [...candidates].reverse(),
      blind: true,
    })));
  });

  it("reports unavailable and out-of-tolerance render durations", () => {
    expect(durationDiagnostics(undefined, undefined)).toMatchObject({ status: "unavailable", deltaSeconds: null });
    expect(durationDiagnostics(10, 10.04, 0.1)).toMatchObject({ status: "ok", deltaSeconds: 0.04 });
    expect(durationDiagnostics(10, 10.25, 0.1)).toMatchObject({ status: "warning", deltaSeconds: 0.25 });
    expect(durationDiagnostics(10, -1)).toMatchObject({ status: "invalid" });
  });

  it("provides explicit deterministic normalization defaults", () => {
    expect(DEFAULT_LISTENING_NORMALIZATION).toEqual({
      method: "peak",
      targetPeakDb: -1,
      maxGainDb: 12,
      sampleRate: 44_100,
      channels: 2,
    });
    const manifest = createListeningManifest({ renderer: { backend: "fluidsynth", version: "x", sampleRate: 48_000, channels: 1 }, candidates });
    expect(manifest.normalization).toEqual({ ...DEFAULT_LISTENING_NORMALIZATION, sampleRate: 48_000, channels: 1 });
  });

  it("creates a blank worksheet without inventing subjective scores", () => {
    const worksheet = createBlankListeningWorksheet(candidates, { title: "Defence of Moscow — blind pass" });
    expect(worksheet.candidates).toHaveLength(2);
    expect(worksheet.candidates[0]?.scores).toEqual(Object.fromEntries(LISTENING_WORKSHEET_DIMENSIONS.map((dimension) => [dimension, null])));
    expect(worksheet.candidates[0]?.wouldRecognize).toBeNull();
    expect(worksheet.candidates[0]?.largestAudibleDefect).toBe("");
    const markdown = renderListeningWorksheetMarkdown(worksheet);
    expect(markdown).toMatch(/Recognizability/);
    expect(markdown).toMatch(/Melody correctness/);
    expect(markdown).toMatch(/Would I recognize the song without seeing its title\?/);
    expect(markdown).toMatch(/Largest audible defect/);
    expect(markdown).not.toMatch(/\| [1-5] \|/);
  });
});
