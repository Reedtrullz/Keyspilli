import type { Note, ChordLabel, MeasureInfo } from "@keyspilli/midi";

export type { Note, ChordLabel, MeasureInfo };

export interface SongData {
  notes: Note[];
  chords: ChordLabel[];
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
  hand: "L" | "R" | "both";
  speed: number;
  transpose: number;
  mode: ViewMode;
}
