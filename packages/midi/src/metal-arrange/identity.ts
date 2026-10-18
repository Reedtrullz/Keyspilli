import type { Note } from "../types.js";
import type { IdentityNote } from "./types.js";
import { EPS, clamp, isUpperGuitarRhythmWall, notesIn, isMetalInstrumentalSource, toRegister } from "./shared.js";

function alternateNoteAllowed(
  note: IdentityNote,
  primaryNotes: IdentityNote[],
  end: number,
  minAlternateRest: number,
): boolean {
  if (minAlternateRest <= 0 || !primaryNotes.length) return true;
  const nextPrimary = primaryNotes
    .filter((primaryNote) => primaryNote.start >= note.start - EPS)
    .sort((a, b) => a.start - b.start)[0];
  const previousPrimary = primaryNotes
    .filter((primaryNote) => primaryNote.start + primaryNote.dur <= note.start + EPS)
    .sort((a, b) => b.start - a.start)[0];
  const nextStart = nextPrimary?.start ?? end;
  const restBefore = previousPrimary
    ? note.start - (previousPrimary.start + previousPrimary.dur)
    : Number.POSITIVE_INFINITY;
  const restAfter = nextStart - (note.start + note.dur);
  const rawMidi = note.rawMidi ?? note.midi;
  // A low instrumental attack directly before a far-away vocal entrance is
  // usually rhythm bleed, not a lead phrase. Keep close stepwise fills (which
  // can be useful melody connectors), but reject a large register jump when
  // the alternate has no real landing room.
  if (
    nextPrimary
    && restAfter <= 0.25 + EPS
    && rawMidi <= 60
    && note.vel < 64
    && Math.abs(rawMidi - (nextPrimary.rawMidi ?? nextPrimary.midi)) >= 12
  ) return false;
  // Apply the same guard after a vocal ending; a quiet low attack with no
  // melodic landing is just as likely to be the rhythm stem leaking into the
  // right-hand identity lane.
  if (
    previousPrimary
    && restBefore <= 0.75 + EPS
    && rawMidi <= 60
    && note.vel < 64
    && Math.abs(rawMidi - (previousPrimary.rawMidi ?? previousPrimary.midi)) >= 12
  ) return false;
  return true;
}

export function instrumentalLaneQuality(notes: IdentityNote[], start: number, end: number): number {
  if (!notes.length) return 0;
  const ordered = [...notes].sort((a, b) => a.start - b.start || b.vel - a.vel);
  const upper = ordered.filter((note) => (note.rawMidi ?? note.midi) >= 61 || note.midi >= 64);
  if (!upper.length) return 0.05;
  const span = Math.max(0.5, (upper.at(-1)!.start - upper[0]!.start) || (end - start));
  const gaps = upper.slice(1).map((note, index) => note.start - upper[index]!.start).filter((gap) => gap > EPS);
  const density = upper.length / span;
  const largeLeapRatio = gaps.length
    ? upper.slice(1).filter((note, index) => Math.abs(note.midi - upper[index]!.midi) >= 7).length / gaps.length
    : 0;
  const repeatedRatio = gaps.length
    ? upper.slice(1).filter((note, index) => note.midi === upper[index]!.midi).length / gaps.length
    : 0;
  const continuity = clamp(1 - largeLeapRatio * 1.25 - Math.max(0, repeatedRatio - 0.75) * 0.25, 0, 1);
  // Residual full-mix lanes often contain a high partial on almost every
  // detector frame. A genuine lead can be dense, but a sustained 8+/beat
  // stream is more likely chord/noise evidence than a playable phrase.
  const densityFit = clamp(1 - Math.max(0, density - 4) / 8, 0, 1);
  const upperCoverage = clamp(upper.length / 4, 0, 1);
  const dynamics = upper.reduce((sum, note) => sum + clamp(note.vel / 127, 0, 1), 0) / upper.length;
  const duration = upper.reduce((sum, note) => sum + clamp(note.dur / 0.5, 0, 1), 0) / upper.length;
  // A dedicated guitar lane can be loud and perfectly regular while still
  // being a palm-muted rhythm wall.  The section chooser uses this quality
  // score directly for vocal rests, so apply the same bounded wall penalty as
  // melodicConfidence; otherwise a wall can win here even when the top-level
  // section score correctly prefers a coherent residual contour.  Keep the
  // penalty finite so a guitar wall remains usable when it is the only lane.
  const upperRhythmWall = isUpperGuitarRhythmWall(ordered);
  const rolePenalty = upperRhythmWall ? 0.35 : 0;
  return clamp(0.3 * continuity
    + 0.25 * densityFit
    + 0.2 * upperCoverage
    + 0.15 * dynamics
    + 0.1 * duration
    - rolePenalty, 0, 1);
}

