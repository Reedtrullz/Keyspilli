import { describe, expect, it } from "vitest";
import type { SongData } from "@keyspilli/player-core";
import { normalizeChordTimeline, resolveChordSources, selectChordSource } from "./chord-sources";

const song = (extra: Record<string, unknown> = {}): SongData => ({
  notes: [{ midi: 60, start: 0, dur: 1, vel: 80, hand: "R" }],
  chords: [{ beat: 0, name: "C", notes: [48, 52, 55] }],
  measures: [{ index: 0, startBeat: 0, endBeat: 4 }],
  key: "C",
  tempoBpm: 120,
  timeSig: [4, 4],
  ...extra,
});

describe("chord source selection", () => {
  it("normalizes UG timeline aliases and preserves supplied names", () => {
    expect(normalizeChordTimeline([
      { startBeat: 2, symbol: "G/B", midis: [47, 55, 59] },
      { beat: 0, label: "C", notes: [48, 52, 55] },
      { beat: 1, label: "C", notes: [48, 52, 55] },
    ])).toEqual([
      { beat: 0, name: "C", notes: [48, 52, 55] },
      { beat: 2, name: "G/B", notes: [47, 55, 59] },
    ]);
  });

  it("keeps repeated chord labels when their inversion changes and rejects unsafe MIDI values", () => {
    expect(normalizeChordTimeline([
      { beat: 0, name: "C", notes: [48, 52, 55] },
      { beat: 2, name: "C", notes: [52, 55, 60] },
      { beat: 4, name: "C", notes: [-1, 48.5, 200, 48] },
    ])).toEqual([
      { beat: 0, name: "C", notes: [48, 52, 55] },
      { beat: 2, name: "C", notes: [52, 55, 60] },
      { beat: 4, name: "C", notes: [48] },
    ]);
  });

  it("selects UG source in auto mode when provenance is supplied", () => {
    const sources = resolveChordSources(song({
      ugChordTimeline: [
        { beat: 0, name: "C", notes: [48, 52, 55] },
        { beat: 2, name: "G", notes: [43, 47, 50] },
      ],
      provenance: { kind: "standard", sourceRef: "ug-tabs:example" },
    }));
    expect(sources.ug?.provenance).toBe("ug-tabs:example");
    expect(sources.generated.chords[0]?.sourceKind).toBe("generated");
    expect(sources.ug?.chords[0]?.sourceKind).toBe("authored");
    expect(selectChordSource(sources, "auto").source?.id).toBe("ug");
    expect(selectChordSource(sources, "ug").fallback).toBe(false);
  });

  it("reports an explicit fallback when UG is requested but absent", () => {
    const selected = selectChordSource(resolveChordSources(song()), "ug");
    expect(selected.source?.id).toBe("generated");
    expect(selected.fallback).toBe(true);
    expect(selected.fallbackReason).toMatch(/UG timeline is unavailable/i);
  });

  it("marks a partial UG timeline when the remaining song uses generated chords", () => {
    const sources = resolveChordSources(song({
      ugChordTimeline: [{ beat: 0, name: "C", notes: [48, 52, 55] }],
      chordProvenance: {
        provider: "ultimate-guitar",
        sourceRef: "ultimate-guitar:partial",
        fallback: true,
        fallbackReason: "opening section only",
      },
    }));
    expect(sources.ug?.label).toBe("UG + generated fallback");
    expect(selectChordSource(sources, "ug")).toMatchObject({ fallback: true, fallbackReason: "opening section only" });
  });

  it("does not treat an unlabelled generic timeline as UG", () => {
    const sources = resolveChordSources(song({ chordTimeline: [{ beat: 0, name: "C", notes: [48, 52, 55] }] }));
    expect(sources.ug).toBeNull();
  });

  it("recognizes the canonical timeline provenance and derives omitted voicings", () => {
    const sources = resolveChordSources(song({
      chordTimeline: {
        chords: [{ beat: 0, name: "C" }, { beat: 4, name: "G7" }],
        provenance: { sourceId: "ug-your-song", provider: "ultimate-guitar", sourceRef: "ultimate-guitar:example" },
      },
    }));
    expect(sources.ug?.provenance).toBe("ultimate-guitar:example");
    expect(sources.ug?.chords[0]?.notes.length).toBeGreaterThan(0);
  });

  it("preserves event provenance, duration, and explicit voicings at the web boundary", () => {
    expect(normalizeChordTimeline([
      {
        beat: 0,
        name: "C/E",
        notes: [52, 55, 60, 64],
        sourceKind: "authored",
        inferred: false,
        inferenceType: "voicing",
        durationBeats: 4,
      },
    ])).toEqual([
      {
        beat: 0,
        name: "C/E",
        notes: [52, 55, 60, 64],
        sourceKind: "authored",
        inferred: false,
        inferenceType: "voicing",
        durationBeats: 4,
      },
    ]);
  });

  it("retains an explicit empty voicing instead of inferring notes", () => {
    expect(normalizeChordTimeline([{
      beat: 0,
      name: "N.C.",
      notes: [],
      sourceKind: "authored",
    }])).toEqual([{
      beat: 0,
      name: "N.C.",
      notes: [],
      sourceKind: "authored",
    }]);
  });
});
