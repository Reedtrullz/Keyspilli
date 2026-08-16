import { describe, expect, it } from "vitest";
import type { ChordLabel } from "@keyspilli/midi";
import { mergeChartTimeline } from "./catalog-api";

const provenance = {
  sourceId: "ug-test",
  provider: "ultimate-guitar",
  kind: "chart" as const,
  sourceRef: "ultimate-guitar:test",
};

describe("catalog chart timeline merge", () => {
  it("fills partial or unvoiced chart positions from generated chords", () => {
    const timeline = {
      schemaVersion: 1 as const,
      baseId: "test-song",
      title: "Test Song",
      artist: "Tester",
      timeSig: [4, 4] as [number, number],
      durationBeats: 12,
      coverage: "opening-section" as const,
      chords: [
        { beat: 0, durationBeats: 4, name: "C", notes: [48, 52, 55] },
        { beat: 4, durationBeats: 4, name: "Unsupported", notes: [] },
      ],
      provenance,
    };
    const generated: ChordLabel[] = [
      { beat: 0, name: "C", notes: [48, 52, 55] },
      { beat: 4, name: "F", notes: [41, 48, 53] },
      { beat: 8, name: "G", notes: [43, 50, 55] },
    ];

    const merged = mergeChartTimeline(timeline, generated);
    expect(merged.chords.map((chord) => chord.name)).toEqual(["C", "F", "G"]);
    expect(merged.provenance.fallback).toBe(true);
    expect(merged.provenance.fallbackReason).toMatch(/remaining song|uncovered/i);
  });

  it("derives a voicing for a supported symbol when the chart omits notes", () => {
    const timeline = {
      schemaVersion: 1 as const,
      baseId: "test-song",
      title: "Test Song",
      artist: "Tester",
      timeSig: [4, 4] as [number, number],
      durationBeats: 4,
      coverage: "full-song" as const,
      chords: [{ beat: 0, durationBeats: 4, name: "G7" }],
      provenance,
    };
    const merged = mergeChartTimeline(timeline, []);
    expect(merged.chords[0]?.notes).toEqual([43, 55, 59, 62, 65]);
    expect(merged.provenance.fallback).not.toBe(true);
  });

  it("does not relabel a generated-only fallback as an Ultimate Guitar chart", () => {
    const timeline = {
      schemaVersion: 1 as const,
      baseId: "generated-song",
      title: "Generated Song",
      artist: "Tester",
      timeSig: [4, 4] as [number, number],
      durationBeats: 4,
      coverage: "full-song" as const,
      chords: [{ beat: 0, durationBeats: 4, name: "C", notes: [48, 52, 55] }],
      provenance: {
        sourceId: "midi-derived",
        provider: "keyspilli",
        kind: "midi-derived" as const,
        sourceRef: "variant:a:notes.json",
        fallback: true,
        fallbackReason: "chart artifact unavailable; derived from a/notes.json",
      },
    };
    const merged = mergeChartTimeline(timeline, []);
    expect(merged.provenance.kind).toBe("midi-derived");
    expect(merged.provenance.fallbackReason).toContain("chart artifact unavailable");
  });
});
