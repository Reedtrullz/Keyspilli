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
