import {
  completeChordDurations,
  dedupeChords,
  resolveAccompaniment,
  type AccompanimentResolution,
  type ChordLabel,
  type Note,
  type SongData,
} from "@keyspilli/player-core";
import { resolveChordSources, selectChordSource, type ChordSourceId, type ChordSourceResolution, type SelectedChordSource } from "./chord-sources";
import { reviewedSourceBacking } from "./reviewed-source-backing";

const clocksSourceFingerprint = "variant:coldplay-clocks:a:coldplay-clocks-a:6f318e8fcf70028535ded2b2509a0f4db10fa0b56a3987b469f760df582448fc:notes:053b40ebcf93fad16c80e470042cc1fa69b716c77a31f64a7cbb49ab77e90a51";
const journeySourceFingerprint = "variant:journey-dont-stop-believin:a:journey-dont-stop-believin-a:08a07ee27a19467cc7257f18cc0b67311bebc02a135c7b814b2ef798585ec717:notes:d4fe2e2e14bb77889a37f6fe37a040df8c470897270c128c09675ab21a04b354";
const thoseDaysSourceFingerprint = "variant:mary-hopkin-those-were-the-days:a:mary-hopkin-those-were-the-days-a:28ad9166ff01da3b2b50ce23654ed7517154b0492af5d5d7931149fc5fc93945:notes:5b76fc45646effb0b6dd9382fe7481c8505647dffdb29be6be36215ba02c1545";

function clocksPlayedVoicings(data: SongData, resolution: AccompanimentResolution): AccompanimentResolution {
  if (data.sourceFingerprint !== clocksSourceFingerprint) return resolution;
  const byBeat = new Map<number, Note[]>();
  for (const note of data.notes) byBeat.set(note.start, [...(byBeat.get(note.start) ?? []), note]);
  const playedStack = (beat: number) => {
    const atBeat = byBeat.get(beat) ?? [];
    if (!atBeat.some((note) => note.hand === "L")) return null;
    // This pinned arrangement places its chord shell in LH plus the low RH
    // voice (up to F4); the higher RH notes are its arpeggio and melody.
    const stack = atBeat.filter((note) => note.hand === "L" || (note.hand === "R" && note.midi <= 65))
      .sort((a, b) => a.midi - b.midi)
      .filter((note, index, notes) => index === 0 || note.midi !== notes[index - 1]!.midi);
    return stack.length >= 2 ? stack : null;
  };
  let changed = false;
  const chords = resolution.chords.map((chord) => {
    if (chord.sourceKind !== "authored") return chord;
    // The RH-only ending repeats the first eight bars' harmony; borrow its
    // already-played stacks instead of inventing new upper voicings there.
    const sourceBeat = chord.beat >= 128 && chord.beat < 160 ? chord.beat - 128 : chord.beat;
    const stack = playedStack(sourceBeat);
    if (!stack) return chord;
    changed = true;
    return {
      ...chord,
      notes: stack.map((note) => note.midi),
      suggestedHands: stack.map((note) => note.hand as "L" | "R"),
      inferred: false,
      inferenceType: undefined,
    };
  });
  if (!changed) return resolution;
  const byChordBeat = new Map(chords.map((chord) => [chord.beat, chord]));
  return {
    ...resolution,
    chords,
    displayChords: resolution.displayChords.map((label) => {
      const voiced = byChordBeat.get(label.beat);
      return voiced ? { ...label, notes: voiced.notes, inferred: voiced.inferred, inferenceType: voiced.inferenceType } : label;
    }),
    guidanceNotes: chords.flatMap((chord) => chord.notes.map((midi, index) => ({
      midi, start: chord.beat, dur: chord.durationBeats ?? 1, vel: 70,
      hand: chord.suggestedHands[index],
    }))),
  };
}

/**
 * The Player's Chords-mode backing path as pure functions. Player.tsx calls
 * these pieces from its memos; offline evaluation calls `replayChordsBacking`
 * so a catalogue report measures exactly what a listener hears.
 */
