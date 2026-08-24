import {
  chordToNotes,
  transposeChordSymbol,
  tryParseChordSymbol,
  type ChordLabel,
  type MeasureInfo,
} from "@keyspilli/midi";

export interface ChordPracticeTarget {
  name: string;
  notes: number[];
  beat?: number;
  sourceKind?: ChordLabel["sourceKind"];
  inferred?: boolean;
  inferenceType?: ChordLabel["inferenceType"];
}

export interface ChordPracticeSnapshot {
  currentIndex: number;
  total: number;
  completed: number;
  skipped: number;
  wrong: number;
  target: ChordPracticeTarget | null;
  playedPitchClasses: number[];
  remainingPitchClasses: number[];
  lastWrongPitchClass: number | null;
  finished: boolean;
  accuracyPct: number;
}

function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function validNotes(notes: readonly number[]): number[] {
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
  const supplied = validNotes(chord.notes);
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

/**
 * Groups note input into chord attempts. Chord practice is intentionally
 * octave-flexible and order-independent: the learner is practising the
 * chord quality, not trying to reproduce a transcription's accidental
 * octave doublings.
 */
export class ChordGrader {
  private readonly targets: ChordPracticeTarget[];
  private index = 0;
  private completed = 0;
  private skipped = 0;
  private wrong = 0;
  private played = new Set<number>();
  private lastWrong: number | null = null;

  constructor(targets: readonly ChordPracticeTarget[]) {
    this.targets = targets
      .map((target) => ({ ...target, notes: validNotes(target.notes) }))
      .filter((target) => target.notes.length > 0);
  }

  /** Feed one note-on. The note remains audible even when it is wrong. */
  play(midi: number): { accepted: boolean; completed: boolean; wrong: boolean } {
    const target = this.targets[this.index];
    if (!target) return { accepted: false, completed: false, wrong: false };
    const pc = pitchClass(midi);
    const expected = new Set(target.notes.map(pitchClass));
    if (!expected.has(pc)) {
      this.wrong++;
      this.lastWrong = pc;
      return { accepted: false, completed: false, wrong: true };
    }
    this.lastWrong = null;
    if (this.played.has(pc)) return { accepted: true, completed: false, wrong: false };
    this.played.add(pc);
    if (this.played.size < expected.size) return { accepted: true, completed: false, wrong: false };
    this.completed++;
    this.index++;
    this.played.clear();
    return { accepted: true, completed: true, wrong: false };
  }

  skip(): void {
    if (!this.targets[this.index]) return;
    this.skipped++;
    this.index++;
    this.played.clear();
    this.lastWrong = null;
  }

  get currentTarget(): ChordPracticeTarget | null {
    return this.targets[this.index] ?? null;
  }

  get finished(): boolean {
    return this.index >= this.targets.length;
  }

  snapshot(): ChordPracticeSnapshot {
    const target = this.currentTarget;
    const expected = target ? [...new Set(target.notes.map(pitchClass))].sort((a, b) => a - b) : [];
    const playedPitchClasses = [...this.played].sort((a, b) => a - b);
    const remainingPitchClasses = expected.filter((pc) => !this.played.has(pc));
    const accuracyPct = this.targets.length === 0
      ? 100
      : Math.round((this.completed / this.targets.length) * 100);
    return {
      currentIndex: this.index,
      total: this.targets.length,
      completed: this.completed,
      skipped: this.skipped,
      wrong: this.wrong,
      target,
      playedPitchClasses,
      remainingPitchClasses,
      lastWrongPitchClass: this.lastWrong,
      finished: this.finished,
      accuracyPct,
    };
  }
}
