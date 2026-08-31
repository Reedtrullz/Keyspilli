import { describe, expect, it } from "vitest";
import {
  buildMidiCorpusBenchmark,
  buildMidiCorpusReport,
  buildMidiCorpusSongReport,
  canonicalMidiCorpusReportJson,
  computeMidiCorpusDefectClusters,
  type MidiCorpusSongReport,
} from "../src/midi-corpus-report.js";
import type { CanonicalMidi } from "../src/midi-corpus.js";

function fixture(title = "Synthetic corpus song"): CanonicalMidi {
  const note = (trackIndex: number, midi: number, startBeats: number, durationBeats: number) => ({
    trackIndex,
    channel: trackIndex,
    midi,
    velocity: 100,
    startTick: Math.round(startBeats * 480),
    endTick: Math.round((startBeats + durationBeats) * 480),
    startBeats,
    durationBeats,
    program: 0,
    percussion: false,
  });
  return {
    schemaVersion: 1,
    format: 1,
    division: 480,
    title,
    tempos: [{ tick: 0, bpm: 120 }],
    timeSignatures: [{ tick: 0, signature: [4, 4] }],
    keySignatures: [],
    tracks: [
      { index: 0, name: "Lead", channels: [0], programs: [], percussion: false, endTick: 1920, notes: [] },
      { index: 1, name: "Piano harmony", channels: [1], programs: [], percussion: false, endTick: 1920, notes: [] },
      { index: 2, name: "Bass", channels: [2], programs: [], percussion: false, endTick: 1920, notes: [] },
    ],
    notes: [
      note(0, 72, 0, 0.5), note(0, 74, 1, 0.5), note(0, 76, 2, 0.5),
      note(1, 60, 0, 1), note(1, 64, 0, 1), note(1, 67, 0, 1),
      note(1, 60, 1, 1), note(1, 64, 1, 1), note(1, 67, 1, 1),
      note(1, 60, 2, 1), note(1, 64, 2, 1), note(1, 67, 2, 1),
      note(2, 36, 0, 1), note(2, 36, 1, 1), note(2, 36, 2, 1),
    ],
  };
}

function report(id: string, title = "Synthetic corpus song"): MidiCorpusSongReport {
  return buildMidiCorpusSongReport({ id, title, referenceKind: "piano-target", canonical: fixture(title) });
}

function singleTrackPianoFixture(): CanonicalMidi {
  const source = fixture("Single-track piano target");
  return {
    ...source,
    tracks: [{
      index: 0,
      name: "Grand Piano",
      channels: [0],
      programs: [],
      percussion: false,
      endTick: 1920,
      notes: [],
    }],
    notes: source.notes.map((value) => ({ ...value, trackIndex: 0, channel: 0 })),
  };
}

