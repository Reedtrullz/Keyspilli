import type { ChordLabel, Note, ParsedMidi } from "./types.js";

export type MetalStemRole = "vocals" | "bass" | "guitar" | "other" | "drums";

export interface MetalStem {
  role: MetalStemRole;
  /** Original separated stem when a routing-compatible role was remapped. */
  sourceStem?: MetalStemRole;
  midi: ParsedMidi;
  /** Optional separator/transcriber confidence in [0, 1]. */
  confidence?: number;
}

export interface MetalArrangementInput {
  stems: MetalStem[];
  sectionBeats?: number;
  harmonyBeats?: number;
  title?: string;
}

export interface MetalIdentitySection {
  startBeat: number;
  endBeat: number;
  source: "vocals" | "guitar" | "other" | "mixed" | "rest";
  confidence: number;
}

export interface MetalArrangementIR {
  version: 1;
  tempoBpm: number;
  timeSig: [number, number];
  durationBeats: number;
  sections: MetalIdentitySection[];
  identity: Note[];
  harmony: ChordLabel[];
  rhythmicAccents: number[];
}

export interface MetalArrangementResult {
  parsed: ParsedMidi;
  chords: ChordLabel[];
  ir: MetalArrangementIR;
  stats: {
    identityNotes: number;
    leftHandNotes: number;
    chordEvents: number;
    sourceSections: Record<string, number>;
  };
  warnings: string[];
}

