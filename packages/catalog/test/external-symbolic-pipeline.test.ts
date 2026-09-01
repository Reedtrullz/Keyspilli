import { describe, expect, it } from "vitest";
import type { Note } from "@keyspilli/midi";
import type { ExternalResearchRecord } from "../src/external-research.js";
import {
  buildExternalSymbolicArrangement,
  evaluateRouteCoverage,
  freezeGenerationCandidateSet,
  type ExternalRouteCoverageAttribution,
} from "../src/external-symbolic-pipeline.js";

const score = (pitch = 60) => ({
  title: "Synthetic source",
  parts: [{ id: "lead", name: "Lead Voice", measures: [{ id: "m1", startBeat: 0, durationBeats: 4, events: [{ onset: 0, duration: 1, pitch }] }] }],
});

function record(overrides: Partial<ExternalResearchRecord> = {}): ExternalResearchRecord {
  const candidate = {
    id: "candidate-a",
    evidenceClass: "VERIFIED_NATIVE_SYMBOLIC" as const,
    purpose: "GENERATION_CANDIDATE" as const,
    provenance: { sourceRef: "synthetic:lead", acquiredVia: "local-bytes" },
    content: { sha256: "a".repeat(64), byteLength: 8, mediaType: "audio/midi" },
    status: "parsed" as const,
    roles: [{ role: "melody" as const, confidence: 0.9 }],
  };
  return {
    id: "record-a",
    songId: "song-a",
    title: "Synthetic source",
    provider: "synthetic",
    evidenceClass: "VERIFIED_NATIVE_SYMBOLIC",
    purpose: "GENERATION_CANDIDATE",
    discovery: { status: "local-supplied", sourceRef: "synthetic:lead", sourcePage: null },
    acquisition: { status: "local-bytes", method: "local-bytes" },
    content: { sha256: "a".repeat(64), byteLength: 8, mediaType: "audio/midi" },
    parser: { status: "parsed", format: "midi", adapter: "synthetic", warnings: [], error: null },
    roles: [{ partId: "lead", partName: "Lead Voice", role: "melody", confidence: 0.9, certainty: "uncertain", signals: [], eventCount: 1, pitchRange: [pitchFor(record), pitchFor(record)] as [number, number], monophonic: true, density: 1, percussion: false, timingOnly: false, alternatives: [] }],
    alignment: { status: "aligned", reason: null },
    generationUsable: true,
    rejectionReasons: [],
    candidate,
    score: score(),
    canonical: null,
    ...overrides,
  };
}

function pitchFor(_record: unknown): number { return 60; }