describe("MIDI corpus report", () => {
  it("builds path-free deterministic source, role, and restrike diagnostics", () => {
    const first = report("song-a");
    const second = report("song-a");
    expect(first).toEqual(second);
    expect(first.identity.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(first.parser).toMatchObject({ tempoBpm: 120, durationBeats: 4, noteCount: 15 });
    expect(first.roles?.counts).toMatchObject({ melody: 3, harmony: 9, bass: 3 });
    expect(first.metrics?.accompanimentRestrikes.attackCount).toBeGreaterThan(0);
    expect(first.metrics?.accompanimentRestrikes.sameHarmonyRepeatedAttackRate).toBeGreaterThanOrEqual(0);
    expect(canonicalMidiCorpusReportJson(first)).toBe(canonicalMidiCorpusReportJson(second));
    expect(canonicalMidiCorpusReportJson(first)).not.toContain("/Users/");
  });

  it("reports derived semantic layers and direct-piano readiness", () => {
    const value = buildMidiCorpusSongReport({
      id: "single-piano",
      referenceKind: "direct-piano",
      canonical: singleTrackPianoFixture(),
    });

    expect(value.roles?.layerCounts).toEqual({
      fullSymbolic: { notes: 15, onsets: 3 },
      pianoTarget: { notes: 15, onsets: 3 },
      melody: { notes: 3, onsets: 3 },
      harmony: { notes: 12, onsets: 3 },
      bassRoot: { notes: 3, onsets: 3 },
      rhythmAttacks: { notes: 3, onsets: 3 },
    });
    expect(value.readiness).toMatchObject({
      pianoTarget: "READY_WITH_WARNINGS",
      melody: "READY_WITH_WARNINGS",
      harmony: "READY_WITH_WARNINGS",
      bassRoot: "READY_WITH_WARNINGS",
      rhythm: "READY_WITH_WARNINGS",
    });
    expect(value.readiness.reasons.melody.join(" ")).toContain("direct piano semantic melody layer");
    expect(computeMidiCorpusDefectClusters([value], 1).some((cluster) => cluster.kind === "MISSING_MELODY")).toBe(false);
  });

  it("fails the benchmark closed until five genuine aligned pairs exist", () => {
    const result = buildMidiCorpusBenchmark([
      { songId: "song-a", comparable: true, status: "aligned", alignedDurationBeats: 128, baseline: { revision: "old", coverage: { windows: 3, bars: 32, status: "aligned" } }, current: { revision: "new", coverage: { windows: 3, bars: 32, status: "aligned" } } },
      { songId: "song-b", comparable: true, status: "aligned", alignedDurationBeats: 128, baseline: { revision: "old", coverage: { windows: 3, bars: 32, status: "aligned" } }, current: { revision: "new", coverage: { windows: 3, bars: 32, status: "aligned" } } },
    ]);
    expect(result.status).toBe("insufficient-evidence");
    expect(result.comparableSongCount).toBe(2);
    expect(result.winner).toBeNull();
    expect(result.diagnostics[0]).toContain("at least 5");
  });

  it("requires explicit comparable duration evidence for an aligned pair", () => {
    const result = buildMidiCorpusBenchmark([
      {
        songId: "song-a",
        status: "aligned",
        baseline: { revision: "old", coverage: { windows: 3, bars: 32, status: "aligned" } },
        current: { revision: "new", coverage: { windows: 3, bars: 32, status: "aligned" } },
      },
    ], 1);
    expect(result.comparableSongCount).toBe(0);
    expect(result.comparisons[0]?.genuine).toBe(false);
  });

  it("requires aligned windows on both snapshots", () => {
    const result = buildMidiCorpusBenchmark([
      {
        songId: "song-asymmetric",
        comparable: true,
        status: "aligned",
        alignedDurationBeats: 128,
        baseline: { revision: "old", coverage: { windows: 3, bars: 32, status: "aligned" } },
        current: { revision: "new", coverage: { windows: 0, bars: 0, status: "aligned" } },
      },
    ], 1);
    expect(result.comparableSongCount).toBe(0);
    expect(result.comparisons[0]?.genuine).toBe(false);
  });

  it("only reports recurring defects after the configured occurrence threshold", () => {
    const songs = ["song-a", "song-b", "song-c"].map((id) => {
      const value = report(id);
      return {
        ...value,
        metrics: value.metrics
          ? {
            ...value.metrics,
            accompanimentRestrikes: {
              ...value.metrics.accompanimentRestrikes,
              attackCount: 16,
              sameHarmonyRepeatedAttackRate: 0.8,
            },
          }
          : null,
      };
    });
    const clusters = computeMidiCorpusDefectClusters(songs, 3);
    expect(clusters.some((cluster) => cluster.kind === "EXCESSIVE_CHORD_RESTRIKES")).toBe(true);
    expect(clusters.every((cluster) => cluster.occurrenceCount >= 3)).toBe(true);
  });

  it("does not turn unavailable metrics into a missing-melody defect cluster", () => {
    const songs = ["song-a", "song-b", "song-c"].map((id) => buildMidiCorpusSongReport({ id }));
    const clusters = computeMidiCorpusDefectClusters(songs, 1);
    expect(clusters.some((cluster) => cluster.kind === "MISSING_MELODY")).toBe(false);
  });

  it("uses harmonic change rate as the root-jitter signal", () => {
    const value = report("song-jitter");
    expect(value.metrics).not.toBeNull();
    const jitter = {
      ...value,
      metrics: value.metrics
        ? {
          ...value.metrics,
          accompanimentRestrikes: {
            ...value.metrics.accompanimentRestrikes,
            attackCount: 3,
            harmonicChangeCount: 2,
          },
        }
        : null,
    };
    const clusters = computeMidiCorpusDefectClusters([jitter], 1);
    expect(clusters.some((cluster) => cluster.kind === "ROOT_JITTER")).toBe(true);
  });

  it("keeps evaluation modes path-free and allowlisted at runtime", () => {
    const value = buildMidiCorpusSongReport({
      id: "song-modes",
      canonical: fixture(),
      evaluationModes: ["SEMANTIC_MELODY", "not-a-mode"] as never,
    });
    expect(value.evaluationModes).toEqual(["SEMANTIC_MELODY"]);
  });

  it("redacts absolute paths with spaces in arbitrary diagnostic values", () => {
    const serialized = canonicalMidiCorpusReportJson({
      trace: { source: "/Users/reidar/Private MIDI/Defence Of Moscow.mid" },
      note: "keep this diagnostic label",
    });
    expect(serialized).not.toContain("/Users/reidar");
    expect(serialized).not.toContain("Defence Of Moscow.mid");
    expect(serialized).toContain("keep this diagnostic label");
  });

  it("does not expose source paths through inferred role metadata", () => {
    const value = fixture();
    value.tracks[0]!.name = "/Users/reidar/private/secret.mid";
    const result = buildMidiCorpusSongReport({ id: "song-path", canonical: value });
    expect(result.tracks[0]?.name).toBeNull();
    expect(result.roles?.lanes.find((lane) => lane.trackIndex === 0)?.trackName).toBeNull();
    expect(JSON.stringify(result)).not.toContain("/Users/reidar");
  });

  it("does not claim source readiness when canonical data is absent", () => {
    const result = buildMidiCorpusSongReport({ id: "missing", referenceKind: "semantic-full-band" });
    expect(result.integrity.strictParse).toBe("failed");
    expect(result.readiness.pianoTarget).toBe("FAILED");
    expect(result.metrics).toBeNull();
    expect(result.diagnostics.join(" ")).toContain("unavailable");
  });
});