/**
 * Select at most one instrumental source inside each vocal-free interval.
 * Residual `other` is useful when guitar is absent or clearly rhythmic, but
 * adding every alternate note to every rest makes the RH jump between lanes
 * like a detector rather than a performer. Vocal notes remain mandatory and
 * are never passed through this chooser.
 */
function chooseInstrumentalRestLanes(
  primaryNotes: IdentityNote[],
  alternates: IdentityNote[][],
  start: number,
  end: number,
  minAlternateRest: number,
  preferredSource?: "guitar" | "other",
  preferredLastAttack?: number,
): { notes: IdentityNote[]; source?: "guitar" | "other" } {
  if (!alternates.length || !primaryNotes.length) return { notes: [] };
  const sortedPrimary = [...primaryNotes].sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let cursor = start;
  for (const primary of sortedPrimary) {
    const primaryStart = Math.max(start, primary.start);
    if (primaryStart > cursor + EPS) gaps.push({ start: cursor, end: primaryStart });
    cursor = Math.max(cursor, Math.min(end, primary.start + primary.dur));
  }
  if (cursor < end - EPS) gaps.push({ start: cursor, end });

  const candidatesFor = (lane: IdentityNote[], gap: { start: number; end: number }): IdentityNote[] =>
    notesIn(lane, gap.start, gap.end)
      .filter((note) => alternateNoteAllowed(note, sortedPrimary, end, minAlternateRest))
      .filter((note) => !sortedPrimary.some((primary) =>
        Math.abs(primary.start - note.start) <= 0.08
        || (primary.start <= note.start && primary.start + primary.dur > note.start),
      ));

  // First decide which instrumental lane owns this section. Selecting a
  // winner independently inside each vocal gap lets a dense residual stem
  // steal one gap from a connected guitar phrase. A section winner provides
  // hysteresis without requiring an expensive song-wide DP; a carried source
  // is retained while it has a nearby continuation and is released after a
  // genuine rest.
  const sectionOptions = alternates.map((lane, laneIndex) => {
    const candidates = candidatesFor(lane, { start, end });
    const sourceNote = candidates.find((note) => isMetalInstrumentalSource(note.identitySource));
    const source = sourceNote && isMetalInstrumentalSource(sourceNote.identitySource)
      ? sourceNote.identitySource
      : undefined;
    const sourceBonus = source === "guitar" ? 0.02 : 0;
    return {
      laneIndex,
      candidates,
      source,
      score: instrumentalLaneQuality(candidates, start, end) + sourceBonus,
    };
  }).filter((option) => option.candidates.length > 0);
  if (!sectionOptions.length) return { notes: [] };

  const preferredOption = preferredSource
    ? sectionOptions.find((option) => option.source === preferredSource)
    : undefined;
  const preferredIsConnected = Boolean(
    preferredOption
    && preferredLastAttack !== undefined
    // A section seam is not a reason to resurrect a palm-muted upper wall.
    // Let the current section's lane-quality comparison choose a coherent
    // residual contour when the carried guitar evidence is wall-like.
    && !(preferredOption.source === "guitar" && isUpperGuitarRhythmWall(preferredOption.candidates))
    && preferredOption.candidates.some((note) => note.start - preferredLastAttack <= 1.5 + EPS),
  );
  const sectionWinner = preferredIsConnected
    ? preferredOption!
    : sectionOptions
      .slice()
      .sort((a, b) => b.score - a.score || a.laneIndex - b.laneIndex)[0]!;

  const selected: IdentityNote[] = [];
  for (const gap of gaps) {
    const options = alternates.map((lane, laneIndex) => {
      const candidates = candidatesFor(lane, gap);
      // A tiny tie-break keeps an actual guitar lead ahead of an equally
      // coherent residual lane, while the quality score still lets `other`
      // win when it is the only credible upper phrase.
      const sourceBonus = candidates.some((note) => note.identitySource === "guitar") ? 0.02 : 0;
      return { laneIndex, candidates, score: instrumentalLaneQuality(candidates, gap.start, gap.end) + sourceBonus };
    }).filter((option) => option.candidates.length > 0);
    // Keep the section owner whenever it has evidence in this vocal gap. If
    // it is silent, fall back to the best available lane rather than inventing
    // a note or deleting a legitimate sparse residual phrase.
    const winner = options.find((option) => option.laneIndex === sectionWinner.laneIndex)
      ?? options.sort((a, b) => b.score - a.score || a.laneIndex - b.laneIndex)[0];
    if (winner) selected.push(...winner.candidates.map((note) => ({ ...note })));
  }
  return {
    notes: selected,
    source: sectionWinner.source,
  };
}

