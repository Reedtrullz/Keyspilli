/**
 * Shared Basic Pitch post-processing for YouTube transcriptions: drop notes
 * with no nearby real audio onset (Basic Pitch fabricates notes between real
 * ones) and trim leading silence so songs start at the first note.
 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseMidi, writeMidi, type Note } from "@keyspilli/midi";
import { ROOT } from "./paths.js";

const execFileP = promisify(execFile);
const PYTHON = process.env.KEYSPILLI_PYTHON ?? join(ROOT, "services", "transcribe", ".venv", "bin", "python");

/** Bump when the audio-onset filtering algorithm or its Python contract changes. */
export const TRANSCRIPTION_FILTER_VERSION = "audio-onset-filter-v2";

/** Effective onset detector settings in services/transcribe/src/audio_onsets.py. */
export const AUDIO_ONSET_DETECTOR_CONFIG = {
  sampleRate: 22_050,
  hopLength: 512,
  backtrack: true,
  delta: 0.07,
} as const;

/** Maximum distance between an audio onset and a Basic Pitch note onset. */
export const ONSET_MATCH_SEC = Number(process.env.KEYSPILLI_ONSET_MATCH_SEC ?? 0.15);

const RETRIGGER_ONSET_SEC = 0.06;
const RETRIGGER_ATTACK_GAP_BEATS = 0.75;
const RETRIGGER_SOUNDING_GAP_BEATS = 0.125;
export const TRANSCRIPTION_MAX_RECONSTRUCTED_DUR_BEATS = 1.5;

/** Join Basic Pitch fragments only when audio does not support a new attack. */
export function collapseUnsupportedSamePitchRetriggers(
  notes: readonly Note[],
  audioOnsetsSec: readonly number[],
  tempoBpm: number,
): Note[] {
  const secPerBeat = 60 / tempoBpm;
  const sorted = notes.map((note) => ({ ...note })).sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur);
  const byPitch = new Map<string, Note[]>();
  for (const note of sorted) {
    const key = `${note.hand ?? ""}:${note.identitySource ?? ""}:${note.midi}`;
    const pitch = byPitch.get(key);
    if (pitch) pitch.push(note);
    else byPitch.set(key, [note]);
  }

  const merged: Note[] = [];
  for (const pitch of byPitch.values()) {
    let current = pitch[0];
    if (!current) continue;
    let previousFragmentStart = current.start;
    for (const note of pitch.slice(1)) {
      const attackGap = note.start - previousFragmentStart;
      const soundingGap = note.start - (current.start + current.dur);
      const mergedDuration = Math.max(current.start + current.dur, note.start + note.dur) - current.start;
      const independentAttack = audioOnsetsSec.some((onset) => Math.abs(onset - note.start * secPerBeat) <= RETRIGGER_ONSET_SEC);
      if (attackGap <= RETRIGGER_ATTACK_GAP_BEATS && soundingGap <= RETRIGGER_SOUNDING_GAP_BEATS && mergedDuration <= TRANSCRIPTION_MAX_RECONSTRUCTED_DUR_BEATS && !independentAttack) {
        current.dur = mergedDuration;
        current.vel = Math.max(current.vel, note.vel);
        previousFragmentStart = note.start;
      } else {
        merged.push(current);
        current = note;
        previousFragmentStart = note.start;
      }
    }
    merged.push(current);
  }
  return merged.sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur);
}

