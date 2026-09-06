import { describe, expect, it } from "vitest";
import {
  DEFAULT_OMR_QUALITY_THRESHOLDS,
  evaluateOmrQuality,
  canonicalOmrQualityJson,
  selectBestOmrQuality,
  type OmrQualityInput,
} from "../src/omr-quality.js";

function score(measures: Array<Record<string, unknown>>): NonNullable<OmrQualityInput["engines"]>[number] {
  return {
    id: "audiveris",
    version: "5.11.0",
    score: {
      title: "Synthetic",
      parts: [{ id: "P1", name: "Piano", measures }],
    },
  };
}

function measure(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "m1",
    number: "1",
    page: 2,
    system: 1,
    durationBeats: 4,
    timeSignature: [4, 4],
    events: [
      { onset: 0, duration: 1, pitch: 60, role: "melody", staff: 1, voice: "1", accidental: "natural", tie: null },
      { onset: 1, duration: 1, pitch: 62, role: "melody", staff: 1, voice: "1", accidental: "natural", tie: null },
      { onset: 2, duration: 2, pitch: 64, role: "melody", staff: 1, voice: "1", accidental: "natural", tie: null },
    ],
    ...overrides,
  };
}

describe("independent OMR measure quality", () => {
  it("scores arithmetic-valid measures as acceptable and distinguishes underfull/overfull measures", () => {
    const report = evaluateOmrQuality({ engines: [score([
      measure(),
      measure({ id: "m2", number: "2", events: [{ onset: 0, duration: 2, pitch: 60 }] }),
      measure({ id: "m3", number: "3", events: [{ onset: 0, duration: 5, pitch: 60 }] }),
    ])] });

    expect(report.measures.find((row) => row.measureId === "P1:m1")?.categories.rhythmicValidity.score).toBe(1);
    expect(report.measures.find((row) => row.measureId === "P1:m2")?.diagnostics).toContain("underfull-measure");
    expect(report.measures.find((row) => row.measureId === "P1:m3")?.diagnostics).toContain("overfull-measure");
    expect(report.measures.find((row) => row.measureId === "P1:m1")?.state).toBe("AUTO_ACCEPT");
  });

  it("fails closed for impossible leaps, duplicates, and anomalous ties", () => {
    const report = evaluateOmrQuality({ engines: [score([measure({ events: [
      { onset: 0, duration: 1, pitch: 60, staff: 1, voice: "1", tie: "stop" },
      { onset: 0, duration: 1, pitch: 60, staff: 1, voice: "1", tie: "stop" },
      { onset: 1, duration: 1, pitch: 110, staff: 1, voice: "1", tie: "start" },
    ] })])] });
    const row = report.measures[0]!;

    expect(row.categories.pitchPlausibility.flags).toContain("impossible-leap");
    expect(row.categories.continuity.flags).toEqual(expect.arrayContaining(["duplicate-event", "orphan-tie-stop"]));
    expect(row.state).toBe("BROKEN");
  });

  it("marks density spikes without treating missing baseline evidence as zero", () => {
    const sparse = measure({ id: "sparse", number: "1", events: [{ onset: 0, duration: 4, pitch: 60 }] });
    const dense = measure({ id: "dense", number: "2", events: Array.from({ length: 16 }, (_, index) => ({ onset: index / 4, duration: 0.25, pitch: 60 + index % 3 })) });
    const single = evaluateOmrQuality({ engines: [score([sparse])] });
    const pair = evaluateOmrQuality({ engines: [score([sparse, dense])] });

    expect(single.measures[0]?.categories.densityAnomaly.score).toBeNull();
    expect(pair.measures.find((row) => row.measureId === "P1:dense")?.categories.densityAnomaly.flags).toContain("density-spike");
  });

  it("preserves missing page/staff/voice and accidental metadata as tri-state diagnostics", () => {
    const report = evaluateOmrQuality({ engines: [score([measure({ page: undefined, system: undefined, events: [{ onset: 0, duration: 4, pitch: 60 }] })])] });
    const row = report.measures[0]!;

    expect(row.page).toBeNull();
    expect(row.events[0]).toMatchObject({ pitch: 60, staff: null, voice: null, accidental: null, tie: { start: false, stop: false, continue: false } });
    expect(row.categories.notationCompleteness.available).toBe(true);
    expect(row.categories.notationCompleteness.score).toBeLessThan(1);
  });

  it("selects the best backend independently for each page/measure region", () => {
    const bad = score([measure({ page: 1, events: [{ onset: 0, duration: 1, pitch: 60 }, { onset: 1, duration: 1, pitch: 110 }] }), measure({ id: "m2", number: "2", page: 2, events: [{ onset: 0, duration: 1, pitch: 60 }, { onset: 1, duration: 1, pitch: 110 }] })]);
    const good = { ...score([measure({ page: 1 }), measure({ id: "m2", number: "2", page: 2 })]), id: "homr", version: "0.7.0" };
    const report = evaluateOmrQuality({ engines: [bad, good] });
    const selection = selectBestOmrQuality(report);

    expect(selection.regions.map((row) => row.backendId)).toEqual(["homr", "homr"]);
    expect(selection.regions.map((row) => row.page)).toEqual([1, 2]);
    expect(report.consensusClaim).toBe(false);
  });

  it("reports unavailable HOMR and malformed engines without throwing", () => {
    const report = evaluateOmrQuality({ engines: [
      { id: "homr", version: "0.7.0", status: "unavailable", error: "not installed" },
      { id: "broken", version: "unknown", score: null, status: "failed", error: "invalid output" },
    ] });

    expect(report.backends.map((row) => [row.id, row.status])).toEqual([["broken", "failed"], ["homr", "unavailable"]]);
    expect(report.measures.every((row) => row.state === "BROKEN" && row.available === false)).toBe(true);
    expect(report.backendSummaries.every((row) => row.measureCount === 0)).toBe(true);
  });

  it("is stable under backend and event reordering and exposes conservative thresholds", () => {
    const first = evaluateOmrQuality({ engines: [score([measure()]), { ...score([measure()]), id: "homr", version: "0.7.0" }] });
    const second = evaluateOmrQuality({ engines: [{ ...score([measure()]), id: "homr", version: "0.7.0" }, score([measure()])] });

    expect(canonicalOmrQualityJson(first)).toBe(canonicalOmrQualityJson(second));
    expect(DEFAULT_OMR_QUALITY_THRESHOLDS.measureDurationToleranceBeats).toBeLessThanOrEqual(0.1);
    expect(DEFAULT_OMR_QUALITY_THRESHOLDS.maxLeapSemitones).toBeGreaterThanOrEqual(24);
  });
});
