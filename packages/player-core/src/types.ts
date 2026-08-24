import type { Note, ChordLabel, MeasureInfo, Section, PracticeAnnotation } from "@keyspilli/midi";

export type { Note, ChordLabel, MeasureInfo, Section, PracticeAnnotation };

/** Provenance for an optional external chord timeline. */
export interface ChordSourceProvenance {
  sourceId?: string;
  provider?: string;
  kind?: string;
  sourceRef?: string;
  sourceUrl?: string | null;
  retrievedAt?: string | null;
  confidence?: string;
  fallback?: boolean;
  fallbackReason?: string;
}

/** Stable identifiers for the chord timelines exposed by the player. */
export type ChordSourceId = "auto" | "ug" | "generated";

/** A player-facing chord timeline with explicit source identity. */
export interface ChordSourceTimeline {
  id: ChordSourceId;
  label: string;
  chords: ChordLabel[];
  provenance?: string | null;
  /** Structured provenance retained alongside the legacy display string. */
  provenanceInfo?: ChordSourceProvenance | null;
  coverage?: "opening-section" | "full-song";
  fallback?: boolean;
  fallbackReason?: string | null;
}

/** Versioned source bundle. `auto` is an explicit hybrid projection. */
export interface ChordSourceBundle {
  schemaVersion: 1;
  generated: ChordSourceTimeline;
  ug: ChordSourceTimeline | null;
  auto: ChordSourceTimeline;
}

export interface SongData {
  notes: Note[];
  chords: ChordLabel[];
  /** Optional chart-backed timeline; generated chords remain in `chords`. */
  ugChordTimeline?: ChordLabel[];
  chordProvenance?: ChordSourceProvenance;
  /** Optional explicit chord source projections for newer catalogue payloads. */
  chordSources?: ChordSourceBundle;
  measures: MeasureInfo[];
  sections?: Section[];
  practiceAnnotations?: PracticeAnnotation[];
  key: string;
  tempoBpm: number;
  timeSig: [number, number];
}

export type ViewMode = "falling" | "beginner" | "sheet" | "leadsheet";

export interface PlayerSettings {
  voiceGain: number;
  pianoGain: number;
  backgroundMode: "piano" | "chord";
  /** "synth" = oscillator fallback, "sampled" = smplr SplendidGrandPiano. */
  soundSource: "synth" | "sampled";
  metronome: boolean;
  chordKeys: boolean;
  sustainPedal: boolean;
  hand: "L" | "R" | "both";
  speed: number;
  transpose: number;
  mode: ViewMode;
  showAllKeys: boolean;
}
