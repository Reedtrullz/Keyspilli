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
  notes: readonly Note[],
  chords: readonly ChordLabel[],
  arrangementEnd: number,
  sourceBackingNotes: Note[] | null,
): AccompanimentResolution {
  if (sourceBackingNotes) {
    return { style: "bass-chords", notes: sourceBackingNotes, chords: [], displayChords: [], guidanceNotes: sourceBackingNotes, fallbackSpans: [] };
  }
  return resolveAccompaniment(notes, chords, "bass-chords", { durationBeats: arrangementEnd });
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
    resolution: bassChordsBackground(data.notes, chords, arrangementEnd, sourceBackingNotes),
  };
}
