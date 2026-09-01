import { describe, expect, it } from "vitest";
import {
  SHADOW_ALIGNMENT_BAR_BEATS,
  calibrateShadowAlignment,
  createShadowAlignmentFixtures,
  createShadowAlignmentReference,
  normalizeShadowAlignmentWindows,
  type ShadowAlignmentFixture,
} from "../src/shadow-alignment.js";

function fixture(id: string): ShadowAlignmentFixture {
  const selected = createShadowAlignmentFixtures().find((entry) => entry.id === id);
  if (!selected) throw new Error(`missing shadow alignment fixture: ${id}`);
  return selected;
}

describe("shadow symbolic-alignment calibration", () => {
  it("builds an eight-bar reference and deterministic corruption transforms", () => {
    const reference = createShadowAlignmentReference();
    expect(reference.durationBeats).toBe(8 * SHADOW_ALIGNMENT_BAR_BEATS);
    expect(reference.notes.length).toBeGreaterThan(64);
    expect(reference.notes.every((note) => note.start >= 0 && note.start + note.dur <= reference.durationBeats!)).toBe(true);

    const fixtures = createShadowAlignmentFixtures();
    expect(fixtures.map((entry) => entry.id)).toEqual([
      "offset-plus-5s",
      "offset-plus-15s",
      "tempo-0.8x",
      "tempo-1.25x",
      "transpose-plus-2",
      "transpose-minus-2",
      "remove-first-section",
      "remove-repeat",
      "duplicate-repeat",
      "truncate-ending",
    ]);
    expect(fixture("offset-plus-5s").truth.offsetSeconds).toBe(5);
    expect(fixture("offset-plus-5s").truth.offsetBeats).toBe(10);
    expect(fixture("offset-plus-15s").truth.offsetBeats).toBe(30);
    expect(fixture("tempo-0.8x").truth.beatScale).toBe(0.8);
    expect(fixture("tempo-1.25x").truth.beatScale).toBe(1.25);
    expect(fixture("transpose-plus-2").truth.transposeSemitones).toBe(2);
    expect(fixture("transpose-minus-2").truth.transposeSemitones).toBe(-2);
    expect(fixture("truncate-ending").candidate.durationBeats).toBeLessThan(reference.durationBeats!);
    expect(fixture("duplicate-repeat").candidate.durationBeats).toBeGreaterThan(reference.durationBeats!);
  });

  it("normalizes paired windows and fails closed for malformed windows", () => {
    const source = fixture("offset-plus-5s");
    const normalized = normalizeShadowAlignmentWindows(source.windows);
    expect(normalized.invalid).toBe(0);
    expect(normalized.windows).toHaveLength(4);
    expect(normalized.windows.map((window) => window.id)).toEqual(["intro", "verse", "chorus", "outro"]);

    const malformed = normalizeShadowAlignmentWindows([
      ...source.windows,
      { id: "bad", reference: [8, 4], candidate: [1, 2] },
      { id: "intro", reference: [0, 1], candidate: [10, 11] },
    ]);
    expect(malformed.invalid).toBe(2);
    expect(malformed.windows).toHaveLength(4);
  });

  it("recovers blind offset, tempo, and transpose cases with timing evidence", () => {
    const report = calibrateShadowAlignment();
    for (const id of ["offset-plus-5s", "offset-plus-15s", "tempo-0.8x", "tempo-1.25x", "transpose-plus-2", "transpose-minus-2"]) {
      const row = report.cases.find((entry) => entry.caseId === id);
      expect(row, id).toBeDefined();
      expect(row?.recovered, id).toBe(true);
      expect(row?.falseAlignment, id).toBe(false);
      expect(row?.timingErrorBeats.median, id).toBeLessThanOrEqual(0.001);
      expect(row?.coverage.referenceRatio, id).toBe(1);
      expect(row?.recoveredTransform, id).toMatchObject({
        offsetBeats: fixture(id).truth.offsetBeats,
        beatScale: fixture(id).truth.beatScale,
        transposeSemitones: fixture(id).truth.alignmentTransposeSemitones,
      });
    }
  });

  it("reports truncation, section removal, and repeat insertion as partial or false-alignment evidence", () => {
    const report = calibrateShadowAlignment();
    const truncated = report.cases.find((entry) => entry.caseId === "truncate-ending")!;
    expect(truncated.recovered).toBe(true);
    expect(truncated.status).toBe("partial");
    expect(truncated.coverage.referenceRatio).toBeLessThan(1);
    expect(truncated.unalignedDurationBeats).toBeGreaterThan(0);
    expect(truncated.falseAlignment).toBe(false);

    const removed = report.cases.find((entry) => entry.caseId === "remove-repeat")!;
    expect(removed.status).toBe("partial");
    expect(removed.coverage.referenceRatio).toBeLessThan(1);
    expect(removed.falseAlignment).toBe(false);

    const duplicated = report.cases.find((entry) => entry.caseId === "duplicate-repeat")!;
    expect(duplicated.coverage.candidateRatio).toBeLessThan(1);
    expect(duplicated.falseAlignedDurationBeats).toBeGreaterThan(0);
    expect(duplicated.falseAlignment).toBe(true);
  });

  it("is deterministic and keeps the 3-window/32-bar gate as a calibration observation", () => {
    const first = calibrateShadowAlignment();
    const second = calibrateShadowAlignment();
    expect(second).toEqual(first);
    expect(first.gate.windowMinimum).toBe(3);
    expect(first.gate.barMinimum).toBe(32);
    expect(first.gate.thresholdsChanged).toBe(false);
    expect(first.gate.assessment).toBe("insufficient-independent-32-bar-evidence");
    expect(JSON.stringify(first)).not.toMatch(/generatedAt|\/Users\/|\/private\/tmp/);
  });
});
