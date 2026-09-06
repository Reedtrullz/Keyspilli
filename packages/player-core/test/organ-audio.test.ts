import { describe, expect, it } from "vitest";
import {
  ROCK_REGISTRATION,
  ROTARY_SPEEDS,
  buildDriveCurve,
  buildTonewheelCoefficients,
  drawbarAmplitude,
  organVelocityLevel,
  tonewheelFrequencies,
} from "../src/organ-audio.js";

describe("tonewheel math", () => {
  it("maps A4 to the nine Hammond drawbar frequencies", () => {
    expect(tonewheelFrequencies(69)).toEqual([220, 660, 440, 880, 1320, 1760, 2200, 2640, 3520]);
  });

  it("maps the frozen 888800000 registration onto one normalized PeriodicWave", () => {
    const { real, imag } = buildTonewheelCoefficients(ROCK_REGISTRATION);
    expect([...real]).toEqual([0, 0.25, 0.25, 0.25, 0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...imag]).toEqual(Array(17).fill(0));
  });

  it("uses silent zero and monotonic 3 dB drawbar steps", () => {
    const levels = Array.from({ length: 9 }, (_, digit) => drawbarAmplitude(digit));
    expect(levels[0]).toBe(0);
    expect(levels[7]).toBeCloseTo(0.7079, 4);
    expect(levels[8]).toBe(1);
    expect(levels.every((level, index) => index === 0 || level > levels[index - 1]!)).toBe(true);
  });

  it("keeps velocity influence shallow", () => {
    expect(organVelocityLevel(1)).toBeCloseTo(0.752, 3);
    expect(organVelocityLevel(64)).toBeCloseTo(0.876, 3);
    expect(organVelocityLevel(127)).toBe(1);
  });
});

describe("organ effects math", () => {
  it("keeps drive curves finite, bounded, symmetric, and linear at zero", () => {
    const linear = buildDriveCurve(0, 5);
    const driven = buildDriveCurve(1, 5);
    expect([...linear]).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(driven.every(Number.isFinite)).toBe(true);
    expect(Math.max(...driven)).toBeLessThanOrEqual(1);
    expect(Math.min(...driven)).toBeGreaterThanOrEqual(-1);
    expect(driven[0]).toBeCloseTo(-driven[4]!, 6);
    expect(driven[1]).toBeCloseTo(-driven[3]!, 6);
    expect(driven[3]).toBeGreaterThan(linear[3]!);
  });

  it("defines materially distinct bounded slow and fast rotor rates", () => {
    expect(ROTARY_SPEEDS.slow.lowHz).toBeLessThan(1);
    expect(ROTARY_SPEEDS.slow.highHz).toBeLessThan(1);
    expect(ROTARY_SPEEDS.fast.lowHz).toBeGreaterThanOrEqual(5);
    expect(ROTARY_SPEEDS.fast.highHz).toBeGreaterThan(ROTARY_SPEEDS.fast.lowHz);
    expect(ROTARY_SPEEDS.fast.highHz).toBeLessThanOrEqual(8);
  });
});
