import type { Note } from "./types.js";

/** Options for the deterministic piano-role splitter. */
export interface PianoRoleOptions {
  /** Treat starts within this many beats as one simultaneous onset. */
  onsetTolerance?: number;
  /** Keep very short upper attacks from displacing a sustained line below them. */
  preferSustainedLine?: boolean;
  /** Permit an explicit no-new-melody state between selected attacks. */
  allowRests?: boolean;
}

/** Role assigned by {@link splitPianoRoles}. */
export type PianoNoteRole = "melody" | "accompaniment";

/**
 * A melody note that can be carried through later arrangement passes without
 * losing its source position or changing its musical values.
 *
 * The note fields are copied and frozen. `sourceIndex` points to the caller's
 * input array, while `identity` is stable for the same note values even when
 * the input array is reordered.
 */
export interface ProtectedMelodyNote extends Readonly<Note> {
  readonly sourceIndex: number;
  readonly identity: string;
  readonly role: "melody";
}

/** Internal, uncalibrated evidence for a selected path and its nearest alternative. */
export interface PianoRolePathEvidence {
  readonly startBeat: number;
  readonly endBeat: number;
  readonly selectedIdentity: string | null;
  readonly alternativeIdentity: string | null;
  readonly scoreMargin: number;
}

/** Result of splitting a note stream into one protected upper voice and support. */
export interface PianoRoleSplit {
  /** Frozen, canonical-time-ordered melody note values. */
  readonly melody: readonly Readonly<Note>[];
  /** Non-melody notes, copied in canonical time/pitch order. */
  readonly accompaniment: readonly Note[];
  /** Alias-shaped mask for callers that specifically consume protected notes. */
  readonly protectedMelody: readonly ProtectedMelodyNote[];
  /** Source-index-aligned role mask; useful when preserving the original array. */
  readonly melodyMask: readonly boolean[];
  /** Per-onset selected-path alternatives; not a calibrated confidence score. */
  readonly pathEvidence: readonly PianoRolePathEvidence[];
}

interface IndexedNote {
  readonly note: Note;
  readonly sourceIndex: number;
  readonly identity: string;
}

interface Candidate {
  readonly indexed: IndexedNote | null;
  readonly emission: number;
}

interface PathState {
  readonly lastIdentity: string | null;
  readonly score: number;
  readonly candidateIndex: number;
  readonly previousStateIndex: number;
}

// Keep role grouping aligned with the detector/harmony onset contract.  A
// small amount of jitter is expected in imported piano MIDI, and grouping it
// here prevents a chord from being mistaken for several competing melody
// attacks.
const DEFAULT_ONSET_TOLERANCE = 0.08;
const EPSILON = 1e-9;
const PATH_AMBIGUITY_MARGIN = 0.16;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function numberToken(value: number): string {
  // JSON's number representation is deterministic and does not round note
  // values that are meaningful to the parser (including fractional beats).
  return Number.isFinite(value) ? JSON.stringify(value) : String(value);
}

function noteBaseIdentity(note: Note): string {
  return JSON.stringify([
    numberToken(note.midi),
    numberToken(note.start),
    numberToken(note.dur),
    numberToken(note.vel),
    note.hand ?? null,
    note.sourceLane ?? null,
    note.identitySource ?? null,
    note.lyrics ?? null,
  ]);
}

function compareNotes(a: Note, b: Note): number {
  return (
    a.start - b.start ||
    a.midi - b.midi ||
    a.dur - b.dur ||
    a.vel - b.vel ||
    compareText(a.hand ?? "", b.hand ?? "") ||
    compareText(a.sourceLane ?? "", b.sourceLane ?? "") ||
    compareText(a.identitySource ?? "", b.identitySource ?? "") ||
    compareText(a.lyrics ?? "", b.lyrics ?? "")
  );
}

function compareIndexed(a: IndexedNote, b: IndexedNote): number {
  return compareNotes(a.note, b.note) || compareText(a.identity, b.identity);
}

function isPlayableNote(note: Note): boolean {
  return (
    Number.isFinite(note.midi) &&
    Number.isFinite(note.start) &&
    Number.isFinite(note.dur) &&
    Number.isFinite(note.vel) &&
    note.dur > 0
  );
}

