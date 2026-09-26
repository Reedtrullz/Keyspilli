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
const winnerSourceFingerprint = "variant:abba-the-winner-takes-it-all:a:abba-the-winner-takes-it-all-a:54fdc6dfba535308b19583a24ca6cb284813bb2ae84e42abe4cac8b062a57eb2:notes:9d9ae9b17b3bd10ebc973d549b12d1102606e66a9342a4702d449e7f73afd664";
const journeySourceFingerprint = "variant:journey-dont-stop-believin:a:journey-dont-stop-believin-a:08a07ee27a19467cc7257f18cc0b67311bebc02a135c7b814b2ef798585ec717:notes:d4fe2e2e14bb77889a37f6fe37a040df8c470897270c128c09675ab21a04b354";
const thoseDaysSourceFingerprint = "variant:mary-hopkin-those-were-the-days:a:mary-hopkin-those-were-the-days-a:28ad9166ff01da3b2b50ce23654ed7517154b0492af5d5d7931149fc5fc93945:notes:5b76fc45646effb0b6dd9382fe7481c8505647dffdb29be6be36215ba02c1545";

function sourcePlayedVoicings(data: SongData, selected: readonly ChordLabel[], resolution: AccompanimentResolution): AccompanimentResolution {
  const clocks = data.sourceFingerprint === clocksSourceFingerprint;
  const days = data.sourceFingerprint === thoseDaysSourceFingerprint;
  const winner = data.sourceFingerprint === winnerSourceFingerprint;
  if (!clocks && !days && !winner) return resolution;
  const chartVoicings = new Map(selected.filter((event) => days && event.sourceKind === "authored" && event.notes.length > 0)
    .map((event) => [event.beat, event.notes] as const));
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
  const winnerVoicing = (chord: AccompanimentResolution["chords"][number]) => {
    const chordPcs = new Set(chord.notes.map((midi) => midi % 12));
    const seen = new Set<number>();
    const played = (byBeat.get(chord.beat) ?? [])
      .filter((note) => note.hand === "R" && chordPcs.has(note.midi % 12))
      .sort((a, b) => a.midi - b.midi)
      .filter((note) => {
        if (seen.has(note.midi % 12)) return false;
        seen.add(note.midi % 12);
        return true;
      })
      .slice(0, chord.notes.length - 1);
    // Prefer the played chord stack; incomplete stacks retain the chart's full harmony.
    const right = played.length === chord.notes.length - 1
      ? played.map((note) => note.midi) : chord.notes.slice(1);
    const octaveDrop = Math.max(0, Math.ceil((Math.max(...right) - 85) / 12)) * 12;
    return [chord.notes[0]!, ...right.map((midi) => midi - octaveDrop)];
  };
  let changed = false;
  const chords = resolution.chords.map((chord) => {
    if (chord.sourceKind !== "authored" || chord.notes.length < 2) return chord;
    // Clocks' RH-only ending repeats the first eight bars' played stacks.
    const sourceBeat = clocks && chord.beat >= 128 && chord.beat < 160 ? chord.beat - 128 : chord.beat;
    const stack = clocks ? playedStack(sourceBeat) : null;
    // Those Were the Days uses the authored beginner shape at each sung hit.
    const notes = winner ? winnerVoicing(chord) : chartVoicings.get(chord.beat) ?? stack?.map((note) => note.midi);
    if (!notes) return chord;
    changed = true;
    return {
      ...chord,
      notes,
      suggestedHands: winner ? notes.map((_, index) => index === 0 ? "L" as const : "R" as const)
        : stack ? stack.map((note) => note.hand as "L" | "R")
        : notes.map((_, index) => index === 0 ? "L" as const : "R" as const),
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
  const resolution = sourcePlayedVoicings(data, chords, resolveAccompaniment(data.notes, chords, "bass-chords", {
    durationBeats: arrangementEnd, sourceRhythmMeasures: data.measures,
  }));
  if (data.sourceFingerprint === journeySourceFingerprint) {
    // This chordal RH phrase repeats exactly; the RH elsewhere carries the vocal line.
    const laterBassOnly = (beat: number) => (beat >= 244 && beat < 308) || beat >= 372;
    // Later LH verses shift an octave up and add upper runs; keep their low chord shell.
    const played = data.notes.filter((note) => (note.hand === "L" && !(laterBassOnly(note.start) && note.midi > 49))
      || (note.hand === "R" && ((note.start >= 164 && note.start < 228) || (note.start >= 308 && note.start < 372))))
      .map((note) => {
        if (note.hand !== "L" || (note.start < 228 || (note.start >= 308 && note.start < 372))) return note;
        const nextChange = chords.find((chord) => chord.sourceKind === "authored" && chord.beat > note.start)?.beat ?? arrangementEnd;
        return { ...note, dur: Math.min(note.dur, nextChange - note.start, note.start < 308 ? 308 - note.start : arrangementEnd - note.start) };
      });
    const byBeat = new Map<number, Note[]>();
    for (const note of played) if (note.hand === "L" && laterBassOnly(note.start)) {
      byBeat.set(note.start, [...(byBeat.get(note.start) ?? []), note]);
    }
    for (const group of byBeat.values()) {
      const lowest = group.reduce((a, b) => a.midi < b.midi ? a : b);
      if (lowest.midi >= 37 && !group.some((note) => note.midi === lowest.midi - 12)) {
        played.push({ ...lowest, midi: lowest.midi - 12 });
      }
    }
    played.sort((a, b) => a.start - b.start || a.midi - b.midi);
    return {
      ...resolution,
      notes: played,
      chords: [],
      guidanceNotes: played,
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
