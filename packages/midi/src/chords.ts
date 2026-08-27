import type { ChordLabel, ChordNoteOptions, ChordParseOptions, ChordQuality, ChordSymbol, ChordVoicingOptions, Note } from "./types.js";

/**
 * Pitch classes for the chord qualities understood by the learner player.
 *
 * `add9` deliberately keeps the ninth as 14 semitones when it is turned into
 * MIDI.  A pitch-class view of the same chord is, of course, 0/2/4/7.
 */
const QUALITY_INTERVALS: Record<ChordQuality, readonly number[]> = {
  major: [0, 4, 7],
  "5": [0, 7],
  minor: [0, 3, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  "6": [0, 4, 7, 9],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  add9: [0, 4, 7, 14],
};

const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  major: "",
  "5": "5",
  minor: "m",
  "7": "7",
  maj7: "maj7",
  m7: "m7",
  "6": "6",
  sus2: "sus2",
  sus4: "sus4",
  dim: "dim",
  aug: "aug",
  add9: "add9",
};

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const LETTER_PITCH_CLASSES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}
function ensureInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${name} must be a finite integer`);
  }
  return value;
}

function semitoneShift(options: ChordParseOptions | undefined): number {
  const capo = options?.capo ?? 0;
  const transpose = options?.transpose ?? 0;
  ensureInteger(capo, "capo");
  ensureInteger(transpose, "transpose");
  return capo + transpose;
}

function noteName(pc: number, preferFlats = false): string {
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)]!;
}

function parsePitchClass(token: string): { name: string; pc: number; preferFlats: boolean } {
  const match = /^([A-Ga-g])([#b♯♭]?)$/.exec(token.trim());
  if (!match) throw new Error(`Invalid chord note "${token}"`);
  const letter = match[1]!.toUpperCase();
  const accidental = match[2] ?? "";
  const base = LETTER_PITCH_CLASSES[letter];
  if (base === undefined) throw new Error(`Invalid chord note "${token}"`);
  const offset = accidental === "#" || accidental === "♯" ? 1 : accidental ? -1 : 0;
  const preferFlats = accidental === "b" || accidental === "♭";
  return { name: noteName(base + offset, preferFlats), pc: mod12(base + offset), preferFlats };
}

/** Map a human chord suffix to the canonical quality used by the MIDI core. */
function parseQuality(raw: string): ChordQuality {
  // Spaces are common in hand-entered lead sheets (`C add9`, `G sus 4`).
  const suffix = raw.replace(/\s+/g, "");
  if (!suffix || suffix === "M" || /^maj(?:or)?$/i.test(suffix)) return "major";
  if (suffix === "5") return "5";
  if (suffix === "m" || suffix === "-" || /^(?:min|minor)$/i.test(suffix)) return "minor";

  // Keep the case-sensitive M/m aliases before lower-casing the remainder.
  if (suffix === "M7" || suffix === "Δ7" || /^maj(?:or)?7$/i.test(suffix)) return "maj7";
  if (suffix === "m7" || suffix === "-7" || /^(?:min|minor)7$/i.test(suffix)) return "m7";
  if (suffix === "M6" || /^maj(?:or)?6$/i.test(suffix) || suffix === "6") return "6";
  if (suffix === "7" || /^dom(?:inant)?7$/i.test(suffix)) return "7";
  if (/^sus2$/i.test(suffix)) return "sus2";
  // `sus` without a number conventionally means sus4.
  if (/^sus4?$/i.test(suffix)) return "sus4";
  if (suffix === "°" || suffix === "o" || /^dim$/i.test(suffix)) return "dim";
  if (suffix === "+" || /^aug$/i.test(suffix)) return "aug";
  if (/^add9$/i.test(suffix)) return "add9";
  throw new Error(`Unsupported chord quality "${raw.trim() || "(empty)"}"`);
}

function isChordSymbol(value: string | ChordSymbol): value is ChordSymbol {
  return typeof value !== "string" && value !== null && typeof value === "object";
}

function canonicalSymbol(
  rootPc: number,
  quality: ChordQuality,
  bassPc: number | undefined,
  preferFlats: boolean,
): string {
  const root = noteName(rootPc, preferFlats);
  const bass = bassPc === undefined ? "" : `/${noteName(bassPc, preferFlats)}`;
  return `${root}${QUALITY_SUFFIX[quality]}${bass}`;
}

/**
 * Parse a chord symbol into pitch classes and a small, stable quality enum.
 *
 * The optional `capo` and `transpose` values are sounding-pitch shifts.  For
 * example, `parseChordSymbol("C/G", { capo: 2 })` describes D/A.  This makes
 * the parser useful for both displayed lead-sheet symbols and playback.
 */
export function parseChordSymbol(symbol: string, options: ChordParseOptions = {}): ChordSymbol {
  if (typeof symbol !== "string" || !symbol.trim()) throw new Error("Chord symbol must be a non-empty string");

  const input = symbol.trim().replace(/[\u2212\u2010\u2011\u2012\u2013]/g, "-");
  const slash = input.indexOf("/");
  if (slash >= 0 && input.indexOf("/", slash + 1) >= 0) {
    throw new Error(`Invalid chord symbol "${symbol}"`);
  }

  const rootAndQuality = slash >= 0 ? input.slice(0, slash).trim() : input;
  const bassToken = slash >= 0 ? input.slice(slash + 1).trim() : undefined;
  if (!rootAndQuality || (slash >= 0 && !bassToken)) throw new Error(`Invalid chord symbol "${symbol}"`);

  const rootMatch = /^([A-Ga-g](?:#|b|♯|♭)?)(.*)$/.exec(rootAndQuality);
  if (!rootMatch) throw new Error(`Invalid chord root in "${symbol}"`);
  const root = parsePitchClass(rootMatch[1]!);
  const quality = parseQuality(rootMatch[2]!.trim());
  const bass = bassToken === undefined ? undefined : parsePitchClass(bassToken);
  const shift = semitoneShift(options);
  const preferFlats = options.preferFlats ?? (root.preferFlats || Boolean(bass?.preferFlats));
  const rootPc = mod12(root.pc + shift);
  const bassPc = bass === undefined ? undefined : mod12(bass.pc + shift);

  return {
    symbol: canonicalSymbol(rootPc, quality, bassPc, preferFlats),
    root: noteName(rootPc, preferFlats),
    rootPc,
    quality,
    ...(bassPc === undefined ? {} : { bass: noteName(bassPc, preferFlats), bassPc }),
  };
}

/** A non-throwing parser useful for user-entered lead-sheet text. */
export function tryParseChordSymbol(symbol: string, options: ChordParseOptions = {}): ChordSymbol | null {
  try {
    return parseChordSymbol(symbol, options);
  } catch {
    return null;
  }
}

/** Validate externally supplied chord events before they reach artifacts. */
export function validateChordLabels(value: unknown, path = "chords"): string[] {
  if (!Array.isArray(value)) return [`${path} must be an array`];
  const errors: string[] = [];
  let previousBeat = -Infinity;
  value.forEach((candidate, index) => {
    const itemPath = `${path}[${index}]`;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      errors.push(`${itemPath} must be an object`);
      return;
    }
    const chord = candidate as Partial<ChordLabel>;
    if (typeof chord.beat !== "number" || !Number.isFinite(chord.beat) || chord.beat < 0) {
      errors.push(`${itemPath}.beat must be a finite non-negative number`);
    } else if (chord.beat + 1e-9 < previousBeat) {
      errors.push(`${itemPath}.beat must be non-decreasing`);
    } else {
      previousBeat = chord.beat;
    }
    if (typeof chord.name !== "string" || !chord.name.trim()) {
      errors.push(`${itemPath}.name must be a non-empty string`);
    } else if (chord.name !== "N.C." && !tryParseChordSymbol(chord.name)) {
      errors.push(`${itemPath}.name must be a supported chord symbol or N.C.`);
    }
    if (!Array.isArray(chord.notes) || chord.notes.length < 1) {
      errors.push(`${itemPath}.notes must be a non-empty array`);
    } else if (chord.notes.some((note) => !Number.isInteger(note) || note < 21 || note > 108)) {
      errors.push(`${itemPath}.notes must contain integer MIDI pitches in 21-108`);
    }
    if (chord.durationBeats !== undefined &&
      (typeof chord.durationBeats !== "number" || !Number.isFinite(chord.durationBeats) || chord.durationBeats <= 0)) {
      errors.push(`${itemPath}.durationBeats must be a positive finite number when present`);
    }
  });
  return errors;
}

function toParsedChord(symbol: string | ChordSymbol, options: ChordParseOptions = {}): ChordSymbol {
  if (typeof symbol === "string") return parseChordSymbol(symbol, options);
  if (!isChordSymbol(symbol)) throw new Error("Chord must be a symbol string or parsed chord");
  const shift = semitoneShift(options);
  if (shift === 0) return symbol;
  const rootPc = mod12(symbol.rootPc + shift);
  const bassPc = symbol.bassPc === undefined ? undefined : mod12(symbol.bassPc + shift);
  const preferFlats = options.preferFlats ?? /b/.test(`${symbol.root}${symbol.bass ?? ""}`);
  return {
    symbol: canonicalSymbol(rootPc, symbol.quality, bassPc, preferFlats),
    root: noteName(rootPc, preferFlats),
    rootPc,
    quality: symbol.quality,
    ...(bassPc === undefined ? {} : { bass: noteName(bassPc, preferFlats), bassPc }),
  };
}

/** Return the semitone intervals for a chord quality, including a high ninth for add9. */
export function chordIntervals(quality: ChordQuality): readonly number[] {
  return QUALITY_INTERVALS[quality];
}

/** Return the chord's pitch classes in root-to-extension order. */
export function chordPitchClasses(
  symbol: string | ChordSymbol,
  options: ChordParseOptions = {},
): number[] {
  const parsed = toParsedChord(symbol, options);
  const pcs = QUALITY_INTERVALS[parsed.quality]!.map((interval) => mod12(parsed.rootPc + interval));
  if (parsed.bassPc !== undefined && !pcs.includes(parsed.bassPc)) pcs.push(parsed.bassPc);
  return pcs;
}

function midiForPitchClass(pc: number, octave: number): number {
  ensureInteger(octave, "octave");
  const midi = (octave + 1) * 12 + mod12(pc);
  if (midi < 0 || midi > 127) throw new Error(`octave ${octave} produces a MIDI note outside 0-127`);
  return midi;
}

function normaliseVoicingOptions(options: ChordVoicingOptions): Required<Pick<ChordVoicingOptions, "octave" | "bassOctave" | "capo" | "transpose" | "includeBass">> & ChordVoicingOptions {
  const octave = options.octave ?? 4;
  const bassOctave = options.bassOctave ?? octave - 1;
  const capo = options.capo ?? 0;
  const transpose = options.transpose ?? 0;
  ensureInteger(octave, "octave");
  ensureInteger(bassOctave, "bassOctave");
  ensureInteger(capo, "capo");
  ensureInteger(transpose, "transpose");
  if (options.maxNotes !== undefined) {
    ensureInteger(options.maxNotes, "maxNotes");
    if (options.maxNotes < 1) throw new Error("maxNotes must be at least 1");
  }
  return { ...options, octave, bassOctave, capo, transpose, includeBass: options.includeBass ?? false };
}

/**
 * Generate a compact, playable MIDI voicing for a chord symbol.
 *
 * By default the root is in octave 4 (C4 = 60), producing a simple root
 * position suitable for a learner's right hand.  Slash chords add the named
 * bass one octave below the shape; set `includeBass` to do the same for an
 * ordinary root chord.  `capo` and `transpose` are both sounding-pitch shifts.
 */
export function chordToNotes(symbol: string | ChordSymbol, options: ChordVoicingOptions = {}): number[] {
  const voicing = normaliseVoicingOptions(options);
  const parsed = typeof symbol === "string" ? parseChordSymbol(symbol) : toParsedChord(symbol);
  const shift = voicing.capo + voicing.transpose;
  const rootMidi = midiForPitchClass(parsed.rootPc, voicing.octave) + shift;
  const intervals = QUALITY_INTERVALS[parsed.quality]!;
  let notes = intervals.map((interval) => rootMidi + interval);

  const bassPc = parsed.bassPc;
  if (voicing.includeBass || bassPc !== undefined) {
    const bass = midiForPitchClass(bassPc ?? parsed.rootPc, voicing.bassOctave) + shift;
    // Keep the bass below the chord shape even when callers choose an unusual
    // bassOctave.  This also makes slash inversions easy for a beginner to
    // read and play.
    let lowBass = bass;
    while (lowBass >= Math.min(...notes) && lowBass - 12 >= 0) lowBass -= 12;
    while (lowBass < 0) lowBass += 12;
    if (!notes.includes(lowBass)) notes.push(lowBass);
  }

  notes = [...new Set(notes)].sort((a, b) => a - b);
  if (notes.some((note) => note < 0 || note > 127)) {
    throw new Error("Chord voicing produces a MIDI note outside 0-127");
  }

  if (voicing.maxNotes !== undefined && notes.length > voicing.maxNotes) {
    // Keep the bass and the shell (root plus third/suspension) before dropping
    // colour tones.  This is intentionally deterministic and learner-first.
    const bass = notes[0]!;
    const required = new Set<number>([bass, rootMidi]);
    const shell = intervals.slice(1, 2).map((interval) => rootMidi + interval);
    shell.forEach((note) => required.add(note));
    const reduced = notes.filter((note) => required.has(note));
    for (const note of notes) {
      if (reduced.length >= voicing.maxNotes) break;
      if (!reduced.includes(note)) reduced.push(note);
    }
    notes = reduced.slice(0, voicing.maxNotes).sort((a, b) => a - b);
  }
  return notes;
}

/** Alias with an explicit generation verb for callers that prefer it. */
export const generateChordNotes = chordToNotes;

/** Alias used by a few playback integrations. */
export const chordToMidi = chordToNotes;

/** Generate timed `Note` objects for a chord event. */
export function chordToNoteEvents(symbol: string | ChordSymbol, options: ChordNoteOptions = {}): Note[] {
  const { start = 0, dur = 1, vel = 80, hand, lyrics, ...voicing } = options;
  if (!Number.isFinite(start) || !Number.isFinite(dur) || dur <= 0) {
    throw new Error("start must be finite and dur must be positive");
  }
  if (!Number.isFinite(vel) || vel < 0 || vel > 127) throw new Error("vel must be between 0 and 127");
  return chordToNotes(symbol, voicing).map((midi) => ({ midi, start, dur, vel, ...(hand ? { hand } : {}), ...(lyrics ? { lyrics } : {}) }));
}

/**
 * Transpose a symbol, including a slash bass, while retaining its quality.
 * The result uses sharps by default; set `preferFlats` when publishing flat
 * lead-sheet keys.
 */
export function transposeChordSymbol(
  symbol: string | ChordSymbol,
  semitones: number,
  options: Pick<ChordParseOptions, "preferFlats"> = {},
): string {
  ensureInteger(semitones, "semitones");
  const parsed = typeof symbol === "string" ? parseChordSymbol(symbol) : symbol;
  const preferFlats = options.preferFlats ?? (typeof symbol === "string" && /b|♭/.test(symbol));
  return canonicalSymbol(
    parsed.rootPc + semitones,
    parsed.quality,
    parsed.bassPc === undefined ? undefined : parsed.bassPc + semitones,
    preferFlats,
  );
}

/** Apply a capo as a sounding-pitch shift to a chord symbol. */
export function capoChordSymbol(symbol: string | ChordSymbol, capo: number, options: Pick<ChordParseOptions, "preferFlats"> = {}): string {
  ensureInteger(capo, "capo");
  return transposeChordSymbol(symbol, capo, options);
}

/** Compatibility alias for code that calls this operation `applyCapo`. */
export const applyCapo = capoChordSymbol;

/** Shift absolute MIDI notes without changing their timing. */
export function transposeMidiNotes(notes: readonly number[], semitones: number): number[] {
  ensureInteger(semitones, "semitones");
  return notes.map((note) => {
    if (!Number.isFinite(note) || !Number.isInteger(note) || note < 0 || note > 127) {
      throw new Error(`Invalid MIDI note ${note}`);
    }
    const shifted = note + semitones;
    if (shifted < 0 || shifted > 127) throw new Error(`Transposed MIDI note ${shifted} is outside 0-127`);
    return shifted;
  });
}
