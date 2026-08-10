import type { TimedNote } from "../timeline.js";
import { pitchColor } from "@keyspilli/midi";

export interface KeyboardGeometry {
  whiteKeys: number[]; // midi of white keys
  blackKeys: number[]; // midi of black keys
  whiteWidth: number;
  blackWidth: number;
  whiteHeight: number;
  blackHeight: number;
}

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Short pitch label: letter for keys, octave appended on C (C4, C#4...). */
export function noteLabel(midi: number): string {
  const pc = NAMES[midi % 12]!;
  const octave = Math.floor(midi / 12) - 1;
  return pc === "C" ? `${pc}${octave}` : pc;
}

export function keyboardGeometry(lowMidi: number, highMidi: number, width: number, whiteHeight = 160): KeyboardGeometry {
  const whites: number[] = [];
  const blacks: number[] = [];
  for (let m = lowMidi; m <= highMidi; m++) {
    if (WHITE.includes(m % 12)) whites.push(m);
    else blacks.push(m);
  }
  const whiteWidth = width / whites.length;
  return {
    whiteKeys: whites,
    blackKeys: blacks,
    whiteWidth,
    blackWidth: whiteWidth * 0.62,
    whiteHeight,
    blackHeight: whiteHeight * 0.62,
  };
}

export interface FallingBar {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  midi: number;
  label: string;
}

export interface FallingLayoutOptions {
  width: number;
  height: number;
  nowSec: number;
  speed: number;
  lookaheadSec: number;
  lowMidi: number;
  highMidi: number;
}

/** Map notes to falling bars for the given viewport + time window. */
export function fallingBars(notes: TimedNote[], o: FallingLayoutOptions): FallingBar[] {
  const geo = keyboardGeometry(o.lowMidi, o.highMidi, o.width);
  const xOf = (midi: number): number => {
    if (WHITE.includes(midi % 12)) {
      const idx = geo.whiteKeys.indexOf(midi);
      return idx < 0 ? -100 : idx * geo.whiteWidth;
    }
    const prevWhite = midi - 1;
    const idx = geo.whiteKeys.indexOf(prevWhite);
    if (idx < 0) return -100;
    return idx * geo.whiteWidth + geo.whiteWidth - geo.blackWidth / 2;
  };
  const pxPerSec = o.height / o.lookaheadSec;
  const out: FallingBar[] = [];
  for (const n of notes) {
    if (n.startSec > o.nowSec + o.lookaheadSec || n.startSec + n.durSec < o.nowSec - 0.05) continue;
    const x = xOf(n.midi);
    if (x < 0) continue;
    const isBlack = !WHITE.includes(n.midi % 12);
    // Notes fall DOWN toward the keyboard. The note's leading edge is its
    // BOTTOM: it lands exactly on the playhead (y == o.height) at the note's
    // start time, and the bar extends UPWARD for the note's duration.
    const bottom = o.height - (n.startSec - o.nowSec) * pxPerSec;
    const height = Math.max(6, n.durSec * pxPerSec - 2);
    const y = bottom - height;
    out.push({
      x,
      y,
      width: isBlack ? geo.blackWidth : geo.whiteWidth * 0.92,
      height,
      color: pitchColor(n.midi),
      midi: n.midi,
      label: noteLabel(n.midi),
    });
  }
  return out;
}

/** Keyboard row geometry for drawing the on-screen keyboard. */
export function keyboardRects(o: { width: number; lowMidi: number; highMidi: number; whiteHeight: number }): {
  whites: { midi: number; x: number; w: number }[];
  blacks: { midi: number; x: number; w: number }[];
  whiteWidth: number;
} {
  const geo = keyboardGeometry(o.lowMidi, o.highMidi, o.width, o.whiteHeight);
  return {
    whites: geo.whiteKeys.map((midi, i) => ({ midi, x: i * geo.whiteWidth, w: geo.whiteWidth })),
    blacks: geo.blackKeys.map((midi) => {
      const prevWhite = midi - 1;
      const idx = geo.whiteKeys.indexOf(prevWhite);
      return { midi, x: idx * geo.whiteWidth + geo.whiteWidth - geo.blackWidth / 2, w: geo.blackWidth };
    }),
    whiteWidth: geo.whiteWidth,
  };
}

export { pitchColor };
