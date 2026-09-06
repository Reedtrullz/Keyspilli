import { describe, expect, it } from "vitest";
import { buildVariants, type Note, type ParsedMidi, type Variant } from "@keyspilli/midi";
import {
  canonicalCoverRhCliffJson,
  evaluateCoverRhIdentityCliff,
  type ProvenanceTraceEvent,
} from "../src/index.js";

function variant(level: Variant["level"], notes: Note[]): Variant {
  return {
    level,
    difficultyScore: level === "advanced" ? 4.6 : level === "medium" ? 3.4 : level === "easy" ? 2.6 : level === "very-easy" ? 2 : level === "beginner" ? 1.4 : 1,
    notes: notes.map((note) => ({ ...note })),
    chords: [],
    bassPattern: "block",
    key: "C",
    tempoBpm: 120,
    timeSig: [4, 4],
    measures: [{ index: 0, startBeat: 0, endBeat: 8 }],
  };
}

function traceForThreeToTwo(): ProvenanceTraceEvent[] {
  const raw: ProvenanceTraceEvent[] = [0, 1, 2].map((index) => ({
    key: `raw-${index}`,
    stage: "raw",
    note: { midi: 60 + index * 2, start: index, dur: 0.75, vel: 90, hand: "R" },
    selected: true,
    operation: "RETAINED",
  }));
  const stage = (name: NonNullable<ProvenanceTraceEvent["stage"]>, ids: number[], selectedIds = ids): ProvenanceTraceEvent[] => ids.map((index) => ({
    key: `${name}-${index}`,
    stage: name,
    parentKeys: [`${name === "very-easy-rh-input" ? "raw" : name === "very-easy-playable" ? "very-easy-rh-input" : name === "beginner-rh-input" ? "very-easy-playable" : name === "beginner-rh-selected" ? "beginner-rh-input" : name === "beginner-assembled" ? "beginner-rh-selected" : name === "beginner-playable" ? "beginner-assembled" : name === "beginner-ladder" ? "beginner-playable" : "beginner-ladder"}-${index}`],
    note: { midi: 60 + index * 2, start: index, dur: 0.75, vel: 90, hand: "R" },
    selected: selectedIds.includes(index),
    operation: selectedIds.includes(index) ? "RETAINED" : "REJECTED",
  }));
  const ladder = [
    ...stage("very-easy-rh-input", [0, 1, 2]),
    ...stage("very-easy-playable", [0, 1, 2]),
    ...stage("beginner-rh-input", [0, 1, 2]),
    ...stage("beginner-rh-selected", [0, 1, 2]),
    ...stage("beginner-assembled", [0, 1, 2]),
    ...stage("beginner-playable", [0, 1, 2]),
    ...stage("beginner-ladder", [0, 1, 2], [0, 2]),
    ...stage("beginner-final", [0, 2]),
  ];
  const final = [0, 2].map((index) => ({
    key: `difficulty:beginner:${index}`,
    stage: "difficulty" as const,
    parentKeys: [`raw-${index}`],
    note: { midi: 60 + index * 2, start: index, dur: 0.75, vel: 90, hand: "R" as const },
    selected: true,
    operation: "RETAINED" as const,
  }));
  const veFinal = [0, 1, 2].map((index) => ({
    key: `difficulty:very-easy:${index}`,
    stage: "difficulty" as const,
    parentKeys: [`raw-${index}`],
    note: { midi: 60 + index * 2, start: index, dur: 0.75, vel: 90, hand: "R" as const },
    selected: true,
    operation: "RETAINED" as const,
  }));
  return [...raw, ...ladder, ...final, ...veFinal];
}

function parsed(notes: Note[]): ParsedMidi {
  return {
    format: 1,
    division: 480,
    tempoBpm: 120,
    keySig: 0,
    keyMode: 0,
    timeSig: [4, 4],
    notes,
    trackNames: ["synthetic cover"],
    durationBeats: 8,
  };
}

describe("cover RH cliff diagnostic", () => {
  it("attributes a one-to-zero RH loss to the ladder and keeps onset semantics separate", () => {
    const source: Note[] = [0, 1, 2].map((index) => ({ midi: 60 + index * 2, start: index, dur: 0.75, vel: 90, hand: "R" }));
    const report = evaluateCoverRhIdentityCliff({
      fixture: { id: "cover" },
      source,
      variants: [variant("advanced", source), variant("very-easy", source), variant("beginner", [source[0]!, source[2]!])],
      trace: traceForThreeToTwo(),
    });
    expect(report.status).toBe("ready");
    expect(report.transition.identity.eventCount).toMatchObject({ harder: 3, easier: 2, shared: 2, survival: 2 / 3 });
    expect(report.transition.identity.onsetCount).toMatchObject({ harder: 3, easier: 2, shared: 2, survival: 2 / 3 });
    expect(report.transition.fateCounts).toMatchObject({ RETAINED_1_TO_1: 2, REJECTED: 1 });
    expect(report.funnel.firstLossCounts["beginner-ladder"]).toBe(1);
    expect(report.counterfactual?.bypassedStage).toBe("beginner-ladder");
  });

  it("is deterministic under reordered input and returns partial output without trace", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" },
      { midi: 64, start: 1, dur: 1, vel: 90, hand: "R" },
      { midi: 48, start: 0, dur: 1, vel: 70, hand: "L" },
    ];
    const source: ParsedMidi = parsed(notes);
    const firstTrace: ProvenanceTraceEvent[] = [];
    const first = buildVariants(source, { title: "Cover", artist: "Test" }, { arrangementProfile: "learner", maxDurBeats: null, trace: { record: (event) => firstTrace.push(event) } });
    const secondTrace: ProvenanceTraceEvent[] = [];
    const second = buildVariants({ ...source, notes: [...notes].reverse() }, { title: "Cover", artist: "Test" }, { arrangementProfile: "learner", maxDurBeats: null, trace: { record: (event) => secondTrace.push(event) } });
    const firstReport = evaluateCoverRhIdentityCliff({ fixture: { id: "synthetic" }, source: notes, variants: first, trace: firstTrace });
    const secondReport = evaluateCoverRhIdentityCliff({ fixture: { id: "synthetic" }, source: [...notes].reverse(), variants: second, trace: secondTrace });
    expect(canonicalCoverRhCliffJson(firstReport)).toBe(canonicalCoverRhCliffJson(secondReport));
    const partial = evaluateCoverRhIdentityCliff({ fixture: { id: "synthetic" }, source: notes, variants: first });
    expect(partial.status).toBe("partial");
    expect(partial.counterfactual).toBeNull();
  });
});