export function identityForWindow(
  primary: IdentityNote[],
  alternates: IdentityNote[][],
  start: number,
  end: number,
  minAlternateRest = 0,
  preferredSource?: "guitar" | "other",
  preferredLastAttack?: number,
): { notes: IdentityNote[]; primaryNotes: IdentityNote[]; primaryCount: number; alternateCount: number; alternateSource?: "guitar" | "other" } {
  const primaryNotes = notesIn(primary, start, end).map((note) => ({ ...note }));
  const selected = [...primaryNotes];
  let alternateCount = 0;
  let alternateSource: "guitar" | "other" | undefined;
  // With multiple instrumental lanes, choose one coherent source per vocal
  // rest. A single-lane call keeps the historical behaviour and its
  // backwards-compatible tests unchanged.
  if (alternates.length > 1 && primaryNotes.length) {
    const chosen = chooseInstrumentalRestLanes(
      primaryNotes,
      alternates,
      start,
      end,
      minAlternateRest,
      preferredSource,
      preferredLastAttack,
    );
    selected.push(...chosen.notes);
    alternateCount = chosen.notes.length;
    alternateSource = chosen.source;
  } else {
    // Preserve a guitar/other motif during vocal rests instead of throwing the
    // whole instrumental lane away just because the section has a vocal lead.
    for (const lane of alternates) {
      for (const note of notesIn(lane, start, end)) {
        const occupied = selected.some((existing) =>
          Math.abs(existing.start - note.start) <= 0.08
          || (existing.start <= note.start && existing.start + existing.dur > note.start),
        );
        if (occupied || !alternateNoteAllowed(note, primaryNotes, end, minAlternateRest)) continue;
        selected.push({ ...note });
        alternateCount += 1;
      }
    }
  }
  const sorted = selected
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi)
    .map((note, index, all) => ({
      ...note,
      dur: Math.max(EPS, Math.min(note.dur, end - note.start, all[index + 1] ? all[index + 1]!.start - note.start : note.dur)),
    }));
  return { notes: sorted, primaryNotes, primaryCount: primaryNotes.length, alternateCount, alternateSource };
}

/**
 * Apply the vocal-boundary bleed guard across section windows as well as
 * inside them. A section can end immediately before a vocal phrase starts,
 * so looking only at its local primary notes would leave that attack
 * unclassified. The raw source pitch is used here because the instrumental
 * lane may already have been octave-registered for piano.
 */
