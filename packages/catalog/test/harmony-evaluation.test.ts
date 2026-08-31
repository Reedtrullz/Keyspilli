import { describe, expect, it } from "vitest";
import type { Note } from "@keyspilli/midi";
import {
  evaluateHarmony,
  evaluateHarmonyGate,
  type HarmonyEvaluationInput,
  type HarmonyGateOptions,
} from "../src/harmony-evaluation.js";

const note = (midi: number, start: number, dur = 1, hand: "L" | "R" = "L"): Note => ({
  midi,
  start,
  dur,
  vel: 80,
  hand,
});

const healthy: HarmonyEvaluationInput = {
  windows: [{
    id: "verse-1",
    startBeat: 0,
    endBeat: 8,
    reference: {
      chroma: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
      rootPc: 0,
      bassPc: 0,
      quality: "major",
      changes: [{ beat: 0, rootPc: 0, bassPc: 0, quality: "major" }],
    },
    candidate: {
      leftHandNotes: [
        note(36, 0, 4), note(43, 0, 4), note(40, 0, 4),
        note(36, 4, 4), note(43, 4, 4), note(40, 4, 4),
      ],
      harmony: [{ beat: 0, rootPc: 0, bassPc: 0, quality: "major" }],
    },
  }],
};

describe("deterministic harmony evaluation", () => {
  it("reports healthy chroma/root/quality and left-hand playability metrics", () => {
    const report = evaluateHarmony(healthy);
    const metrics = report.windows[0]!.metrics;

    expect(report.status).toBe("available");
    expect(metrics.chromaAgreement).toBe(1);
    expect(metrics.rootAgreement).toBe(1);
    expect(metrics.bassAgreement).toBe(1);
    expect(metrics.qualityAgreement).toBe(1);
    expect(metrics.changeTiming.matched).toBe(1);
    expect(metrics.leftHand.attacks).toBe(2);
    expect(metrics.leftHand.averageNotesPerAttack).toBe(3);
    expect(metrics.leftHand.maxNotesPerAttack).toBe(3);
    expect(metrics.playability.lowRegisterMudRate).toBe(0);
    expect(metrics.playability.octaveFifthDuplicationRate).toBe(0);
    expect(metrics.availability.chroma).toBe("available");
    expect(metrics.availability.rootBass).toBe("available");
  });

  it("is independent of input ordering and does not mutate notes", () => {
    const reversed: HarmonyEvaluationInput = {
      windows: [{
        ...healthy.windows[0]!,
        candidate: {
          ...healthy.windows[0]!.candidate,
          leftHandNotes: [...healthy.windows[0]!.candidate!.leftHandNotes!].reverse(),
        },
      }],
    };
    const first = evaluateHarmony(healthy);
    const second = evaluateHarmony(reversed);
    expect(second.determinism.canonical).toBe(first.determinism.canonical);
    expect(second.windows).toEqual(first.windows);
    expect(healthy.windows[0]!.candidate!.leftHandNotes![0]!.midi).toBe(36);
  });

  it("keeps missing and malformed evidence distinct with null metrics", () => {
    const missing = evaluateHarmony({
      windows: [{
        id: "missing",
        startBeat: 0,
        endBeat: 4,
        candidate: { leftHandNotes: [note(36, 0, 4)] },
      }],
    });
    expect(missing.status).toBe("unavailable");
    expect(missing.windows[0]!.metrics.chromaAgreement).toBeNull();
    expect(missing.windows[0]!.metrics.availability.chroma).toBe("unavailable");
    expect(missing.windows[0]!.metrics.rootAgreement).toBeNull();

    const malformed = evaluateHarmony({
      windows: [{
        id: "bad",
        startBeat: 0,
        endBeat: 4,
        reference: { rootPc: 99, chroma: [1, 2, 3] },
        candidate: { leftHandNotes: [{ midi: 200, start: 0, dur: 1, vel: 80 }] },
      }],
    });
    expect(malformed.status).toBe("malformed");
    expect(malformed.diagnostics.some((item) => /malformed|invalid/i.test(item))).toBe(true);
    expect(malformed.windows[0]!.metrics.availability.overall).toBe("malformed");
  });

  it("detects pathological density, mud, duplication, jumps, walls, jitter, and unsupported changes", () => {
    const report = evaluateHarmony({
      windows: [{
        id: "bad-voicing",
        startBeat: 0,
        endBeat: 16,
        reference: {
          chroma: [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0],
          rootPc: 0,
          bassPc: 0,
          quality: "major",
          changes: [
            { beat: 0, rootPc: 0, bassPc: 0, quality: "major" },
            { beat: 8, rootPc: 7, bassPc: 7, quality: "major" },
          ],
        },
        candidate: {
          leftHandNotes: [
            note(36, 0, 0.25), note(37, 0, 0.25), note(40, 0, 0.25), note(43, 0, 0.25), note(48, 0, 0.25),
            note(72, 1, 0.25), note(36, 1, 0.25),
            note(48, 1.5, 0.25), note(36, 2, 0.25), note(48, 2.5, 0.25),
            note(36, 3, 0.25), note(48, 3.5, 0.25), note(36, 4, 0.25), note(48, 4.5, 0.25),
            note(36, 5, 0.25), note(48, 5.5, 0.25), note(36, 6, 0.25), note(48, 6.5, 0.25),
            note(36, 7, 0.25), note(48, 7.5, 0.25), note(36, 8, 0.25), note(48, 8.5, 0.25),
            note(36, 9, 0.25), note(48, 9.5, 0.25), note(36, 10, 0.25), note(48, 10.5, 0.25),
          ],
          harmony: [
            { beat: 0, rootPc: 0, bassPc: 0, quality: "major" },
            { beat: 1, rootPc: 7, bassPc: 7, quality: "minor" },
            { beat: 2, rootPc: 0, bassPc: 0, quality: "major" },
            { beat: 3, rootPc: 7, bassPc: 7, quality: "minor" },
          ],
        },
      }],
    });
    const metrics = report.windows[0]!.metrics;
    expect(metrics.leftHand.maxNotesPerAttack).toBe(5);
    expect(metrics.playability.lowRegisterMudRate).toBeGreaterThan(0);
    expect(metrics.playability.lowRegisterCloseIntervalCount).toBeGreaterThan(0);
    expect(metrics.playability.octaveFifthDuplicationRate).toBeGreaterThan(0);
    expect(metrics.playability.maxSpanSemitones).toBeGreaterThan(24);
    expect(metrics.playability.jumpRate).toBeGreaterThan(0);
    expect(metrics.playability.repeatedWallRate).toBeGreaterThan(0);
    expect(metrics.jitter.rootRate).toBeGreaterThan(0);
    expect(metrics.jitter.qualityRate).toBeGreaterThan(0);
    expect(metrics.unsupportedChanges.count).toBeGreaterThan(0);
    expect(metrics.changeTiming.medianErrorBeats).not.toBeNull();
  });

  it("fails only an enabled harmony gate, and fails closed for malformed diagnostics", () => {
    const disabled = evaluateHarmony(healthy);
    expect(disabled.gate.status).toBe("disabled");

    const strict: HarmonyGateOptions = { enabled: true };
    expect(evaluateHarmony(healthy, strict).gate.status).toBe("pass");
    const pathological = evaluateHarmony({
      ...healthy,
      windows: [{
        ...healthy.windows[0]!,
        candidate: {
          ...healthy.windows[0]!.candidate,
          leftHandNotes: [note(36, 0), note(37, 0), note(40, 0), note(43, 0), note(48, 0)],
        },
      }],
    }, strict);
    expect(pathological.gate.status).toBe("fail");
    expect(pathological.gate.failures.some((item) => /mud|notes per attack/i.test(item))).toBe(true);

    const malformed = evaluateHarmony({
      windows: [{ id: "bad", startBeat: 0, endBeat: 4, reference: { rootPc: 99 } }],
    });
    expect(evaluateHarmonyGate(malformed, strict).status).toBe("fail");
    expect(evaluateHarmonyGate(malformed, strict).failures).toContain("harmony evidence is malformed");
  });
});
