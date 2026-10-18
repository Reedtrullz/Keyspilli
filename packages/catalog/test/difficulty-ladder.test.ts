import { describe, expect, it } from "vitest";
import {
  buildVariants,
  LEVEL_ORDER,
  parseMidi,
  verifyMonotonicity,
  writeVariantArtifacts,
  type Note,
  type ParsedMidi,
  type Variant,
} from "@keyspilli/midi";
import {
  canonicalDifficultyLadderJson,
  evaluateDifficultyLadder,
  type ProvenanceTraceEvent,
} from "../src/arrangement-evaluation.js";
import { sha256Hex } from "../src/fixture-evidence.js";

function sourceNotes(): Note[] {
  const melody = [60, 60, 62, 64, 65, 64, 62, 60].map((midi, index) => ({
    midi,
    start: index,
    dur: 0.75,
    vel: index === 0 ? 108 : 88,
    hand: "R" as const,
    identitySource: "vocals" as const,
  }));
  const roots = [36, 36, 43, 43].map((midi, index) => ({
    midi,
    start: index * 2,
    dur: 1.5,
    vel: 86,
    hand: "L" as const,
    identitySource: "guitar" as const,
  }));
  return [...melody, ...roots];
}

function parsed(notes: Note[]): ParsedMidi {
  return {
    format: 1,
    division: 480,
    tempoBpm: 120,
    tempoMetaPresent: true,
    keySig: 0,
    keyMode: 0,
    timeSig: [4, 4],
    notes,
    trackNames: ["synthetic ladder"],
    durationBeats: 8,
    title: "Synthetic ladder",
  };
}

function learnerVariants(notes = sourceNotes()): { variants: Variant[]; trace: ProvenanceTraceEvent[] } {
  const trace: ProvenanceTraceEvent[] = [];
  const variants = buildVariants(parsed(notes), { title: "Synthetic ladder", artist: "Test" }, {
    arrangementProfile: "learner",
    maxDurBeats: null,
    trace: { record: (event) => trace.push(event) },
  });
  return { variants, trace };
}

function manualVariant(level: Variant["level"], notes: Note[], score: number): Variant {
  return {
    level,
    difficultyScore: score,
    notes: notes.map((note) => ({ ...note })),
    chords: [],
    bassPattern: "block",
    key: "C",
    tempoBpm: 120,
    timeSig: [4, 4],
    measures: [{ index: 0, startBeat: 0, endBeat: 8 }],
  };
}

function sameNotesVariants(notes: Note[] = sourceNotes()): Variant[] {
  return LEVEL_ORDER.map((level, index) => manualVariant(level, notes, [1, 1.4, 2, 2.6, 3.4, 4.6][index]!));
}

function eventDigest(notes: Note[]): string {
  const rows = notes
    .map((note) => [note.midi, note.start, note.dur, note.vel, note.hand ?? ""])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return sha256Hex(new TextEncoder().encode(JSON.stringify(rows)));
}

/** Compare the old pinned transport after removing only the new measure map
 * and terminal EOT delay. All original events and their encoded deltas survive. */
