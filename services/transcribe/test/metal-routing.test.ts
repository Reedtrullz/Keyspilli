import type { Note, ParsedMidi } from "@keyspilli/midi";
import { describe, expect, it } from "vitest";
import { assessMetalRouting, type MetalRoutingRole, type MetalRoutingStem } from "../src/metal-routing.js";

function midi(notes: Note[], durationBeats = 32): ParsedMidi {
  return {
    format: 1,
    division: 480,
    tempoBpm: 120,
    keySig: 0,
    keyMode: 0,
    timeSig: [4, 4],
    notes,
    trackNames: ["stem"],
    durationBeats,
  };
}

function repeated(count: number, pitch: number, spacing = 1): Note[] {
  return Array.from({ length: count }, (_, index) => ({
    midi: pitch,
    start: index * spacing,
    dur: Math.min(0.75, spacing),
    vel: 80,
  }));
}

function stems(overrides: Partial<Record<MetalRoutingRole, Note[]>> = {}): MetalRoutingStem[] {
  return (["vocals", "bass", "guitar", "drums"] as const).map((role) => ({
    role,
    midi: midi(overrides[role] ?? []),
  }));
}

describe("assessMetalRouting", () => {
  it("accepts a full-band stem set with a low-register, active guitar lane", () => {
    const guitar = Array.from({ length: 24 }, (_, index) => ({
      midi: index % 2 ? 72 : 52,
      start: index,
      dur: 0.75,
      vel: 90,
    }));
    const result = assessMetalRouting(stems({
      vocals: repeated(8, 74),
      bass: repeated(8, 40, 2),
      guitar,
      drums: repeated(16, 36),
    }));

    expect(result.eligible).toBe(true);
    expect(result.reason).toBe("eligible");
    expect(result.features.counts).toEqual({ vocals: 8, bass: 8, guitar: 24, drums: 16 });
    expect(result.features.guitarLowRegisterRatio).toBe(0.5);
    expect(result.features.guitarAttackDensity).toBeGreaterThan(0.25);
  });

  it("rejects note-rich piano-like residuals without low-register guitar attacks", () => {
    const result = assessMetalRouting(stems({
      vocals: repeated(12, 76),
      bass: repeated(12, 40),
      // Many high notes can be a piano or bright accompaniment bleed. They
      // are not enough evidence to route the source as a metal band.
      guitar: repeated(40, 84, 0.5),
      drums: repeated(20, 36),
    }));

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("missing-guitar-signal");
    expect(result.features.counts.guitar).toBe(40);
    expect(result.features.guitarLowRegisterRatio).toBe(0);
  });

  it("rejects a residual with enough notes but no meaningful band foundation", () => {
    const result = assessMetalRouting(stems({
      vocals: repeated(40, 74),
      guitar: repeated(40, 52),
    }));

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("missing-band-counts");
  });

  it("keeps a missing-identity decision distinct from a missing-guitar signal", () => {
    const result = assessMetalRouting(stems({
      bass: repeated(8, 40),
      drums: repeated(16, 36),
    }));

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("missing-identity");
  });

  it("does not treat vocal count as a substitute for metal guitar evidence", () => {
    const result = assessMetalRouting(stems({
      vocals: repeated(16, 74),
      bass: repeated(8, 40, 2),
      drums: repeated(16, 36),
    }));

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("missing-guitar-signal");
    expect(result.message).toContain("guitar-signal gate");
  });

  it("allows an explicit force override while retaining feature diagnostics", () => {
    const result = assessMetalRouting(stems(), { force: true });

    expect(result.eligible).toBe(true);
    expect(result.forced).toBe(true);
    expect(result.reason).toBe("forced");
    expect(result.features.counts).toEqual({ vocals: 0, bass: 0, guitar: 0, drums: 0 });
    expect(result.message).toContain("forced metal routing");
  });

  it("does not let simultaneous octave duplicates inflate attack density", () => {
    const guitar = Array.from({ length: 24 }, (_, index) => [
      { midi: 52, start: index, dur: 0.75, vel: 80 },
      { midi: 64, start: index + 0.03, dur: 0.75, vel: 80 },
    ]).flat();
    const result = assessMetalRouting(stems({
      vocals: repeated(8, 74),
      bass: repeated(8, 40, 2),
      guitar,
      drums: repeated(16, 36),
    }));

    expect(result.features.counts.guitar).toBe(48);
    expect(result.features.guitarAttackCount).toBe(24);
    expect(result.features.guitarAttackDensity).toBe(0.75);
  });

  it("accepts a sparse riff that is active across a long recording", () => {
    const durationBeats = 600;
    const result = assessMetalRouting(stems({
      vocals: repeated(12, 74, 8),
      bass: repeated(12, 40, 8),
      guitar: Array.from({ length: 40 }, (_, index) => ({
        midi: index % 2 ? 59 : 52,
        start: 96 + index * 4,
        dur: 1,
        vel: 88,
      })),
      drums: repeated(24, 36, 4),
    }).map((stem) => ({
      ...stem,
      midi: { ...stem.midi, durationBeats },
    })));

    expect(result.eligible).toBe(true);
    expect(result.features.guitarAttackDensity).toBeLessThan(0.1);
    expect(result.features.guitarActiveAttackDensity).toBeGreaterThanOrEqual(0.25);
    expect(result.features.guitarSongCoverage).toBeGreaterThanOrEqual(0.1);
  });

  it("rejects a short isolated residual cluster despite high local density", () => {
    const durationBeats = 600;
    const result = assessMetalRouting(stems({
      vocals: repeated(12, 74, 8),
      bass: repeated(12, 40, 8),
      guitar: Array.from({ length: 40 }, (_, index) => ({
        midi: index % 2 ? 59 : 52,
        start: 96 + index * 0.5,
        dur: 0.25,
        vel: 88,
      })),
      drums: repeated(24, 36, 4),
    }).map((stem) => ({
      ...stem,
      midi: { ...stem.midi, durationBeats },
    })));

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("missing-guitar-signal");
    expect(result.features.guitarActiveAttackDensity).toBeGreaterThan(1);
    expect(result.features.guitarSongCoverage).toBeLessThan(0.1);
  });
});