const EPS = 1e-6;
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function isMetalInstrumentalSource(source: Note["identitySource"]): source is "guitar" | "other" {
  return source === "guitar" || source === "other";
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function beatsPerMeasure(timeSig: [number, number]): number {
  const [numerator, denominator] = timeSig;
  const value = numerator * (4 / denominator);
  return Number.isFinite(value) && value > 0 ? value : 4;
}

function toRegister(midi: number, low: number, high: number): number {
  let pitch = Math.round(midi);
  while (pitch < low) pitch += 12;
  while (pitch > high) pitch -= 12;
  return clamp(pitch, low, high);
}

function validNotes(stem: MetalStem | undefined): Note[] {
  if (!stem) return [];
  return stem.midi.notes
    .filter((note) => Number.isFinite(note.start) && Number.isFinite(note.dur) && note.dur > 0 && note.midi >= 0 && note.midi <= 127)
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
}

interface MonophonicPathOptions {
  /** Prefer a plausible upper lead tone over lower rhythm/accompaniment bleed. */
  preferUpperLead?: boolean;
  /** Maximum beat distance for treating an exact octave as detector flicker. */
  exactOctaveWindow?: number;
  /** Use a phrase-local contour DP instead of selecting each onset greedily. */
  coherent?: boolean;
}

/** Internal source pitch retained until boundary cleanup is complete. */
type IdentityNote = Note & { rawMidi?: number };

type MonophonicCandidate = IdentityNote & { rawMidi: number };

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
function monophonicPath(
  notes: Note[],
  low: number,
  high: number,
  options: MonophonicPathOptions = {},
): IdentityNote[] {
  const groups: MonophonicCandidate[][] = [];
  for (const note of notes) {
    const normalized: MonophonicCandidate = { ...note, rawMidi: note.midi, midi: toRegister(note.midi, low, high) };
    const last = groups.at(-1);
    if (last && Math.abs(last[0]!.start - normalized.start) <= 0.08) last.push(normalized);
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

/**
 * A separated guitar stem often contains the rhythm guitar's low power-chord
 * pulse as a single repeated pitch. Once the stem has been reduced to one
 * note per onset, that pulse is indistinguishable from a lead line unless we
 * remove the repeated wall before vocal/guitar fusion. Keep a strong, sparse
 * phrase anchor, but leave any higher-register contour untouched.
 * Short runs and runs with a real pitch contour are deliberately preserved so
 * a genuinely low guitar melody is not erased.
 */
interface GuitarPulseLanes {
  lead: IdentityNote[];
  rhythm: IdentityNote[];
}

/**
 * Keep quiet upper detector events only when they have local support. A lone,
 * very short spike is usually bleed/reverb and can otherwise become a fake
 * RH melody after octave registration. Sustained or strongly articulated
 * notes remain eligible as phrase landings even when they are isolated.
 */
function supportedUpperRawNotes(notes: Note[]): Note[] {
  const upper = notes.filter((note) => note.midi >= 61);
  return upper.filter((note) => note.vel >= 48 || note.dur >= 0.2 || upper.some((candidate) =>
    candidate !== note && Math.abs(candidate.start - note.start) <= 2 + EPS,
  ));
}

/**
 * Preserve detector notes below the RH register before octave registration can
 * turn them into a fake melody (raw 29/41 both become 65 in the RH window).
 * One representative attack per onset is enough for the LH rhythm lane; the
 * lead path is built from notes at or above MIDI 55 separately.
 */
function rawLowRhythmEvents(
  notes: Note[],
  source: "guitar" | "other",
  upperContext: IdentityNote[],
): IdentityNote[] {
  const upper = upperContext.filter((candidate) => (candidate.rawMidi ?? candidate.midi) >= 61);
  const lowNotes = notes
    .filter((note) => note.midi <= 60)
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  const sameOnset = (left: Note, right: Note): boolean => Math.abs(left.start - right.start) <= 0.08 + EPS;
  const upperNear = (note: Note): Note[] => upper.filter((candidate) => Math.abs(candidate.start - note.start) <= 4 + EPS);
  const localLow = (note: Note): Note[] => lowNotes.filter((candidate) => Math.abs(candidate.start - note.start) <= 2 + EPS);
  const routeLow = (note: Note): boolean => {
    // Detector sub-bass notes cannot be a useful RH melody after registration.
    // Keep the long-standing unconditional floor for the very low octave;
    // MIDI 45–54 is also a valid low-register motif in sparse, low-only
    // fixtures, so route that band only when there is credible upper context
    // showing that it is accompaniment rather than the sole melody evidence.
    if (note.midi < 45) return true;
    // Two low pitches at one onset are a power-chord/root cluster, even when
    // the lead detector did not return an upper note for that attack. Route
    // the cluster together so the louder root cannot octave-fold into RH
    // while its quieter companion silently disappears.
    if (lowNotes.some((candidate) => candidate !== note && sameOnset(candidate, note))) return true;
    const nearbyUpper = upperNear(note);
    // A simultaneous upper attack is strong evidence that this is the power
    // root/accompaniment voice, even when the root is quieter than the lead.
    if (nearbyUpper.some((candidate) => sameOnset(candidate, note))) return true;
    const local = localLow(note);
    const localPitches = local.map((candidate) => candidate.midi);
    const localGaps = local.slice(1)
      .map((candidate, index) => candidate.start - local[index]!.start)
      .filter((gap) => gap > EPS)
      .sort((a, b) => a - b);
    const medianLocalGap = localGaps.length
      ? localGaps[Math.floor(localGaps.length / 2)]!
      : Number.POSITIVE_INFINITY;
    const localSpan = (local.at(-1)?.start ?? note.start) - (local[0]?.start ?? note.start);
    const localDensity = local.length >= 2 && localSpan > EPS ? local.length / localSpan : 0;
    const localDeltas = local.slice(1).map((candidate, index) => candidate.midi - local[index]!.midi);
    let longestMonotonicSteps = 0;
    let monotonicSteps = 0;
    let previousDirection = 0;
    for (const delta of localDeltas) {
      const direction = Math.sign(delta);
      if (direction !== 0 && direction === previousDirection) monotonicSteps += 1;
      else monotonicSteps = direction === 0 ? 0 : 1;
      longestMonotonicSteps = Math.max(longestMonotonicSteps, monotonicSteps);
      previousDirection = direction;
    }
    // Use a wider contour window than the wall statistics.  The edge of a
    // phrase can have only two local pitches (for example the final 50→52),
    // while the preceding four-beat context still makes the moving contour
    // unambiguous.  Looking beyond the ±2-beat wall window prevents an
    // unrelated upper attack near that edge from routing the tail into LH.
    const noteIndex = lowNotes.indexOf(note);
    const contourWindow: Note[] = [note];
    // Keep the contour context connected.  A later phrase separated by a
    // one-and-a-half-beat rest must not make the first two notes of a sparse
    // low phrase look like a moving melody merely because an upper event is
    // nearby.  Detector contours normally have <=1-beat inter-onset gaps;
    // larger gaps are treated as phrase boundaries for this exception.
    for (let index = noteIndex - 1; index >= 0; index -= 1) {
      const candidate = lowNotes[index]!;
      const next = lowNotes[index + 1]!;
      if (note.start - candidate.start > 4 + EPS || next.start - candidate.start > 1.25 + EPS) break;
      contourWindow.unshift(candidate);
    }
    for (let index = noteIndex + 1; index < lowNotes.length; index += 1) {
      const candidate = lowNotes[index]!;
      const previous = lowNotes[index - 1]!;
      if (candidate.start - note.start > 4 + EPS || candidate.start - previous.start > 1.25 + EPS) break;
      contourWindow.push(candidate);
    }
    const contourPitches = contourWindow.map((candidate) => candidate.midi);
    let contourLongestMonotonicSteps = 0;
    let contourMonotonicSteps = 0;
    let contourPreviousDirection = 0;
    for (let index = 1; index < contourPitches.length; index += 1) {
      const direction = Math.sign(contourPitches[index]! - contourPitches[index - 1]!);
      if (direction !== 0 && direction === contourPreviousDirection) contourMonotonicSteps += 1;
      else contourMonotonicSteps = direction === 0 ? 0 : 1;
      contourLongestMonotonicSteps = Math.max(contourLongestMonotonicSteps, contourMonotonicSteps);
      contourPreviousDirection = direction;
    }
    const clearLowContour = contourWindow.length >= 4
      && new Set(contourPitches).size >= 3
      && contourLongestMonotonicSteps >= 2;
    // A raw 45–54 detector partial can octave-fold into a false RH note
    // (e.g. 52 -> 64). Only make that routing decision when an upper event in
    // the same local phrase proves that a separate lead exists. A moving
    // low-register contour is an exception: its changing pitches and directed
    // steps are useful melody evidence even when an unrelated upper event is
    // nearby. Low-only phrases remain eligible for the historical
    // register-continuity path.
    if (note.midi < 55 && nearbyUpper.length > 0 && !clearLowContour) return true;
    const dominantLocalPitchRatio = local.length
      ? Math.max(...localPitches.map((pitch) => localPitches.filter((value) => value === pitch).length)) / local.length
      : 0;
    // A source-local repeated wall should still be routed when the other
    // stem has no credible upper evidence. Otherwise filtering an unrelated
    // quiet spike out of `upperContext` would let a raw 45/57 wall octave-fold
    // back into RH. Require a dominant pitch and preserve clear monotonic
    // contours so moving low motifs remain eligible melody candidates.
    const sourceLocalRepeatedWall = local.length >= 4
      && dominantLocalPitchRatio >= 0.75
      && medianLocalGap <= 0.75 + EPS
      && local.every((candidate) => candidate.dur <= 0.75 + EPS)
      && !(new Set(localPitches).size >= 3 && longestMonotonicSteps >= 3);
    if (sourceLocalRepeatedWall) return true;
    // Dense alternating power-root fragments can span more than the old
    // five-semitone run key (detector octave choices commonly add another
    // octave). Treat them as rhythm when they lack a sustained monotonic
    // contour; sparse or clearly ascending/descending low hooks remain RH
    // candidates. This runs before octave registration so raw 50–60 notes do
    // not become a scattered 62–72 melody.
    const denseAlternatingLowWall = !clearLowContour && nearbyUpper.length > 0
      && (() => {
        // Use a wider diagnostic window for the first attack of a wall. The
        // detector may report octave/partial changes greater than five
        // semitones, which split the old run before the repeated rhythm is
        // visible; a four-beat neighbourhood recovers that context without
        // changing the selected note's onset.
        const wallWindow = lowNotes.filter((candidate) => Math.abs(candidate.start - note.start) <= 4 + EPS);
        if (wallWindow.length < 6) return false;
        const wallGaps = wallWindow.slice(1)
          .map((candidate, index) => candidate.start - wallWindow[index]!.start)
          .filter((gap) => gap > EPS)
          .sort((a, b) => a - b);
        const wallSpan = wallWindow.at(-1)!.start - wallWindow[0]!.start;
        const wallDensity = wallSpan > EPS ? wallWindow.length / wallSpan : 0;
        const wallPitches = wallWindow.map((candidate) => candidate.midi);
        const wallDeltas = wallWindow.slice(1).map((candidate, index) => candidate.midi - wallWindow[index]!.midi);
        let wallLongestMonotonic = 0;
        let wallMonotonic = 0;
        let wallPreviousDirection = 0;
        for (const delta of wallDeltas) {
          const direction = Math.sign(delta);
          if (direction !== 0 && direction === wallPreviousDirection) wallMonotonic += 1;
          else wallMonotonic = direction === 0 ? 0 : 1;
          wallLongestMonotonic = Math.max(wallLongestMonotonic, wallMonotonic);
          wallPreviousDirection = direction;
        }
        return wallGaps.length > 0
          && wallGaps[Math.floor(wallGaps.length / 2)]! <= 0.75 + EPS
          && wallDensity >= 1.25
          && Math.max(...wallPitches) - Math.min(...wallPitches) <= 24
          && wallLongestMonotonic < 3;
      })();
    if (denseAlternatingLowWall) return true;
    if (!clearLowContour && nearbyUpper.length === 1) {
      const medianGap = medianLocalGap;
      // One isolated upper spike still identifies a dense, stable low wall;
      // keep that wall in LH while the unsupported spike is discarded from
      // the lead candidates below.
      if (local.length >= 3 && new Set(localPitches).size <= 2 && medianGap <= 1 + EPS) return true;
    }
    if (nearbyUpper.length < 2) return false;
    // Preserve a sparse low motif, but route a locally dense low wall when an
    // upper lane is present. This catches raw 50–57 attacks that would
    // otherwise octave-fold into a fake RH 62–69 melody.
    // A low line with a real changing contour is still plausible melody even
    // when an upper lane is active. Preserve it before applying density-based
    // rhythm classification.
    if (new Set(localPitches).size >= 3) return false;
    return note.dur <= 0.75 + EPS && (medianLocalGap <= 1 + EPS || localDensity >= 1);
  };
  const low = notes
    .filter((note) => note.midi <= 60 && routeLow(note))
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  const selected: IdentityNote[] = [];
  for (const note of low) {
    const previous = selected.at(-1);
    if (previous && Math.abs(previous.start - note.start) <= 0.08) continue;
    selected.push({
      ...note,
      rawMidi: note.midi,
      midi: toRegister(note.midi, 36, 54),
      hand: "L",
      identitySource: source,
    });
  }
  return selected;
}

function suppressLowGuitarPulseRuns(notes: IdentityNote[], externalLeadContext: IdentityNote[] = []): GuitarPulseLanes {
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  const leadContext = [...sorted, ...externalLeadContext];
  // Keep raw/registered MIDI 61–62 available for upper hooks; the reference
  // opening deliberately repeats MIDI 62 as melody rather than accompaniment.
  const lowMaxMidi = 60;
  // Keep the original registered-pitch pulse gate narrow. Re-registered raw
  // lows (which may be an octave above this threshold after continuity
  // folding) are handled by the separate detector below.
  // Stem extraction can miss several pulse attacks, so a rhythm run may have
  // bar-sized gaps even though it repeats the same low pitch throughout.
  const maxInterAttackBeats = 4.5;
  const minRunLength = 4;
  const anchorSpacingBeats = 4;
  const lowNotes = sorted.filter((note) =>
    (note.identitySource === "guitar" || note.identitySource === "other")
      && note.midi <= lowMaxMidi
      && (note.rawMidi ?? note.midi) <= lowMaxMidi,
  );
  const retainedLowNotes = new Set<IdentityNote>();
  const suppressedPulseNotes = new Set<IdentityNote>();
  const rhythmLowNotes = new Set<IdentityNote>();

  let index = 0;
  while (index < lowNotes.length) {
    const first = lowNotes[index]!;
    const run = [first];
    let cursor = index + 1;
    while (cursor < lowNotes.length) {
      const note = lowNotes[cursor]!;
      const previous = run.at(-1)!;
      if (
        note.identitySource !== first.identitySource
        || note.midi > lowMaxMidi
        || Math.abs(note.midi - first.midi) > 5
        || note.start - previous.start > maxInterAttackBeats + EPS
      ) break;
      run.push(note);
      cursor += 1;
    }
    const pitchCounts = new Map<number, number>();
    for (const note of run) pitchCounts.set(note.midi, (pitchCounts.get(note.midi) ?? 0) + 1);
    const maxRepeatedPitch = Math.max(...pitchCounts.values());
    const pitchDeltas = run.slice(1).map((note, deltaIndex) => note.midi - run[deltaIndex]!.midi);
    const absolutePitchDeltas = pitchDeltas.map((delta) => Math.abs(delta)).sort((a, b) => a - b);
    const medianAbsPitchDelta = absolutePitchDeltas.length
      ? absolutePitchDeltas[Math.floor(absolutePitchDeltas.length / 2)]!
      : 0;
    let longestMonotonicSteps = 0;
    let monotonicSteps = 0;
    let previousDirection = 0;
    for (const delta of pitchDeltas) {
      const direction = Math.sign(delta);
      if (direction !== 0 && direction === previousDirection) monotonicSteps += 1;
      else monotonicSteps = direction === 0 ? 0 : 1;
      longestMonotonicSteps = Math.max(longestMonotonicSteps, monotonicSteps);
      previousDirection = direction;
    }
    const dominantPitchRatio = maxRepeatedPitch / run.length;
    const repeatedAttackRatio = run.length > 1
      ? pitchDeltas.filter((delta) => delta === 0).length / pitchDeltas.length
      : 1;
    const interAttackBeats = run.slice(1)
      .map((note, runIndex) => note.start - run[runIndex]!.start)
      .filter((gap) => Number.isFinite(gap) && gap > EPS)
      .sort((a, b) => a - b);
    const medianInterAttackBeats = interAttackBeats.length
      ? interAttackBeats[Math.floor(interAttackBeats.length / 2)]!
      : Number.POSITIVE_INFINITY;
    const hasLeadContext = leadContext.some((candidate) =>
      (candidate.identitySource === first.identitySource
        || ((candidate.identitySource === "guitar" || candidate.identitySource === "other")
          && (first.identitySource === "guitar" || first.identitySource === "other")))
      // MIDI 64 is high enough to count as upper harmonic evidence while
      // still leaving raw 55–62 melodic contours alone when no upper lane is
      // present. This matters for sparse hooks whose detector velocity is
      // much quieter than the palm-muted root.
      && (candidate.rawMidi ?? candidate.midi) >= 61
      && candidate.start >= first.start - 4 - EPS
      && candidate.start <= run.at(-1)!.start + 4 + EPS,
    );
    // A real low lead may revisit its tonic several times while still making
    // a clear three-note contour. Require a stable, low-variation run and a
    // high dominant-pitch ratio (or a long wall) before calling it rhythm.
    const hasClearContour = longestMonotonicSteps >= 3;
    const stableLowPulse = hasLeadContext
      && medianAbsPitchDelta <= 2
      && !hasClearContour
      // A repeated low pitch that only appears every few beats is a sparse
      // melodic anchor, not a palm-muted wall. Allow a one-beat pulse (common
      // in half-time metal riffs), but keep wider phrase anchors in RH.
      && medianInterAttackBeats <= 1 + EPS
      && (
        dominantPitchRatio >= 0.6
        || (run.length >= 16 && dominantPitchRatio >= 0.3 && repeatedAttackRatio >= 0.25)
      );
    const pulseLike = run.length >= minRunLength && stableLowPulse;
    if (run.length < minRunLength || !pulseLike) {
      run.forEach((note) => retainedLowNotes.add(note));
    } else {
      // A stable wall is accompaniment evidence, not a RH melody. Keep the
      // complete low subsequence in a separate lane so the piano arrangement
      // can preserve its pulse without making the learner's melody jump
      // between an upper lead and repeated low detector partials.
      run.forEach((note) => {
        rhythmLowNotes.add(note);
        suppressedPulseNotes.add(note);
      });
      for (let windowStart = run[0]!.start; windowStart <= run.at(-1)!.start + EPS; windowStart += anchorSpacingBeats) {
        const windowEnd = windowStart + anchorSpacingBeats;
        const candidates = run.filter((note) => note.start >= windowStart - EPS && note.start < windowEnd - EPS);
        if (!candidates.length) continue;
        // A first/strong downbeat is a more useful rhythmic hint than the
        // weakest detector fragment at the start of a run. Prefer dynamics,
        // then a higher shell tone, then an onset close to the beat grid.
        const anchor = candidates.reduce((winner, note) => {
          const winnerGridDistance = Math.abs(winner.start - Math.round(winner.start));
          const noteGridDistance = Math.abs(note.start - Math.round(note.start));
          return note.vel > winner.vel
            || (note.vel === winner.vel && note.midi > winner.midi)
            || (note.vel === winner.vel && note.midi === winner.midi && noteGridDistance < winnerGridDistance - EPS)
            || (note.vel === winner.vel && note.midi === winner.midi && Math.abs(note.start - Math.round(note.start)) <= winnerGridDistance + EPS && note.start < winner.start)
            ? note
            : winner;
        });
        // Retained as an accompaniment anchor below; do not put it back into
        // the RH identity lane. `rhythmLowNotes` remains complete for the
        // advanced source and is reduced by the normal learner LH passes.
        rhythmLowNotes.add(anchor);
      }
    }
    index += run.length;
  }
  // `monophonicPath` may octave-register a raw low partial toward the active
  // lead before the pulse classifier runs (for example raw MIDI 57 becomes
  // registered MIDI 69 after a lead at MIDI 72). Inspect this re-registered
  // subset separately, but require a genuinely repeated raw pitch so a real
  // low contour is not mistaken for accompaniment.
  const reRegisteredLow = sorted.filter((note) =>
    (note.identitySource === "guitar" || note.identitySource === "other")
      && (note.rawMidi ?? note.midi) <= lowMaxMidi
      && note.midi > lowMaxMidi,
  );
  let rawIndex = 0;
  while (rawIndex < reRegisteredLow.length) {
    const first = reRegisteredLow[rawIndex]!;
    const firstRaw = first.rawMidi ?? first.midi;
    const run = [first];
    let cursor = rawIndex + 1;
    while (cursor < reRegisteredLow.length) {
      const note = reRegisteredLow[cursor]!;
      const previous = run.at(-1)!;
      const rawPitch = note.rawMidi ?? note.midi;
      if (
        note.identitySource !== first.identitySource
        || Math.abs(rawPitch - firstRaw) > 2
        || note.start - previous.start > maxInterAttackBeats + EPS
      ) break;
      run.push(note);
      cursor += 1;
    }
    const repeatedRawRatio = run.length > 1
      ? run.filter((note) => (note.rawMidi ?? note.midi) === firstRaw).length / run.length
      : 1;
    if (run.length >= minRunLength && repeatedRawRatio >= 0.75) {
      run.forEach((note) => {
        rhythmLowNotes.add(note);
        suppressedPulseNotes.add(note);
      });
    }
    rawIndex += run.length;
  }
  // Classify the low-note subsequence independently of high lead attacks.
  // A solo landing interleaved with a rhythm wall must not reset the wall;
  // Retain all high notes and genuine low contours in the lead lane. Stable
  // low walls are returned separately for explicit LH accompaniment routing.
  return {
    lead: sorted.filter((note) => !suppressedPulseNotes.has(note)
      && ((note.rawMidi ?? note.midi) > lowMaxMidi || note.midi > lowMaxMidi || retainedLowNotes.has(note))),
    rhythm: sorted.filter((note) => rhythmLowNotes.has(note)),
  };
}

/**
 * Basic Pitch can leak sparse guitar/reverb events into the vocal stem. Only
 * let vocals displace an active guitar lead when they form a compact moving
 * phrase. Isolated vocal events are used only when there is no usable
 * instrumental identity in the window.
 */
function trustworthyVocalNotes(notes: Note[]): Note[] {
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
function filterLowVocalDroneNotes(notes: Note[]): Note[] {
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

function notesIn<T extends Note>(notes: T[], start: number, end: number): T[] {
  return notes.filter((note) => note.start >= start - EPS && note.start < end - EPS);
}

function sourceConfidence(notes: Note[], start: number, end: number, stemConfidence = 1): number {
  const attacks = notesIn(notes, start, end).length;
  const expected = Math.max(1, (end - start) / 2);
  return clamp((attacks / expected) * stemConfidence, 0, 1);
}

function isUpperGuitarRhythmWall(notes: Note[]): boolean {
  const evidence = notes.slice().sort((a, b) => a.start - b.start || b.vel - a.vel);
  if (evidence.length < 4 || evidence[0]?.identitySource !== "guitar") return false;
  const upperRatio = evidence.filter((note) => note.midi >= 64).length / evidence.length;
  const repeatedRatio = evidence.length > 1
    ? evidence.slice(1).filter((note, index) => note.midi === evidence[index]!.midi).length / (evidence.length - 1)
    : 1;
  const distinctPitches = new Set(evidence.map((note) => note.midi)).size;
  const gaps = evidence.slice(1)
    .map((note, index) => note.start - evidence[index]!.start)
    .filter((gap) => gap > EPS)
    .sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : Number.POSITIVE_INFINITY;
  const attackDensity = evidence.length / Math.max(0.5, evidence.at(-1)!.start - evidence[0]!.start);
  return upperRatio >= 0.8
    && distinctPitches <= 2
    && repeatedRatio >= 0.75
    && medianGap <= 0.75 + EPS
    && attackDensity >= 1.5 - EPS;
}

/**
 * Estimate whether an instrumental lane behaves like a playable melody. Raw
 * attack density is useful for routing, but it rewards a loud palm-muted wall
 * and detector zig-zag more than a sparse, connected lead. Keep this score
 * deliberately explainable: register, continuity, dynamics, and density are
 * evidence only; the phrase decoder still makes the final choice.
 */
function melodicConfidence(notes: Note[], start: number, end: number, stemConfidence = 1): number {
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

interface UpperEvidenceLane {
  source: "guitar" | "other";
  notes: IdentityNote[];
}

/**
 * Keep a second, upper-only view of each separated lane. Basic Pitch can pick
 * a loud low guitar partial at an onset and omit a much quieter lead tone from
 * the one-note path. This view is deliberately conservative: it reuses only
 * notes already present in the stem, chooses one connected contour per onset,
 * and is used only to fill genuinely sparse phrases.
 */
function upperHarmonicPath(notes: Note[], source: UpperEvidenceLane["source"]): IdentityNote[] {
  const upper = supportedUpperRawNotes(notes);
  return monophonicPath(upper, 55, 96, { exactOctaveWindow: 1, coherent: true })
    .map((note) => ({ ...note, identitySource: source }));
}

/**
 * Recover a regular, evidence-backed contour when a residual phrase has
 * enough raw coverage but the first monophonic pass selected a sparse set of
 * detector onsets. This is intentionally restricted to the residual lane:
 * dedicated guitar and Advanced/source detail keep their richer paths. The
 * decoder selects existing raw notes only; it does not quantize or synthesize
 * attacks. A small dynamic program prefers one credible event per beat while
 * penalizing quiet short spikes and abrupt neighbouring leaps.
 */
function regularizeSparseResidualPhrase(
  phrase: IdentityNote[],
  rawUpper: Note[],
  source: UpperEvidenceLane["source"],
): IdentityNote[] | undefined {
  if (source !== "other" || phrase.length < 4) return undefined;
  const phraseStart = phrase[0]!.start;
  const phraseEnd = phrase.at(-1)!.start;
  const span = phraseEnd - phraseStart;
  if (!Number.isFinite(span) || span < 4) return undefined;
  const baseDensity = phrase.length / Math.max(1, span);
  // Dense authored/solo evidence already has enough attacks for the normal
  // contour scheduler. Only regularize a collapsed residual phrase whose
  // selected path is substantially sparse. This pass is deliberately kept
  // out of the dense residual/solo path; it is a recovery step for a line
  // that has fallen below roughly one supported attack per beat.
  // A phrase that already has roughly one attack per beat does not need a
  // second pass. Keeping this threshold tight is important: the helper runs
  // before the learner ladder, so regularizing a denser phrase would also
  // erase Advanced/source detail without recovering anything useful.
  if (baseDensity > 1.1 + EPS) return undefined;

  const candidates = rawUpper
    .filter((note) => note.midi >= 61
      && note.start >= phraseStart - 0.46 - EPS
      && note.start <= phraseEnd + 0.46 + EPS)
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.dur - a.dur || b.midi - a.midi);
  if (candidates.length < 4) return undefined;
  const rawStarts = candidates.reduce<number[]>((starts, note) => {
    if (!starts.length || note.start - starts.at(-1)! > 0.08 + EPS) starts.push(note.start);
    return starts;
  }, []);
  const rawDensity = rawStarts.length / Math.max(1, span);
  if (rawDensity < 2.5) return undefined;
  // A residual stream above roughly four attacks/beat is usually a dense
  // accompaniment/solo texture rather than a collapsed beat-level melody.
  // Leave it to the normal contour scheduler so this recovery pass cannot
  // flatten authored detail.
  if (rawDensity > 4.5 + EPS) return undefined;

  const bucketCount = Math.max(1, Math.floor(span + EPS) + 1);
  const buckets = new Map<number, Note[]>();
  for (const note of candidates) {
    const bucket = Math.round(note.start - phraseStart);
    if (bucket < 0 || bucket >= bucketCount) continue;
    const entries = buckets.get(bucket) ?? [];
    entries.push(note);
    buckets.set(bucket, entries);
  }
  const covered = [...buckets.keys()].length;
  if (covered < Math.max(4, Math.ceil(bucketCount * 0.65))) return undefined;

  const candidateBuckets = [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucket, entries]) => ({
      bucket,
      entries: entries
        .filter((note) => note.vel >= 56 || note.dur >= 0.3
          || (note.midi >= 88 && (note.vel >= 80 || note.dur >= 0.75)))
        .map((note) => ({
          ...note,
          midi: toRegister(note.midi, 55, 96),
          rawMidi: note.midi,
          hand: "R" as const,
          identitySource: source,
        }))
        .sort((a, b) => a.start - b.start || b.vel - a.vel || b.dur - a.dur || b.rawMidi - a.rawMidi),
    }))
    .filter((bucket) => bucket.entries.length > 0);
  if (candidateBuckets.length < Math.max(4, Math.ceil(bucketCount * 0.65))) return undefined;
  const distinctPitches = new Set(candidateBuckets.flatMap((bucket) => bucket.entries.map((note) => note.midi)));
  if (distinctPitches.size < 3) return undefined;
  const credibleCandidates = candidates.filter((note) => note.vel >= 56 || note.dur >= 0.3);
  const moderateRegisterRatio = credibleCandidates.length
    ? credibleCandidates.filter((note) => note.midi >= 61 && note.midi <= 71).length / credibleCandidates.length
    : 0;
  const preferModerateRegister = moderateRegisterRatio >= 0.35;

  const score = (note: IdentityNote, bucket: number): number => {
    const gridDistance = Math.abs(note.start - (phraseStart + bucket));
    const gridFit = Math.max(0, 1 - Math.min(1, gridDistance / 0.46));
    const dynamic = clamp(note.vel / 127, 0, 1);
    const duration = clamp(note.dur / 0.35, 0, 1);
    const weakSpike = note.vel < 56 && note.dur < 0.3;
    const rawMidi = note.rawMidi ?? note.midi;
    const rawHighLanding = rawMidi >= 88 && (note.vel >= 80 || note.dur >= 0.75);
    const highPartialPenalty = preferModerateRegister && rawMidi >= 72 && !rawHighLanding
      ? 1.1 + (note.vel < 64 && note.dur < 0.5 ? 0.7 : 0)
      : 0;
    return gridFit * 1.5 + dynamic * 1.1 + duration * 1.4
      - (weakSpike ? 1.5 : 0)
      - highPartialPenalty;
  };
  const transition = (previous: IdentityNote, current: IdentityNote): number => {
    const gap = current.start - previous.start;
    const leap = Math.abs(current.midi - previous.midi);
    let value = leap * 0.06;
    if (gap <= 1.1 + EPS && leap >= 7) value += 1.5 + (leap - 7) * 0.25;
    if (gap <= 1.5 + EPS && leap >= 12) value += 2;
    return value;
  };

  const best: number[][] = [];
  const parents: number[][] = [];
  for (let bucketIndex = 0; bucketIndex < candidateBuckets.length; bucketIndex++) {
    const group = candidateBuckets[bucketIndex]!;
    best[bucketIndex] = [];
    parents[bucketIndex] = [];
    for (let candidateIndex = 0; candidateIndex < group.entries.length; candidateIndex++) {
      const note = group.entries[candidateIndex]!;
      const emission = score(note, group.bucket);
      if (bucketIndex === 0) {
        best[bucketIndex]![candidateIndex] = emission;
        parents[bucketIndex]![candidateIndex] = -1;
        continue;
      }
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestParent = 0;
      for (let previousIndex = 0; previousIndex < candidateBuckets[bucketIndex - 1]!.entries.length; previousIndex++) {
        const previous = candidateBuckets[bucketIndex - 1]!.entries[previousIndex]!;
        const candidateScore = best[bucketIndex - 1]![previousIndex]!
          + emission
          - transition(previous, note);
        if (candidateScore > bestScore + EPS) {
          bestScore = candidateScore;
          bestParent = previousIndex;
        }
      }
      best[bucketIndex]![candidateIndex] = bestScore;
      parents[bucketIndex]![candidateIndex] = bestParent;
    }
  }
  const finalScores = best.at(-1)!;
  let state = finalScores.reduce((winner, value, index) => value > finalScores[winner]! + EPS ? index : winner, 0);
  const selected = new Array<IdentityNote>(candidateBuckets.length);
  for (let bucketIndex = candidateBuckets.length - 1; bucketIndex >= 0; bucketIndex--) {
    selected[bucketIndex] = { ...candidateBuckets[bucketIndex]!.entries[state]! };
    state = parents[bucketIndex]![state]!;
  }
  return selected;
}

/**
 * Decode a residual/full-mix upper stem before it reaches identity fusion.
 * `coherentMonophonicPath` intentionally keeps one event per detector onset;
 * that is useful for an authored lead but makes a residual stem's chord
 * partials look like a second melody.  This bounded weighted interval pass
 * keeps the richer candidates that are well-aligned, sustained, and
 * stepwise, while allowing a denser phrase (such as a solo) to retain a
 * half-beat contour.  It never creates pitches: every returned note is a
 * copied upper-stem event.
 */
function selectResidualUpperMelodyPath(notes: Note[], source: UpperEvidenceLane["source"]): IdentityNote[] {
  const upper = supportedUpperRawNotes(notes)
    .filter((note) => note.midi >= 61)
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.dur - a.dur);
  const base = upperHarmonicPath(upper, source);
  if (base.length < 4) return base;

  const phrases: IdentityNote[][] = [];
  for (const note of base) {
    const phrase = phrases.at(-1);
    const previous = phrase?.at(-1);
    // Residual stems often lose several attacks at a phrase seam. Keep a
    // little more temporal context than the guitar path so two short bursts
    // separated by a detector gap are decoded as one playable contour rather
    // than bypassing the spacing scheduler as independent tiny phrases.
    if (!phrase || !previous || note.start - previous.start > 3 + EPS
      || note.start - phrase[0]!.start > 32 + EPS) phrases.push([note]);
    else phrase.push(note);
  }

  const selectedBase: IdentityNote[] = [];
  for (const phrase of phrases) {
    if (phrase.length <= 3) {
      selectedBase.push(...phrase.map((note) => ({ ...note })));
      continue;
    }
    const span = Math.max(1, phrase.at(-1)!.start - phrase[0]!.start);
    const density = phrase.length / span;
    const gaps = phrase.slice(1)
      .map((note, index) => note.start - phrase[index]!.start)
      .filter((gap) => gap > EPS)
      .sort((a, b) => a - b);
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : Number.POSITIVE_INFINITY;
    const intervals = phrase.slice(1).map((note, index) => Math.abs(note.midi - phrase[index]!.midi));
    const largeLeapRatio = intervals.length
      ? intervals.filter((interval) => interval >= 7).length / intervals.length
      : 0;
    // A residual phrase below roughly two attacks/beat can still be a useful
    // authored lead (the coherent-other fallback uses ~0.75-beat attacks).
    // Only impose a one-beat floor when its timing/contour also looks like
    // detector jitter; genuinely dense lead evidence keeps the half-beat
    // contour floor.
    const jitterLike = medianGap < 0.7 - EPS || largeLeapRatio >= 0.35;
    const minimumSpacing = density >= 2 ? 0.5 : jitterLike ? 1 : 0.75;
    const weights = phrase.map((note, index) => {
      const previous = phrase[index - 1];
      const next = phrase[index + 1];
      const gridDistance = Math.abs(note.start * 4 - Math.round(note.start * 4)) / 4;
      const gridBonus = Math.max(0, 1 - Math.min(1, gridDistance / 0.125)) * 1.25;
      const shortPenalty = note.dur < 0.15 && note.vel < 64 ? 1.4 : 0;
      const localStep = previous && next
        && Math.abs(note.midi - previous.midi) <= 5
        && Math.abs(next.midi - note.midi) <= 5;
      const localPeak = previous && next
        && (note.midi > previous.midi && note.midi > next.midi
          || note.midi < previous.midi && note.midi < next.midi);
      const endpoint = index === 0 || index === phrase.length - 1;
      const rawHighLanding = (note.rawMidi ?? note.midi) >= 88
        && (note.vel >= 80 || note.dur >= 0.75);
      return 1
        + Math.min(note.dur, 0.75) * 2
        + clamp(note.vel / 127, 0, 1) * 1.2
        + gridBonus
        + (localStep ? 0.9 : 0)
        + (localPeak ? 0.25 : 0)
        + (endpoint ? 2.5 : 0)
        + (rawHighLanding ? 4 : 0)
        - shortPenalty;
    });
    const best = new Array<number>(phrase.length).fill(Number.NEGATIVE_INFINITY);
    const parent = new Array<number>(phrase.length).fill(-1);
    for (let index = 0; index < phrase.length; index++) {
      const current = phrase[index]!;
      best[index] = weights[index]!;
      for (let previousIndex = 0; previousIndex < index; previousIndex++) {
        const previous = phrase[previousIndex]!;
        const gap = current.start - previous.start;
        if (gap < minimumSpacing - EPS) continue;
        const leap = Math.abs(current.midi - previous.midi);
        let transition = leap * 0.025;
        if (gap <= 0.5 + EPS && leap >= 5) transition += 1.5 + (leap - 5) * 0.45;
        if (gap <= 1 + EPS && leap >= 7) transition += 2;
        if (gap <= 1.5 + EPS && leap >= 12) transition += 3;
        if (gap > 1.5 + EPS) transition = 0;
        const candidate = best[previousIndex]! + weights[index]! - transition;
        if (candidate > best[index]! + EPS) {
          best[index] = candidate;
          parent[index] = previousIndex;
        }
      }
    }
    let state = best.reduce((winner, score, index) => score > best[winner]! + EPS ? index : winner, 0);
    const path: IdentityNote[] = [];
    while (state >= 0) {
      path.push({ ...phrase[state]! });
      state = parent[state]!;
    }
    selectedBase.push(...path.reverse());
  }

  // Run residual recovery after the normal weighted-interval pass. That
  // ordering is important: dense detector evidence must first be reduced to
  // the learner's ordinary contour, and only a genuinely sparse result may
  // borrow additional supported raw attacks. Advanced/source detail remains
  // on the normal path whenever it is already dense enough.
  const selectedPhrases: IdentityNote[][] = [];
  for (const note of selectedBase) {
    const phrase = selectedPhrases.at(-1);
    const previous = phrase?.at(-1);
    if (!phrase || !previous || note.start - previous.start > 3 + EPS
      || note.start - phrase[0]!.start > 32 + EPS) selectedPhrases.push([note]);
    else phrase.push(note);
  }
  const selected: IdentityNote[] = [];
  for (const phrase of selectedPhrases) {
    const regularized = regularizeSparseResidualPhrase(phrase, upper, source);
    selected.push(...(regularized ?? phrase.map((note) => ({ ...note }))));
  }
  return selected;
}

/**
 * Preserve a short low-register contour that leads into a later residual
 * upper phrase. The upper-only residual path is intentionally strict, but
 * using it as the complete identity path can erase the recognisable opening
 * when the detector reports that line below MIDI 61 first. This gate is
 * deliberately narrow: it only considers the first contiguous prefix, needs
 * real pitch motion, and never revives low attacks already routed to LH.
 */
function selectResidualOpeningContour(
  notes: Note[],
  upperEvidence: IdentityNote[],
  routedLow: IdentityNote[],
  openingBeats: number,
  source: UpperEvidenceLane["source"],
): IdentityNote[] {
  const firstUpperStart = upperEvidence[0]?.start;
  if (!Number.isFinite(firstUpperStart) || !Number.isFinite(openingBeats) || openingBeats <= 0) return [];
  const openingEnd = Math.min(openingBeats, firstUpperStart!);
  if (openingEnd < 2 - EPS) return [];

  const candidates = notes
    .filter((note) => note.midi >= 55
      && note.midi <= 60
      && note.start >= -EPS
      && note.start < openingEnd - EPS
      && !routedLow.some((routed) => Math.abs(routed.start - note.start) <= 0.08 + EPS))
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  if (candidates.length < 3 || candidates[0]!.start > 0.5 + EPS) return [];

  const prefix: Note[] = [candidates[0]!];
  for (const note of candidates.slice(1)) {
    if (note.start - prefix.at(-1)!.start > 1.5 + EPS) break;
    prefix.push(note);
  }
  const span = prefix.at(-1)!.start - prefix[0]!.start;
  const distinctPitches = new Set(prefix.map((note) => note.midi));
  const dominantPitchRatio = Math.max(...[...distinctPitches].map((pitch) =>
    prefix.filter((note) => note.midi === pitch).length)) / prefix.length;
  const deltas = prefix.slice(1).map((note, index) => note.midi - prefix[index]!.midi);
  let longestMonotonicSteps = 0;
  let monotonicSteps = 0;
  let previousDirection = 0;
  for (const delta of deltas) {
    const direction = Math.sign(delta);
    if (direction !== 0 && direction === previousDirection) monotonicSteps += 1;
    else monotonicSteps = direction === 0 ? 0 : 1;
    longestMonotonicSteps = Math.max(longestMonotonicSteps, monotonicSteps);
    previousDirection = direction;
  }
  if (prefix.length < 3
    || span < 2 - EPS
    || distinctPitches.size < 3
    || dominantPitchRatio > 0.75 + EPS
    || longestMonotonicSteps < 2) return [];

  return monophonicPath(prefix, 55, 96, { exactOctaveWindow: 1, coherent: true })
    .map((note) => ({ ...note, identitySource: source }));
}

/**
 * Recover a small top-line when the selected source path is empty or visibly
 * sparse but the raw separated stems still contain repeated upper evidence.
 * No pitch is synthesized: every returned event is copied from an upper stem
 * candidate. Low-only phrases remain rests/accompaniment, and a dense phrase
 * is left untouched so this fallback cannot turn a rhythm wall into a second
 * melody. The one-attack-per-beat cap is intentionally below the reference's
 * dense solo rate; learner simplification can retain more when confidence is
 * already high.
 */
function inferConservativeTopLine(
  selected: IdentityNote[],
  lanes: UpperEvidenceLane[],
  start: number,
  end: number,
  allowedSource?: UpperEvidenceLane["source"],
): IdentityNote[] {
  const existing = notesIn(selected, start, end);
  const existingMelody = existing.filter((note) => note.identitySource === "vocals" || note.midi >= 64);
  const targetAttacks = Math.max(2, Math.floor((end - start) / 2));
  const needed = targetAttacks - existingMelody.length;
  if (needed <= 0) return [];
  const candidateLanes = allowedSource
    ? lanes.filter((lane) => lane.source === allowedSource)
    : lanes;
  const candidates = candidateLanes.flatMap((lane) => {
    const laneNotes = notesIn(lane.notes, start, end);
    return laneNotes
      .filter((note) => (note.rawMidi ?? note.midi) >= 60)
      .map((note) => ({ note, source: lane.source, laneNotes }));
  });
  if (!candidates.length) return [];
  const chosen: IdentityNote[] = [];
  const occupied = (note: IdentityNote): boolean => [...existing, ...chosen].some((other) =>
    Math.abs(other.start - note.start) <= 0.08
    || (other.start <= note.start && other.start + other.dur > note.start + EPS),
  );
  const sourceSupport = (candidate: typeof candidates[number]): number => {
    const nearby = candidate.laneNotes.filter((note) => Math.abs(note.start - candidate.note.start) <= 2 + EPS);
    const distinctPitches = new Set(nearby.map((note) => note.midi));
    // Repetition across a phrase is stronger evidence than one isolated high
    // spike. A sustained/dynamic attack is allowed with less repetition.
    if (nearby.length >= 2 && distinctPitches.size >= 2) return nearby.length + 1;
    if (candidate.note.dur >= 0.35 || candidate.note.vel >= 64) return nearby.length;
    return 0;
  };
  const ordered = [...candidates]
    .map((candidate) => ({ ...candidate, support: sourceSupport(candidate) }))
    .filter((candidate) => candidate.support > 0)
    .sort((a, b) => a.note.start - b.note.start || b.support - a.support || b.note.vel - a.note.vel || b.note.midi - a.note.midi);
  if (!ordered.length) return [];
  const step = 1;
  for (let bucketStart = start; bucketStart < end - EPS && chosen.length < needed; bucketStart += step) {
    const bucketEnd = Math.min(end, bucketStart + step);
    const bucket = ordered.filter((candidate) => candidate.note.start >= bucketStart - EPS && candidate.note.start < bucketEnd - EPS);
    const selectedSoFar = [...existing, ...chosen];
    const previousInstrumental = selectedSoFar
      .filter((note) => isMetalInstrumentalSource(note.identitySource) && note.start <= bucketStart + EPS)
      .sort((a, b) => a.start - b.start)
      .at(-1);
    const activeSource = previousInstrumental?.identitySource;
    const sourceHasContinuation = activeSource
      ? ordered.some((entry) => entry.source === activeSource
        && entry.note.start >= bucketEnd - EPS
        && entry.note.start <= bucketEnd + 1.5 + EPS)
      : false;
    const candidate = bucket
      .filter(({ note, source }) => {
        if (occupied(note)) return false;
        // Keep sparse recovery on the lane already carrying the phrase. If
        // that lane has another candidate nearby, a different residual source
        // is a handoff artifact rather than missing melody. A true rest or the
        // end of the active lane allows the fallback source to enter.
        if (
          activeSource
          && source !== activeSource
          && previousInstrumental
          && bucketStart - previousInstrumental.start <= 1.5 + EPS
          && sourceHasContinuation
        ) return false;
        return true;
      })
      .sort((a, b) => {
        const score = (entry: typeof a): number => {
          // Only earlier events may shape an inferred contour. Looking at the
          // last note in the whole section let a future vocal/identity note
          // pull every sparse recovery backward into an artificial leap.
          const previous = selectedSoFar
            .filter((note) => note.start <= entry.note.start + EPS)
            .sort((left, right) => left.start - right.start)
            .at(-1);
          const previousInstrumental = selectedSoFar
            .filter((note) => isMetalInstrumentalSource(note.identitySource) && note.start <= entry.note.start + EPS)
            .sort((left, right) => left.start - right.start)
            .at(-1);
          const next = existing
            .filter((note) => note.start > entry.note.start + EPS)
            .sort((left, right) => left.start - right.start)[0];
          const previousDistance = previous ? Math.abs(entry.note.midi - previous.midi) : 0;
          const nextDistance = next ? Math.abs(entry.note.midi - next.midi) : 0;
          const sourceGap = previousInstrumental
            ? entry.note.start - previousInstrumental.start
            : Number.POSITIVE_INFINITY;
          const sameSource = previousInstrumental?.identitySource === entry.source;
          const sourceContinuationBonus = sameSource && sourceGap <= 1.5 + EPS ? 1.5 : 0;
          const sourceSwitchPenalty = previousInstrumental
            && !sameSource
            && sourceGap <= 1.5 + EPS
            // Do not let a residual lane replace a connected lead simply
            // because its detector support is denser. A real rest resets the
            // state and permits a deliberate source handoff.
            ? 3
            : 0;
          return entry.support * 2
            + entry.note.vel / 64
            + Math.min(entry.note.dur, 1)
            + sourceContinuationBonus
            + instrumentalLaneQuality(entry.laneNotes, start, end) * 0.5
            - sourceSwitchPenalty
            - (previousDistance + nextDistance) * 0.03;
        };
        const aScore = score(a);
        const bScore = score(b);
        return bScore - aScore || a.note.start - b.note.start;
      })[0];
    if (!candidate) continue;
    const note: IdentityNote = {
      ...candidate.note,
      hand: "R",
      dur: Math.min(candidate.note.dur, 0.75),
      identitySource: candidate.source,
    };
    chosen.push(note);
  }
  return chosen;
}

/**
 * A transcription can produce a dense, single-pitch vocal drone from bleed
 * or reverb. It should not displace a moving riff that carries the song's
 * identity. Penalize only the degenerate vocal case; chants and deliberately
 * narrow melodies with at least two pitches retain their normal priority.
 */
function vocalSourceConfidence(notes: Note[], start: number, end: number, stemConfidence = 1): number {
  const confidence = sourceConfidence(notes, start, end, stemConfidence);
  const evidence = notesIn(notes, start, end);
  if (evidence.length < 4) return confidence;
  const distinct = new Set(evidence.map((note) => note.midi));
  if (distinct.size > 1) return confidence;
  return confidence * 0.5;
}

function bassAt(notes: Note[], start: number, end: number): Note | undefined {
  // A fresh bass attack is stronger harmonic evidence than an older low
  // sustain. Otherwise a held C2 can mask a D2 chord change two beats later.
  const attacked = notes.filter((note) => note.start >= start - EPS && note.start < end - EPS);
  if (attacked.length) {
    return attacked.sort((a, b) => Math.abs(a.start - start) - Math.abs(b.start - start) || a.midi - b.midi || b.vel - a.vel)[0];
  }
  const candidates = notes.filter((note) => note.start < end && note.start + note.dur > start);
  return candidates.sort((a, b) => a.midi - b.midi || b.vel - a.vel)[0];
}

function pitchClassesAt(notes: Note[], start: number, end: number): Set<number> {
  return new Set(notes.filter((note) => note.start < end && note.start + note.dur > start).map((note) => ((note.midi % 12) + 12) % 12));
}

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

function instrumentalLaneQuality(notes: IdentityNote[], start: number, end: number): number {
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

function identityForWindow(
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
function suppressBoundaryBleed(notes: IdentityNote[], vocals: IdentityNote[]): IdentityNote[] {
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
function stabilizeIdentityRegister(
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

function chordFor(rootPc: number, pcs: Set<number>): { name: string; notes: number[] } {
  const hasMinor = pcs.has((rootPc + 3) % 12);
  const hasMajor = pcs.has((rootPc + 4) % 12);
  const quality = hasMinor === hasMajor ? "5" : hasMinor ? "m" : "";
  const root = 36 + rootPc;
  const bassRoot = root > 47 ? root - 12 : root;
  const intervals = quality === "m" ? [0, 3, 7] : quality === "" ? [0, 4, 7] : [0, 7];
  return {
    name: `${SHARP_NAMES[rootPc]}${quality}`,
    notes: intervals.map((interval) => bassRoot + interval),
  };
}

function uniqueSorted(notes: Note[]): Note[] {
  const seen = new Set<string>();
  return notes
    .sort((a, b) => a.start - b.start
      || a.midi - b.midi
      // When a routed rhythm/root event lands on the same pitch as the
      // inferred chord shell, keep the source-tagged event. It represents
      // both the physical strike and its provenance; dropping it would make
      // the LH rhythm lane disappear at every chord boundary.
      || Number(Boolean(b.identitySource)) - Number(Boolean(a.identitySource))
      || b.dur - a.dur)
    .filter((note) => {
      const key = `${note.hand}:${note.midi}:${note.start.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Turn separated band evidence into a deliberately piano-shaped canonical
 * arrangement. Drums contribute timing accents only; they are never emitted
 * as pitched notes.
 */
export function buildMetalArrangement(input: MetalArrangementInput): MetalArrangementResult {
  if (!input.stems.length) throw new Error("Metal arrangement requires at least one stem");
  const reference = input.stems.find((stem) => stem.role !== "drums")?.midi ?? input.stems[0]!.midi;
  const tempoBpm = reference.tempoBpm;
  const timeSig = reference.timeSig;
  const durationBeats = input.stems.reduce((duration, stem) => {
    let result = Number.isFinite(stem.midi.durationBeats) ? Math.max(duration, stem.midi.durationBeats) : duration;
    for (const note of validNotes(stem)) {
      const end = note.start + note.dur;
      if (Number.isFinite(end) && end > result) result = end;
    }
    return result;
  }, 1);
  const meterBeats = beatsPerMeasure(timeSig);
  const sectionBeats = Math.max(2, input.sectionBeats ?? meterBeats * 2);
  const harmonyBeats = Math.max(1, input.harmonyBeats ?? meterBeats / 2);
  const roles: MetalStemRole[] = ["vocals", "bass", "guitar", "other", "drums"];
  for (const role of roles) {
    if (input.stems.filter((stem) => stem.role === role).length > 1) {
      throw new Error(`metal arrangement received duplicate ${role} stems`);
    }
  }
  const vocalsStem = input.stems.find((stem) => stem.role === "vocals");
  // Keep a residual-only input labeled as `other`. Treating it as guitar
  // loses provenance and bypasses the stricter residual upper-line decoder,
  // which lets full-mix detector chatter back into the RH as a fake lead.
  // The four-source worker keeps the routing role `guitar` for compatibility,
  // but marks that lane's actual source as `other`. Normalize that alias here
  // while retaining the public routing role in the worker/report layer.
  const roleGuitarStem = input.stems.find((stem) => stem.role === "guitar");
  const guitarStem = roleGuitarStem?.sourceStem === "other" ? undefined : roleGuitarStem;
  const otherStem = input.stems.find((stem) => stem.role === "other")
    ?? (roleGuitarStem?.sourceStem === "other" ? roleGuitarStem : undefined);
  const bassStem = input.stems.find((stem) => stem.role === "bass");
  const drumsStem = input.stems.find((stem) => stem.role === "drums");
  const vocalRaw = filterLowVocalDroneNotes(validNotes(vocalsStem));
  const vocals = monophonicPath(vocalRaw, 60, 96, { exactOctaveWindow: 0.5 })
    .map((note) => ({ ...note, identitySource: "vocals" as const }));
  const trustedVocals = trustworthyVocalNotes(vocals);
  const guitarRaw = validNotes(guitarStem);
  const otherRaw = validNotes(otherStem);
  const guitarUpperRaw = supportedUpperRawNotes(guitarRaw);
  const otherUpperRaw = supportedUpperRawNotes(otherRaw);
  const guitarUpperEvidence = upperHarmonicPath(guitarRaw, "guitar");
  // Residual `other` is often full-mix-like and can contain a high partial on
  // every detector frame. Decode it to a single coherent upper contour before
  // source fusion; dedicated guitar remains on the richer path below.
  const otherUpperEvidence = selectResidualUpperMelodyPath(otherRaw, "other");
  const upperEvidenceLanes: UpperEvidenceLane[] = [
    { source: "guitar", notes: guitarUpperEvidence },
    { source: "other", notes: otherUpperEvidence },
  ];
  const sharedUpperEvidence = [...guitarUpperEvidence, ...otherUpperEvidence];
  const guitarRawUpperContext: IdentityNote[] = guitarUpperRaw
    .map((note) => ({ ...note, rawMidi: note.midi, identitySource: "guitar" as const }));
  const otherRawUpperContext: IdentityNote[] = otherUpperRaw
    .map((note) => ({ ...note, rawMidi: note.midi, identitySource: "other" as const }));
  const guitarRawRhythm = rawLowRhythmEvents(guitarRaw, "guitar", guitarRawUpperContext);
  const otherRawRhythm = rawLowRhythmEvents(otherRaw, "other", otherRawUpperContext);
  const isRoutedRawLow = (note: Note, routed: IdentityNote[]): boolean =>
    note.midi <= 60 && routed.some((candidate) => Math.abs(candidate.start - note.start) <= 0.08 + EPS);
  // Split raw low material before octave registration. Otherwise MIDI 50–54
  // can become a false RH 62–66 line and the later pulse pass cannot recover
  // which detector event was really accompaniment.
  const guitarPath = monophonicPath(
    guitarRaw.filter((note) => (note.midi < 61 || guitarUpperRaw.includes(note)) && note.midi >= 45 && !isRoutedRawLow(note, guitarRawRhythm)),
    55,
    96,
      { preferUpperLead: true, exactOctaveWindow: 1, coherent: true },
    ).map((note) => ({ ...note, identitySource: "guitar" as const }));
  const otherUpperPitchClasses = new Set(otherUpperEvidence.map((note) => note.midi));
  const otherOpeningEvidence = selectResidualOpeningContour(
    otherRaw,
    otherUpperEvidence,
    otherRawRhythm,
    sectionBeats,
    "other",
  );
  // `other` is a residual/full-mix lane in Demucs' six-stem output. When it
  // has a real upper contour, use that upper-only path as identity evidence;
  // allowing every low residual partial into the same monophonic chooser
  // creates registered 60–66 jumps that are accompaniment, not melody. Keep
  // the broader path as a backwards-compatible fallback for sparse/low-only
  // residual stems.
  const otherIdentityPath = otherUpperEvidence.length >= 3 && otherUpperPitchClasses.size >= 2
    ? [...otherOpeningEvidence, ...otherUpperEvidence]
    : monophonicPath(
      otherRaw.filter((note) => (note.midi < 61 || otherUpperRaw.includes(note)) && note.midi >= 45 && !isRoutedRawLow(note, otherRawRhythm)),
      55,
      96,
      { preferUpperLead: true, exactOctaveWindow: 1, coherent: true },
    ).map((note) => ({ ...note, identitySource: "other" as const }));
  const otherPath = otherIdentityPath;
  const guitarLanes = suppressLowGuitarPulseRuns(guitarPath, [...otherPath, ...sharedUpperEvidence]);
  const guitar = guitarLanes.lead;
  const rhythmGuitar = [...guitarLanes.rhythm, ...guitarRawRhythm];
  const otherLanes = suppressLowGuitarPulseRuns(otherPath, [...guitarPath, ...sharedUpperEvidence]);
  const other = otherLanes.lead;
  const rhythmOther = [...otherLanes.rhythm, ...otherRawRhythm];
  const bass = validNotes(bassStem);
  const harmonicEvidence = [...validNotes(guitarStem), ...validNotes(otherStem)];
  const sections: MetalIdentitySection[] = [];
  const identity: Note[] = [];
  const vocalRegisterAnchors = new Set<string>();
  let inferredTopLineSections = 0;
  // Carry the chosen instrumental lane across fixed section windows. A
  // section boundary is a bookkeeping boundary, not a musical rest; without
  // this state a residual lane can take over for one window and hand the line
  // back to guitar on the next downbeat.
  let activeInstrumentSource: "guitar" | "other" | undefined;
  let activeInstrumentLastAttack: number | undefined;

  for (let start = 0; start < durationBeats - EPS; start += sectionBeats) {
    const end = Math.min(durationBeats, start + sectionBeats);
    const rawVocalConfidence = vocalSourceConfidence(vocals, start, end, vocalsStem?.confidence);
    const trustedVocalEvidence = notesIn(trustedVocals, start, end);
    const vocalConfidence = trustedVocalEvidence.length
      ? vocalSourceConfidence(trustedVocals, start, end, vocalsStem?.confidence)
      : rawVocalConfidence;
    const instrumentalChoices = [
      { source: "guitar" as const, notes: guitar, confidence: melodicConfidence(guitar, start, end, guitarStem?.confidence) * 0.92 },
      { source: "other" as const, notes: other, confidence: melodicConfidence(other, start, end, otherStem?.confidence) * 0.85 },
    ].sort((a, b) => b.confidence - a.confidence);
    const carriedLastAttack = activeInstrumentLastAttack;
    const carriedChoice = activeInstrumentSource
      ? instrumentalChoices.find((choice) => choice.source === activeInstrumentSource)
      : undefined;
    const carriedWall = Boolean(
      carriedChoice
      && activeInstrumentSource === "guitar"
      && isUpperGuitarRhythmWall(notesIn(carriedChoice.notes, start, end)),
    );
    const carriedContinuation = Boolean(
      carriedChoice
      && !carriedWall
      && carriedLastAttack !== undefined
      && notesIn(carriedChoice.notes, start, end).some((note) => note.start - carriedLastAttack <= 1.5 + EPS),
    );
    // Instrumental-only sections have no vocal rest helper to enforce lane
    // continuity. Reuse the same carry rule here so a section seam does not
    // alternate between guitar and residual evidence merely because their
    // local confidence scores crossed by a few points.
    const instrumentalWinner = carriedContinuation ? carriedChoice! : instrumentalChoices[0]!;
    const useVocalLead = trustedVocalEvidence.length > 0
      || (vocalConfidence >= 0.15 && instrumentalWinner.confidence < 0.15);
    const winner = useVocalLead
      ? {
        source: "vocals" as const,
        notes: trustedVocalEvidence.length ? trustedVocals : vocals,
        confidence: vocalConfidence,
      }
      : instrumentalWinner;
    // Sparse recovery must stay on the lane selected for this section. The
    // residual `other` stem is often full-mix-like; handing both lanes back to
    // the inference pass would reintroduce its isolated spikes after the
    // source-aware fusion gate already chose a coherent guitar phrase.
    let inferenceSource: UpperEvidenceLane["source"] = instrumentalWinner.source;
    let source: MetalIdentitySection["source"] = winner.confidence >= 0.15 ? winner.source : "rest";
    let sectionConfidence = winner.confidence;
    const sectionIdentity: IdentityNote[] = [];
    if (source !== "rest") {
      // In an instrumental-only phrase, commit to the best-scoring melodic
      // lane instead of interleaving every residual source into the RH. Dense
      // guitar partials and a sparse keys/lead contour otherwise create a
      // synthetic source-switching line that neither performer would play.
      // Vocal phrases retain the intentional rest-filling behavior below.
      const alternates = useVocalLead
        ? instrumentalChoices.map((choice) => choice.notes)
        : [];
      const fused = identityForWindow(
        winner.notes,
        alternates,
        start,
        end,
        useVocalLead ? 0.5 : 0,
        activeInstrumentSource,
        activeInstrumentLastAttack,
      );
      if (fused.alternateSource) inferenceSource = fused.alternateSource;
      if (useVocalLead) {
        for (const note of fused.primaryNotes) vocalRegisterAnchors.add(`${note.start.toFixed(6)}:${note.midi}`);
      }
      if (useVocalLead && fused.alternateCount > 0) {
        source = "mixed";
        const total = fused.primaryCount + fused.alternateCount;
        sectionConfidence = total > 0
          ? (vocalConfidence * fused.primaryCount + instrumentalWinner.confidence * fused.alternateCount) / total
          : vocalConfidence;
      }
      for (const note of fused.notes) {
        sectionIdentity.push(note);
        identity.push(note);
      }
      const instrumentalNotes = fused.notes
        .filter((note): note is IdentityNote & { identitySource: "guitar" | "other" } => isMetalInstrumentalSource(note.identitySource))
        .sort((a, b) => a.start - b.start);
      if (instrumentalNotes.length) {
        activeInstrumentSource = instrumentalNotes.at(-1)!.identitySource;
        activeInstrumentLastAttack = instrumentalNotes.at(-1)!.start;
      }
    }
    const inferred = inferConservativeTopLine(
      sectionIdentity,
      upperEvidenceLanes,
      start,
      end,
      inferenceSource,
    );
    if (inferred.length) {
      inferredTopLineSections += 1;
      sectionConfidence = Math.max(sectionConfidence, 0.16);
      if (source === "rest") source = inferred[0]!.identitySource ?? "other";
      for (const note of inferred) identity.push(note);
      // Inferred attacks are still evidence from the selected instrumental
      // lane. Carry their provenance across the next bookkeeping section so
      // a sparse phrase cannot flip sources merely at an 8/16-beat seam.
      const inferredInstrumental = inferred
        .filter((note): note is IdentityNote & { identitySource: "guitar" | "other" } => isMetalInstrumentalSource(note.identitySource))
        .sort((a, b) => a.start - b.start);
      const lastInferred = inferredInstrumental.at(-1);
      if (lastInferred) {
        activeInstrumentSource = lastInferred.identitySource;
        activeInstrumentLastAttack = lastInferred.start;
      }
    }
    sections.push({ startBeat: start, endBeat: end, source, confidence: sectionConfidence });
  }

  const filteredIdentity = suppressBoundaryBleed(identity, trustedVocals);
  // The initial section winner is calculated before the cross-window bleed
  // pass. Reconcile provenance against the surviving identity notes so a
  // guitar-only section that was fully suppressed cannot still be published
  // as a contributing guitar section.
  const filteredSections = sections.map((section) => {
    const sectionNotes = notesIn(filteredIdentity, section.startBeat, section.endBeat);
    if (!sectionNotes.length) return { ...section, source: "rest" as const, confidence: 0 };
    const sources = new Set(
      sectionNotes
        .map((note) => note.identitySource)
        .filter((source): source is NonNullable<Note["identitySource"]> => Boolean(source)),
    );
    if (sources.size === 1) return { ...section, source: [...sources][0]! };
    if (sources.size > 1) return { ...section, source: "mixed" as const };
    return section;
  });
  const stabilizedIdentity = stabilizeIdentityRegister(
    filteredIdentity,
    tempoBpm,
    vocalRegisterAnchors,
    55,
    96,
  );
  const publicIdentity = stabilizedIdentity.map(({ rawMidi: _rawMidi, ...note }) => note);
  const chords: ChordLabel[] = [];
  const leftHand: Note[] = [];
  let previousRoot: number | undefined;
  for (let beat = 0; beat < durationBeats - EPS; beat += harmonyBeats) {
    const end = Math.min(durationBeats, beat + harmonyBeats);
    const bassNote = bassAt(bass, beat, end);
    const evidence = pitchClassesAt(harmonicEvidence, beat, end);
    let rootPc = bassNote ? ((bassNote.midi % 12) + 12) % 12 : previousRoot;
    if (rootPc === undefined && evidence.size) rootPc = [...evidence][0];
    if (rootPc === undefined) continue;
    previousRoot = rootPc;
    const chord = chordFor(rootPc, evidence);
    const duration = Math.max(0.25, end - beat);
    chords.push({
      beat,
      name: chord.name,
      notes: chord.notes,
      sourceKind: "inferred",
      inferred: true,
      inferenceType: "voicing",
      durationBeats: duration,
    });
    const root = chord.notes[0]!;
    leftHand.push({ midi: root, start: beat, dur: Math.min(duration, 1.5), vel: 68, hand: "L" });
    if (chord.notes.length > 1) {
      const fifth = chord.notes.find((note) => note % 12 === (rootPc! + 7) % 12);
      if (fifth !== undefined) leftHand.push({ midi: fifth, start: beat, dur: Math.min(duration, 1.5), vel: 62, hand: "L" });
    }
  }

  // Stable low guitar walls are useful rhythmic evidence but poor RH melody.
  // Route them to a low register while preserving their original attacks;
  // the variant builder can then thin this explicit accompaniment lane per
  // difficulty without contaminating identity selection.
  for (const note of rhythmGuitar) {
    leftHand.push({
      midi: toRegister(note.rawMidi ?? note.midi, 36, 54),
      start: note.start,
      dur: Math.min(Math.max(note.dur, 0.25), 0.75),
      vel: Math.max(40, Math.min(76, note.vel)),
      hand: "L",
      identitySource: note.identitySource,
    });
  }
  for (const note of rhythmOther) {
    leftHand.push({
      midi: toRegister(note.rawMidi ?? note.midi, 36, 54),
      start: note.start,
      dur: Math.min(Math.max(note.dur, 0.25), 0.75),
      vel: Math.max(40, Math.min(76, note.vel)),
      hand: "L",
      identitySource: note.identitySource,
    });
  }

  const rhythmicAccents = validNotes(drumsStem).map((note) => note.start).filter((beat, index, all) => index === 0 || beat - all[index - 1]! >= 0.125);
  const notes = uniqueSorted([...publicIdentity.map((note) => ({ ...note, hand: "R" as const })), ...leftHand]);
  const warnings: string[] = [];
  const mismatchedTempo = input.stems.filter((stem) => Math.abs(stem.midi.tempoBpm - tempoBpm) > 0.5);
  if (mismatchedTempo.length) warnings.push(`${mismatchedTempo.length} stems had mismatched tempo metadata; beat positions were used unchanged`);
  if (!publicIdentity.length) warnings.push("no reliable vocal, guitar, or other identity line was found");
  if (inferredTopLineSections) {
    warnings.push(`conservative upper harmonic evidence filled ${inferredTopLineSections} sparse section${inferredTopLineSections === 1 ? "" : "s"}`);
  }
  if (!bass.length) warnings.push("no bass stem was available; harmony roots may be less reliable");
  const sourceSections: Record<string, number> = {};
  for (const section of filteredSections) {
    sourceSections[section.source] = (sourceSections[section.source] ?? 0) + 1;
  }
  const parsed: ParsedMidi = {
    format: 1,
    division: reference.division || 480,
    tempoBpm,
    tempoMetaPresent: true,
    keySig: reference.keySig,
    keyMode: reference.keyMode,
    timeSig,
    notes,
    trackNames: ["Metal Piano RH", "Metal Piano LH"],
    durationBeats,
    ...(input.title ? { title: input.title } : {}),
  };
  const ir: MetalArrangementIR = { version: 1, tempoBpm, timeSig, durationBeats, sections: filteredSections, identity: publicIdentity.map((note) => ({ ...note })), harmony: chords, rhythmicAccents };
  return {
    parsed,
    chords,
    ir,
    stats: { identityNotes: publicIdentity.length, leftHandNotes: leftHand.length, chordEvents: chords.length, sourceSections },
    warnings,
  };
}