function legacyTransportDigest(bytes: Uint8Array): string {
  let position = 14, maps = 0;
  const tracks: number[] = [];
  const varint = () => {
    let value = 0;
    for (let index = 0; index < 4; index++) {
      const byte = bytes[position++]!;
      value = value * 128 + (byte & 127);
      if (!(byte & 128)) return value;
    }
    throw new Error("Invalid synthetic MIDI varint");
  };
  while (position < bytes.length) {
    expect(new TextDecoder().decode(bytes.slice(position, position + 4))).toBe("MTrk");
    const size = new DataView(bytes.buffer, bytes.byteOffset + position + 4, 4).getUint32(0);
    position += 8;
    const end = position + size, body: number[] = [];
    while (position < end) {
      const start = position, delta = varint(), status = bytes[position++]!;
      if (status === 255) {
        const type = bytes[position++]!, length = varint();
        const payload = new TextDecoder().decode(bytes.slice(position, position + length));
        position += length;
        if (type === 127 && payload.startsWith("keyspilli-notation-measures-v1:")) {
          expect(delta).toBe(0);
          maps++;
          continue;
        }
        if (type === 47) {
          expect(length).toBe(0);
          body.push(0, 255, 47, 0);
          continue;
        }
      } else {
        if (status < 128 || status >= 240) throw new Error("Unexpected synthetic MIDI event");
        position += (status & 240) === 192 || (status & 240) === 208 ? 1 : 2;
      }
      body.push(...bytes.slice(start, position));
    }
    expect(position).toBe(end);
    tracks.push(77, 84, 114, 107, (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255, ...body);
  }
  expect(maps).toBe(1);
  return sha256Hex(new Uint8Array([...bytes.slice(0, 14), ...tracks]));
}

describe("difficulty ladder calibration", () => {
  it("uses the canonical six-level order and emits deterministic all-level diagnostics", () => {
    const first = learnerVariants();
    const _second = learnerVariants([...sourceNotes()].reverse());
    const firstReport = evaluateDifficultyLadder({
      fixture: { id: "synthetic-ladder" },
      sourceNotes: sourceNotes(),
      variants: first.variants,
      trace: first.trace,
    });
    const secondReport = evaluateDifficultyLadder({
      fixture: { id: "synthetic-ladder" },
      sourceNotes: [...sourceNotes()].reverse(),
      variants: first.variants.map((variant) => ({ ...variant, notes: [...variant.notes].reverse() })),
      trace: [...first.trace].reverse(),
    });

    expect(firstReport.order).toEqual(LEVEL_ORDER);
    expect(firstReport.transitions).toHaveLength(5);
    expect(firstReport.levels.advanced?.difficultyScore).toBe(4.6);
    expect(firstReport.levels.advanced?.identity.sourceRhOnsetCoverage).toBe(1);
    expect(firstReport.levels["very-easy"]?.harmonicRootChanges).toBeGreaterThan(0);
    expect(firstReport.levels["very-easy"]?.repeatedAttackRate).toBeGreaterThanOrEqual(0);
    expect(firstReport.levels.easy?.lineage.traceAvailable).toBe(true);
    expect(firstReport.levels.easy?.lineage.operationCounts).toBeDefined();
    expect(canonicalDifficultyLadderJson(firstReport)).toBe(canonicalDifficultyLadderJson(secondReport));
    expect(verifyMonotonicity(first.variants)).toEqual([]);
  });

  it("keeps the pinned synthetic note transport while adding measure-map and EOT metadata", () => {
    const { variants } = learnerVariants();
    const expectedWriterDigests: Record<Variant["level"], string> = {
      "very-beginner": "b85b94214cbebc168b54f4898260b6301554c3eec7fa3be80bafb1b0f9d4d52c",
      beginner: "6eca3c2220a658482130f130887145597887915b64132ffe2ede1d72f1e49b32",
      "very-easy": "2e113869849a2a90ed676411973d5722e219c087b008b91e5965f27b248b4838",
      easy: "2e113869849a2a90ed676411973d5722e219c087b008b91e5965f27b248b4838",
      medium: "6676e7472f34c9f59df2fa9c0ed183b97d27446b0a089184ea654b9b723ec711",
      advanced: "6676e7472f34c9f59df2fa9c0ed183b97d27446b0a089184ea654b9b723ec711",
    };

    expect(variants.map((variant) => variant.level)).toEqual(LEVEL_ORDER);
    const actualWriterDigests: Record<Variant["level"], string> = {} as Record<Variant["level"], string>;
    for (const variant of variants) {
      const rendered = writeVariantArtifacts(variant, "Synthetic ladder", "Test");
      const roundTripped = parseMidi(rendered.midi);
      expect(eventDigest(roundTripped.notes), variant.level).toBe(eventDigest(variant.notes));
      expect(roundTripped.tempoBpm, variant.level).toBeCloseTo(variant.tempoBpm, 2);
      expect(roundTripped.notationMeasures, variant.level).toEqual(variant.measures);
      expect(roundTripped.durationBeats, variant.level).toBe(8);
      expect(roundTripped.repeatPlayback, variant.level).toBeUndefined();
      expect(writeVariantArtifacts(variant, "Synthetic ladder", "Test").midi, variant.level).toEqual(rendered.midi);
      actualWriterDigests[variant.level] = legacyTransportDigest(rendered.midi);
    }
    expect(actualWriterDigests).toEqual(expectedWriterDigests);
  });

  it("counts difficulty operations and exposes a stable identity/harmony lineage", () => {
    const notes = [...sourceNotes(), { midi: 60, start: 0.25, dur: 0.125, vel: 86, hand: "R" as const, identitySource: "vocals" as const }];
    const variants = sameNotesVariants(notes);
    const trace: ProvenanceTraceEvent[] = [
      { key: "difficulty:easy:octave", stage: "difficulty", operation: "OCTAVE_SHIFTED", selected: true },
      { key: "difficulty:medium:merge", stage: "difficulty", operation: "MERGED", selected: true },
    ];
    const report = evaluateDifficultyLadder({ fixture: { id: "lineage" }, sourceNotes: notes, variants, trace });

    expect(report.levels.easy?.lineage.operationCounts).toEqual({ OCTAVE_SHIFTED: 1 });
    expect(report.levels.medium?.lineage.operationCounts).toEqual({ MERGED: 1 });
    expect(report.levels.advanced?.lineage.sourceNotesMatched).toBe(notes.length);
    expect(report.levels["very-easy"]?.harmonicRootChanges).toBe(1);
    expect(report.levels["very-easy"]?.repeatedAttackRate).toBeGreaterThan(0);
    expect(report.transitions.every((transition) => transition.classification === "REDUNDANT_LEVEL")).toBe(true);
    expect(report.transitions.every((transition) => transition.violations.length === 0)).toBe(true);
  });

  it("classifies a missing identity edge as a non-monotonic transition", () => {
    const notes = sourceNotes();
    const variants = sameNotesVariants(notes);
    const veryEasy = variants.find((variant) => variant.level === "very-easy")!;
    veryEasy.notes.push({ midi: 72, start: 8, dur: 0.5, vel: 70, hand: "R", identitySource: "vocals" });
    const report = evaluateDifficultyLadder({ fixture: { id: "cliff" }, sourceNotes: notes, variants });
    const transition = report.transitions.find((entry) => entry.harder === "easy" && entry.easier === "very-easy");

    expect(transition?.violations).toContain("note count increased");
    expect(transition?.classification).toBe("NON_MONOTONIC");
  });

  it("rejects duplicate level records instead of silently overwriting diagnostics", () => {
    const variants = sameNotesVariants();
    expect(() => evaluateDifficultyLadder({
      fixture: { id: "duplicate" },
      sourceNotes: sourceNotes(),
      variants: [variants[0]!, variants[0]!],
    })).toThrow(/duplicate difficulty level/i);
  });

  it("keeps omitted levels explicit in the report order", () => {
    const variants = sameNotesVariants().filter((variant) => variant.level !== "beginner");
    const report = evaluateDifficultyLadder({ fixture: { id: "partial" }, sourceNotes: sourceNotes(), variants });
    expect(report.order).toEqual(["very-beginner", "very-easy", "easy", "medium", "advanced"]);
    expect(report.transitions).toHaveLength(3);
  });

  it("counts the final phrase group as an anchor", () => {
    const notes = [0, 1, 2, 6].map((start) => ({
      midi: 60,
      start,
      dur: 0.25,
      vel: 80,
      hand: "R" as const,
      identitySource: "vocals" as const,
    }));
    const variants = sameNotesVariants(notes).map((variant) => ({
      ...variant,
      notes: variant.notes.filter((note) => note.start < 6),
    }));
    const report = evaluateDifficultyLadder({ fixture: { id: "phrase-end" }, sourceNotes: notes, variants });
    expect(report.levels.advanced?.identity.anchorSurvival).toBe(0.5);
  });
});