function indexedNotes(notes: readonly Note[]): IndexedNote[] {
  const raw = notes.map((note, sourceIndex) => ({ note, sourceIndex }));
  const ordered = [...raw].sort(
    (a, b) => compareNotes(a.note, b.note) || a.sourceIndex - b.sourceIndex,
  );
  const occurrences = new Map<string, number>();
  const identities = new Map<number, string>();

  for (const entry of ordered) {
    const base = noteBaseIdentity(entry.note);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    identities.set(entry.sourceIndex, `note:${base}#${occurrence}`);
  }

  return raw.map(({ note, sourceIndex }) => ({
    note,
    sourceIndex,
    identity: identities.get(sourceIndex) ?? `note:${noteBaseIdentity(note)}#0`,
  }));
}

function groupByOnset(indexed: readonly IndexedNote[], tolerance: number): IndexedNote[][] {
  const ordered = indexed
    .filter(({ note }) => isPlayableNote(note))
    .sort(compareIndexed);
  const groups: IndexedNote[][] = [];

  for (const item of ordered) {
    const previous = groups[groups.length - 1];
    // Onset jitter is transitive: compare with the latest onset already in
    // the group so 0.00/0.07/0.13 remains one attack at the default 0.08
    // beat tolerance.
    const previousLatestStart = previous?.[previous.length - 1]?.note.start;
    if (previous && previousLatestStart !== undefined && item.note.start - previousLatestStart <= tolerance + EPSILON) {
      previous.push(item);
    } else {
      groups.push([item]);
    }
  }

  return groups;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function highestMidi(group: readonly IndexedNote[]): number {
  return group.reduce((highest, item) => Math.max(highest, item.note.midi), -Infinity);
}

function upperVoiceContinuity(previous: Note, current: Note): number {
  const distance = Math.abs(current.midi - previous.midi);
  if (distance <= 2) return 1;
  if (distance <= 5) return 0.88;
  if (distance <= 9) return 0.68;
  if (distance <= 12) return 0.5;
  if (distance <= 19) return 0.25;
  return 0.05;
}

function localTopLineContext(
  groupIndex: number,
  candidate: IndexedNote,
  groups: readonly (readonly IndexedNote[])[],
): number {
  const current = groups[groupIndex]!;
  const currentTop = highestMidi(current);
  const gapToCurrentTop = currentTop - candidate.note.midi;
  // The current attack being the local top is the strongest contextual cue.
  const onsetTop = gapToCurrentTop <= EPSILON ? 1 : 0.15 * clamp(1 - gapToCurrentTop / 12);

  const neighbourScores: number[] = [];
  for (const neighbourIndex of [groupIndex - 1, groupIndex + 1]) {
    const neighbour = groups[neighbourIndex];
    if (!neighbour) continue;
    const gap = Math.abs(highestMidi(neighbour) - candidate.note.midi);
    neighbourScores.push(clamp(1 - gap / 24));
  }
  const neighbours = neighbourScores.length > 0 ? median(neighbourScores) : onsetTop;
  return clamp(0.65 * onsetTop + 0.35 * neighbours);
}

function durationSalience(duration: number, typicalDuration: number): number {
  if (typicalDuration <= EPSILON) return 0.5;
  // Longer notes get a modest boost, but never enough to displace a coherent
  // upper voice merely because a chord tone is held by the pedal.
  return clamp(duration / (typicalDuration * 1.5));
}

function isShortTopDecoration(
  candidate: IndexedNote,
  group: readonly IndexedNote[],
  typicalDuration: number,
): boolean {
  if (group.length < 2 || candidate.note.midi !== highestMidi(group)) return false;
  if (candidate.note.dur >= typicalDuration * 0.5) return false;
  return group.some((other) =>
    other !== candidate
    && other.note.midi < candidate.note.midi
    && other.note.dur >= typicalDuration * 0.75
    && other.note.dur >= candidate.note.dur * 2,
  );
}

function candidateEmission(
  groupIndex: number,
  candidate: IndexedNote,
  group: readonly IndexedNote[],
  groups: readonly (readonly IndexedNote[])[],
  typicalDuration: number,
  preferSustainedLine: boolean,
): number {
  const minPitch = group.reduce((minimum, item) => Math.min(minimum, item.note.midi), Infinity);
  const maxPitch = highestMidi(group);
  const pitchRange = Math.max(1, maxPitch - minPitch);
  const pitchRank = clamp((candidate.note.midi - minPitch) / pitchRange);
  const globalPitch = clamp((candidate.note.midi - 36) / 60);
  const velocity = clamp(candidate.note.vel / 127);
  const duration = durationSalience(candidate.note.dur, typicalDuration);
  const topContext = localTopLineContext(groupIndex, candidate, groups);
  const sustainedLine = preferSustainedLine && candidate.note.dur > typicalDuration
    ? clamp((candidate.note.dur / typicalDuration - 1) / 3)
    : 0;

  // Upper-voice position and local context lead; salience and duration help
  // break ties without making a right-hand label equivalent to melody.
  return (
    0.42 * pitchRank +
    0.2 * topContext +
    0.12 * globalPitch +
    0.14 * velocity +
    0.12 * duration +
    0.35 * sustainedLine
  );
}

function durationContinuity(previous: Note, current: Note): number {
  const previousDuration = Math.max(previous.dur, 0.01);
  const currentDuration = Math.max(current.dur, 0.01);
  return clamp(1 - Math.abs(Math.log(previousDuration / currentDuration)) / 3);
}

function transitionScore(previous: Note, current: Note): number {
  const continuity = upperVoiceContinuity(previous, current);
  const articulation = durationContinuity(previous, current);
  const overlapPenalty = previous.start + previous.dur > current.start + EPSILON ? 0.82 : 1;
  return (0.72 * continuity + 0.28 * articulation) * overlapPenalty;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.indexed === null && b.indexed === null) return 0;
  if (a.indexed === null) return 1;
  if (b.indexed === null) return -1;
  return compareIndexed(a.indexed, b.indexed);
}

