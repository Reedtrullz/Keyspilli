import { describe, expect, it } from "vitest";
import {
  alignSymbolicScores,
  coarseAlignScores,
  normalizeSymbolicScore,
  parseSymbolicCandidate,
  type SymbolicAlignmentWindow,
  type SymbolicScoreInput,
} from "../src/symbolic-alignment.js";

function score(notes: SymbolicScoreInput["notes"], extras: Partial<SymbolicScoreInput> = {}): SymbolicScoreInput {
  return {
    notes,
    tempoBpm: 120,
    durationBeats: notes.reduce((end, note) => Math.max(end, note.start + note.dur), 0),
    ...extras,
  };
}

describe("symbolic alignment", () => {
  it("fails closed for null score and options objects", () => {
    expect(() => normalizeSymbolicScore(null as unknown as SymbolicScoreInput)).not.toThrow();
    expect(normalizeSymbolicScore(null as unknown as SymbolicScoreInput)).toMatchObject({ notes: [], originalNoteCount: 0, droppedNoteCount: 0 });
    expect(() => alignSymbolicScores(score([]), score([]), null as unknown as Parameters<typeof alignSymbolicScores>[2])).not.toThrow();
  });

  it("normalizes without quantizing, filters invalid notes, and preserves metadata", () => {
    const normalized = normalizeSymbolicScore({
      notes: [
        { midi: 64, start: 1.125, dur: 0.375, vel: 90, identitySource: "guitar" },
        { midi: 60, start: 0.125, dur: 0.25, vel: 80 },
        { midi: 128, start: 2, dur: 1, vel: 100 },
        { midi: 62.5, start: 3, dur: 1, vel: 100 },
        { midi: 62, start: Number.NaN, dur: 1, vel: 100 },
        { midi: 62, start: 4, dur: -1, vel: 100 },
      ],
      tempoBpm: Number.NaN,
      durationBeats: Number.NaN,
      metadata: { source: "local-test", nested: { keep: true } },
    });

    expect(normalized.notes).toEqual([
      { midi: 60, start: 0.125, dur: 0.25, vel: 80 },
      { midi: 64, start: 1.125, dur: 0.375, vel: 90, identitySource: "guitar" },
    ]);
    expect(normalized.durationBeats).toBe(1.5);
    expect(normalized.tempoBpm).toBe(120);
    expect(normalized.metadata).toEqual({ source: "local-test", nested: { keep: true } });
  });

  it("normalizes explicit beat scaling once and tolerates malformed runtime entries", () => {
    const normalized = normalizeSymbolicScore({
      notes: [
        { midi: 60, start: 0, dur: 1, vel: 90 },
        null as unknown as SymbolicScoreInput["notes"][number],
      ],
      durationBeats: 1,
    }, { beatScale: 1.5 });
    expect(normalized.notes).toEqual([{ midi: 60, start: 0, dur: 1.5, vel: 90 }]);
    expect(normalized.durationBeats).toBe(1.5);
    expect(normalized.droppedNoteCount).toBe(1);
  });

  it("reuses the MusicXML parser through the symbolic adapter", () => {
    const xml = `<?xml version="1.0"?><score-partwise><work><work-title>Test</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><metronome><per-minute>110</per-minute></metronome></direction-type></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
    const parsed = parseSymbolicCandidate(xml, "musicxml");
    expect(parsed).toMatchObject({ tempoBpm: 110, title: "Test", notes: [{ midi: 60, start: 0, dur: 0.5 }] });
  });

  it("finds a leading intro offset and transposition", () => {
    const reference = score([
      { midi: 60, start: 0, dur: 1, vel: 100 },
      { midi: 62, start: 1, dur: 1, vel: 100 },
      { midi: 64, start: 2, dur: 1, vel: 100 },
    ]);
    const candidate = score([
      { midi: 63, start: 2, dur: 1, vel: 100 },
      { midi: 65, start: 3, dur: 1, vel: 100 },
      { midi: 67, start: 4, dur: 1, vel: 100 },
    ]);
    const result = alignSymbolicScores(reference, candidate, {
      offsetsBeats: [0, 1, 2, 3],
      transpositions: [-3, 0, 3],
      beatScales: [1],
    });

    expect(result.status).toBe("aligned");
    expect(result.offsetBeats).toBe(2);
    expect(result.transpositionSemitones).toBe(-3);
    expect(result.metrics.matchedNotes).toBe(3);
    expect(result.metrics.exactPitch.f1).toBe(1);
    expect(result.metrics.onset.f1).toBe(1);
  });

  it("bounds the default hypothesis search for a realistic dense score", () => {
    const referenceNotes = Array.from({ length: 500 }, (_, index) => ({
      midi: 60 + (index % 7),
      start: index * 1.03 + (index % 5) * 0.17,
      dur: 0.75,
      vel: 90,
    }));
    const candidateNotes = Array.from({ length: 500 }, (_, index) => ({
      midi: 60 + (index % 7),
      start: 12 + index * 1.07 + ((index * 7) % 11) * 0.13,
      dur: 0.75,
      vel: 90,
    }));
    const result = alignSymbolicScores(
      score(referenceNotes),
      score(candidateNotes),
    );

    expect(result.diagnostics).toContain("bounded automatic hypothesis search (1024/4000)");
    expect(result.metrics.onset.matched).toBeGreaterThan(0);
  });

  it("keeps many annotated windows from creating an offset-scale cartesian explosion", { timeout: 10_000 }, () => {
    const referenceNotes = Array.from({ length: 96 }, (_, index) => ({
      midi: 60 + (index % 7),
      start: index * 2 + 0.25,
      dur: 0.5,
      vel: 90,
    }));
    const candidateNotes: typeof referenceNotes = [];
    const windows: SymbolicAlignmentWindow[] = [];
    let candidateStart = 12;
    for (let index = 0; index < referenceNotes.length; index += 1) {
      const candidateWidth = 0.85 + (index % 31) / 30 * 0.3;
      const candidateEnd = candidateStart + candidateWidth;
      candidateNotes.push({
        midi: referenceNotes[index]!.midi,
        start: candidateStart + candidateWidth * 0.25,
        dur: candidateWidth * 0.5,
        vel: 90,
      });
      windows.push({
        id: `window-${index}`,
        reference: [index * 2, index * 2 + 1],
        candidate: [candidateStart, candidateEnd],
      });
      candidateStart = candidateEnd;
    }
    const result = alignSymbolicScores(
      score(referenceNotes, { durationBeats: 192.5 }),
      score(candidateNotes, { durationBeats: candidateStart + 1 }),
      { windows },
    );

    expect(result.windows).toHaveLength(windows.length);
    expect(result.windows.every((window) => window.reference[1] > window.reference[0])).toBe(true);
    expect(result.diagnostics).toContain(`evaluated ${windows.length} explicit alignment windows`);
  });

  it("keeps the strongest automatic offset and transposition under the cap", () => {
    const referenceNotes = Array.from({ length: 500 }, (_, index) => ({
      midi: 60 + (index % 7),
      start: index * 1.03 + (index % 5) * 0.17,
      dur: 0.75,
      vel: 90,
    }));
    const candidateNotes = referenceNotes.map((note) => ({
      ...note,
      midi: note.midi + 5,
      start: note.start + 12,
    }));
    const result = alignSymbolicScores(score(referenceNotes), score(candidateNotes));

    expect(result.status).toBe("aligned");
    expect(result.offsetBeats).toBe(12);
    expect(result.transpositionSemitones).toBe(-5);
    expect(result.metrics.exactPitch.f1).toBe(1);
  });

  it("supports an explicit global stretch while retaining the intro offset", () => {
    const reference = score([
      { midi: 60, start: 0, dur: 0.5, vel: 100 },
      { midi: 62, start: 1, dur: 0.5, vel: 100 },
      { midi: 64, start: 2, dur: 0.5, vel: 100 },
    ]);
    const candidate = score([
      { midi: 60, start: 1, dur: 0.5, vel: 100 },
      { midi: 62, start: 2.5, dur: 0.5, vel: 100 },
      { midi: 64, start: 4, dur: 0.5, vel: 100 },
    ]);
    const result = coarseAlignScores(reference, candidate, {
      offsetsBeats: [0, 1],
      beatScales: [1, 1.5],
      transpositions: [0],
    });

    expect(result.status).toBe("aligned");
    expect(result.offsetBeats).toBe(1);
    expect(result.beatScale).toBe(1.5);
    expect(result.metrics.exactPitch.f1).toBe(1);
  });

  it("reports truncated candidates as partial coverage instead of fabricating full alignment", () => {
    const reference = score(Array.from({ length: 8 }, (_, index) => ({ midi: 60 + (index % 3), start: index, dur: 0.75, vel: 90 })), { durationBeats: 8.75 });
    const candidate = score(reference.notes.slice(0, 4), { durationBeats: 4.75 });
    const result = alignSymbolicScores(reference, candidate, { offsetsBeats: [0], transpositions: [0], beatScales: [1] });

    expect(result.status).toBe("partial");
    expect(result.partialCoverage).toBe(true);
    expect(result.coverage.referenceRatio).toBeGreaterThan(0.3);
    expect(result.coverage.referenceRatio).toBeLessThan(1);
    expect(result.metrics.matchedNotes).toBe(4);
    expect(result.confidenceMap.some((region) => region.level === "high")).toBe(true);
    expect(result.confidenceMap.some((region) => region.level === "unknown")).toBe(true);
    expect(result.confidenceMap.every((region) => region.reference[1] > region.reference[0])).toBe(true);
  });

  it("keeps confidence-map timing in the reference domain and marks unmapped gaps unknown", () => {
    const result = alignSymbolicScores(
      score([
        { midi: 60, start: 0, dur: 0.5, vel: 90 },
        { midi: 62, start: 1, dur: 0.5, vel: 90 },
        { midi: 64, start: 4, dur: 0.5, vel: 90 },
      ], { durationBeats: 5 }),
      score([
        { midi: 60, start: 2, dur: 0.5, vel: 90 },
        { midi: 62, start: 3, dur: 0.5, vel: 90 },
      ], { durationBeats: 4 }),
      { offsetsBeats: [2], transpositions: [0], beatScales: [1] },
    );

    expect(result.offsetBeats).toBe(2);
    expect(result.confidenceMap).toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: [0, 2], candidate: [2, 4], level: "high" }),
      expect.objectContaining({ reference: [2, 5], level: "unknown" }),
    ]));
    expect(result.confidenceMap.every((region) => region.reference[0] >= 0)).toBe(true);
  });

  it("matches notes one-to-one, even when an onset contains duplicate pitches", () => {
    const reference = score([
      { midi: 60, start: 0, dur: 1, vel: 100 },
      { midi: 60, start: 0, dur: 0.5, vel: 90 },
    ]);
    const candidate = score([{ midi: 60, start: 0, dur: 1, vel: 100 }]);
    const result = alignSymbolicScores(reference, candidate, { offsetsBeats: [0], transpositions: [0], beatScales: [1] });

    expect(result.metrics.matchedNotes).toBe(1);
    expect(result.matches).toHaveLength(1);
    expect(result.metrics.onset.matched).toBe(1);
  });

  it("keeps explicit offset windows in reference time and counts duplicate identities", () => {
    const reference = score([
      { midi: 60, start: 0, dur: 1, vel: 100 },
      { midi: 60, start: 0, dur: 0.5, vel: 90 },
      { midi: 62, start: 1, dur: 1, vel: 100 },
    ]);
    const candidate = score([
      { midi: 60, start: 2, dur: 1, vel: 100 },
      { midi: 60, start: 2, dur: 0.5, vel: 90 },
      { midi: 62, start: 3, dur: 1, vel: 100 },
    ]);
    const result = alignSymbolicScores(reference, candidate, {
      offsetsBeats: [2], transpositions: [0], beatScales: [1],
      windows: [{ id: "intro", reference: [0, 2], candidate: [2, 4] }],
    });
    expect(result.metrics.matchedNotes).toBe(3);
    expect(result.coverage.referenceRatio).toBe(1);
    expect(result.coverage.candidateRatio).toBe(1);
    expect(result.matches[0]?.referenceStart).toBe(0);
    expect(result.windows[0]).toMatchObject({ matchedOnsets: 2, exactPitch: { f1: 1 } });
  });

  it("counts matched onset groups rather than jittered notes inside a window", () => {
    const reference = score([
      { midi: 60, start: 0, dur: 1, vel: 100 },
      { midi: 64, start: 0.04, dur: 1, vel: 90 },
      { midi: 67, start: 1, dur: 1, vel: 100 },
    ]);
    const candidate = score([
      { midi: 60, start: 2, dur: 1, vel: 100 },
      { midi: 64, start: 2.04, dur: 1, vel: 90 },
      { midi: 67, start: 3, dur: 1, vel: 100 },
    ]);
    const result = alignSymbolicScores(reference, candidate, {
      offsetsBeats: [2],
      transpositions: [0],
      beatScales: [1],
      windows: [{ id: "jittered", reference: [0, 2], candidate: [2, 4] }],
    });

    expect(result.metrics.matchedNotes).toBe(3);
    expect(result.windows[0]).toMatchObject({
      referenceOnsets: 2,
      candidateOnsets: 2,
      matchedOnsets: 2,
    });
  });

  it("does not fabricate a window match when its domains contain no paired onset", () => {
    const result = alignSymbolicScores(
      score([{ midi: 60, start: 0, dur: 1, vel: 90 }]),
      score([{ midi: 60, start: 8, dur: 1, vel: 90 }]),
      { offsetsBeats: [0], transpositions: [0], beatScales: [1], windows: [{ id: "empty", reference: [0, 1], candidate: [0, 1] }] },
    );
    expect(result.windows[0]).toMatchObject({ matchedOnsets: 0, exactPitch: { f1: null } });
  });

  it("derives an alignment hypothesis from annotated windows", () => {
    const result = alignSymbolicScores(
      score([{ midi: 60, start: 100, dur: 1, vel: 90 }, { midi: 62, start: 101, dur: 1, vel: 90 }], { durationBeats: 102 }),
      score([{ midi: 60, start: 110, dur: 1, vel: 90 }, { midi: 62, start: 111, dur: 1, vel: 90 }], { durationBeats: 112 }),
      { windows: [{ id: "late", reference: [100, 102], candidate: [110, 112] }] },
    );
    expect(result.status).toBe("aligned");
    expect(result.offsetBeats).toBe(10);
    expect(result.metrics.exactPitch.f1).toBe(1);
    expect(result.windows[0]?.matchedOnsets).toBe(2);
  });

  it("never matches an onset across two explicit window domains", () => {
    const reference = score([
      { midi: 60, start: 0, dur: 0.5, vel: 90 },
      { midi: 62, start: 4, dur: 0.5, vel: 90 },
    ], { durationBeats: 5 });
    const candidate = score([
      { midi: 60, start: 10, dur: 0.5, vel: 90 },
      { midi: 62, start: 11, dur: 0.5, vel: 90 },
    ], { durationBeats: 12 });
    const result = alignSymbolicScores(reference, candidate, {
      // The supplied hypothesis maps reference beat 0 into window B. The
      // candidate must not be credited to window A merely because all window
      // groups were pooled for the search.
      offsetsBeats: [11],
      transpositions: [0],
      beatScales: [1],
      windows: [
        { id: "a", reference: [0, 1], candidate: [10, 10.5] },
        { id: "b", reference: [4, 5], candidate: [11, 12] },
      ],
    });

    expect(result.metrics.matchedNotes).toBe(0);
    expect(result.metrics.onset.matched).toBe(0);
    expect(result.windows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "a", matchedOnsets: 0 }),
      expect.objectContaining({ id: "b", matchedOnsets: 0 }),
    ]));
  });

  it("fails closed when every supplied window is malformed", () => {
    const result = alignSymbolicScores(
      score([{ midi: 60, start: 0, dur: 1, vel: 90 }]),
      score([{ midi: 60, start: 0, dur: 1, vel: 90 }]),
      { windows: [{ id: "bad", reference: [2, 1], candidate: [0, 1] }] },
    );
    expect(result.status).toBe("alignment-required");
    expect(result.alignmentRequired).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("fails closed when the explicit window collection is not an array", () => {
    const result = alignSymbolicScores(
      score([{ midi: 60, start: 0, dur: 1, vel: 90 }]),
      score([{ midi: 60, start: 0, dur: 1, vel: 90 }]),
      { windows: { id: "not-an-array" } as unknown as SymbolicAlignmentWindow[] },
    );

    expect(result.status).toBe("alignment-required");
    expect(result.alignmentRequired).toBe(true);
    expect(result.matches).toEqual([]);
    expect(result.diagnostics).toContain("all supplied alignment windows are invalid");
  });

  it("fails closed when explicit window bounds are not numeric arrays", () => {
    const result = alignSymbolicScores(
      score([{ midi: 60, start: 0, dur: 1, vel: 90 }]),
      score([{ midi: 60, start: 0, dur: 1, vel: 90 }]),
      {
        windows: [
          { id: "string-bounds", reference: "01" as unknown as [number, number], candidate: [0, 1] },
          { id: "object-bounds", reference: [0, 1], candidate: { 0: 0, 1: 1, length: 2 } as unknown as [number, number] },
        ],
      },
    );

    expect(result.status).toBe("alignment-required");
    expect(result.alignmentRequired).toBe(true);
    expect(result.matches).toEqual([]);
    expect(result.diagnostics).toContain("all supplied alignment windows are invalid");
  });

  it("drops duplicate and overlapping explicit windows deterministically", () => {
    const result = alignSymbolicScores(
      score([
        { midi: 60, start: 0, dur: 0.5, vel: 90 },
        { midi: 62, start: 3, dur: 0.5, vel: 90 },
      ], { durationBeats: 4 }),
      score([
        { midi: 60, start: 0, dur: 0.5, vel: 90 },
        { midi: 62, start: 3, dur: 0.5, vel: 90 },
      ], { durationBeats: 4 }),
      {
        windows: [
          { id: "a", reference: [0, 2], candidate: [0, 2] },
          { id: "a", reference: [3, 4], candidate: [3, 4] },
          { id: "b", reference: [1, 3], candidate: [1, 3] },
        ],
      },
    );

    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]?.id).toBe("a");
    expect(result.diagnostics).toContain("ignored 2 invalid alignment windows");
  });

  it("honors an explicit large offset instead of applying the automatic offset cap", () => {
    const result = alignSymbolicScores(
      score([{ midi: 60, start: 0, dur: 1, vel: 90 }]),
      score([{ midi: 60, start: 32, dur: 1, vel: 90 }]),
      { offsetsBeats: [32], transpositions: [0], beatScales: [1] },
    );
    expect(result.offsetBeats).toBe(32);
    expect(result.metrics.onset.f1).toBe(1);
  });

  it("fails closed on a large unannotated duration mismatch", () => {
    const reference = score([{ midi: 60, start: 0, dur: 100, vel: 100 }], { durationBeats: 100 });
    const candidate = score([{ midi: 60, start: 0, dur: 5, vel: 100 }], { durationBeats: 5 });
    const result = alignSymbolicScores(reference, candidate, { offsetsBeats: [0], transpositions: [0], beatScales: [1] });

    expect(result.status).toBe("alignment-required");
    expect(result.alignmentRequired).toBe(true);
    expect(result.matches).toEqual([]);
  });

  it("is deterministic for reordered input and reports chroma and contour evidence", () => {
    const reference = score([
      { midi: 60, start: 0, dur: 0.5, vel: 100 },
      { midi: 64, start: 0, dur: 0.5, vel: 90 },
      { midi: 67, start: 1, dur: 0.5, vel: 90 },
      { midi: 69, start: 2, dur: 0.5, vel: 90 },
    ]);
    const candidate = score([
      { midi: 69, start: 2, dur: 0.5, vel: 90 },
      { midi: 67, start: 1, dur: 0.5, vel: 90 },
      { midi: 64, start: 0, dur: 0.5, vel: 90 },
      { midi: 60, start: 0, dur: 0.5, vel: 100 },
    ]);
    const options = { offsetsBeats: [0, 1], transpositions: [0], beatScales: [1] };
    const first = alignSymbolicScores(reference, candidate, options);
    const second = alignSymbolicScores({ ...reference, notes: [...reference.notes].reverse() }, { ...candidate, notes: [...candidate.notes].reverse() }, options);

    expect(second).toEqual(first);
    expect(first.metrics.chroma.cosine).toBe(1);
    expect(first.metrics.contour.directionAgreement).toBe(1);
  });
});
