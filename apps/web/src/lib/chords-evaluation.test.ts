import { describe, expect, it } from "vitest";
import { resolveAccompaniment, type SongData } from "@keyspilli/player-core";
import { replayChordsBacking } from "../components/player/chords-backing";
import { evaluateVisibleChords, type AdvancedRow } from "./chords-evaluation";

function song(overrides: Partial<SongData> = {}): SongData {
  return {
    title: "Fixture", artist: "Test", tempoBpm: 100, timeSig: [4, 4], key: "C",
    notes: [
      { midi: 48, start: 0, dur: 4, vel: 70, hand: "L" },
      { midi: 64, start: 0, dur: 1, vel: 90, hand: "R", identitySource: "vocals" },
      { midi: 43, start: 4, dur: 4, vel: 70, hand: "L", sourceOrigins: [{ id: "midi:1:1", track: 1 }] },
    ],
    chords: [
      { beat: 0, name: "C", notes: [48, 52, 55] },
      { beat: 4, name: "G", notes: [43, 47, 50] },
    ],
    measures: [{ index: 0, startBeat: 0, endBeat: 4 }, { index: 1, startBeat: 4, endBeat: 8 }],
    ...overrides,
  } as SongData;
}

const row = (baseId: string): AdvancedRow => ({ id: `${baseId}-a`, baseId, level: "a", tempo: 100, acquiredVia: "midi-pack" });

describe("Chords backing replay", () => {
  it("resolves the Player's Auto timeline into the bass-chords backing", () => {
    const data = song();
    const replay = replayChordsBacking(data);
    expect(replay.selected.source?.id).toBe("auto");
    expect(replay.chords.map((chord) => chord.name)).toEqual(["C", "G"]);
    expect(replay.reviewedSourceBacking).toBe(false);
    expect(replay.resolution).toEqual(resolveAccompaniment(data.notes, replay.chords, "bass-chords", { durationBeats: 8, sourceRhythmMeasures: data.measures }));
  });
});

describe("all visible song Chords evaluation", () => {
  it("evaluates the Player replay, reports missing and unavailable Advanced sources, and accepts a candidate", async () => {
    const advanced = new Map<string, AdvancedRow | null>([["b-broken", row("b-broken")], ["a-song", row("a-song")], ["c-no-advanced", null]]);
    const load = async (advancedRow: AdvancedRow) => advancedRow.baseId === "a-song"
      ? { data: song(), errors: [], notesSha256: "f".repeat(64) }
      : { data: null, errors: ["missing or corrupt a/notes.json"], notesSha256: null };
    const counts = { hiddenAdvancedArtifacts: 2, orphanAdvancedArtifacts: 1 };

    const report = await evaluateVisibleChords(advanced, load, counts);
    expect(report.rows.map((r) => [r.baseId, r.status])).toEqual([["a-song", "evaluated"], ["b-broken", "unavailable"], ["c-no-advanced", "no-advanced"]]);
    expect(report.summary).toMatchObject({
      visibleBases: 3, evaluated: 1, unavailable: 1, noAdvanced: 1, ...counts,
      generatedOnlyBases: 1, noChordBases: 0, roleLabeledBases: 1, vocalLabeledBases: 1, originLabeledBases: 1,
      chordSources: { auto: 1 },
    });
    const evaluated = report.rows[0]!;
    expect(evaluated).toMatchObject({
      songId: "a-song-a", notesSha256: "f".repeat(64),
      source: { chordProvenance: { generated: 2 }, durationBeats: 8, vocalNoteCount: 1 },
      player: { chordSource: "auto", timelineChords: 2, reviewedSourceBacking: false },
      backing: { input: "player" },
    });
    expect(report.rows[1]!.errors).toEqual(["missing or corrupt a/notes.json"]);

    const candidate = await evaluateVisibleChords(new Map([["a-song", row("a-song")]]), load, counts, (_data, player) => ({
      ...player.resolution,
      notes: [{ midi: 48, start: 0, dur: 1, vel: 70, hand: "L" }],
      chords: [{ beat: 0, durationBeats: 1, name: "C", notes: [48, 52, 55], suggestedHands: ["L", "R", "R"] }],
      fallbackSpans: [{ startBeat: 1, endBeat: 8, reason: "fixture gap" }],
    }) as never);
    expect(candidate.rows[0]!.backing).toMatchObject({
      input: "candidate", attacks: 4, duplicateOnsetAttacks: 1, coveredBeats: 1, coveredFraction: 1 / 8,
      unsupportedSpans: [{ startBeat: 1, endBeat: 8, reason: "fixture gap" }],
      onsetGeometryByHand: { L: { maxSimultaneousSpanSemitones: 0 }, R: { maxSimultaneousSpanSemitones: 3 } },
    });
    expect(candidate.summary).toMatchObject({
      songsWithDuplicateOnsetAttacks: 1, songsWithUnsupportedSpans: 1, songsUnder80PercentCovered: 1,
      unsupportedBeatsByReason: { "fixture gap": 7 },
    });
  });
});