export function playerArrangementEnd(data: SongData): number {
  return Math.max(
    data.notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0),
    data.measures.reduce((max, measure) => Math.max(max, measure.endBeat), 0),
  );
}

export function playerChordSources(data: SongData, arrangementEnd: number): ChordSourceResolution {
  const resolved = resolveChordSources(data);
  return {
    ...resolved,
    // Keep the established inferred-chord naming/cleanup path unchanged;
    // only source timelines bypass relabeling so their provenance is visible.
    // Normalize through the generated source first. This stamps legacy
    // generated events with sourceKind=generated while preserving explicit
    // authored/inferred/unknown metadata on newer artifacts.
    generated: {
      ...resolved.generated,
      chords: completeChordDurations(dedupeChords(resolved.generated.chords, { durationBeats: arrangementEnd }), arrangementEnd),
    },
  };
}

/** Chords-mode background for the backing-only style. */
export function bassChordsBackground(
  data: SongData,
  chords: readonly ChordLabel[],
  arrangementEnd: number,
  sourceBackingNotes: Note[] | null,
): AccompanimentResolution {
  if (sourceBackingNotes) {
    return { style: "bass-chords", notes: sourceBackingNotes, chords: [], displayChords: [], guidanceNotes: sourceBackingNotes, fallbackSpans: [] };
  }
  const resolution = clocksPlayedVoicings(data, resolveAccompaniment(data.notes, chords, "bass-chords", {
    durationBeats: arrangementEnd, sourceRhythmMeasures: data.measures,
  }));
  if (data.sourceFingerprint === journeySourceFingerprint) {
    const rightCounts = new Map<number, number>();
    for (const note of data.notes) if (note.hand === "R" && note.start >= 228) {
      rightCounts.set(note.start, (rightCounts.get(note.start) ?? 0) + 1);
    }
    const played = data.notes.filter((note) => note.hand === "L" || (note.start >= 164
      && (note.start < 228 || (rightCounts.get(note.start) ?? 0) >= 2)));
    return {
      ...resolution,
      notes: played,
      chords: [],
      guidanceNotes: played,
    };
  }
  if (data.sourceFingerprint === thoseDaysSourceFingerprint) {
    const inPhrase = (beat: number) => [36, 118, 200, 282].some((start) => start <= beat && beat < start + 12);
    const rightCounts = new Map<number, number>();
    for (const note of data.notes) if (note.hand === "R" && inPhrase(note.start)) {
      rightCounts.set(note.start, (rightCounts.get(note.start) ?? 0) + 1);
    }
    const played = data.notes.filter((note) => inPhrase(note.start)
      && (note.hand === "L" || (rightCounts.get(note.start) ?? 0) >= 2));
    return {
      ...resolution,
      notes: played,
      chords: resolution.chords.filter((chord) => !inPhrase(chord.beat)),
      guidanceNotes: [...played, ...resolution.guidanceNotes.filter((note) => !inPhrase(note.start))]
        .sort((a, b) => a.start - b.start || a.midi - b.midi),
    };
  }
  return resolution;
}

export interface ChordsBackingReplay {
  arrangementEnd: number;
  selected: SelectedChordSource;
  chords: ChordLabel[];
  reviewedSourceBacking: boolean;
  resolution: AccompanimentResolution;
}

/** Replay the default Chords backing a Player builds for `data` (its `chordData ?? data`). */
export function replayChordsBacking(data: SongData, preference: ChordSourceId = "auto"): ChordsBackingReplay {
  const arrangementEnd = playerArrangementEnd(data);
  const selected = selectChordSource(playerChordSources(data, arrangementEnd), preference);
  const chords = selected.source?.chords ?? [];
  const sourceBackingNotes = reviewedSourceBacking(data);
  return {
    arrangementEnd,
    selected,
    chords,
    reviewedSourceBacking: sourceBackingNotes !== null,
    resolution: bassChordsBackground(data, chords, arrangementEnd, sourceBackingNotes),
  };
}