function restTransitionScore(previous: IndexedNote | null, group: readonly IndexedNote[]): number {
  if (!previous) return 0.1;
  const groupStart = group[0]?.note.start ?? previous.note.start;
  if (previous.note.start + previous.note.dur > groupStart + EPSILON) return 0.9;
  const bestContinuity = Math.max(
    ...group.map(({ note }) => upperVoiceContinuity(previous.note, note)),
    0,
  );
  return bestContinuity < 0.35 ? 0.78 : 0.1;
}

function candidateTransitionScore(
  previous: IndexedNote | null,
  current: Candidate,
  group: readonly IndexedNote[],
): number {
  if (current.indexed === null) return restTransitionScore(previous, group);
  if (!previous) return 0.1;
  return transitionScore(previous.note, current.indexed.note);
}

function cloneNote(note: Note): Note {
  return { ...note };
}

function freezeMelodyValue(note: Note): Readonly<Note> {
  return Object.freeze({ ...note });
}

function protectMelodyNote(indexed: IndexedNote): ProtectedMelodyNote {
  const protectedNote: ProtectedMelodyNote = {
    ...indexed.note,
    sourceIndex: indexed.sourceIndex,
    identity: indexed.identity,
    role: "melody",
  };
  return Object.freeze(protectedNote);
}

/**
 * Split a note stream into one deterministic melodic upper voice and its
 * accompaniment. The selected voice is the best continuous path through
 * simultaneous onsets, combining upper-voice position, velocity salience,
 * duration, and local top-line context. Hand labels are intentionally not
 * treated as a melody declaration.
 */
