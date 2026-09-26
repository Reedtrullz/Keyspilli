import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chordPitchClasses } from "@keyspilli/midi";
import {
  loadChordTimeline,
  normalizeChordTimeline,
  parseChordSourceMap,
  resolveChordTimeline,
  validateChordSourceMap,
} from "../src/index.js";

const YOUR_SONG = "the-theorist-elton-john-your-song-piano-cover-jz6ugvghbt8";
const SKYFALL = "adele-skyfall";
const AEROSMITH = "aerosmith-i-dont-want-to-miss-a-thing";
const MY_WAY = "frank-sinatra-my-way";
const KINGS_QUEENS = "piano-cover-by-pianella-piano-ava-max-kings-queens-mslwtpef";
const IMAGINE = "john-lennon-imagine";
const LET_IT_BE = "the-beatles-let-it-be";

describe("catalog chord source plumbing", () => {
  it.each([
    [IMAGINE, "ug-imagine", 73, 224, [[0, "C"], [3, "Cmaj7"], [4, "F"], [50, "Am/E"], [52, "Dm7"], [112, "F"], [118, "E7"], [132, "Am"], [136, "Dm7"], [176, "F"], [220, "C"]]],
    [LET_IT_BE, "ug-let-it-be", 70, 288, [[0, "N.C."], [4, "C"], [6, "G"], [10, "Fmaj7"], [11, "F6"], [52, "Am"], [91, "F6/C"], [100, "Am"], [132, "F"], [144, "G"], [180, "Am"], [219, "F6/C"], [228, "Am"], [282, "C"]]],
  ] as const)("covers %s with the published harmony on its Advanced beat grid", async (baseId, sourceId, tempo, duration, examples) => {
    const result = await resolveChordTimeline(baseId, { runtimeDataDir: join(process.cwd(), "missing-runtime-data") });
    expect(result?.usedFallback).toBe(false);
    expect(result?.source.id).toBe(sourceId);
    expect(result?.timeline.coverage).toBe("full-song");
    expect(result?.timeline.tempoBpm).toBe(tempo);
    const chords = result?.timeline.chords ?? [];
    const at = (beat: number) => chords.find((chord) => chord.beat <= beat && beat < chord.beat + chord.durationBeats)?.name;
    for (const [beat, name] of examples) expect(at(beat)).toBe(name);
    expect(chords[0]?.beat).toBe(0);
    expect(chords.at(-1)!.beat + chords.at(-1)!.durationBeats).toBe(duration);
    expect(chords.every((chord, index) => index === 0 || chords[index - 1]!.beat + chords[index - 1]!.durationBeats === chord.beat)).toBe(true);
    expect(chords.every((chord) => chord.name === "N.C." || chordPitchClasses(chord.name).length > 0)).toBe(true);
  });

  it("retains authored repeated F and C onsets and the short chord ladders in both songs", async () => {
    const imagine = (await resolveChordTimeline(IMAGINE))!.timeline.chords;
    const letItBe = (await resolveChordTimeline(LET_IT_BE))!.timeline.chords;
    const at = (chords: typeof imagine, beat: number) => chords.find((chord) => chord.beat === beat)?.name;
    for (const [beat, name] of [[67.875, "F"], [96, "F"], [99.875, "Dm7"], [119, "E7/D"], [123.875, "C"], [176, "F"], [179.875, "Dm7"], [199, "E7/D"], [203.875, "C"]] as const) {
      expect(at(imagine, beat), `Imagine beat ${beat}`).toBe(name);
    }
    for (const [beat, name] of [[5, "C"], [7, "G"], [20, "C"], [21, "C"], [33, "C/E"], [33.5, "Dm7"], [51, "Cmaj7/B"], [53, "Am"], [65, "C/E"], [65.5, "Dm7"], [99, "C"], [135, "Bb"], [135.5, "Am"], [137, "F"], [145, "F"], [227, "C"], [277, "C/E"], [277.5, "Dm"], [279, "Bb"], [279.5, "Am"], [281, "F"]] as const) {
      expect(at(letItBe, beat), `Let It Be beat ${beat}`).toBe(name);
    }
  });

  it("keeps adjacent authored repeats as independent attack boundaries", () => {
    const input = {
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test Song",
      artist: "Tester",
      durationBeats: 4,
      provenance: { sourceId: "chart", provider: "test", kind: "chart", sourceRef: "test" },
      chords: [{ beat: 0, durationBeats: 2, name: "C" }, { beat: 2, durationBeats: 2, name: "C" }],
    };
    const once = normalizeChordTimeline(input);
    expect(once.chords.map(({ beat }) => beat)).toEqual([0, 2]);
    expect(normalizeChordTimeline(once)).toEqual(once);
  });

  it("keeps Help's sustained A7 entry and bar-anchored late pulses under continuous harmony", async () => {
    const chords = (await resolveChordTimeline("the-beatles-help"))!.timeline.chords;
    expect(chords.filter(({ beat }) => beat >= 148 && beat < 172)
      .map(({ beat, durationBeats, name, strikeSpacingBeats, maxStrikeDurationBeats }) =>
        [beat, durationBeats, name, strikeSpacingBeats, maxStrikeDurationBeats])).toEqual([
      [148, 8, "A7", 4, undefined],
      [156, 2.5, "A7", 2, 1.75],
      [158.5, 1.5, "A7", 2, 1.75],
      [160, 2.5, "A7", 2, 1.75],
      [162.5, 1.5, "A7", 2, 1.75],
      [164, 2, "A7", 2, 1.75],
      [166, 2, "A7", 2, 1.75],
      [168, 2, "A7", 2, 1.75],
      [170, 2, "A7", 2, 1.75],
    ]);
  });

  it("aligns Aerosmith's D-key chart with the Advanced intro, verses, bridge, and final chorus", async () => {
    const result = await resolveChordTimeline(AEROSMITH, { runtimeDataDir: join(process.cwd(), "missing-runtime-data") });
    expect(result?.usedFallback).toBe(false);
    expect(result?.source.id).toBe("ug-i-dont-want-to-miss-a-thing");
    expect(result?.timeline.coverage).toBe("full-song");
    expect(result?.timeline.key).toBe("D");
    const chords = result?.timeline.chords ?? [];
    const at = (beat: number) => chords.find((chord) => chord.beat <= beat && beat < chord.beat + chord.durationBeats)?.name;
    expect([at(0), at(4), at(8), at(36), at(38), at(40), at(44), at(46), at(48), at(68), at(72), at(76), at(80), at(84), at(100), at(120), at(140), at(168), at(172), at(176), at(180), at(192), at(196), at(204), at(240), at(242), at(252), at(278), at(288), at(299)]).toEqual([
      "N.C.", "A/B", "A/E", "D", "A/C#", "Bm", "G", "D/F#", "Em7/D", "F#m", "A", "D", "Em", "G", "D", "A7/E", "D", "C", "G", "Bb", "F", "Dm/A", "A", "D", "Bm", "A/C#", "D", "A", "D", "A",
    ]);
    expect(chords[0]?.beat).toBe(0);
    expect(chords.at(-1)!.beat + chords.at(-1)!.durationBeats).toBe(300);
    expect(chords.every((chord, index) => index === 0 || chords[index - 1]!.beat + chords[index - 1]!.durationBeats === chord.beat)).toBe(true);
    expect(chords.every((chord) => chord.name === "N.C." || chordPitchClasses(chord.name).length > 0)).toBe(true);
  });

  it("uses the sounding-key Kings & Queens progression through Pianella's bridge and outro", async () => {
    const result = await resolveChordTimeline(KINGS_QUEENS, { runtimeDataDir: join(process.cwd(), "missing-runtime-data") });
    expect(result?.usedFallback).toBe(false);
    expect(result?.source.id).toBe("ug-kings-and-queens-pianella");
    expect(result?.timeline.coverage).toBe("full-song");
    expect(result?.timeline.key).toBe("C#m");

    const chords = result?.timeline.chords ?? [];
    const at = (beat: number) => chords.find((chord) => chord.beat <= beat && beat < chord.beat + chord.durationBeats)?.name;
    expect([at(4), at(13.5), at(15), at(17.5), at(19), at(21.375), at(23.375), at(25.5), at(26.875), at(251.625), at(255.625), at(259.625), at(263.625), at(267.5), at(271.625), at(275.5), at(279.5), at(287.375), at(348.375), at(355)]).toEqual([
      "N.C.", "C#m", "F#m", "B", "E", "A", "F#m", "G#m", "C#m", "D", "A", "E", "B", "D", "A", "E", "G#", "C#m", "C#m", "N.C.",
    ]);
    // In the later repeated progression, each new bass entry switches harmony on its first attack.
    expect([at(205.875), at(206), at(208), at(213.875), at(221.875), at(225.875), at(229.875), at(233.875), at(237.75), at(239.75), at(241.75), at(245.75)]).toEqual([
      "C#m", "F#m", "B", "F#m", "F#m", "E", "F#m", "C#m", "F#m", "B", "E", "F#m",
    ]);
    expect(chords.at(-1)!.beat + chords.at(-1)!.durationBeats).toBe(376);
    expect(chords.every((chord, index) => index === 0 || chords[index - 1]!.beat + chords[index - 1]!.durationBeats === chord.beat)).toBe(true);
    expect(chords.every((chord) => chord.name === "N.C." || chordPitchClasses(chord.name).length > 0)).toBe(true);
  });

  it("uses My Way's chart at the descending verse bass, turnaround, and final cadence", async () => {
    const result = await resolveChordTimeline(MY_WAY, { runtimeDataDir: join(process.cwd(), "missing-runtime-data") });
    expect(result?.usedFallback).toBe(false);
    expect(result?.source.id).toBe("ug-my-way");
    expect(result?.timeline.coverage).toBe("full-song");

    const chords = result?.timeline.chords ?? [];
    const at = (beat: number) => chords.find((chord) => chord.beat <= beat && beat < chord.beat + chord.durationBeats)?.name;
    expect([at(4), at(8), at(20), at(24), at(28), at(36), at(40), at(56), at(60), at(68), at(84), at(120), at(148), at(168), at(192), at(200), at(236), at(280), at(320), at(340)]).toEqual([
      "N.C.", "D", "Dmaj7/C#", "D7/C", "B7", "Em7/D", "A7/C#", "G", "Gm/E", "Asus4", "Dmaj7/C#", "G", "D7", "F#m7", "D/F#", "D7/C", "Gm/E", "F#m7", "A7/E", "D",
    ]);
    expect(chords[0]?.beat).toBe(0);
    expect(chords.at(-1)!.beat + chords.at(-1)!.durationBeats).toBe(352);
    expect(chords.every((chord, index) => index === 0 || chords[index - 1]!.beat + chords[index - 1]!.durationBeats === chord.beat)).toBe(true);
    expect(chords.every((chord) => chord.name === "N.C." || chordPitchClasses(chord.name).length > 0)).toBe(true);
  });

  it("uses Skyfall's chart through the intro, cadences, bridge, and outro", async () => {
    const result = await resolveChordTimeline(SKYFALL, { runtimeDataDir: join(process.cwd(), "missing-runtime-data") });
    expect(result?.usedFallback).toBe(false);
    expect(result?.source.id).toBe("ug-skyfall");
    expect(result?.timeline.coverage).toBe("full-song");

    const chords = result?.timeline.chords ?? [];
    const at = (beat: number) => chords.find((chord) => chord.beat <= beat && beat < chord.beat + chord.durationBeats)?.name;
    expect([
      at(4), at(18.75), at(20), at(24), at(26), at(40), at(44),
      at(84), at(86), at(92), at(94), at(100), at(102),
      at(123), at(124), at(126), at(136), at(148), at(150), at(200),
      at(252), at(256), at(259), at(264), at(266), at(332), at(334), at(352),
    ]).toEqual([
      "N.C.", "Cm", "Fm", "Cm", "Ab", "Ddim", "G",
      "F", "Fm", "F", "Fm", "F", "Fm",
      "Eb", "Ddim", "G", "F", "F", "Fm", "Fm",
      "N.C.", "F", "G", "Bb", "Bdim", "Ddim", "G", "Cm",
    ]);
    expect(chords[0]?.beat).toBe(0);
    expect(chords.at(-1)!.beat + chords.at(-1)!.durationBeats).toBe(360);
    expect(chords.every((chord, index) => index === 0 || chords[index - 1]!.beat + chords[index - 1]!.durationBeats === chord.beat)).toBe(true);
  });

  it("loads the checked-in Your Song chart with external provenance", async () => {
    const result = await resolveChordTimeline(YOUR_SONG, { runtimeDataDir: join(process.cwd(), "missing-runtime-data") });
    expect(result).not.toBeNull();
    expect(result?.usedFallback).toBe(false);
    expect(result?.source.id).toBe("ug-your-song");
    expect(result?.timeline.baseId).toBe(YOUR_SONG);
    expect(result?.timeline.chords.length).toBeGreaterThan(8);
    expect(result?.timeline.chords[0]).toMatchObject({ beat: 0, name: "N.C.", durationBeats: 1.25 });
    expect(result?.timeline.coverage).toBe("full-song");
    expect(result?.timeline.durationBeats).toBe(516);
    expect(result?.timeline.provenance.provider).toBe("ultimate-guitar");
    expect(result?.timeline.provenance.sourceUrl).toBe("https://tabs.ultimate-guitar.com/tab/elton-john/your-song-chords-2323509");
    expect(result?.timeline.chords.filter((chord) => chord.name === "Cm/A").map((chord) => chord.beat)).toEqual([
      41.5, 109.75, 193.5, 266.375, 334.75, 418.25, 459.125,
    ]);
    expect(JSON.stringify(result?.timeline)).not.toMatch(/lyrics|tablature|chartText/i);
  });

  it.each([
    [YOUR_SONG, "Eb", 516, [4, 4], [[1.25, "Eb/Bb"], [5.25, "Ab/C"], [25.625, "Bb/D"]]],
    ["gloria-gaynor-i-will-survive", "Am", 388, [4, 4], [[24, "Am7"], [27.875, "Dm7/A"], [32.5, "G7"], [35.875, "Cmaj7/G"], [39.875, "Fmaj7"], [44.5, "Dm/B"], [47.875, "Esus4"], [51.875, "E7"], [59.875, "Dm7"], [375.875, "Am7"]]],
    ["the-beatles-help", "A", 436, [4, 4], [[4, "Bm"], [10, "Bm"], [10.5, "G"], [18, "G/F#"], [60, "D"], [62, "G"]]],
    ["status-quo-in-the-army-now", "Em", 428, [4, 4], [[12, "Dm"], [52, "Gm"], [192, "Em"], [208, "Am"], [212, "Bm"]]],
    ["ozzy-osbourne-dreamer", "Db", 364, [4, 4], [[5.5, "Db"], [34.75, "Ebm"], [84.5, "Bbm"], [176.125, "Ebm"], [344.25, "Db"]]],
    ["rousseau-john-legend-all-of-me-piano-cover-mslwrq3x", "Fm", 664, [4, 4], [[0, "Fm"], [4.5, "Db"], [8.875, "Ab"], [13.375, "Eb"], [44.875, "Fm"], [52.125, "Db"]]],
    ["journey-dont-stop-believin", "C#", 520, [4, 4], [[4, "C#"], [6.5, "G#/D#"], [10.5, "A#m"], [15.5, "F#"]]],
    ["mary-hopkin-those-were-the-days", "Am", 344, [2, 4], [[8, "Am"], [16, "A7"], [20, "Dm"], [32, "B7"], [52, "G7"]]],
    ["katherine-cordova-coldplay-fix-you-advanced-piano-cover-mslws0x0", "Eb", 332, [4, 4], [[1.875, "Eb"], [3.875, "Ebmaj7/G"], [5.875, "Cm"], [7.875, "Bb"], [81.875, "Ab"], [177.875, "Eb"]]],
    ["abba-the-winner-takes-it-all", "F#", 592, [4, 4], [[0, "F#"], [6.5, "A#7"], [8, "D#m"], [76, "C#/F"]]],
  ] as const)("keeps %s playable and complete at its source changes", async (baseId, key, end, meter, examples) => {
    const result = await resolveChordTimeline(baseId, { runtimeDataDir: join(process.cwd(), "missing-runtime-data") });
    expect(result?.usedFallback).toBe(false);
    expect(result?.timeline.coverage).toBe("full-song");
    expect(result?.timeline.key).toBe(key);
    expect(result?.timeline.timeSig).toEqual(meter);
    const chords = result?.timeline.chords ?? [];
    expect(chords[0]?.beat).toBe(0);
    expect(chords.at(-1)!.beat + chords.at(-1)!.durationBeats).toBe(end);
    expect(chords.every((chord, index) => index === 0 || chords[index - 1]!.beat + chords[index - 1]!.durationBeats === chord.beat)).toBe(true);
    expect(chords.every((chord) => chord.name === "N.C." || chordPitchClasses(chord.name).length > 0)).toBe(true);
    const at = (beat: number) => chords.find((chord) => chord.beat <= beat && beat < chord.beat + chord.durationBeats)?.name;
    for (const [beat, name] of examples) expect(at(beat), `${baseId} at ${beat}`).toBe(name);
  });

  it("normalizes aliases, ordering, repeated labels, and overlapping spans", () => {
    const timeline = normalizeChordTimeline({
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test Song",
      artist: "Tester",
      chords: [
        { startBeat: 4, endBeat: 12, name: "G" },
        { beat: 0, durationBeats: 8, name: "C" },
        { beat: 8, durationBeats: 4, name: "C" },
      ],
      provenance: { sourceId: "test", provider: "test", kind: "chart", sourceRef: "test" },
    });
    expect(timeline.chords).toEqual([
      { beat: 0, durationBeats: 4, name: "C", sourceKind: "authored" },
      { beat: 4, durationBeats: 4, name: "G", sourceKind: "authored" },
      { beat: 8, durationBeats: 4, name: "C", sourceKind: "authored" },
    ]);
    expect(timeline.durationBeats).toBe(12);
  });

  it("classifies legacy events by source context and round-trips event metadata", () => {
    const authored = normalizeChordTimeline({
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test Song",
      artist: "Tester",
      chords: [{
        beat: 0,
        durationBeats: 2,
        name: "N.C.",
        notes: [],
        inferred: true,
        inferenceType: "voicing",
      }],
    }, {
      source: { id: "chart", provider: "ug", kind: "chart", sourceRef: "ug:test" },
    });
    expect(authored.chords[0]).toEqual({
      beat: 0,
      durationBeats: 2,
      name: "N.C.",
      notes: [],
      sourceKind: "authored",
      inferred: true,
      inferenceType: "voicing",
    });

    const ambiguous = normalizeChordTimeline({
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test Song",
      artist: "Tester",
      chords: [{ beat: 0, name: "C", notes: [48, 52, 55] }],
    });
    expect(ambiguous.chords[0]?.sourceKind).toBe("unknown");
  });

  it("keeps an authored empty-voicing symbol authoritative over a generated same-onset fallback", () => {
    const timeline = normalizeChordTimeline({
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test Song",
      artist: "Tester",
      durationBeats: 4,
      chords: [
        { beat: 0, durationBeats: 4, name: "C", notes: [48, 52, 55], sourceKind: "generated" },
        { beat: 0, durationBeats: 4, name: "C", notes: [], sourceKind: "authored" },
      ],
    });
    expect(timeline.chords).toEqual([{
      beat: 0,
      durationBeats: 4,
      name: "C",
      notes: [],
      sourceKind: "authored",
    }]);
  });

  it("resolves same-onset events independently of input order and canonicalizes note order", () => {
    const candidates = [
      { beat: 0, durationBeats: 4, name: "C", notes: [67, 60, 64, 64], sourceKind: "generated" },
      { beat: 0, durationBeats: 4, name: "C", notes: [72, 67, 60, 64], sourceKind: "generated" },
      { beat: 0, durationBeats: 4, name: "C", notes: [64, 67, 60], sourceKind: "generated" },
    ] as const;
    const make = (chords: readonly unknown[]) => normalizeChordTimeline({
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test Song",
      artist: "Tester",
      durationBeats: 4,
      chords,
    }).chords;

    const forward = make(candidates);
    const reverse = make([...candidates].reverse());
    expect(forward).toEqual(reverse);
    expect(forward).toEqual([{
      beat: 0,
      durationBeats: 4,
      name: "C",
      notes: [60, 64, 67],
      sourceKind: "generated",
    }]);
  });

  it("uses a canonical fingerprint for same-rank metadata ties", () => {
    const candidates = [
      {
        beat: 0,
        durationBeats: 4,
        name: "C",
        notes: [60, 64, 67],
        sourceKind: "inferred",
        inferred: true,
        inferenceType: "carry-forward-root",
      },
      {
        beat: 0,
        durationBeats: 4,
        name: "C",
        notes: [67, 64, 60],
        sourceKind: "inferred",
        inferred: true,
        inferenceType: "dyad-completion",
      },
    ] as const;
    const make = (chords: readonly unknown[]) => normalizeChordTimeline({
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test Song",
      artist: "Tester",
      durationBeats: 4,
      chords,
    }).chords;

    expect(make(candidates)).toEqual(make([...candidates].reverse()));
    expect(make(candidates)[0]).toMatchObject({
      sourceKind: "inferred",
      inferenceType: "carry-forward-root",
      notes: [60, 64, 67],
    });
  });

  it("is idempotent while preserving precedence, durations, and canonical shape", () => {
    const input = {
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test Song",
      artist: "Tester",
      durationBeats: 12,
      chords: [
        // The authored event must remain authoritative over the generated
        // fallback at the same onset, regardless of source-array order.
        { beat: 0, durationBeats: 8, name: "C", notes: [72, 67, 60], sourceKind: "generated" },
        { beat: 0, durationBeats: 4, name: "C", notes: [55, 52, 48], sourceKind: "authored" },
        {
          beat: 4,
          endBeat: 12,
          name: "F",
          notes: [60, 57, 53],
          sourceKind: "inferred",
          inferred: true,
          inferenceType: "dyad-completion",
        },
      ],
    };

    const once = normalizeChordTimeline(input);
    const twice = normalizeChordTimeline(once);

    expect(twice).toEqual(once);
    expect(once).toEqual({
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test Song",
      timeSig: [4, 4],
      durationBeats: 12,
      artist: "Tester",
      chords: [
        { beat: 0, durationBeats: 4, name: "C", notes: [48, 52, 55], sourceKind: "authored" },
        {
          beat: 4,
          durationBeats: 8,
          name: "F",
          notes: [53, 57, 60],
          sourceKind: "inferred",
          inferred: true,
          inferenceType: "dyad-completion",
        },
      ],
      provenance: {
        sourceId: "unknown",
        provider: "unknown",
        kind: "midi-derived",
        sourceRef: "unknown",
        sourceUrl: null,
        retrievedAt: null,
        confidence: "low",
      },
    });
    expect(Object.hasOwn(once.provenance, "fallback")).toBe(false);
  });

  it("keeps explicit false fallback provenance stable across normalization", () => {
    const input = {
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test Song",
      artist: "Tester",
      durationBeats: 4,
      chords: [{ beat: 0, durationBeats: 4, name: "C", sourceKind: "unknown" }],
      provenance: {
        sourceId: "manual",
        provider: "test",
        kind: "midi-derived",
        sourceRef: "manual:test",
        fallback: false,
      },
    };
    const once = normalizeChordTimeline(input);
    expect(once.provenance.fallback).toBe(false);
    expect(normalizeChordTimeline(once)).toEqual(once);
  });

  it("rejects source maps that could carry raw tab payload or escape the catalog root", () => {
    const map = {
      schemaVersion: 1,
      entries: [{
        baseId: "test-song",
        canonicalTitle: "Test",
        canonicalArtist: "Tester",
        lyrics: "not allowed",
        sources: [{ id: "chart", provider: "ug", kind: "chart", sourceRef: "ug:test", artifactPath: "../raw.json" }],
      }],
    };
    const errors = validateChordSourceMap(map);
    expect(errors.some((error) => /lyrics|artifactPath/.test(error))).toBe(true);
    expect(() => parseChordSourceMap(map)).toThrow(/invalid chord source map/);
  });

  it("rejects raw chart payload keys nested in timeline provenance", () => {
    expect(() => normalizeChordTimeline({
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test",
      artist: "Tester",
      chords: [{ beat: 0, name: "C", notes: [48, 52, 55] }],
      provenance: { sourceId: "chart", provider: "ug", kind: "chart", sourceRef: "ug:test", rawText: "not allowed" },
    })).toThrow(/rawText/);
  });

  it("rejects a chart voicing that omits a required chord tone", () => {
    expect(() => normalizeChordTimeline({
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test",
      artist: "Tester",
      chords: [{ beat: 0, name: "C7", notes: [48, 55, 58] }],
      provenance: { sourceId: "chart", provider: "ug", kind: "chart", sourceRef: "ug:test" },
    })).toThrow(/missing chord pitch classes/);
  });

  it("falls back to generated notes.json when a mapped chart artifact is unavailable", async () => {
    const root = await mkdtemp("keyspilli-chords-");
    try {
      const baseId = "fallback-song";
      const mappingPath = join(root, "map.json");
      const notesPath = join(root, "artifacts", baseId, "a", "notes.json");
      await mkdir(join(root, "artifacts", baseId, "a"), { recursive: true });
      await writeFile(mappingPath, JSON.stringify({
        schemaVersion: 1,
        entries: [{
          baseId,
          canonicalTitle: "Fallback Song",
          canonicalArtist: "Tester",
          fallbackSourceId: "midi",
          sources: [
            { id: "chart", provider: "ultimate-guitar", kind: "chart", sourceRef: "ug:fallback", artifactPath: "missing.json" },
            { id: "midi", provider: "keyspilli", kind: "midi-derived", sourceRef: "variant:advanced:notes.json", confidence: "fallback" },
          ],
        }],
      }));
      await writeFile(notesPath, JSON.stringify({
        notes: [{ midi: 48, start: 0, dur: 8 }],
        durationBeats: 12,
        chords: [
          { beat: 0, durationBeats: 2, name: "C", notes: [48, 60, 64] },
          { beat: 4, durationBeats: 3, name: "F", notes: [53, 57, 60], inferred: true, inferenceType: "nearest-symbol" },
        ],
        measures: [{ startBeat: 0, endBeat: 8 }],
      }));
      const result = await resolveChordTimeline(baseId, { mappingPath, catalogRoot: root, runtimeDataDir: root });
      expect(result?.usedFallback).toBe(true);
      expect(result?.source.id).toBe("midi");
      expect(result?.timeline.chords.map((chord) => chord.name)).toEqual(["C", "F"]);
      expect(result?.timeline.durationBeats).toBe(12);
      expect(result?.timeline.chords).toEqual([
        { beat: 0, durationBeats: 2, name: "C", notes: [48, 60, 64], sourceKind: "generated" },
        {
          beat: 4,
          durationBeats: 3,
          name: "F",
          notes: [53, 57, 60],
          sourceKind: "generated",
          inferred: true,
          inferenceType: "nearest-symbol",
        },
      ]);
      expect(result?.timeline.provenance.fallbackReason).toContain("notes.json");
      expect(result?.warnings[0]).toContain("chart");

      const mapMissing = await resolveChordTimeline(baseId, { mappingPath: join(root, "missing-map.json"), runtimeDataDir: root });
      expect(mapMissing?.usedFallback).toBe(true);
      expect(mapMissing?.warnings[0]).toContain("chord source map");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses normalized timelines and invalidates them when notes are republished", async () => {
    const root = await mkdtemp("keyspilli-chord-cache-");
    try {
      const baseId = "cache-song";
      const mappingPath = join(root, "map.json");
      const notesPath = join(root, "artifacts", baseId, "a", "notes.json");
      await mkdir(join(root, "artifacts", baseId, "a"), { recursive: true });
      await writeFile(mappingPath, JSON.stringify({
        schemaVersion: 1,
        entries: [{
          baseId,
          canonicalTitle: "Cache Song",
          canonicalArtist: "Tester",
          fallbackSourceId: "midi",
          sources: [
            { id: "chart", provider: "test", kind: "chart", sourceRef: "test:missing", artifactPath: "missing.json" },
            { id: "midi", provider: "keyspilli", kind: "midi-derived", sourceRef: "variant:a:notes.json", confidence: "fallback" },
          ],
        }],
      }));
      const writeNotes = async (name: string, midi: number[]) => {
        await writeFile(notesPath, JSON.stringify({
          notes: [{ midi: midi[0], start: 0, dur: 4 }],
          durationBeats: 4,
          chords: [{ beat: 0, durationBeats: 4, name, notes: midi }],
          measures: [{ startBeat: 0, endBeat: 4 }],
        }));
      };

      await writeNotes("C", [48, 52, 55]);
      const first = await resolveChordTimeline(baseId, { mappingPath, catalogRoot: root, runtimeDataDir: root });
      const second = await resolveChordTimeline(baseId, { mappingPath, catalogRoot: root, runtimeDataDir: root });
      expect(first).not.toBeNull();
      expect(second).toBe(first);
      expect(first?.timeline.chords[0]?.name).toBe("C");

      await rm(notesPath, { force: true });
      await writeNotes("D", [50, 54, 57]);
      const republished = await resolveChordTimeline(baseId, { mappingPath, catalogRoot: root, runtimeDataDir: root });
      expect(republished).not.toBe(first);
      expect(republished?.timeline.chords[0]?.name).toBe("D");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns the timeline directly for simple callers", async () => {
    const timeline = await loadChordTimeline(YOUR_SONG);
    expect(timeline?.schemaVersion).toBe(1);
    expect(timeline?.provenance.sourceId).toBe("ug-your-song");
  });
});
