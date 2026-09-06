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
  /** Source lane for role-aware learner arrangement; absent on legacy notes. */
  identitySource?: "vocals" | "guitar" | "other";
  /** optional lyric syllable for this note */
  lyrics?: string;
}

/** Provenance of a chord event; omitted on legacy chord labels. */
export type ChordSourceKind = "authored" | "inferred" | "generated" | "unknown";

/** Why a chord label or voicing was inferred. */
export type ChordInferenceType =
  | "dyad-completion"
  | "carry-forward-root"
  | "nearest-symbol"
  | "subbeat-extension"
  | "voicing";

export interface ChordLabel {
  /** beat position */
  beat: number;
  name: string;
  notes: number[];
  /** Event provenance; absent for legacy labels without source metadata. */
  sourceKind?: ChordSourceKind;
  /** Whether the label or playable voicing was inferred. */
  inferred?: boolean;
  /** Strategy used to infer the label or voicing, when applicable. */
  inferenceType?: ChordInferenceType;
  /** Optional span in beats; legacy labels derive their span from the next event. */
  durationBeats?: number;
}

/** Chord qualities supported by the lead-sheet parser and chord player. */
export type ChordQuality =
  | "major"
  | "5"
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
  /** Whether the source carried an explicit tempo meta/direction. */
  tempoMetaPresent?: boolean;
  /** Native MIDI tempo changes, in source ticks and quarter-note beats. */
  tempoEvents?: MidiTempoEvent[];
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

/** A MIDI Set Tempo event retained for native beat-to-second conversion. */
export interface MidiTempoEvent {
  tick: number;
  beat: number;
  microsecondsPerQuarter: number;
  bpm: number;
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

/** Client-facing five-level roll-up; physical six-level generation is unchanged. */
export type PublicDifficultyLevel =
  | "very-beginner"
  | "beginner"
  | "easy"
  | "medium"
  | "advanced";

export const PUBLIC_DIFFICULTY_ORDER = [
  "very-beginner",
  "beginner",
  "easy",
  "medium",
  "advanced",
] as const satisfies readonly PublicDifficultyLevel[];

export function isPublicDifficultyLevel(value: unknown): value is PublicDifficultyLevel {
  return typeof value === "string" && PUBLIC_DIFFICULTY_ORDER.includes(value as PublicDifficultyLevel);
}

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

/** A named section of a song (verse, chorus, bridge, etc.) for practice navigation. */
export interface Section {
  /** Unique section identifier (e.g., "verse-1", "chorus", "bridge"). */
  id: string;
  /** Human-readable label (e.g., "Verse 1", "Chorus"). */
  label: string;
  /** Start position in quarter-note beats. */
  startBeat: number;
  /** End position in quarter-note beats. */
  endBeat: number;
  /** Optional section type for UI hints. */
  type?: "verse" | "chorus" | "bridge" | "intro" | "outro" | "pre-chorus" | "interlude" | "custom";
}

/** Practice annotation for a section or the full song. */
export interface PracticeAnnotation {
  /** Section ID this annotation applies to, or "full" for the whole song. */
  sectionId: string;
  /** Suggested target tempo in BPM for this section. */
  targetTempo?: number;
  /** Number of times to repeat this section before moving on. */
  repeatTarget?: number;
  /** Free-text practice note. */
  note?: string;
}