export function suppressBoundaryBleed(notes: IdentityNote[], vocals: IdentityNote[]): IdentityNote[] {
  if (!vocals.length) return notes;
  const sortedVocals = [...vocals].sort((a, b) => a.start - b.start);
  return notes.filter((note) => {
    if (note.identitySource !== "guitar" && note.identitySource !== "other") return true;
    const rawMidi = note.rawMidi ?? note.midi;
    if (rawMidi > 60 || note.vel >= 64) return true;
    const activePrimary = sortedVocals.find((vocal) =>
      vocal.start <= note.start + EPS && vocal.start + vocal.dur > note.start + EPS,
    );
    if (
      activePrimary
      && Math.abs(rawMidi - (activePrimary.rawMidi ?? activePrimary.midi)) >= 12
    ) return false;
    const nextPrimary = sortedVocals.find((vocal) => vocal.start >= note.start - EPS);
    if (
      nextPrimary
      && nextPrimary.start - (note.start + note.dur) <= 0.25 + EPS
      && Math.abs(rawMidi - (nextPrimary.rawMidi ?? nextPrimary.midi)) >= 12
    ) return false;
    const previousPrimary = [...sortedVocals]
      .reverse()
      .find((vocal) => vocal.start + vocal.dur <= note.start + EPS);
    if (
      previousPrimary
      && note.start - (previousPrimary.start + previousPrimary.dur) <= 0.75 + EPS
      && Math.abs(rawMidi - (previousPrimary.rawMidi ?? previousPrimary.midi)) >= 12
    ) return false;
    return true;
  });
}

/**
 * Trace the fused vocal/guitar phrase through octave-equivalent registers.
 * Trusted vocal pitches and phrase starts are anchors; surrounding guitar
 * partials may move by octaves when that avoids physically implausible rapid
 * travel. A real rest starts a fresh path, preserving deliberate register
 * changes between phrases.
 */
