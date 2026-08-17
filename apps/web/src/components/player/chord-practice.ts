import {
  chordToNotes,
  transposeChordSymbol,
  tryParseChordSymbol,
  type ChordLabel,
} from "@keyspilli/midi";
import type { ChordPracticeTarget } from "@keyspilli/player-core";
import type { MeasureInfo } from "@keyspilli/midi";

function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function uniqueNotes(notes: readonly number[]): number[] {
  return [...new Set(notes.filter((note) => Number.isInteger(note) && note >= 0 && note <= 127))]
    .sort((a, b) => a - b);
}

function fallbackVoicing(notes: readonly number[]): number[] {
  return [...new Set(notes.map(pitchClass))]
    .sort((a, b) => a - b)
    .map((pc) => 60 + pc);
}

/** Derive a compact, readable reference shape without changing catalogue data. */
export function compactPracticeVoicing(chord: ChordLabel): { notes: number[]; inferred: boolean } {
  const supplied = uniqueNotes(chord.notes);
  const compactSupplied = supplied.length > 0 && supplied.length <= 4 && supplied.at(-1)! - supplied[0]! <= 24;
  if (compactSupplied) return { notes: supplied, inferred: Boolean(chord.inferred) };

  if (tryParseChordSymbol(chord.name)) {
    try {
      return {
        notes: chordToNotes(chord.name, { octave: 4, bassOctave: 3, maxNotes: 4 }),
        inferred: true,
      };
    } catch {
      // Fall through to a pitch-class shape for legacy/unsupported symbols.
    }
  }
  return { notes: fallbackVoicing(supplied), inferred: true };
}

/**
 * Convert the selected song chord timeline into learner targets. The shown
 * octave is a reference voicing; ChordGrader compares pitch classes so a
 * learner can use a comfortable register.
 */
export function buildChordPracticeTargets(chords: readonly ChordLabel[], transpose = 0): ChordPracticeTarget[] {
  return chords.flatMap((chord) => {
    const voicing = compactPracticeVoicing(chord);
    if (voicing.notes.length === 0) return [];
    let name = chord.name;
    if (transpose !== 0) {
      try {
        name = transposeChordSymbol(chord.name, transpose, { preferFlats: /b|♭/.test(chord.name) });
      } catch {
        // Keep power-chord/legacy labels that the shared parser does not know.
      }
    }
    return [{
      name,
      notes: voicing.notes.map((note) => note + transpose),
      beat: chord.beat,
      sourceKind: chord.sourceKind,
      inferred: voicing.inferred || chord.inferred,
      inferenceType: voicing.inferred ? "voicing" : chord.inferenceType,
    }];
  });
}

/** Select a small, navigable four-measure window instead of exposing a whole song at once. */
export function selectPracticeChords(
  chords: readonly ChordLabel[],
  measures: readonly MeasureInfo[],
  currentMeasure: number,
  spanMeasures = 4,
): ChordLabel[] {
  if (!chords.length) return [];
  const startBeat = measures[currentMeasure]?.startBeat ?? 0;
  const endMeasure = Math.min(measures.length - 1, currentMeasure + Math.max(1, spanMeasures) - 1);
  const endBeat = measures[endMeasure]?.endBeat ?? startBeat + 16;
  const active = chords.filter((chord) => chord.beat <= startBeat).at(-1);
  const inWindow = chords.filter((chord) => chord.beat >= startBeat && chord.beat < endBeat);
  const selected = active && active.beat < startBeat ? [active, ...inWindow] : inWindow;
  return selected.filter((chord, index) => index === 0 || chord.beat !== selected[index - 1]!.beat || chord.name !== selected[index - 1]!.name);
}
