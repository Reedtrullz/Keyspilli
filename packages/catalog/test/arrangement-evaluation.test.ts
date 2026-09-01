import { describe, expect, it } from "vitest";
import { canonicalEvaluationJson, compareArrangementReference, evaluateArrangement, type ArrangementEvaluationInput, type EvaluationWindow } from "../src/arrangement-evaluation.js";
import type { Note, ParsedMidi, Variant } from "@keyspilli/midi";

const parsed = (notes: Note[]): ParsedMidi => ({
  format: 1,
  division: 480,
  tempoBpm: 120,
  keySig: 0,
  keyMode: 0,
  timeSig: [4, 4],
  notes,
  trackNames: ["Piano"],
  durationBeats: Math.max(4, ...notes.map((n) => n.start + n.dur)),
});

const input = (notes: Note[]): ArrangementEvaluationInput => ({
  fixture: { id: "synthetic-metal" },
  candidate: { selector: "synthetic.mid", parsed: parsed(notes) },
});

describe("arrangement evaluation", () => {
  it("reports deterministic global and hand metrics using onset groups", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 1, vel: 100, hand: "R", identitySource: "vocals" },
      { midi: 64, start: 0.04, dur: 0.5, vel: 80, hand: "R", identitySource: "guitar" },
      { midi: 48, start: 0, dur: 1, vel: 90, hand: "L", identitySource: "guitar" },
      { midi: 50, start: 1, dur: 0.25, vel: 90, hand: "L", identitySource: "guitar" },
    ];
    const report = evaluateArrangement(input(notes));
    expect(report.schemaVersion).toBe(1);
    expect(report.candidate.parser.noteCount).toBe(4);
    expect(report.metrics.global.onsetCount).toBe(2);
    expect(report.metrics.rightHand.onsetCount).toBe(1);
    expect(report.metrics.leftHand.onsetCount).toBe(2);
    expect(report.metrics.source.final.right.vocals).toBe(1);
    expect(report.metrics.source.final.right.guitar).toBe(1);
    expect(report.metrics.global.simultaneity.max).toBe(3);
    expect(report.metrics.global.simultaneity.basis).toBe("event-boundary");
    expect(report.gate.mode).toBe("structural");
  });

  it("matches reference events one-to-one only inside explicit windows", () => {
    const candidate = parsed([
      { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" },
      { midi: 62, start: 1, dur: 1, vel: 90, hand: "R" },
      { midi: 64, start: 2, dur: 1, vel: 90, hand: "R" },
    ]);
    const reference = parsed([
      { midi: 60, start: 0.04, dur: 1, vel: 127, hand: "R" },
      { midi: 62, start: 1.04, dur: 1, vel: 127, hand: "R" },
      { midi: 64, start: 2.04, dur: 1, vel: 127, hand: "R" },
    ]);
    const report = evaluateArrangement({
      fixture: { id: "ref-test" },
      candidate: { selector: "candidate.mid", parsed: candidate },
      reference: {
        selector: "reference.mid",
        parsed: reference,
        aliasOf: "reference-canonical",
        windows: [{ id: "intro", candidate: [0, 3], reference: [0, 3] }],
      },
    });
    expect(report.reference?.status).toBe("insufficient-coverage");
    expect(report.reference?.windows[0]?.exactPitch.f1).toBe(1);
    expect(report.reference?.windows[0]?.matchedOnsets).toBe(3);
    expect(report.reference?.aliasOf).toBe("reference-canonical");
    expect(report.gate.mode).toBe("structural");
  });

  it("does not pass a reference gate when alignment coverage is insufficient", () => {
    const candidateNotes = Array.from({ length: 3 }, (_, index) => ({
      midi: 60 + index,
      start: index * 8,
      dur: 1,
      vel: 90,
      hand: "R" as const,
    }));
    const referenceNotes = Array.from({ length: 3 }, (_, index) => ({
      midi: 60 + index,
      start: index * 4,
      dur: 1,
      vel: 90,
      hand: "R" as const,
    }));
    const windows = [0, 1, 2].map((index) => ({
      id: `bar-${index}`,
      candidate: [index * 8, index * 8 + 8] as [number, number],
      reference: [index * 4, index * 4 + 4] as [number, number],
    }));
    const report = evaluateArrangement({
      fixture: { id: "short-reference" },
      candidate: { selector: "candidate.mid", parsed: parsed(candidateNotes) },
      reference: { selector: "reference.mid", parsed: parsed(referenceNotes), windows },
      windows,
      mode: "reference",
    });
    expect(report.reference?.status).toBe("insufficient-coverage");
    expect(report.reference?.alignmentCoverageBars).toBe(3);
    expect(report.gate.status).toBe("null");
    expect(report.gate.evaluated).toContain("reference alignment unavailable (insufficient-coverage)");
  });

  it("matches chord members one-to-one and never reuses a reference note", () => {
    const report = evaluateArrangement({
      fixture: { id: "chord-match" },
      candidate: { selector: "candidate.mid", parsed: parsed([
        { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" },
        { midi: 64, start: 0.02, dur: 1, vel: 90, hand: "R" },
        { midi: 67, start: 0.02, dur: 1, vel: 90, hand: "R" },
      ]) },
      reference: {
        selector: "reference.mid",
        parsed: parsed([
          { midi: 60, start: 0.04, dur: 1, vel: 127, hand: "R" },
          { midi: 67, start: 0.04, dur: 1, vel: 127, hand: "R" },
        ]),
        windows: [{ id: "bar", candidate: [0, 1], reference: [0, 1] }],
      },
    });
    const window = report.reference?.windows[0];
    expect(window?.matchedOnsets).toBe(1);
    expect(window?.exactPitchMatches).toBe(2);
    expect(window?.candidateNoteCount).toBe(3);
    expect(window?.referenceNoteCount).toBe(2);
    expect(window?.exactPitch.precision).toBe(0.667);
    expect(window?.exactPitch.recall).toBe(1);
  });

  it("fails closed when a reference is supplied without explicit reference bounds", () => {
    const report = evaluateArrangement({
      fixture: { id: "missing-alignment" },
      candidate: { selector: "candidate.mid", parsed: parsed([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]) },
      reference: {
        selector: "reference.mid",
        parsed: parsed([{ midi: 60, start: 0, dur: 1, vel: 127, hand: "R" }]),
      },
      windows: [{ id: "candidate-only", candidate: [0, 1] }],
    });
    expect(report.reference?.status).toBe("alignment-required");
    expect(report.reference?.exactPitch.f1).toBeNull();
  });

  it("fails closed when explicit candidate or reference notes are null", () => {
    const candidateReport = evaluateArrangement({
      fixture: { id: "null-candidate-notes" },
      candidate: { selector: "candidate.mid", notes: null as unknown as Note[] },
    });
    expect(candidateReport.gate.status).toBe("fail");
    expect(candidateReport.gate.failures).toContain("candidate notes are not an array");

    const referenceReport = evaluateArrangement({
      fixture: { id: "null-reference-notes" },
      candidate: { selector: "candidate.mid", notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }] },
      reference: {
        selector: "reference.mid",
        notes: null as unknown as Note[],
        windows: [{ id: "intro", candidate: [0, 1], reference: [0, 1] }],
      },
    });
    expect(referenceReport.gate.status).toBe("fail");
    expect(referenceReport.gate.failures).toContain("reference notes are not an array");
  });

  it("keeps canonical JSON independent of paths, timestamps, and input order", () => {
    const notes: Note[] = [
      { midi: 62, start: 1, dur: 1, vel: 90, hand: "R" },
      { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" },
    ];
    const a = evaluateArrangement(input(notes));
    const b = evaluateArrangement({
      ...input([...notes].reverse()),
      candidate: { ...input(notes).candidate, selector: "/private/user/synthetic.mid" },
    });
    expect(canonicalEvaluationJson(a)).toBe(canonicalEvaluationJson(b));
    expect(canonicalEvaluationJson(a)).not.toContain("generatedAt");
    expect(canonicalEvaluationJson(a)).not.toContain("/private");
  });

  it("normalizes explicit windows and provenance trace ordering", () => {
    const base = input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]);
    const a = evaluateArrangement({
      ...base,
      windows: [
        { id: "b", candidate: [2, 4] },
        { id: "a", candidate: [0, 2] },
      ],
      trace: {
        status: "available",
        events: [
          { key: "z", stage: "final", source: "guitar" },
          { key: "a", stage: "raw", source: "other" },
        ],
      },
    });
    const b = evaluateArrangement({
      ...base,
      windows: [
        { id: "a", candidate: [0, 2] },
        { id: "b", candidate: [2, 4] },
      ],
      trace: {
        status: "available",
        events: [
          { key: "a", stage: "raw", source: "other" },
          { key: "z", stage: "final", source: "guitar" },
        ],
      },
    });
    expect(canonicalEvaluationJson(a)).toBe(canonicalEvaluationJson(b));
  });

  it("orders same-onset source transitions deterministically and counts large hand leaps", () => {
    const notes: Note[] = [
      { midi: 60, start: 0, dur: 1, vel: 90, hand: "R", identitySource: "other" },
      { midi: 72, start: 0, dur: 1, vel: 90, hand: "R", identitySource: "vocals" },
      { midi: 85, start: 1, dur: 1, vel: 90, hand: "R", identitySource: "guitar" },
    ];
    const report = evaluateArrangement(input(notes));
    expect(report.metrics.source.transitions).toBe(1);
    expect(report.metrics.global.handSpanViolations).toBe(1);
    const reversed = evaluateArrangement(input([...notes].reverse()));
    expect(canonicalEvaluationJson(report)).toBe(canonicalEvaluationJson(reversed));
  });

  it("reports optional guitar diagnostics and an unavailable provenance trace", () => {
    const report = evaluateArrangement({
      ...input([{ midi: 64, start: 0, dur: 1, vel: 90, hand: "R", identitySource: "guitar" }]),
      guitarDiagnostics: {
        rawGuitarNotes: 8,
        leadNotes: 3,
        residualNotes: 5,
        onsetClusterCount: 4,
        semanticAttackCount: 2,
        collapsedUnisonOctaveFifth: 6,
        rejectedWeakThirds: 1,
        bassSupportedRoots: 2,
        stabilizedTransitions: 1,
        emittedLeftHandEvents: 2,
        fallbackWindows: 0,
        qualityCounts: { power: 1, major: 1 },
      },
    });
    expect(report.metrics.guitar.rawGuitarNotes).toBe(8);
    expect(report.trace?.status).toBe("unavailable");
    expect(report.gate.availability.variants).toBe("unavailable");
  });

  it("reports learner variants independently from canonical arrangement diagnostics", () => {
    const variantNotes: Note[] = Array.from({ length: 8 }, (_, index) => ({
      midi: 60 + (index % 3),
      start: index * 0.5,
      dur: 0.25,
      vel: 90,
      hand: index % 2 === 0 ? "R" : "L",
      identitySource: index % 2 === 0 ? "guitar" : "other",
    }));
    const variant: Variant = {
      level: "easy",
      difficultyScore: 0.4,
      notes: variantNotes,
      chords: [],
      bassPattern: "root-fifth",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    };
    const report = evaluateArrangement({
      ...input(variantNotes.slice(0, 1)),
      guitarDiagnostics: { semanticAttackCount: 99 },
      variants: [variant],
    });
    expect(report.metrics.variants.easy?.level).toBe("easy");
    expect(report.metrics.variants.easy?.global.noteCount).toBe(8);
    expect(report.metrics.variants.easy?.rightHand.noteCount).toBe(4);
    expect(report.metrics.variants.easy?.leftHand.noteCount).toBe(4);
    expect(report.metrics.variants.easy?.guitar.finalRightHandCount).toBe(4);
    expect(report.metrics.variants.easy?.guitar.semanticAttackCount).toBeNull();
    expect(report.gate.availability.variants).toBe("evaluated");
  });

  it("fails the structural gate for malformed note values instead of silently filtering them", () => {
    const malformed = [
      { midi: 60.5, start: 0, dur: 1, vel: 90, hand: "R" },
      { midi: 61, start: 1, dur: 1, vel: Number.NaN, hand: "R" },
      { midi: 62, start: 2, dur: 1, vel: 140, hand: "X" },
    ] as unknown as Note[];
    const report = evaluateArrangement({
      fixture: { id: "malformed-notes" },
      candidate: { selector: "malformed.mid", parsed: parsed(malformed) },
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toContain("3 non-finite or invalid MIDI notes");
  });

  it("fails closed when finite note fields would overflow their derived end time", () => {
    const report = evaluateArrangement({
      fixture: { id: "overflowing-note" },
      candidate: {
        selector: "overflowing.mid",
        notes: [{ midi: 60, start: Number.MAX_VALUE, dur: Number.MAX_VALUE, vel: 90, hand: "R" }],
      },
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toContain("candidate: 1 non-finite or invalid MIDI notes");
    expect(report.candidate.parser.durationBeats).toBe(0);
    expect(report.metrics.global.coverage).toEqual({ firstBeat: null, lastBeat: null, activeBeats: 0, ratio: 0 });
  });

  it("returns an empty comparison instead of throwing for malformed runtime reference inputs", () => {
    const malformed = compareArrangementReference(
      {} as unknown as Note[],
      [] as unknown as Note[],
      { id: "intro", candidate: [0, 4], reference: [0, 4] },
    );
    expect(malformed.matchedOnsets).toBe(0);
    expect(malformed.exactPitch.f1).toBeNull();

    const missingBounds = compareArrangementReference(
      [],
      [],
      { id: "intro", candidate: [0, 4] } as unknown as EvaluationWindow,
    );
    expect(missingBounds.matchedOnsets).toBe(0);
    expect(missingBounds.candidateBounds).toEqual([0, 4]);
    expect(missingBounds.referenceBounds).toEqual([0, 0]);
  });

  it("uses the explicit expected duration rather than the candidate's actual duration", () => {
    const report = evaluateArrangement({
      ...input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]),
      candidate: { selector: "duration.mid", parsed: parsed([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]), durationBeats: 4 },
      expectedDurationBeats: 8,
    });
    expect(report.metrics.global.durationMismatch).toEqual({ value: -4, basis: "expected" });
  });

  it("clips section coverage to the section's absolute beat window", () => {
    const notes: Note[] = [{ midi: 60, start: 8, dur: 2, vel: 90, hand: "R" }];
    const report = evaluateArrangement({
      ...input(notes),
      windows: [{ id: "late", candidate: [8, 12] }],
    });
    expect(report.metrics.sections.late?.coverage).toEqual({
      firstBeat: 8,
      lastBeat: 10,
      activeBeats: 2,
      ratio: 0.5,
    });
  });

  it("keeps bass attribution tri-state when Note provenance cannot carry it", () => {
    const report = evaluateArrangement(input([
      { midi: 40, start: 0, dur: 1, vel: 90, hand: "L", identitySource: "guitar" },
    ]));
    expect(report.metrics.source.final.all.bass).toBeNull();
    expect(report.metrics.source.final.left.bass).toBeNull();
  });

  it("separates close attacks from repeated-pitch attacks", () => {
    const report = evaluateArrangement(input([
      { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" },
      { midi: 62, start: 0.25, dur: 1, vel: 90, hand: "R" },
      { midi: 60, start: 0.5, dur: 1, vel: 90, hand: "R" },
      { midi: 60, start: 0.75, dur: 1, vel: 90, hand: "R" },
    ]));
    expect(report.metrics.global.closeAttackRate).toBe(1);
    expect(report.metrics.global.repeatedAttackRate).toBe(0.333);
  });

  it("fails the structural gate for invalid variant notes without crashing evaluation", () => {
    const invalidVariant = {
      level: "easy",
      difficultyScore: 0.4,
      notes: [{ midi: Number.NaN, start: 0, dur: 1, vel: 90, hand: "R" }],
      chords: [],
      bassPattern: "root-fifth",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    } as unknown as Variant;
    const report = evaluateArrangement({
      ...input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]),
      variants: [invalidVariant],
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toContain("easy: 1 non-finite or invalid MIDI notes");
  });

  it("fails closed when required variant metadata is null or non-finite", () => {
    const malformedVariant = {
      level: "easy",
      difficultyScore: Number.NaN,
      notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }],
      chords: [],
      bassPattern: "root-fifth",
      key: "C",
      tempoBpm: Number.NaN,
      timeSig: null,
      measures: null,
    } as unknown as Variant;
    expect(() => evaluateArrangement({
      ...input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]),
      variants: [malformedVariant],
    })).not.toThrow();
    const report = evaluateArrangement({
      ...input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]),
      variants: [malformedVariant],
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toEqual(expect.arrayContaining([
      "easy: measures must be an array",
      "easy: timeSig must be an array of two positive integers",
      "easy: tempoBpm must be a finite positive number",
      "easy: difficultyScore must be a finite number",
    ]));
    expect(report.metrics.variants.easy?.timeSig).toEqual([4, 4]);
    expect(report.metrics.variants.easy?.tempoBpm).toBe(120);
    expect(report.metrics.variants.easy?.difficultyScore).toBe(0);
  });

  it("fails closed for malformed variant metadata shapes without throwing", () => {
    const malformedVariant = {
      level: "easy",
      difficultyScore: "0.4",
      notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }],
      chords: [],
      bassPattern: "root-fifth",
      key: "C",
      tempoBpm: null,
      timeSig: [4, Number.NaN],
      measures: { endBeat: 4 },
    } as unknown as Variant;
    expect(() => evaluateArrangement({
      ...input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]),
      variants: [malformedVariant],
    })).not.toThrow();
    const report = evaluateArrangement({
      ...input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]),
      variants: [malformedVariant],
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toEqual(expect.arrayContaining([
      "easy: measures must be an array",
      "easy: timeSig must be an array of two positive integers",
      "easy: tempoBpm must be a finite positive number",
      "easy: difficultyScore must be a finite number",
    ]));
  });

  it("fails closed when the variant list contains duplicate difficulty levels", () => {
    const notes: Note[] = Array.from({ length: 8 }, (_, index) => ({
      midi: 60 + (index % 2),
      start: index * 0.5,
      dur: 0.25,
      vel: 90,
      hand: "R" as const,
    }));
    const variant = {
      level: "easy",
      difficultyScore: 0.4,
      notes,
      chords: [],
      bassPattern: "root-fifth",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    } as unknown as Variant;
    const report = evaluateArrangement({
      ...input(notes.slice(0, 1)),
      variants: [variant, { ...variant, difficultyScore: 0.5 }],
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toContain("easy: duplicate difficulty level");
  });

  it("reports suspicious output shape as non-blocking quality warnings", () => {
    const notes: Note[] = Array.from({ length: 32 }, (_, index) => ({
      midi: 60,
      start: index * 0.125,
      dur: 0.0625,
      vel: 90,
      hand: "R" as const,
    }));
    const report = evaluateArrangement(input(notes));
    expect(report.gate.status).toBe("pass");
    expect(report.gate.warnings).toEqual(expect.arrayContaining([
      "onset density 16/s exceeds warning threshold 12/s",
      "very-short notes 32/32 (1) exceed warning rate 0.8",
      "R repeated-pitch wall run 32 attacks (100% of right-hand onsets)",
    ]));
  });

  it("warns when a candidate has no right-hand events without failing the structural gate", () => {
    const report = evaluateArrangement(input([
      { midi: 48, start: 0, dur: 1, vel: 90, hand: "L" },
    ]));
    expect(report.gate.status).toBe("pass");
    expect(report.gate.warnings).toContain("candidate has no right-hand events");
  });

  it("warns on a material explicit duration mismatch", () => {
    const report = evaluateArrangement({
      ...input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]),
      expectedDurationBeats: 8,
    });
    expect(report.gate.status).toBe("pass");
    expect(report.gate.warnings).toContain("candidate duration differs from expected by 4 beats");
  });
  it("reports reference duration mismatch with an explicit reference basis", () => {
    const candidate = parsed([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]);
    candidate.durationBeats = 12;
    const reference = parsed([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]);
    reference.durationBeats = 8;
    const report = evaluateArrangement({
      fixture: { id: "reference-duration" },
      candidate: { selector: "candidate.mid", parsed: candidate },
      reference: { selector: "reference.mid", parsed: reference, windows: [{ id: "body", candidate: [0, 4], reference: [0, 4] }] },
      windows: [{ id: "body", candidate: [0, 4], reference: [0, 4] }],
    });
    expect(report.metrics.global.durationMismatch).toEqual({ value: 4, basis: "reference" });
  });

  it("fails closed instead of throwing when candidate or reference notes are not arrays", () => {
    const candidateReport = evaluateArrangement({
      fixture: { id: "malformed-candidate-notes" },
      candidate: { selector: "candidate.mid", notes: { midi: 60 } as unknown as Note[] },
    });
    expect(candidateReport.gate.status).toBe("fail");
    expect(candidateReport.gate.failures).toContain("candidate notes are not an array");

    const referenceReport = evaluateArrangement({
      fixture: { id: "malformed-reference-notes" },
      candidate: { selector: "candidate.mid", notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }] },
      reference: {
        selector: "reference.mid",
        notes: { midi: 60 } as unknown as Note[],
        windows: [{ id: "intro", candidate: [0, 1], reference: [0, 1] }],
      },
    });
    expect(referenceReport.gate.status).toBe("fail");
    expect(referenceReport.gate.failures).toContain("reference notes are not an array");
    expect(referenceReport.reference?.windows[0]?.referenceNoteCount).toBe(0);
  });

  it("fails closed for malformed candidate/reference containers and byte metadata", () => {
    const candidateReport = evaluateArrangement({
      fixture: { id: "malformed-candidate" },
      candidate: null as unknown as ArrangementEvaluationInput["candidate"],
    });
    expect(candidateReport.gate.status).toBe("fail");
    expect(candidateReport.gate.failures).toContain("candidate must be an object");

    const referenceReport = evaluateArrangement({
      fixture: { id: "malformed-reference" },
      candidate: { selector: "candidate.mid", notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }] },
      windows: [{ id: "intro", candidate: [0, 1], reference: [0, 1] }],
      reference: {
        selector: {} as unknown as string,
        bytes: {} as unknown as Uint8Array,
        notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }],
      },
    });
    expect(referenceReport.gate.status).toBe("fail");
    expect(referenceReport.gate.failures).toEqual(expect.arrayContaining([
      "reference selector must be a string",
      "reference bytes must be a Uint8Array",
    ]));
    expect(referenceReport.reference?.referenceHash).toBeNull();

    const byteReport = evaluateArrangement({
      fixture: { id: "malformed-bytes" },
      candidate: { selector: "candidate.mid", bytes: {} as unknown as Uint8Array, notes: [] },
    });
    expect(byteReport.gate.status).toBe("fail");
    expect(byteReport.gate.failures).toContain("candidate bytes must be a Uint8Array");
    expect(byteReport.candidate.sha256).toBeNull();
  });

  it("fails closed and emits no sections for invalid evaluation windows", () => {
    const report = evaluateArrangement({
      ...input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]),
      windows: [
        { id: "reversed", candidate: [2, 1] },
        { id: "negative", candidate: [-1, 1] },
      ],
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toEqual(expect.arrayContaining([
      "evaluation windows: reversed candidate bounds must be finite, non-negative, and end after start",
      "evaluation windows: negative candidate bounds must be finite, non-negative, and end after start",
    ]));
    expect(report.metrics.sections).toEqual({});
  });

  it("rejects duplicate or overlapping candidate and reference windows", () => {
    const report = evaluateArrangement({
      ...input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]),
      windows: [
        { id: "a", candidate: [0, 2], reference: [0, 2] },
        { id: "a", candidate: [1, 3], reference: [1, 3] },
        { id: "b", candidate: [4, 6], reference: [1.5, 2.5] },
      ],
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toEqual(expect.arrayContaining([
      "evaluation windows: duplicate window id a",
      "evaluation windows: overlapping windows a and a",
      "evaluation windows: overlapping reference windows a and a",
    ]));
    expect(report.metrics.sections).toEqual({});
  });

  it("fails closed when expected duration is non-finite", () => {
    const report = evaluateArrangement({
      ...input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]),
      expectedDurationBeats: Number.NaN,
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toContain("expected duration must be a finite non-negative number");
    expect(report.metrics.global.durationMismatch).toEqual({ value: null, basis: "unavailable" });
  });

  it("redacts trace paths and orders equivalent trace keys deterministically", () => {
    const notes = [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" as const }];
    const traceEvents = [
      {
        key: "same-key",
        stage: "decision" as const,
        source: "guitar",
        selectionReason: "selected /private/tmp/lead.mid",
      },
      {
        key: "same-key",
        stage: "decision" as const,
        source: "guitar",
        selectionReason: "rejected /Users/reidar/review.mid",
      },
    ];
    const first = evaluateArrangement({
      ...input(notes),
      trace: { status: "available", events: traceEvents },
    });
    const second = evaluateArrangement({
      ...input(notes),
      trace: { status: "available", events: [...traceEvents].reverse() },
    });
    const canonical = canonicalEvaluationJson(first);
    expect(canonical).toBe(canonicalEvaluationJson(second));
    expect(canonical).not.toContain("/private/tmp/lead.mid");
    expect(canonical).not.toContain("/Users/reidar/review.mid");
    expect(canonical).toContain("[redacted-path]");
  });

  it("fails closed for malformed traces and drops path-bearing trace extensions", () => {
    const base = input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]);
    const malformed = evaluateArrangement({
      ...base,
      trace: { status: "available", events: {} } as unknown as ArrangementEvaluationInput["trace"],
    });
    expect(malformed.gate.status).toBe("fail");
    expect(malformed.gate.failures).toContain("trace events must be an array");

    const report = evaluateArrangement({
      ...base,
      trace: {
        status: "available",
        events: [{
          key: "trace",
          source: "Users/reidar/private/review.txt",
          sourcePath: "relative/private-source-without-extension",
          filePath: "/private/tmp/secret-source",
          sourceStem: "C:\\Users\\reidar\\secret.mid",
          note: { midi: 60, start: 0, dur: 1, vel: 90, rawMidi: 1n },
        }],
      } as unknown as ArrangementEvaluationInput["trace"],
    });
    const canonical = canonicalEvaluationJson(report);
    expect(canonical).not.toContain("Users/reidar");
    expect(canonical).not.toContain("relative/private-source-without-extension");
    expect(canonical).not.toContain("secret-source");
    expect(canonical).not.toContain("sourcePath");
    expect(canonical).not.toContain("filePath");
    expect(canonical).toContain("[redacted-path]");
    expect(canonical).not.toContain("rawMidi");
  });

  it("redacts complete paths when trace values contain spaces or Windows separators", () => {
    const report = evaluateArrangement({
      ...input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]),
      trace: {
        status: "available",
        events: [{
          key: "trace",
          source: "/Users/reidar/Private MIDI/Defence of Moscow.mid",
          sourceStem: "C:\\Users\\reidar\\My folder\\Secret.mid",
          selectionReason: "selected /private/tmp/Source File.mid.",
        }],
      },
    });
    const canonical = canonicalEvaluationJson(report);
    expect(canonical).not.toContain("MIDI/Defence of Moscow.mid");
    expect(canonical).not.toContain("folder\\\\Secret.mid");
    expect(canonical).not.toContain("Source File.mid");
    expect(canonical).toContain("[redacted-path]");

    const uriAndUnc = evaluateArrangement({
      ...input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]),
      trace: {
        status: "available",
        events: [{
          key: "trace",
          source: "file:///Users/reidar/Private MIDI/Reference.mid",
          sourceStem: "\\\\server\\share\\My Folder\\Fallback.mid",
        }],
      },
    });
    const uriAndUncCanonical = canonicalEvaluationJson(uriAndUnc);
    expect(uriAndUncCanonical).not.toContain("MIDI/Reference.mid");
    expect(uriAndUncCanonical).not.toContain("My Folder\\\\Fallback.mid");

    const extensionless = evaluateArrangement({
      ...input([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }]),
      trace: {
        status: "available",
        events: [{
          key: "trace",
          source: "file://Users/reidar/My Folder/extensionless-source",
          sourceStem: "\\\\server\\share\\My Folder\\extensionless-source",
        }],
      },
    });
    const extensionlessCanonical = canonicalEvaluationJson(extensionless);
    expect(extensionlessCanonical).not.toContain("My Folder/extensionless-source");
    expect(extensionlessCanonical).not.toContain("My Folder\\\\extensionless-source");
  });

  it("sanitizes Windows-style selector paths in the report", () => {
    const report = evaluateArrangement({
      fixture: { id: "windows-selector" },
      candidate: { selector: "C:\\Users\\reidar\\private\\candidate.mid", notes: [] },
      reference: { selector: "C:\\Users\\reidar\\private\\reference.mid", notes: [] },
    });
    expect(report.candidate.selector).toBe("candidate.mid");
    expect(report.reference?.referenceSelector).toBe("reference.mid");
  });

  it("fails closed when parsed metadata contains an explicit null time signature", () => {
    const report = evaluateArrangement({
      fixture: { id: "null-parser-timesig" },
      candidate: {
        selector: "candidate.mid",
        parsed: { notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }], timeSig: null } as unknown as ParsedMidi,
      },
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toContain("parser metadata contains non-finite or invalid values");
  });

  it("fails closed when candidate or reference parsed metadata is explicitly null", () => {
    const candidateReport = evaluateArrangement({
      fixture: { id: "null-candidate-parsed" },
      candidate: {
        selector: "candidate.mid",
        notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }],
        parsed: null as unknown as ParsedMidi,
      },
    });
    expect(candidateReport.gate.status).toBe("fail");
    expect(candidateReport.gate.failures).toContain("candidate parsed metadata must be an object");

    const referenceReport = evaluateArrangement({
      fixture: { id: "null-reference-parsed" },
      candidate: { selector: "candidate.mid", notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }] },
      reference: {
        selector: "reference.mid",
        notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }],
        parsed: null as unknown as ParsedMidi,
      },
    });
    expect(referenceReport.gate.status).toBe("fail");
    expect(referenceReport.gate.failures).toContain("reference parsed metadata must be an object");
  });

  it("fails closed when reference notes contain invalid note values", () => {
    const report = evaluateArrangement({
      fixture: { id: "invalid-reference-note" },
      candidate: { selector: "candidate.mid", notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }] },
      reference: {
        selector: "reference.mid",
        notes: [
          { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" },
          { midi: Number.NaN, start: 1, dur: 1, vel: 90, hand: "R" },
        ] as unknown as Note[],
        windows: [{ id: "intro", candidate: [0, 2], reference: [0, 2] }],
      },
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toContain("reference: 1 non-finite or invalid MIDI notes");
  });

  it("does not hide malformed parsed notes behind an explicit note array", () => {
    const report = evaluateArrangement({
      fixture: { id: "shadowed-parsed-notes" },
      candidate: {
        selector: "candidate.mid",
        notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }],
        parsed: { notes: { midi: 60 } } as unknown as ParsedMidi,
      },
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toContain("candidate parsed notes are not an array");
  });

  it("fails closed without throwing for non-string revision and alias metadata", () => {
    const report = evaluateArrangement({
      fixture: { id: "hostile-metadata" },
      candidate: {
        selector: "candidate.mid",
        revision: 1n as unknown as string,
        notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }],
      },
      reference: {
        selector: "reference.mid",
        aliasOf: 2n as unknown as string,
        notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }],
      },
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toEqual(expect.arrayContaining([
      "candidate revision must be a string",
      "reference aliasOf must be a string",
    ]));
    expect(() => canonicalEvaluationJson(report)).not.toThrow();
    expect(report.candidate.revision).toBeUndefined();
    expect(report.reference?.aliasOf).toBeNull();
  });

  it("retains reserved window and variant identifiers as own report fields", () => {
    const variant = {
      level: "easy",
      difficultyScore: 0.4,
      notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }],
      chords: [],
      bassPattern: "root-fifth",
      key: "C",
      tempoBpm: 120,
      timeSig: [4, 4],
      measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
    } as unknown as Variant;
    const report = evaluateArrangement({
      fixture: { id: "reserved-identifiers" },
      candidate: { selector: "candidate.mid", notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }] },
      windows: [{ id: "__proto__", candidate: [0, 1] }],
      variants: [variant],
    });
    expect(Object.prototype.hasOwnProperty.call(report.metrics.sections, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(report.metrics.variants, "easy")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(report.metrics.source.sectionSourceCounts, "__proto__")).toBe(true);
    expect(canonicalEvaluationJson(report)).toContain("__proto__");
  });

  it("fails closed for malformed reference metadata and null alignment bounds", () => {
    const report = evaluateArrangement({
      fixture: { id: "malformed-reference-metadata" },
      candidate: { selector: "candidate.mid", notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }] },
      windows: [{ id: "intro", candidate: [0, 1], reference: null } as unknown as EvaluationWindow],
      reference: {
        selector: "reference.mid",
        notes: [{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" }],
        durationBeats: Number.NaN,
      },
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toEqual(expect.arrayContaining([
      "reference durationBeats must be a finite non-negative number",
      "evaluation windows: intro reference bounds must be finite, non-negative, and end after start",
    ]));
    expect(report.metrics.sections).toEqual({});
  });

  it("fails closed for malformed fixture and mode metadata", () => {
    const report = evaluateArrangement({
      fixture: { id: 42 } as unknown as ArrangementEvaluationInput["fixture"],
      candidate: { selector: "candidate.mid", notes: [] },
      mode: "unexpected" as unknown as ArrangementEvaluationInput["mode"],
    });
    expect(report.gate.status).toBe("fail");
    expect(report.gate.failures).toEqual(expect.arrayContaining([
      "fixture id must be a non-empty string",
      "mode must be structural, reference, or human",
    ]));
    expect(report.gate.mode).toBe("structural");
  });
});
