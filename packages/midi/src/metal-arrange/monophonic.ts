import type { Note } from "../types.js";
import type { MonophonicCandidate, MonophonicPathOptions, IdentityNote } from "./types.js";
import { EPS, toRegister } from "./shared.js";

function coherentMonophonicPath(
  groups: MonophonicCandidate[][],
  options: MonophonicPathOptions,
  low: number,
  high: number,
): IdentityNote[] {
  if (!groups.length) return [];
  const candidateGroups = groups.map((group) => {
    const maxVelocity = group.reduce((value, note) => Math.max(value, note.vel), 0);
    const upper = options.preferUpperLead
      ? group.filter((note) => note.rawMidi >= 61 && note.vel >= maxVelocity * 0.4)
      : [];
    // Keep the upper contour when it exists, but do not manufacture one when
    // a group contains only low rhythm evidence. The low-wall classifier runs
    // after this path and can then route that evidence to LH.
    return (upper.length ? upper : group)
      .slice()
      .sort((a, b) => a.start - b.start || b.vel - a.vel || b.rawMidi - a.rawMidi);
  });
  const costs: number[][] = [];
  const parents: number[][] = [];
  const candidateEmission = (note: MonophonicCandidate): number => {
    let value = -(note.vel / 24 + Math.min(note.dur, 1.5));
    if (options.preferUpperLead && note.rawMidi >= 72) value -= 2.5;
    if (note.rawMidi >= 88 && (note.vel >= 80 || note.dur >= 0.75)) value -= 2;
    return value;
  };
  const transitionPenalty = (previous: MonophonicCandidate, current: MonophonicCandidate): number => {
    const elapsed = Math.max(0.001, current.start - previous.start);
    const interval = Math.abs(current.midi - previous.midi);
    let value = interval * 0.05;
    if (elapsed <= 0.5 && interval >= 5) value += 1.5 + (interval - 5) * 0.45;
    if (elapsed <= 1 && interval >= 7) value += 2.5;
    if (elapsed <= 1.5 && interval >= 12) value += 3;
    // A true rest is a phrase boundary; do not force a register-continuity
    // decision across it.
    if (elapsed > 1.5) value = 0;
    return value;
  };
  for (let groupIndex = 0; groupIndex < candidateGroups.length; groupIndex++) {
    const group = candidateGroups[groupIndex]!;
    costs[groupIndex] = [];
    parents[groupIndex] = [];
    for (let candidateIndex = 0; candidateIndex < group.length; candidateIndex++) {
      const current = group[candidateIndex]!;
      const emission = candidateEmission(current);
      if (groupIndex === 0) {
        costs[groupIndex]![candidateIndex] = emission;
        parents[groupIndex]![candidateIndex] = -1;
        continue;
      }
      let bestCost = Number.POSITIVE_INFINITY;
      let bestParent = 0;
      for (let previousIndex = 0; previousIndex < candidateGroups[groupIndex - 1]!.length; previousIndex++) {
        const previous = candidateGroups[groupIndex - 1]![previousIndex]!;
        const candidateCost = costs[groupIndex - 1]![previousIndex]!
          + emission
          + transitionPenalty(previous, current);
        if (candidateCost < bestCost - EPS) {
          bestCost = candidateCost;
          bestParent = previousIndex;
        }
      }
      costs[groupIndex]![candidateIndex] = bestCost;
      parents[groupIndex]![candidateIndex] = bestParent;
    }
  }
  const lastCosts = costs.at(-1)!;
  let state = lastCosts.reduce((best, cost, index) => cost < lastCosts[best]! - EPS ? index : best, 0);
  const selected = new Array<MonophonicCandidate>(candidateGroups.length);
  for (let groupIndex = candidateGroups.length - 1; groupIndex >= 0; groupIndex--) {
    selected[groupIndex] = candidateGroups[groupIndex]![state]!;
    state = parents[groupIndex]![state]!;
  }
  const path = selected.map((note, index) => {
    const nextStart = selected[index + 1]?.start;
    return {
      ...note,
      hand: "R" as const,
      dur: Math.max(EPS, Math.min(note.dur, nextStart === undefined ? note.dur : nextStart - note.start)),
    };
  });
  // Retain the old octave-flicker guard for the DP path. A coherent contour
  // should not turn an exact octave detector duplicate into a playable leap,
  // but a deliberate high landing or a real phrase rest remains untouched.
  const exactOctaveWindow = Math.max(0, options.exactOctaveWindow ?? 0.5);
  for (let index = 1; index < path.length; index++) {
    const previous = path[index - 1]!;
    const note = path[index]!;
    const elapsed = note.start - previous.start;
    if (elapsed > exactOctaveWindow + EPS) continue;
    const rawHighLanding = note.rawMidi >= 88 && (note.vel >= 80 || note.dur >= 0.75);
    if (rawHighLanding) continue;
    if (Math.abs(note.midi - previous.midi) === 12) note.midi = previous.midi;
    while (Math.abs(note.midi - previous.midi) > 12 && note.midi > previous.midi && note.midi - 12 >= low) note.midi -= 12;
    while (Math.abs(note.midi - previous.midi) > 12 && note.midi < previous.midi && note.midi + 12 <= high) note.midi += 12;
  }
  return path;
}