const notes: Note[] = [
  { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" },
  { midi: 64, start: 1, dur: 2, vel: 90, hand: "R" },
];

describe("external symbolic generation boundary", () => {
  it("rejects benchmark and malformed candidates before selection", () => {
    const benchmark = record({ id: "benchmark", purpose: "BENCHMARK_REFERENCE", evidenceClass: "BENCHMARK_REFERENCE", generationUsable: false });
    const malformed = record({ id: "malformed", parser: { status: "invalid", format: "midi", adapter: null, warnings: [], error: "bad" }, score: null });
    const frozen = freezeGenerationCandidateSet([benchmark, malformed, record()]);
    expect(frozen.selected.map((entry) => entry.recordId)).toEqual(["record-a"]);
    expect(frozen.rejected.map((entry) => entry.recordId)).toEqual(["benchmark", "malformed"]);
    expect(frozen.rejected.flatMap((entry) => entry.reasons).join(" ")).toMatch(/benchmark|parsed|score/i);
    expect(JSON.stringify(frozen)).not.toMatch(/BENCHMARK_REFERENCE/);
  });

  it("is order invariant and freezes path-safe metadata with sections", () => {
    const first = record({ id: "first", candidate: { ...record().candidate!, id: "first", provenance: { sourceRef: "synthetic:first", acquiredVia: "local-bytes", physicalPath: "/Users/reidar/private/song.mid" }, notes: [{ midi: 1 }] } });
    const second = record({ id: "second", candidate: { ...record().candidate!, id: "second", provenance: { sourceRef: "synthetic:second", acquiredVia: "local-bytes" }, content: { sha256: "b".repeat(64) } } });
    const config = { sections: { first: [{ id: "verse", candidate: [0, 4] as [number, number], confidence: 0.8 }] } };
    const forward = freezeGenerationCandidateSet([second, first], config);
    const reverse = freezeGenerationCandidateSet([first, second], config);
    expect(forward.digest).toBe(reverse.digest);
    expect(forward.selected[0]?.sections).toEqual([{ id: "verse", candidate: [0, 4], confidence: 0.8 }]);
    expect(JSON.stringify(forward)).not.toMatch(/Users\/reidar|private\/song|"notes"/);
    expect(Object.isFrozen(forward.selected)).toBe(true);
    expect(Object.isFrozen(forward.selected[0])).toBe(true);
  });

  it("enforces alignment and confidence gates", () => {
    const ambiguous = record({ id: "ambiguous", alignment: { status: "ambiguous", reason: "two anchors" } });
    const low = record({ id: "low", candidate: { ...record().candidate!, confidence: { parse: 0.2, identity: 0.3 } } });
    const frozen = freezeGenerationCandidateSet([ambiguous, low], { requireAlignment: true, minimumConfidence: 0.5 });
    expect(frozen.selected).toHaveLength(0);
    expect(frozen.rejected.find((entry) => entry.recordId === "ambiguous")?.reasons.join(" ")).toMatch(/alignment/i);
    expect(frozen.rejected.find((entry) => entry.recordId === "low")?.reasons.join(" ")).toMatch(/confidence/i);
  });

  it("delegates only frozen symbolic sources when explicit windows are supplied", () => {
    const frozen = freezeGenerationCandidateSet([record()]);
    const result = buildExternalSymbolicArrangement({
      candidateSet: frozen,
      sources: [{ id: "record-a", notes, sourceType: "piano-symbolic" }],
      windows: [{ id: "intro", startBeat: 0, endBeat: 2, candidateId: "record-a" }],
    });
    expect(result.status).toBe("symbolic");
    expect(result.selectedRecordIds).toEqual(["record-a"]);
    expect(result.notes?.length).toBeGreaterThan(0);
  });

  it("can realize normalized score events without accepting an unfrozen source", () => {
    const frozen = freezeGenerationCandidateSet([record()]);
    const result = buildExternalSymbolicArrangement({
      candidateSet: frozen,
      windows: [{ id: "intro", startBeat: 0, endBeat: 2, candidateId: "record-a" }],
    });
    expect(result.status).toBe("symbolic");
    expect(result.notes?.some((note) => note.midi === 60)).toBe(true);
  });

  it("returns explicit fallback or unavailable without usable evidence", () => {
    const fallback = buildExternalSymbolicArrangement({ candidateSet: freezeGenerationCandidateSet([]) });
    expect(fallback).toMatchObject({ status: "fallback", selectedRecordIds: [] });
    const unavailable = buildExternalSymbolicArrangement({ candidateSet: freezeGenerationCandidateSet([]), fallbackEnabled: false });
    expect(unavailable).toMatchObject({ status: "unavailable", selectedRecordIds: [] });
    expect(unavailable.notes).toBeUndefined();
  });
});

describe("explicit evidence-class route coverage", () => {
  it("returns null attribution when no explicit class mapping is supplied", () => {
    const coverage = evaluateRouteCoverage({ notes });
    expect(coverage.totalNotes).toBe(2);
    expect(coverage.attributedNotePercentage).toBeNull();
    expect(coverage.attributedDurationPercentage).toBeNull();
    expect(coverage.diagnostics.join(" ")).toMatch(/attribution/i);
  });

  it("uses only explicit note-index attribution and reports deterministic confidence", () => {
    const attributions: ExternalRouteCoverageAttribution[] = [
      { noteIndices: [0], evidenceClass: "VERIFIED_NATIVE_SYMBOLIC", confidence: 0.8 },
      { noteIndices: [1], evidenceClass: "PIANO_COVER_SYMBOLIC", confidence: 0.6 },
    ];
    const coverage = evaluateRouteCoverage({ notes, attributions });
    expect(coverage.attributedNotePercentage).toBe(100);
    expect(coverage.byEvidenceClass.VERIFIED_NATIVE_SYMBOLIC).toMatchObject({ noteCount: 1, notePercentage: 50, durationBeats: 1, durationPercentage: 33.333 });
    expect(coverage.byEvidenceClass.PIANO_COVER_SYMBOLIC?.confidence).toEqual({ min: 0.6, median: 0.6, max: 0.6 });
    expect(JSON.stringify(coverage)).not.toMatch(/identitySource/);
  });
});