export function stabilizeIdentityRegister(
  notes: IdentityNote[],
  tempoBpm: number,
  registerAnchors: ReadonlySet<string>,
  low = 55,
  high = 96,
): IdentityNote[] {
  if (notes.length < 2) return notes.map((note) => ({ ...note }));
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  const phrases: IdentityNote[][] = [];
  for (const note of sorted) {
    const phrase = phrases.at(-1);
    const previous = phrase?.at(-1);
    const soundingRest = previous ? note.start - (previous.start + previous.dur) : Number.POSITIVE_INFINITY;
    // A vocal anchor should smooth a genuinely overlapping guitar handoff,
    // but it must not pull a later instrumental phrase into the singer's
    // register after a breath. Resetting on a source change with a modest rest
    // keeps the lead lane near its own raw register and removes the resulting
    // octave flicker without splitting normal fill notes inside a phrase.
    const sourceHandoffRest = Boolean(
      previous?.identitySource
      && note.identitySource
      && previous.identitySource !== note.identitySource
      && soundingRest >= 0.35 - EPS,
    );
    if (!phrase || !previous || soundingRest > 1 || sourceHandoffRest) phrases.push([note]);
    else phrase.push(note);
  }

  const secondsPerBeat = 60 / (Number.isFinite(tempoBpm) && tempoBpm > 0 ? tempoBpm : 120);
  const candidatesFor = (note: Note): number[] => {
    const pitches: number[] = [];
    for (let pitch = note.midi; pitch >= low; pitch -= 12) pitches.push(pitch);
    for (let pitch = note.midi + 12; pitch <= high; pitch += 12) pitches.push(pitch);
    return [...new Set(pitches)].sort((a, b) => a - b);
  };
  const transitionCost = (from: number, to: number, elapsedBeats: number): number => {
    const interval = Math.abs(to - from);
    const elapsedSec = Math.max(0.001, elapsedBeats * secondsPerBeat);
    let cost = interval * 0.03;
    // At song tempos a two-octave jump can fit inside roughly half a second,
    // but it is not a practical single-hand piano motion. Treat one octave
    // as the comfortable ceiling until the phrase has had enough time to
    // move; this also lets octave-equivalent candidates beat raw detector
    // register outliers at vocal/guitar handoffs.
    const comfortable = elapsedSec < 0.12 ? 5 : elapsedSec < 0.2 ? 7 : elapsedSec < 0.35 ? 11 : elapsedSec < 0.65 ? 12 : 19;
    if (interval > comfortable) cost += (interval - comfortable) * 0.8;
    return cost;
  };

  const output: IdentityNote[] = [];
  for (const phrase of phrases) {
    const states = phrase.map(candidatesFor);
    const costs: number[][] = [];
    const parents: number[][] = [];
    for (let index = 0; index < phrase.length; index++) {
      costs[index] = [];
      parents[index] = [];
      for (let candidateIndex = 0; candidateIndex < states[index]!.length; candidateIndex++) {
        const pitch = states[index]![candidateIndex]!;
        const anchorKey = `${phrase[index]!.start.toFixed(6)}:${phrase[index]!.midi}`;
        // Preserve a clearly articulated high landing from the separated lead
        // stem.  Without this anchor the register DP can trade a phrase-end
        // resolution (for example raw MIDI 95) for an octave-lower candidate
        // solely to make the following note cheaper, which erases the very
        // contour we want the learner to hear.  The same velocity/duration
        // gate used by monophonicPath keeps short detector spikes movable.
        const rawHighLanding = phrase[index]!.rawMidi !== undefined
          && phrase[index]!.rawMidi! >= 88
          && (phrase[index]!.vel >= 80 || phrase[index]!.dur >= 0.75);
        const anchored = index === 0 || registerAnchors.has(anchorKey) || rawHighLanding;
        // For non-anchored detector notes, a two-octave register correction is
        // worse than a one-octave correction, not merely twice as costly. A
        // weighted quadratic emission makes the DP prefer the raw practical
        // register over a rapid fifth-sized detour that would then bounce an
        // octave on the next attack, while vocal anchors remain effectively
        // immutable. At a close vocal/instrumental handoff, relax that bias so
        // the new source can still meet the previous anchor within one octave.
        const registerDistance = Math.abs(pitch - phrase[index]!.midi) / 12;
        const sourceChanged = index > 0
          && phrase[index - 1]!.identitySource
          && phrase[index]!.identitySource
          && phrase[index - 1]!.identitySource !== phrase[index]!.identitySource;
        const nonAnchoredWeight = sourceChanged ? 1 : 3;
        const emission = (anchored ? registerDistance : registerDistance ** 2) * (anchored ? 100 : nonAnchoredWeight);
        if (index === 0) {
          costs[index]![candidateIndex] = emission;
          parents[index]![candidateIndex] = -1;
          continue;
        }
        let bestCost = Number.POSITIVE_INFINITY;
        let bestParent = 0;
        const elapsed = phrase[index]!.start - phrase[index - 1]!.start;
        for (let previousIndex = 0; previousIndex < states[index - 1]!.length; previousIndex++) {
          const candidateCost = costs[index - 1]![previousIndex]!
            + emission
            + transitionCost(states[index - 1]![previousIndex]!, pitch, elapsed);
          if (candidateCost < bestCost - EPS) {
            bestCost = candidateCost;
            bestParent = previousIndex;
          }
        }
        costs[index]![candidateIndex] = bestCost;
        parents[index]![candidateIndex] = bestParent;
      }
    }
    const finalCosts = costs.at(-1)!;
    let state = finalCosts.reduce((best, cost, index) => cost < finalCosts[best]! - EPS ? index : best, 0);
    const path = new Array<number>(phrase.length);
    for (let index = phrase.length - 1; index >= 0; index--) {
      path[index] = states[index]![state]!;
      state = parents[index]![state]!;
    }
    output.push(...phrase.map((note, index) => ({ ...note, midi: path[index]! })));
  }
  const stabilized = output.sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  // The dynamic-programming path can still choose an octave-shifted candidate
  // when two adjacent raw pitches sit near the comfort boundary (for example,
  // 64 -> 57 may become 64 -> 69 -> 64). Undo only that small detour when the
  // raw-register travel is at most a few semitones worse; this preserves large
  // handoffs that genuinely need octave revoicing while removing the audible
  // up/down flicker in a single instrumental lane.
  for (let index = 1; index < stabilized.length; index++) {
    const previous = stabilized[index - 1]!;
    const note = stabilized[index]!;
    if (
      note.identitySource === "vocals"
      || previous.identitySource !== note.identitySource
      || note.rawMidi === undefined
    ) continue;
    const rawRegister = toRegister(note.rawMidi, low, high);
    if (Math.abs(note.midi - rawRegister) !== 12) continue;
    const rawTravel = Math.abs(rawRegister - previous.midi);
    const chosenTravel = Math.abs(note.midi - previous.midi);
    if (rawTravel <= chosenTravel + 3) note.midi = rawRegister;
  }
  return stabilized;
}
