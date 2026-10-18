import type { Note } from "../types.js";
import { EPS, notesIn, clamp, isUpperGuitarRhythmWall, sourceConfidence } from "./shared.js";

/**
 * Basic Pitch can leak sparse guitar/reverb events into the vocal stem. Only
 * let vocals displace an active guitar lead when they form a compact moving
 * phrase. Isolated vocal events are used only when there is no usable
 * instrumental identity in the window.
 */
export function trustworthyVocalNotes(notes: Note[]): Note[] {
  const phrases: Note[][] = [];
  for (const note of notes) {
    const phrase = phrases.at(-1);
    const previous = phrase?.at(-1);
    if (!phrase || !previous || note.start - (previous.start + previous.dur) > 4) {
      phrases.push([note]);
    } else {
      phrase.push(note);
    }
  }
  return phrases.flatMap((phrase) => {
    if (phrase.length < 2) return [];
    const peakVelocity = phrase.reduce((value, note) => Math.max(value, note.vel), 0);
    // Apply confidence locally so a quiet reverb/bleed tail cannot become
    // trusted merely by landing 0.1 beat inside the phrase-gap boundary.
    const credible = phrase.filter((note) => note.vel >= peakVelocity * 0.55);
    if (credible.length < 2) return [];
    const distinct = new Set(credible.map((note) => note.midi));
    const first = credible[0]!;
    const last = credible.at(-1)!;
    const span = Math.max(0.5, last.start + Math.min(last.dur, 1) - first.start);
    const density = credible.length / span;
    const minimumDensity = credible.length >= 3 ? 0.35 : 0.5;
    return distinct.size >= 2 && density >= minimumDensity ? credible : [];
  });
}

/**
 * Basic Pitch occasionally labels a very low, sustained vocal-stem bleed as a
 * note (for example raw MIDI 29 for several beats). Register normalization
 * would octave-fold that detector artifact into an apparently plausible RH
 * melody. Keep the gate deliberately narrow: long/drone material is filtered
 * only below raw MIDI 45, while a short regular same-pitch wall is filtered
 * below raw MIDI 60. Short moving low-register vocal phrases and isolated low
 * anchors remain eligible.
 */
export function filterLowVocalDroneNotes(notes: Note[]): Note[] {
  const lowDrones = notes.filter((note) => note.midi < 45 && note.dur >= 2 - EPS);
  const lowWallNotes = new Set<Note>();
  const lowAttacks = notes
    .filter((note) => note.midi < 60 && note.dur < 2 - EPS)
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.dur - a.dur);
  let run: Note[] = [];
  const flushWall = (): void => {
    const starts = run.reduce<number[]>((result, note) => {
      if (!result.length || note.start - result.at(-1)! > 0.08 + EPS) result.push(note.start);
      return result;
    }, []);
    const distinctPitches = new Set(run.map((note) => note.midi));
    const shortRepeatedWall = starts.length >= 4
      && distinctPitches.size === 1
      && run.every((note) => note.dur <= 0.75 + EPS)
      && starts.slice(1).every((start, index) => start - starts[index]! <= 1 + EPS);
    if (shortRepeatedWall) run.forEach((note) => lowWallNotes.add(note));
    run = [];
  };
  for (const note of lowAttacks) {
    const previous = run.at(-1);
    if (!previous || (note.midi === previous.midi && note.start - previous.start <= 1 + EPS)) {
      run.push(note);
    } else {
      flushWall();
      run.push(note);
    }
  }
  flushWall();
  if (!lowDrones.length && !lowWallNotes.size) return notes;
  return notes.filter((note) => {
    if (lowWallNotes.has(note)) return false;
    if (note.midi >= 45) return true;
    if (note.dur >= 2 - EPS) return false;
    return !lowDrones.some((drone) => drone.midi === note.midi
      && note.start <= drone.start + drone.dur + 0.25 + EPS
      && note.start + note.dur >= drone.start - 0.25 - EPS);
  });
}

/**
 * Estimate whether an instrumental lane behaves like a playable melody. Raw
 * attack density is useful for routing, but it rewards a loud palm-muted wall
 * and detector zig-zag more than a sparse, connected lead. Keep this score
 * deliberately explainable: register, continuity, dynamics, and density are
 * evidence only; the phrase decoder still makes the final choice.
 */
export function melodicConfidence(notes: Note[], start: number, end: number, stemConfidence = 1): number {
  const evidence = notesIn(notes, start, end).sort((a, b) => a.start - b.start || b.vel - a.vel);
  if (!evidence.length) return 0;
  const expected = Math.max(1, (end - start) / 2);
  const density = clamp(evidence.length / expected, 0, 1);
  const upperRatio = evidence.filter((note) => note.midi >= 64).length / evidence.length;
  const dynamic = evidence.reduce((sum, note) => sum + clamp(note.vel / 127, 0, 1), 0) / evidence.length;
  const intervals = evidence.slice(1).map((note, index) => Math.abs(note.midi - evidence[index]!.midi));
  const largeLeapRatio = intervals.length
    ? intervals.filter((interval) => interval >= 7).length / intervals.length
    : 0;
  const repeatedRatio = intervals.length
    ? intervals.filter((interval) => interval === 0).length / intervals.length
    : 0;
  // Constant repeated attacks are rhythm evidence unless a meaningful pitch
  // contour exists. Penalize them gently so an intentional chant is still
  // viable when no other identity source is available.
  const continuity = clamp(1 - largeLeapRatio * 1.35 - Math.max(0, repeatedRatio - 0.7) * 0.4, 0, 1);
  const score = 0.35 * continuity
    + 0.25 * upperRatio
    + 0.2 * dynamic
    + 0.2 * density;
  // A dedicated guitar stem often contains a palm-muted upper partial wall
  // (the same short MIDI pitch repeated every half beat). When a coherent
  // residual lane is also present, treating that wall as an equally melodic
  // source makes the section start on rhythm noise and hides the real lead.
  // Penalize only the guitar role, and only when the evidence is genuinely
  // wall-like; a repeated note with pitch motion, a sparse hook, or an
  // other-only fallback remains eligible.
  const upperRhythmWall = isUpperGuitarRhythmWall(evidence);
  const rolePenalty = upperRhythmWall ? 0.35 : 0;
  return clamp((score - rolePenalty) * stemConfidence, 0, 1);
}

/**
 * A transcription can produce a dense, single-pitch vocal drone from bleed
 * or reverb. It should not displace a moving riff that carries the song's
 * identity. Penalize only the degenerate vocal case; chants and deliberately
 * narrow melodies with at least two pitches retain their normal priority.
 */
export function vocalSourceConfidence(notes: Note[], start: number, end: number, stemConfidence = 1): number {
  const confidence = sourceConfidence(notes, start, end, stemConfidence);
  const evidence = notesIn(notes, start, end);
  if (evidence.length < 4) return confidence;
  const distinct = new Set(evidence.map((note) => note.midi));
  if (distinct.size > 1) return confidence;
  return confidence * 0.5;
}