/**
 * Reduce polyphonic pitch evidence to one identity voice. The greedy salience
 * pass prefers confident/long attacks, resets continuity after a real rest,
 * and can favor an upper guitar lead over lower accompaniment in the same
 * onset cluster.
 */
export function monophonicPath(
  notes: Note[],
  low: number,
  high: number,
  options: MonophonicPathOptions = {},
): IdentityNote[] {
  const groups: MonophonicCandidate[][] = [];
  for (const note of notes) {
    const normalized: MonophonicCandidate = { ...note, rawMidi: note.midi, midi: toRegister(note.midi, low, high) };
    const last = groups.at(-1);
    if (last && Math.abs(last.at(-1)!.start - normalized.start) <= 0.08 + EPS) last.push(normalized);
    else groups.push([normalized]);
  }

  if (options.coherent) return coherentMonophonicPath(groups, options, low, high);

  let previous: IdentityNote | undefined;
  const selected: IdentityNote[] = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex]!;
    const candidates = group
      .filter((note) => !previous || note.start >= previous.start + Math.min(previous.dur, 0.08) - EPS)
      .map((note) => {
        if (!previous) return note;
        const elapsed = Math.max(0, note.start - previous.start);
        const rest = Math.max(0, note.start - (previous.start + previous.dur));
        const continuityPrevious = rest <= 1 ? previous : undefined;
        let pitch = note.midi;
        // A detector octave-flips guitar/vocal partials surprisingly often.
        // Within a short travel window, fold by octaves toward the previous
        // pitch; never ask the player to jump more than an octave in <=1.5
        // beats merely because the raw stem contained a distant partial.
        if (continuityPrevious && elapsed <= 1.5) {
          // A loud, sustained high landing is the opposite of an octave
          // flicker: it is often the actual lead resolution (the reference
          // arrangement uses landings around MIDI 88-95). Keep that evidence
          // in the upper register so the melody does not lose its phrase end.
          const preserveHighLead = note.rawMidi >= 88
            && (note.vel >= 80 || note.dur >= 0.75);
          // A sufficiently fast exact octave is usually detector harmonic
          // switching, not useful piano articulation. Instrumental lanes use
          // a wider evidence window; vocal lanes keep slower octave contours
          // intact because they are often intentional melody.
          const exactOctaveWindow = Math.max(0, options.exactOctaveWindow ?? 0.5);
          if (!preserveHighLead) {
            if (elapsed <= exactOctaveWindow + EPS && Math.abs(pitch - continuityPrevious.midi) === 12) {
              pitch = continuityPrevious.midi;
            }
            while (Math.abs(pitch - continuityPrevious.midi) > 12 && pitch - continuityPrevious.midi > 0 && pitch - 12 >= low) pitch -= 12;
            while (Math.abs(pitch - continuityPrevious.midi) > 12 && pitch - continuityPrevious.midi < 0 && pitch + 12 <= high) pitch += 12;
          }
        }
        return pitch === note.midi ? note : { ...note, midi: pitch };
      });
    if (!candidates.length) continue;
    const maxVelocity = candidates.reduce((value, note) => Math.max(value, note.vel), 0);
    const upperLeads = options.preferUpperLead
      ? candidates.filter((note) => note.rawMidi >= 60 && note.vel >= maxVelocity * 0.65)
      : [];
    const selectionPool = upperLeads.length
      ? [upperLeads.reduce((highest, note) => note.rawMidi > highest.rawMidi ? note : highest)]
      : candidates;
    const best = selectionPool.reduce((winner, note) => {
      const continuityPrevious = previous && note.start - (previous.start + previous.dur) <= 1 ? previous : undefined;
      const score = note.vel / 16
        + Math.min(note.dur, 2)
        - (continuityPrevious ? Math.abs(note.midi - continuityPrevious.midi) / 7 : 0);
      const winnerScore = winner.vel / 16
        + Math.min(winner.dur, 2)
        - (continuityPrevious ? Math.abs(winner.midi - continuityPrevious.midi) / 7 : 0);
      return score > winnerScore ? note : winner;
    });
    const nextStart = groups[groupIndex + 1]?.[0]?.start;
    const dur = Math.max(EPS, Math.min(best.dur, nextStart === undefined ? best.dur : nextStart - best.start));
    const selectedNote: IdentityNote = { ...best };
    previous = { ...selectedNote, dur, hand: "R" };
    selected.push(previous);
  }
  return selected;
}