export async function filterTranscription(
  rawMidi: Uint8Array,
  audioPath: string,
  opts: {
    onsetMatchSec?: number;
    skipOnsetFilter?: boolean;
    trimIntroBeats?: number;
    collapseOctaveDoubles?: boolean;
    thinBassMinGapBeats?: number;
  } = {},
): Promise<Uint8Array> {
  const raw = parseMidi(rawMidi);
  const secPerBeat = 60 / raw.tempoBpm;
  let kept = raw.notes;
  if (!opts.skipOnsetFilter) {
    const { stdout } = await execFileP(PYTHON, [join(ROOT, "services", "transcribe", "src", "audio_onsets.py"), audioPath], {
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const audioOnsets = JSON.parse(stdout) as number[];
    const matchSec = opts.onsetMatchSec ?? ONSET_MATCH_SEC;
    kept = raw.notes.filter((n) => audioOnsets.some((a) => Math.abs(a - n.start * secPerBeat) <= matchSec));
    if (kept.length < raw.notes.length * 0.2) {
      throw new Error(`onset filter dropped too much (${kept.length}/${raw.notes.length})`);
    }
    kept = collapseUnsupportedSamePitchRetriggers(kept, audioOnsets, raw.tempoBpm);
  }
  // Bass guitar and rhythm-guitar roots transcribe as octave-doubled low
  // clusters that read as mud on piano. Keep the lowest note of each bass
  // attack and enforce a minimum gap so the low register stays a line.
  const thinBassGap = opts.thinBassMinGapBeats;
  if (thinBassGap !== undefined && thinBassGap > 0) {
    const BASS_SPLIT_MIDI = 48;
    const sortedBass = kept
      .filter((n) => n.midi < BASS_SPLIT_MIDI)
      .sort((a, b) => a.start - b.start || a.midi - b.midi);
    const droppedBass = new Set(sortedBass);
    let lastKeptStart = -Infinity;
    for (const n of sortedBass) {
      if (n.start < lastKeptStart + thinBassGap) continue;
      droppedBass.delete(n);
      lastKeptStart = n.start;
    }
    kept = kept.filter((note) => !droppedBass.has(note));
    if (kept.length < raw.notes.length * 0.2) {
      throw new Error(`bass thinning dropped too much (${kept.length}/${raw.notes.length})`);
    }
  }
  // One acoustic attack often produces C3+C5+C6 in the transcription: the
  // higher octaves are harmonics of the same played note, not separate keys.
  // Collapse each same-pitch-class stack at one onset down to its lowest note.
  if (opts.collapseOctaveDoubles) {
    const byOnset = new Map<number, typeof kept>();
    for (const n of kept) {
      const key = Math.round(n.start * 1000);
      const arr = byOnset.get(key);
      if (arr) arr.push(n);
      else byOnset.set(key, [n]);
    }
    const droppedOctaves = new Set<(typeof kept)[number]>();
    for (const group of byOnset.values()) {
      if (group.length < 2) continue;
      const byPc = new Map<number, typeof group>();
      for (const n of group) {
        const pc = n.midi % 12;
        const arr = byPc.get(pc);
        if (arr) arr.push(n);
        else byPc.set(pc, [n]);
      }
      for (const stack of byPc.values()) {
        if (stack.length < 2) continue;
        stack.sort((a, b) => a.midi - b.midi);
        for (let i = 1; i < stack.length; i++) droppedOctaves.add(stack[i]!);
      }
    }
    kept = kept.filter((note) => !droppedOctaves.has(note));
    if (kept.length < raw.notes.length * 0.2) {
      throw new Error(`octave collapse dropped too much (${kept.length}/${raw.notes.length})`);
    }
  }
  // Trim leading silence: video intros (title cards, spoken openings) often
  // leave 5-40s with no notes; the player should start at the first note.
  const firstStart = kept.reduce((earliest, note) => Math.min(earliest, note.start), Infinity);
  if (firstStart * secPerBeat > 2) {
    for (const n of kept) n.start = Math.max(0, n.start - firstStart);
  }
  // Per-song override: some transcriptions start with phantom bass-only bars
  // from a spoken intro. Drop everything before the first real melodic beat.
  if (opts.trimIntroBeats !== undefined && opts.trimIntroBeats > 0) {
    const remaining = kept.filter((n) => n.start >= opts.trimIntroBeats!);
    if (remaining.length >= 8) {
      for (const n of remaining) n.start -= opts.trimIntroBeats!;
      return writeMidi(remaining, {
        tempoBpm: raw.tempoBpm,
        timeSig: raw.timeSig,
        keySig: raw.keySig,
        keyMode: raw.keyMode,
      });
    }
    console.warn(`[filterTranscription] trimIntroBeats=${opts.trimIntroBeats} would drop below 8 notes; skipped`);
  }
  return writeMidi(kept, {
    tempoBpm: raw.tempoBpm,
    timeSig: raw.timeSig,
    keySig: raw.keySig,
    keyMode: raw.keyMode,
  });
}
