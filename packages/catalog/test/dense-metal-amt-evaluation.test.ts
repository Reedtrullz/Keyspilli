import { describe, expect, it } from "vitest";
import { writeMidi } from "@keyspilli/midi";
import {
  classifyRealKickSignal,
  evaluateDenseMetalFixture,
  evaluateHeadroom,
  notesFromMidi,
  type DenseMetalReferenceEvent,
} from "../src/dense-metal-amt-evaluation.js";

const reference: DenseMetalReferenceEvent[] = [
  { role: "rhythm-guitar", midi: 40, startBeat: 0, durationBeats: 0.5, velocity: 100 },
  { role: "lead", midi: 64, startBeat: 1, durationBeats: 0.5, velocity: 100 },
  { role: "bass", midi: 28, startBeat: 0, durationBeats: 0.5, velocity: 100 },
  { role: "harmony", midi: 67, startBeat: 1, durationBeats: 0.5, velocity: 100 },
  { role: "drums", midi: 36, startBeat: 0, durationBeats: 0.1, velocity: 100 },
  { role: "drums", midi: 38, startBeat: 1, durationBeats: 0.1, velocity: 100 },
];

describe("dense metal AMT evaluation", () => {
  it("scores pitched families and percussion without mixing their contracts", () => {
    const bytes = writeMidi([], {
      tempoBpm: 120,
      tracks: [
        { name: "Guitar", channel: 0, program: 29, notes: [{ midi: 40, start: 0.04, dur: 0.5, vel: 100 }, { midi: 64, start: 1.04, dur: 0.5, vel: 100 }] },
        { name: "Bass", channel: 1, program: 33, notes: [{ midi: 28, start: 0.04, dur: 0.5, vel: 100 }] },
        { name: "Other", channel: 2, program: 48, notes: [{ midi: 67, start: 1.04, dur: 0.5, vel: 100 }] },
        { name: "Drums", channel: 9, percussion: true, notes: [{ midi: 36, start: 0.04, dur: 0.1, vel: 100 }, { midi: 38, start: 1.04, dur: 0.1, vel: 100 }] },
      ],
    });
    const result = evaluateDenseMetalFixture({
      id: "fixture",
      bpm: 120,
      durationSeconds: 4,
      reference,
      prediction: notesFromMidi(bytes),
    });

    expect(result.pitched.exact).toMatchObject({ matches: 4, predictedCount: 4, referenceCount: 4, f1: 1 });
    expect(result.families.GUITAR.exact.f1).toBe(1);
    expect(result.families.BASS.exact.f1).toBe(1);
    expect(result.families.OTHER_PITCHED.exact.f1).toBe(1);
    expect(result.percussion.kick.f1).toBe(1);
    expect(result.percussion.snare.f1).toBe(1);
    expect(result.percussion.all.f1).toBe(1);
  });

  it("keeps scoring deterministic when reference and prediction order changes", () => {
    const prediction = [
      { family: "GUITAR" as const, midi: 64, onsetSeconds: 0.5, offsetSeconds: 0.75, percussion: false },
      { family: "GUITAR" as const, midi: 40, onsetSeconds: 0, offsetSeconds: 0.25, percussion: false },
    ];
    const first = evaluateDenseMetalFixture({ id: "x", bpm: 120, durationSeconds: 2, reference: reference.slice(0, 2), prediction });
    const second = evaluateDenseMetalFixture({ id: "x", bpm: 120, durationSeconds: 2, reference: [...reference.slice(0, 2)].reverse(), prediction: [...prediction].reverse() });
    expect(second).toEqual(first);
  });

  it("does not diagnose pitched under-transcription when the reference is percussion-only", () => {
    const result = evaluateDenseMetalFixture({
      id: "kick-only",
      bpm: 120,
      durationSeconds: 2,
      reference: [{ role: "drums", midi: 36, startBeat: 0, durationBeats: 0.1, velocity: 100 }],
      prediction: [{ family: "PERCUSSION", midi: 36, onsetSeconds: 0, offsetSeconds: 0.05, percussion: true }],
    });
    expect(result.diagnostics.failureStates).toEqual([]);
  });

  it("applies the frozen headroom and real-kick gates exactly", () => {
    expect(evaluateHeadroom([0.4, 0.4, 0.3], [0.3, 0.34, 0.31])).toMatchObject({
      decision: "MUSCRIPTOR_SYNTHETIC_DENSE_METAL_HEADROOM_PROVEN",
      wins: 2,
    });
    expect(evaluateHeadroom([0.4, 0.4, 0.1], [0.3, 0.34, 0.25]).decision).toBe("MUSCRIPTOR_SYNTHETIC_DENSE_METAL_HEADROOM_NOT_PROVEN");
    expect(classifyRealKickSignal({ f1: 0.6, recall: 0.6 })).toBe("REAL_METAL_KICK_REFERENCE_SIGNAL_PRESENT");
    expect(classifyRealKickSignal({ f1: 0.25, recall: 0.2 })).toBe("REAL_METAL_KICK_REFERENCE_SIGNAL_WEAK");
    expect(classifyRealKickSignal({ f1: 0.249, recall: 1 })).toBe("REAL_METAL_KICK_REFERENCE_SIGNAL_ABSENT");
  });
});
