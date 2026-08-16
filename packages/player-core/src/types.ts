import type { Note, ChordLabel, MeasureInfo } from "@keyspilli/midi";

export type { Note, ChordLabel, MeasureInfo };

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

export interface SongData {
  notes: Note[];
  chords: ChordLabel[];
  /** Optional chart-backed timeline; generated chords remain in `chords`. */
  ugChordTimeline?: ChordLabel[];
  chordProvenance?: ChordSourceProvenance;
  measures: MeasureInfo[];
  key: string;
  tempoBpm: number;
  timeSig: [number, number];
}

export type ViewMode = "falling" | "beginner" | "sheet" | "leadsheet";

export interface PlayerSettings {
  voiceGain: number;
  pianoGain: number;
  backgroundMode: "piano" | "chord";
  metronome: boolean;
  chordKeys: boolean;
  sustainPedal: boolean;
  hand: "L" | "R" | "both";
  speed: number;
  transpose: number;
  mode: ViewMode;
  showAllKeys: boolean;
}
