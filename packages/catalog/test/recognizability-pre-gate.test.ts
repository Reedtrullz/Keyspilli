import { describe, expect, it } from "vitest";
import {
  evaluateRecognizabilityPreGate,
  type RecognizabilityMelodyEvent,
  type RecognizabilityPreGateInput,
} from "../src/recognizability-pre-gate.js";

const melody = (pitches: number[], start = 0): RecognizabilityMelodyEvent[] => pitches.map((midi, index) => ({
  midi,
  start: start + index,
  dur: 0.75,
  vel: 100,
}));

const goodInput = (): RecognizabilityPreGateInput => ({
  candidateMelody: melody([60, 62, 64, 65, 67, 69, 67, 65, 64, 62, 60, 62]),
  referenceMelody: melody([60, 62, 64, 65, 67, 69, 67, 65, 64, 62, 60, 62]),
  alignment: { status: "aligned", confidence: 0.98 },
  windows: [
    { id: "intro", candidate: [0, 4], reference: [0, 4] },
    { id: "body", candidate: [4, 8], reference: [4, 8] },
    { id: "ending", candidate: [8, 12], reference: [8, 12] },
  ],
});

describe("recognizability pre-gate", () => {
  it("allows a well-aligned melody with strong pitch and contour agreement", () => {
    const result = evaluateRecognizabilityPreGate(goodInput());

    expect(result.status).toBe("READY_FOR_HUMAN_LISTENING");
    expect(result.metrics.pitchClass.f1).toBe(1);
    expect(result.metrics.contour.agreement).toBe(1);
    expect(result.metrics.matchedOnsetRatio).toBe(1);
    expect(result.failures).toEqual([]);
  });

  it("blocks an aligned but unrelated melody", () => {
    const input = goodInput();
    input.candidateMelody = melody([72, 71, 70, 69, 68, 67, 66, 65, 64, 63, 62, 61]);
    const result = evaluateRecognizabilityPreGate(input);

    expect(result.status).toBe("NOT_READY_FOR_HUMAN_LISTENING");
    expect(result.failures.some((failure) => /pitch|overlap/i.test(failure))).toBe(true);
  });

  it("fails closed when alignment or explicit windows are absent", () => {
    const missingAlignment = evaluateRecognizabilityPreGate({
      candidateMelody: melody([60, 62, 64]),
      referenceMelody: melody([60, 62, 64]),
      windows: [{ id: "intro", candidate: [0, 3], reference: [0, 3] }],
    });
    const missingWindows = evaluateRecognizabilityPreGate({
      candidateMelody: melody([60, 62, 64]),
      referenceMelody: melody([60, 62, 64]),
      alignment: { status: "aligned", confidence: 1 },
    });

    expect(missingAlignment.status).toBe("NOT_READY_FOR_HUMAN_LISTENING");
    expect(missingAlignment.failures).toContain("alignment evidence is missing");
    expect(missingWindows.status).toBe("NOT_READY_FOR_HUMAN_LISTENING");
    expect(missingWindows.failures).toContain("explicit alignment windows are required");
  });

  it("fails closed for malformed inputs and is deterministic under reordering", () => {
    const malformed = evaluateRecognizabilityPreGate({
      candidateMelody: null as unknown as RecognizabilityMelodyEvent[],
      referenceMelody: melody([60, 62, 64]),
      alignment: { status: "aligned", confidence: 1 },
      windows: [{ id: "intro", candidate: [0, 3], reference: [0, 3] }],
    });
    const first = evaluateRecognizabilityPreGate(goodInput());
    const reversed = goodInput();
    reversed.candidateMelody = [...reversed.candidateMelody!].reverse();
    reversed.referenceMelody = [...reversed.referenceMelody!].reverse();
    reversed.windows = [...reversed.windows!].reverse();
    const second = evaluateRecognizabilityPreGate(reversed);

    expect(malformed.status).toBe("NOT_READY_FOR_HUMAN_LISTENING");
    expect(malformed.failures.some((failure) => /array|malformed/i.test(failure))).toBe(true);
    expect(second).toEqual(first);
  });
});
