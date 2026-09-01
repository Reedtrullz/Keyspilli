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
    identityStatus: overrides.identityStatus ?? "UNKNOWN",
    versionStatus: overrides.versionStatus ?? "UNKNOWN",
    identityReasons: overrides.identityReasons ?? ["synthetic fixture"],
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

  it("rejects candidates listed in a protected benchmark manifest before freezing", () => {
    const protectedHash = "b".repeat(64);
    const protectedPath = "/tmp/corpus-a";
    const protectedLineage = "fixture-set:opaque-1";
    const manifest = {
      benchmarkReferenceManifest: {
        sha256: [protectedHash],
        paths: [protectedPath],
        lineage: [protectedLineage],
      },
    };
    const protectedCandidates = [
      record({ id: "protected-hash", content: { sha256: protectedHash, byteLength: 8, mediaType: "audio/midi" }, candidate: { ...record().candidate!, content: { sha256: protectedHash } } }),
      record({ id: "protected-path", candidate: { ...record().candidate!, provenance: { sourceRef: "provider:opaque", acquiredVia: "local-import", physicalPath: `${protectedPath}/song.mid` } } }),
      record({ id: "protected-lineage", candidate: { ...record().candidate!, lineage: { parent: protectedLineage } } }),
    ];

    const frozen = freezeGenerationCandidateSet(protectedCandidates, manifest);

    expect(frozen.selected).toHaveLength(0);
    expect(frozen.rejected.map((entry) => entry.recordId)).toEqual([
      "protected-hash",
      "protected-lineage",
      "protected-path",
    ]);
    expect(frozen.rejected.flatMap((entry) => entry.reasons).join(" ")).toMatch(/protected benchmark reference manifest/i);
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

  it("honors an explicit per-window candidate lock and reports only selected regions", () => {
    const primary = record({
      id: "primary-source",
      candidate: { ...record().candidate!, id: "primary-source" },
      score: score(60),
    });
    const alternate = record({
      id: "alternate-source",
      candidate: { ...record().candidate!, id: "alternate-source", content: { sha256: "b".repeat(64) } },
      content: { sha256: "b".repeat(64), byteLength: 8, mediaType: "audio/midi" },
      score: score(84),
    });
    const result = buildExternalSymbolicArrangement({
      candidateSet: freezeGenerationCandidateSet([primary, alternate]),
      mode: "direct-piano",
      primaryRecordId: "primary-source",
      windows: [{ id: "locked", startBeat: 0, endBeat: 2, candidateId: "alternate-source" }],
      fallbackEnabled: false,
    });

    expect(result.status).toBe("symbolic");
    expect(result.selectedRecordIds).toEqual(["alternate-source"]);
    expect(result.canonical?.notes.some((note) => note.midi === 84)).toBe(true);
    expect(result.canonical?.notes.some((note) => note.midi === 60)).toBe(false);
  });

  it("accepts an explicit per-window candidate allow-list while preserving score selection without one", () => {
    const primary = record({
      id: "primary-source",
      candidate: { ...record().candidate!, id: "primary-source" },
      score: score(60),
    });
    const alternate = record({
      id: "alternate-source",
      candidate: { ...record().candidate!, id: "alternate-source", content: { sha256: "b".repeat(64) } },
      content: { sha256: "b".repeat(64), byteLength: 8, mediaType: "audio/midi" },
      score: score(84),
    });
    const frozen = freezeGenerationCandidateSet([primary, alternate]);
    const locked = buildExternalSymbolicArrangement({
      candidateSet: frozen,
      mode: "direct-piano",
      primaryRecordId: "primary-source",
      windows: [{ id: "allow-listed", startBeat: 0, endBeat: 2, candidateIds: ["alternate-source"] }],
      fallbackEnabled: false,
    });
    const unlocked = buildExternalSymbolicArrangement({
      candidateSet: frozen,
      mode: "direct-piano",
      primaryRecordId: "primary-source",
      windows: [{ id: "unlocked", startBeat: 0, endBeat: 2 }],
      fallbackEnabled: false,
    });

    expect(locked.selectedRecordIds).toEqual(["alternate-source"]);
    expect(locked.canonical?.notes.some((note) => note.midi === 84)).toBe(true);
    // Without a lock the section remains score-selected.  These fixtures are
    // intentionally tied on evidence, so the selector's deterministic ID
    // tie-break chooses the alternate rather than treating primaryRecordId as
    // an implicit lock.
    expect(unlocked.selectedRecordIds).toEqual(["alternate-source"]);
    expect(unlocked.canonical?.notes.some((note) => note.midi === 84)).toBe(true);
    expect(unlocked.canonical?.notes.some((note) => note.midi === 60)).toBe(false);
  });

  it("fails closed when a window lock references an unfrozen candidate", () => {
    const result = buildExternalSymbolicArrangement({
      candidateSet: freezeGenerationCandidateSet([record()]),
      mode: "direct-piano",
      windows: [{ id: "missing", startBeat: 0, endBeat: 2, candidateId: "not-frozen" }],
      fallbackEnabled: false,
    });

    expect(result.status).toBe("unavailable");
    expect(result.fallbackReason).toMatch(/unfrozen|candidate/i);
  });

  it("requires an immutable, digest-consistent frozen set at realization", () => {
    const frozen = freezeGenerationCandidateSet([record()]);
    const bypass = buildExternalSymbolicArrangement({
      candidates: frozen.selected,
      windows: [{ id: "intro", startBeat: 0, endBeat: 2, candidateId: "record-a" }],
      fallbackEnabled: false,
    });
    expect(bypass.status).toBe("unavailable");
    const mutable = { ...frozen, selected: [...frozen.selected] };
    const forged = buildExternalSymbolicArrangement({ candidateSet: mutable, windows: [{ id: "intro", startBeat: 0, endBeat: 2, candidateId: "record-a" }], fallbackEnabled: false });
    expect(forged.status).toBe("unavailable");
  });

  it("binds realization to the frozen normalized score events", () => {
    const frozen = freezeGenerationCandidateSet([record()]);
    const original = frozen.selected[0]!;
    const forgedScore = JSON.parse(JSON.stringify(original.score)) as typeof original.score;
    forgedScore.parts[0]!.measures[0]!.events![0]!.pitch += 1;
    const deepFreeze = <T>(value: T): T => {
      if (value && typeof value === "object" && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const key of Object.getOwnPropertyNames(value)) deepFreeze((value as Record<string, unknown>)[key]);
      }
      return value;
    };
    const forgedEntry = { ...original };
    Object.defineProperty(forgedEntry, "score", {
      value: deepFreeze(forgedScore),
      enumerable: false,
      writable: false,
      configurable: false,
    });
    const forgedSet = deepFreeze({ ...frozen, selected: [deepFreeze(forgedEntry)] });
    const result = buildExternalSymbolicArrangement({
      candidateSet: forgedSet,
      windows: [{ id: "intro", startBeat: 0, endBeat: 2, candidateId: "record-a" }],
      fallbackEnabled: false,
    });
    expect(result.status).toBe("unavailable");
  });

  it("removes compound raw note, event, and byte payload keys from frozen metadata", () => {
    const candidate = { ...record().candidate!, noteEvents: [{ midi: 60 }], rawBytes: [1, 2], EventData: [{ pitch: 60 }] };
    const frozen = freezeGenerationCandidateSet([record({ candidate })]);
    expect(JSON.stringify(frozen)).not.toMatch(/noteEvents|rawBytes|EventData/);
  });

  it("rejects malformed section rows without throwing", () => {
    const frozen = freezeGenerationCandidateSet([record()], { sections: [null as never] });
    expect(frozen.selected).toHaveLength(0);
    expect(frozen.rejected[0]?.reasons.join(" ")).toMatch(/section/i);
  });

  it("requires a valid record content hash matching the candidate hash", () => {
    const missing = freezeGenerationCandidateSet([record({ content: { sha256: null, byteLength: 8, mediaType: "audio/midi" } })]);
    const mismatched = freezeGenerationCandidateSet([record({ content: { sha256: "b".repeat(64), byteLength: 8, mediaType: "audio/midi" } })]);
    expect(missing.selected).toHaveLength(0);
    expect(mismatched.selected).toHaveLength(0);
    expect(missing.rejected[0]?.reasons.join(" ")).toMatch(/hash/i);
    expect(mismatched.rejected[0]?.reasons.join(" ")).toMatch(/hash/i);
  });

  it("rejects non-array object section values without throwing", () => {
    const frozen = freezeGenerationCandidateSet([record()], { sections: { "record-a": null as never } });
    expect(frozen.selected).toHaveLength(0);
    expect(frozen.rejected[0]?.reasons.join(" ")).toMatch(/section/i);
  });

  it("keeps raw candidate payloads and unknown-root path fragments out of metadata", () => {
    const candidate = { ...record().candidate!, rawNoteBlob: [{ midi: 60 }], rawNoteBlob2: [{ midi: 60 }], note_payloads: [{ midi: 60 }], eventsByTrack: [{ pitch: 60 }], eventRows2: [{ pitch: 60 }], byteBuffer: [1, 2], metadata: { description: "/odd/private/path", unknown: "/secret", logical: "A/B", url: "https://example.test/a/b" } };
    const frozen = freezeGenerationCandidateSet([record({ candidate })]);
    const serialized = JSON.stringify(frozen);
    expect(serialized).not.toMatch(/rawNoteBlob|note_payloads|eventsByTrack|eventRows2|byteBuffer|odd\/private\/path|\/secret/);
    expect(serialized).toMatch(/A\/B|https:\/\/example\.test\/a\/b/);
  });

  it("keeps normalized score events local but excludes them from path-safe JSON", () => {
    const frozen = freezeGenerationCandidateSet([record({ score: { ...score(), metadata: { rawNoteBlob: [{ midi: 1 }], locator: "/odd/private/path" } } })]);
    expect(frozen.selected[0]?.score.parts).toHaveLength(1);
    expect(frozen.selected[0]?.score.metadata).toEqual({});
    expect(JSON.stringify(frozen)).not.toContain('"score"');
    expect(Object.isFrozen(frozen.selected[0]?.score)).toBe(true);
  });

  it("redacts arbitrary raw score arrays from frozen metadata and its digest", () => {
    const clean = record({
      candidate: { ...record().candidate!, metadata: { label: "typed-candidate" } },
      score: { ...score(), metadata: { label: "typed-score" } },
    });
    const raw = record({
      candidate: {
        ...record().candidate!,
        metadata: {
          label: "typed-candidate",
          payload: { pitches: [60, 64], starts: [0, 1], durations: [1, 2], midiMeta: [{ channel: 1 }] },
        },
      },
      score: {
        ...score(),
        metadata: {
          label: "typed-score",
          payload: { pitches: [60, 64], starts: [0, 1], durations: [1, 2], midiMeta: [{ channel: 1 }] },
        },
      },
    });
    const cleanFrozen = freezeGenerationCandidateSet([clean]);
    const rawFrozen = freezeGenerationCandidateSet([raw]);

    expect(rawFrozen.digest).toBe(cleanFrozen.digest);
    expect(rawFrozen.selected[0]?.candidate.metadata).toEqual({ label: "typed-candidate" });
    expect(rawFrozen.selected[0]?.score.metadata).toEqual({ label: "typed-score" });
    expect(JSON.stringify(rawFrozen)).not.toMatch(/pitches|starts|durations|midiMeta/);
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

  it("fails closed for malformed, negative, and incomplete aggregate attribution", () => {
    expect(() => evaluateRouteCoverage({ notes, attributions: null as never })).not.toThrow();
    expect(() => evaluateRouteCoverage({ notes, attributions: {} as never })).not.toThrow();
    const coverage = evaluateRouteCoverage({
      notes,
      attributions: [{ evidenceClass: "VERIFIED_NATIVE_SYMBOLIC", noteCount: -1, durationBeats: -2, confidence: -0.1 }],
      totalNotes: -2,
      totalDurationBeats: -3,
    });
    expect(coverage.attributedNotePercentage).toBeNull();
    expect(coverage.attributedDurationPercentage).toBeNull();
    expect(coverage.diagnostics.join(" ")).toMatch(/invalid|incomplete/i);
  });

  it("fails closed when route notes contain null or malformed entries", () => {
    const coverage = evaluateRouteCoverage({ notes: [null, notes[0], { dur: 1 }] as never });
    expect(coverage.totalNotes).toBe(1);
    expect(coverage.attributedNotePercentage).toBeNull();
    expect(coverage.diagnostics.join(" ")).toMatch(/note/i);
  });

  it("fails closed for Note values outside the MIDI contract", () => {
    const coverage = evaluateRouteCoverage({
      notes: [
        { midi: 128, start: 0, dur: 1, vel: 90 },
        { midi: 60, start: -1, dur: 1, vel: 90 },
        { midi: 60, start: 0, dur: 1, vel: 0 },
        notes[0]!,
      ],
      attributions: [{ evidenceClass: "VERIFIED_NATIVE_SYMBOLIC", noteIndices: [0] }],
    });
    expect(coverage.totalNotes).toBe(1);
    expect(coverage.attributedNotePercentage).toBeNull();
    expect(coverage.attributedDurationPercentage).toBeNull();
    expect(coverage.diagnostics.join(" ")).toMatch(/malformed|range|note/i);
  });
});

describe("external symbolic realization routes", () => {
  it("uses frozen score notes and preserves score metadata when caller sources are supplied", () => {
    const trusted = record({
      id: "frozen-score",
      candidate: { ...record().candidate!, id: "frozen-score" },
      score: {
        title: "Trusted score",
        tempoBpm: 92,
        timeSignature: [6, 8] as [number, number],
        keySignature: -3,
        parts: [{ id: "piano", name: "Piano", measures: [{ id: "m1", startBeat: 0, durationBeats: 6, events: [
          { onset: 0, duration: 2, pitch: 72, role: "melody" },
          { onset: 2, duration: 2, pitch: 48, role: "harmony" },
          { onset: 4, duration: 2, pitch: 74, role: "melody" },
        ] }] }],
      },
    });
    const frozen = freezeGenerationCandidateSet([trusted]);
    const callerNotes = [{ midi: 127, start: 0, dur: 6, vel: 127, hand: "R" as const }];
    const callerSource = { id: "frozen-score", notes: callerNotes, sourceType: "caller-supplied" };
    const result = buildExternalSymbolicArrangement({
      candidateSet: frozen,
      mode: "direct-piano",
      sources: [callerSource],
      primary: callerSource,
    });

    expect(result.status).toBe("symbolic");
    expect(result.canonical?.tempoBpm).toBeCloseTo(92, 3);
    expect(result.canonical).toMatchObject({ keySig: -3, timeSig: [6, 8] });
    expect(result.canonical?.notes.some((note) => note.midi === 72)).toBe(true);
    expect(result.canonical?.notes.some((note) => note.midi === 127)).toBe(false);
    expect(result.variants?.advanced).toMatchObject({ tempoBpm: 92, timeSig: [6, 8], key: "Eb" });
  });

  it("rejects section-scoped role selections that do not match an input window", () => {
    const frozen = freezeGenerationCandidateSet([record()]);
    const result = buildExternalSymbolicArrangement({
      candidateSet: frozen,
      mode: "direct-piano",
      roleSelections: [{ role: "melody", candidateId: "record-a", sectionIds: ["missing-section"] }],
      windows: [{ id: "verse", startBeat: 0, endBeat: 1, candidateId: "record-a" }],
      fallbackEnabled: false,
    });

    expect(result.status).toBe("unavailable");
    expect(result.fallbackReason).toMatch(/section|window/i);
  });

  it("preserves a direct piano source and emits canonical difficulty outputs", () => {
    const direct = record({
      id: "direct-piano",
      evidenceClass: "PIANO_COVER_SYMBOLIC",
      candidate: { ...record().candidate!, id: "direct-piano", evidenceClass: "PIANO_COVER_SYMBOLIC" },
      score: {
        title: "Direct piano",
        tempoBpm: 92,
        parts: [{ id: "piano", name: "Piano", measures: [{ id: "m1", startBeat: 0, durationBeats: 4, events: [
          { onset: 0, duration: 2, pitch: 72, role: "melody" },
          { onset: 0, duration: 2, pitch: 48, role: "harmony" },
          { onset: 2, duration: 2, pitch: 74, role: "melody" },
        ] }] }],
      },
    });
    const frozen = freezeGenerationCandidateSet([direct]);
    const result = buildExternalSymbolicArrangement({
      candidateSet: frozen,
      mode: "direct-piano",
      windows: [{ id: "full", startBeat: 0, endBeat: 4, candidateId: "direct-piano" }],
    });
    expect(result.route).toBe("EXTERNAL_SYMBOLIC_FIRST");
    expect(result.mode).toBe("direct-piano");
    expect(result.canonical?.notes.some((note) => note.midi === 72)).toBe(true);
    expect(result.variants?.advanced.notes.some((note) => note.midi === 72)).toBe(true);
    expect(result.variants?.medium).toBeDefined();
    expect(result.variants?.easy).toBeDefined();
    expect(result.provenance.some((entry) => entry.recordId === "direct-piano" && entry.role === "melody")).toBe(true);
  });

  it("selects a role-specific candidate per section without admitting other frozen sources", () => {
    const melody = record({
      id: "melody-source",
      candidate: { ...record().candidate!, id: "melody-source", roles: [{ role: "melody", confidence: 0.95 }] },
      score: score(79),
    });
    const alternate = record({
      id: "chorus-source",
      candidate: { ...record().candidate!, id: "chorus-source", content: { sha256: "b".repeat(64) }, roles: [{ role: "melody", confidence: 0.9 }] },
      content: { sha256: "b".repeat(64), byteLength: 8, mediaType: "audio/midi" },
      score: score(84),
    });
    const frozen = freezeGenerationCandidateSet([melody, alternate]);
    const result = buildExternalSymbolicArrangement({
      candidateSet: frozen,
      mode: "direct-piano",
      primaryRecordId: "melody-source",
      roleSelections: [{ role: "melody", candidateId: "chorus-source", sectionIds: ["chorus"] }],
      windows: [{ id: "chorus", startBeat: 0, endBeat: 4, candidateId: "chorus-source" }],
    });
    expect(result.selectedRecordIds).toEqual(["chorus-source"]);
    expect(result.provenance.some((entry) => entry.recordId === "chorus-source" && entry.sectionId === "chorus")).toBe(true);
    expect(result.canonical?.notes.some((note) => note.midi === 84)).toBe(true);
  });

  it("routes full-band symbolic parts through semantic piano roles and excludes drums", () => {
    const fullBand = record({
      id: "band-source",
      evidenceClass: "VERIFIED_STRUCTURED_BAND_SYMBOLIC",
      candidate: { ...record().candidate!, id: "band-source", evidenceClass: "VERIFIED_STRUCTURED_BAND_SYMBOLIC", roles: [
        { role: "melody", confidence: 0.9 }, { role: "bass-root", confidence: 0.85 }, { role: "harmony", confidence: 0.82 }, { role: "timing-only", confidence: 0.95 },
      ] },
      score: {
        title: "Band",
        tempoBpm: 118,
        parts: [
          { id: "vocals", name: "Lead vocals", role: "melody", measures: [{ id: "v1", startBeat: 0, durationBeats: 4, events: [{ onset: 0, duration: 1, pitch: 72 }, { onset: 2, duration: 1, pitch: 74 }] }] },
          { id: "bass", name: "Bass", role: "harmony", measures: [{ id: "b1", startBeat: 0, durationBeats: 4, events: [{ onset: 0, duration: 4, pitch: 40 }] }] },
          { id: "guitar", name: "Rhythm Guitar", role: "harmony", measures: [{ id: "g1", startBeat: 0, durationBeats: 4, events: [{ onset: 0, duration: 2, pitch: 52 }, { onset: 0, duration: 2, pitch: 59 }] }] },
          { id: "drums", name: "Drums", role: "rhythm", measures: [{ id: "d1", startBeat: 0, durationBeats: 4, events: [{ onset: 0, duration: 0.1, pitch: 36 }, { onset: 1, duration: 0.1, pitch: 38 }] }] },
        ],
      },
    });
    const frozen = freezeGenerationCandidateSet([fullBand]);
    const result = buildExternalSymbolicArrangement({
      candidateSet: frozen,
      mode: "semantic-band",
      windows: [{ id: "full", startBeat: 0, endBeat: 4, candidateId: "band-source" }],
    });
    expect(result.route).toBe("EXTERNAL_SYMBOLIC_FIRST");
    expect(result.mode).toBe("semantic-band");
    expect(result.semantic?.melody.length).toBeGreaterThan(0);
    expect(result.semantic?.harmony.length).toBeGreaterThan(0);
    expect(result.semantic?.timingOnly.length).toBeGreaterThan(0);
    expect(result.canonical?.notes.some((note) => note.identitySource === "vocals")).toBe(true);
    expect(result.canonical?.notes.some((note) => note.midi === 36 || note.midi === 38)).toBe(false);
    expect(result.variants?.easy).toBeDefined();
  });

  it("excludes timing-only parts from direct-piano notes", () => {
    const direct = record({
      id: "direct-with-drums",
      evidenceClass: "PIANO_COVER_SYMBOLIC",
      candidate: { ...record().candidate!, id: "direct-with-drums", evidenceClass: "PIANO_COVER_SYMBOLIC" },
      score: {
        title: "Direct with timing lane",
        tempoBpm: 120,
        parts: [
          { id: "piano", name: "Piano", measures: [{ id: "p1", startBeat: 0, durationBeats: 4, events: [{ onset: 0, duration: 1, pitch: 72, role: "melody" }] }] },
          { id: "drums", name: "Drums", role: "rhythm", measures: [{ id: "d1", startBeat: 0, durationBeats: 4, events: [{ onset: 0, duration: 1, pitch: 36 }, { onset: 1, duration: 1, pitch: 38 }] }] },
          { id: "timing", name: "Auxiliary", role: "rhythm", percussion: true, measures: [{ id: "t1", startBeat: 0, durationBeats: 4, events: [{ onset: 2, duration: 1, pitch: 42 }] }] },
        ],
      },
    });
    const result = buildExternalSymbolicArrangement({
      candidateSet: freezeGenerationCandidateSet([direct]),
      mode: "direct-piano",
      windows: [{ id: "full", startBeat: 0, endBeat: 4, candidateId: "direct-with-drums" }],
    });

    expect(result.status).toBe("symbolic");
    expect(result.canonical?.notes.some((note) => note.midi === 36 || note.midi === 38 || note.midi === 42)).toBe(false);
    expect(result.canonical?.notes.some((note) => note.midi === 72)).toBe(true);
  });

  it("clips semantic-band output to explicit requested windows", () => {
    const band = record({
      id: "clipped-band",
      evidenceClass: "VERIFIED_STRUCTURED_BAND_SYMBOLIC",
      candidate: { ...record().candidate!, id: "clipped-band", evidenceClass: "VERIFIED_STRUCTURED_BAND_SYMBOLIC", roles: [
        { role: "melody", confidence: 0.9 }, { role: "bass-root", confidence: 0.85 }, { role: "harmony", confidence: 0.82 },
      ] },
      score: {
        title: "Clipped band",
        tempoBpm: 120,
        parts: [
          { id: "vocals", name: "Lead vocals", role: "melody", measures: [{ id: "v1", startBeat: 0, durationBeats: 6, events: [{ onset: 0, duration: 1, pitch: 72 }, { onset: 2, duration: 1, pitch: 74 }, { onset: 4, duration: 1, pitch: 76 }] }] },
          { id: "bass", name: "Bass", role: "harmony", measures: [{ id: "b1", startBeat: 0, durationBeats: 6, events: [{ onset: 0, duration: 6, pitch: 40 }] }] },
          { id: "guitar", name: "Rhythm Guitar", role: "harmony", measures: [{ id: "g1", startBeat: 0, durationBeats: 6, events: [{ onset: 0, duration: 6, pitch: 52 }] }] },
        ],
      },
    });
    const result = buildExternalSymbolicArrangement({
      candidateSet: freezeGenerationCandidateSet([band]),
      mode: "semantic-band",
      windows: [{ id: "middle", startBeat: 1, endBeat: 5, candidateId: "clipped-band" }],
    });

    expect(result.status).toBe("symbolic");
    for (const notes of [result.semantic?.melody, result.semantic?.bass, result.semantic?.rhythm, result.semantic?.timingOnly]) {
      expect(notes?.every((note) => note.start >= 1 && note.start + note.dur <= 5)).toBe(true);
    }
  });

  it("applies candidate allow-lists to semantic-band sources as well as direct piano", () => {
    const makeBand = (id: string, pitch: number, hash: string) => record({
      id,
      evidenceClass: "VERIFIED_STRUCTURED_BAND_SYMBOLIC",
      content: { sha256: hash, byteLength: 8, mediaType: "audio/midi" },
      candidate: { ...record().candidate!, id, content: { sha256: hash, byteLength: 8, mediaType: "audio/midi" }, evidenceClass: "VERIFIED_STRUCTURED_BAND_SYMBOLIC", roles: [{ role: "melody", confidence: 0.9 }] },
      score: {
        title: id,
        tempoBpm: 120,
        parts: [{ id: "vocals", name: "Lead vocals", role: "melody", measures: [{ id: "m1", startBeat: 0, durationBeats: 4, events: [{ onset: 0, duration: 1, pitch }] }] }],
      },
    });
    const primary = makeBand("band-a", 60, "a".repeat(64));
    const alternate = makeBand("band-b", 84, "b".repeat(64));
    const result = buildExternalSymbolicArrangement({
      candidateSet: freezeGenerationCandidateSet([primary, alternate]),
      mode: "semantic-band",
      windows: [{ id: "intro", startBeat: 0, endBeat: 4, candidateIds: ["band-a"] }],
    });

    expect(result.status).toBe("symbolic");
    expect(result.selectedRecordIds).toEqual(["band-a"]);
    expect(result.semantic?.melody.some((note) => note.midi === 60)).toBe(true);
    expect(result.semantic?.melody.some((note) => note.midi === 84)).toBe(false);
  });

  it("returns an explicit audio AMT fallback route when symbolic evidence is absent", () => {
    const result = buildExternalSymbolicArrangement({ candidateSet: freezeGenerationCandidateSet([]) });
    expect(result).toMatchObject({
      status: "fallback",
      route: "AUDIO_AMT_FALLBACK",
      evidenceClass: "AUDIO_AMT_FALLBACK",
      selectedRecordIds: [],
    });
    expect(result.canonical).toBeUndefined();
  });
});