export function splitPianoRoles(
  notes: readonly Note[],
  options: PianoRoleOptions = {},
): PianoRoleSplit {
  const tolerance = Math.max(0, options.onsetTolerance ?? DEFAULT_ONSET_TOLERANCE);
  const indexed = indexedNotes(notes);
  const groups = groupByOnset(indexed, tolerance);
  const playable = indexed.filter(({ note }) => isPlayableNote(note));

  if (groups.length === 0) {
    return Object.freeze({
      melody: Object.freeze([]) as readonly Readonly<Note>[],
      accompaniment: Object.freeze(indexed.map(({ note }) => cloneNote(note))),
      protectedMelody: Object.freeze([]) as readonly ProtectedMelodyNote[],
      melodyMask: Object.freeze(notes.map(() => false)),
      pathEvidence: Object.freeze([]) as readonly PianoRolePathEvidence[],
    });
  }

  const typicalDuration = median(playable.map(({ note }) => note.dur));
  const candidates: Candidate[][] = groups.map((group, groupIndex) => {
    const filtered = options.preferSustainedLine
      ? group.filter((item) => !isShortTopDecoration(item, group, typicalDuration))
      : group;
    const eligible = filtered.length > 0 ? filtered : group;
    const notes = eligible.map((item) => ({
      indexed: item,
      emission: candidateEmission(groupIndex, item, group, groups, typicalDuration, options.preferSustainedLine === true),
    }));
    return options.allowRests
      ? [...notes, { indexed: null, emission: 0.12 }]
      : notes;
  });

  // Viterbi-style dynamic programming keeps an upper voice coherent through
  // repeated contours and prevents a chord's highest note from winning solely
  // because it is in the right hand. The state key is the last non-rest note,
  // so multiple rest groups retain every distinct reconnection history instead
  // of merging them into one lossy null state.
  const lastNoteByIdentity = new Map<string, IndexedNote>();
  for (const group of groups) {
    for (const candidate of group) {
      if (candidate) lastNoteByIdentity.set(candidate.identity, candidate);
    }
  }
  const forwardStates: PathState[][] = [];
  for (let groupIndex = 0; groupIndex < candidates.length; groupIndex++) {
    const current = candidates[groupIndex]!;
    const priorStates = groupIndex === 0
      ? [{ lastIdentity: null, score: 0, stateIndex: -1 }]
      : forwardStates[groupIndex - 1]!.map((state, stateIndex) => ({
        lastIdentity: state.lastIdentity,
        score: state.score,
        stateIndex,
      }));
    const states: PathState[] = [];
    const stateByLastIdentity = new Map<string | null, number>();

    for (const prior of priorStates) {
      const previousLast = prior.lastIdentity ? lastNoteByIdentity.get(prior.lastIdentity)! : null;
      for (let currentIndex = 0; currentIndex < current.length; currentIndex++) {
        const currentCandidate = current[currentIndex]!;
        const lastIdentity = currentCandidate.indexed?.identity ?? prior.lastIdentity;
        const score = prior.score
          + currentCandidate.emission
          + candidateTransitionScore(previousLast, currentCandidate, groups[groupIndex]!);
        const existingIndex = stateByLastIdentity.get(lastIdentity);
        const existing = existingIndex === undefined ? undefined : states[existingIndex];
        const replace = !existing
          || score > existing.score + EPSILON
          || (Math.abs(score - existing.score) <= EPSILON
            && compareCandidates(currentCandidate, current[existing.candidateIndex]!) < 0);
        if (replace) {
          const nextState: PathState = {
            lastIdentity,
            score,
            candidateIndex: currentIndex,
            previousStateIndex: prior.stateIndex,
          };
          if (existingIndex === undefined) {
            stateByLastIdentity.set(lastIdentity, states.length);
            states.push(nextState);
          } else {
            states[existingIndex] = nextState;
          }
        }
      }
    }
    forwardStates.push(states);
  }

  const finalStates = forwardStates[forwardStates.length - 1]!;
  let finalStateIndex = 0;
  for (let index = 1; index < finalStates.length; index++) {
    if (
      finalStates[index]!.score > finalStates[finalStateIndex]!.score + EPSILON
      || (Math.abs(finalStates[index]!.score - finalStates[finalStateIndex]!.score) <= EPSILON
        && compareCandidates(
          candidates[candidates.length - 1]![finalStates[index]!.candidateIndex]!,
          candidates[candidates.length - 1]![finalStates[finalStateIndex]!.candidateIndex]!,
        ) < 0)
    ) {
      finalStateIndex = index;
    }
  }

  const selected = new Set<string>();
  const selectedChoices = new Array<number>(candidates.length);
  let stateIndex = finalStateIndex;
  for (let groupIndex = candidates.length - 1; groupIndex >= 0; groupIndex--) {
    const state = forwardStates[groupIndex]![stateIndex]!;
    selectedChoices[groupIndex] = state.candidateIndex;
    const chosen = candidates[groupIndex]![state.candidateIndex]!;
    if (chosen.indexed) selected.add(chosen.indexed.identity);
    stateIndex = state.previousStateIndex;
  }

  const allLastIdentities: Array<string | null> = [null, ...lastNoteByIdentity.keys()];
  const backward: Array<Map<string | null, number>> = new Array(candidates.length + 1);
  backward[candidates.length] = new Map(allLastIdentities.map((identity) => [identity, 0]));
  for (let groupIndex = candidates.length - 1; groupIndex >= 0; groupIndex--) {
    const continuation = new Map<string | null, number>();
    for (const previousIdentity of allLastIdentities) {
      const previousLast = previousIdentity ? lastNoteByIdentity.get(previousIdentity)! : null;
      let best = -Infinity;
      for (const candidate of candidates[groupIndex]!) {
        const nextIdentity = candidate.indexed?.identity ?? previousIdentity;
        const score = candidate.emission
          + candidateTransitionScore(previousLast, candidate, groups[groupIndex]!)
          + (backward[groupIndex + 1]!.get(nextIdentity) ?? -Infinity);
        best = Math.max(best, score);
      }
      continuation.set(previousIdentity, best);
    }
    backward[groupIndex] = continuation;
  }

  const pathEvidence: PianoRolePathEvidence[] = [];
  for (let groupIndex = 0; groupIndex < candidates.length; groupIndex++) {
    const group = groups[groupIndex]!;
    const chosenIndex = selectedChoices[groupIndex]!;
    const chosen = candidates[groupIndex]![chosenIndex]!;
    const priorStates = groupIndex === 0
      ? [{ lastIdentity: null, score: 0 }]
      : forwardStates[groupIndex - 1]!.map((state) => ({ lastIdentity: state.lastIdentity, score: state.score }));
    const completeScores = candidates[groupIndex]!.map((candidate) => {
      let best = -Infinity;
      for (const prior of priorStates) {
        const previousLast = prior.lastIdentity ? lastNoteByIdentity.get(prior.lastIdentity)! : null;
        const nextIdentity = candidate.indexed?.identity ?? prior.lastIdentity;
        best = Math.max(
          best,
          prior.score
            + candidate.emission
            + candidateTransitionScore(previousLast, candidate, group)
            + (backward[groupIndex + 1]!.get(nextIdentity) ?? -Infinity),
        );
      }
      return best;
    });
    const alternatives = candidates[groupIndex]!
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ index }) => index !== chosenIndex)
      .sort((a, b) => completeScores[b.index]! - completeScores[a.index]!
        || compareCandidates(a.candidate, b.candidate));
    const alternative = alternatives[0];
    if (!alternative) continue;
    const scoreMargin = Math.max(0, completeScores[chosenIndex]! - completeScores[alternative.index]!);
    if (scoreMargin > PATH_AMBIGUITY_MARGIN + EPSILON) continue;
    pathEvidence.push({
      startBeat: Math.max(0, group[0]!.note.start),
      endBeat: Math.max(group[0]!.note.start + 0.25, ...group.map(({ note }) => note.start + note.dur)),
      selectedIdentity: chosen.indexed?.identity ?? null,
      alternativeIdentity: alternative.candidate.indexed?.identity ?? null,
      scoreMargin,
    });
  }

  const melodyIndexed = indexed
    .filter(({ identity }) => selected.has(identity))
    .sort(compareIndexed);
  const accompaniment = indexed
    .filter(({ identity }) => !selected.has(identity))
    .sort(compareIndexed)
    .map(({ note }) => cloneNote(note));
  const melody = melodyIndexed.map(({ note }) => freezeMelodyValue(note));
  const protectedMelody = melodyIndexed.map(protectMelodyNote);
  const melodyMask = notes.map((_, sourceIndex) => melodyIndexed.some((item) => item.sourceIndex === sourceIndex));

  return Object.freeze({
    melody: Object.freeze(melody),
    accompaniment: Object.freeze(accompaniment),
    protectedMelody: Object.freeze(protectedMelody),
    melodyMask: Object.freeze(melodyMask),
    pathEvidence: Object.freeze(pathEvidence),
  });
}
