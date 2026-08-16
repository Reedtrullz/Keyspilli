export type Hand = "R" | "L";

export interface Note {
  /** MIDI note number (60 = middle C) */
  midi: number;
  /** start time in beats */
  start: number;
  /** duration in beats */
  dur: number;
  /** 0-127 */
  vel: number;
  hand?: Hand;
  /** optional lyric syllable for this note */
  lyrics?: string;
}

export interface ChordLabel {
  /** beat position */
  beat: number;
  name: string;
  notes: number[];
}

/** Chord qualities supported by the lead-sheet parser and chord player. */
export type ChordQuality =
  | "major"
  | "minor"
  | "7"
  | "maj7"
  | "m7"
  | "6"
  | "sus2"
  | "sus4"
  | "dim"
  | "aug"
  | "add9";

/** Parsed, normalized chord symbol. Root/bass pitch classes are in [0, 11]. */
export interface ChordSymbol {
  /** Canonical symbol, e.g. `Cmaj7/E`. */
  symbol: string;
  /** Spelled root, e.g. `Bb` or `F#`. */
  root: string;
  rootPc: number;
  quality: ChordQuality;
  /** Optional slash-bass spelling and pitch class. */
  bass?: string;
  bassPc?: number;
}

export interface ChordParseOptions {
  /** Sounding semitone shift caused by a capo. */
  capo?: number;
  /** Additional sounding semitone shift. */
  transpose?: number;
  /** Prefer flat spellings when formatting shifted symbols. */
  preferFlats?: boolean;
}

export interface ChordVoicingOptions extends ChordParseOptions {
  /** MIDI octave containing the chord root (C4 is MIDI 60); defaults to 4. */
  octave?: number;
  /** MIDI octave for a slash/optional bass; defaults to octave - 1. */
  bassOctave?: number;
  /** Add a low root bass to an ordinary chord; slash chords always include bass. */
  includeBass?: boolean;
  /** Optional deterministic cap on the number of notes, preserving the shell. */
  maxNotes?: number;
}

export interface ChordNoteOptions extends ChordVoicingOptions {
  /** Start time in beats for generated note events. */
  start?: number;
  /** Duration in beats for generated note events. */
  dur?: number;
  /** MIDI velocity for generated note events. */
  vel?: number;
  hand?: Hand;
  lyrics?: string;
}

export interface ParsedMidi {
  format: number;
  division: number;
  /** beats per quarter note */
  tempoBpm: number;
  /** key signature in sharps (+n) / flats (-n) */
  keySig: number;
  /** key mode: 0 major, 1 minor */
  keyMode: 0 | 1;
  timeSig: [number, number];
  notes: Note[];
  trackNames: string[];
  durationBeats: number;
  title?: string;
}

export type DifficultyLevel =
  | "very-beginner"
  | "beginner"
  | "very-easy"
  | "easy"
  | "medium"
  | "advanced";

export const LEVEL_ORDER: DifficultyLevel[] = [
  "very-beginner",
  "beginner",
  "very-easy",
  "easy",
  "medium",
  "advanced",
];

export interface SongMeta {
  title: string;
  artist: string;
  category?: string;
  style?: string;
  mood?: string;
  difficulty?: DifficultyLevel;
  key?: string;
  tempo?: number;
}

export interface Variant {
  level: DifficultyLevel;
  difficultyScore: number;
  notes: Note[];
  /** Non-fatal source transformations applied before publication. */
  warnings?: string[];
  chords: ChordLabel[];
  bassPattern: string;
  key: string;
  tempoBpm: number;
  timeSig: [number, number];
  measures: MeasureInfo[];
}

export interface MeasureInfo {
  index: number;
  startBeat: number;
  endBeat: number;
}
