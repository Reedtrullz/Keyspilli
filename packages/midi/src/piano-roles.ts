import type { Note } from "./types.js";

/** Options for the deterministic piano-role splitter. */
export interface PianoRoleOptions {
  /** Treat starts within this many beats as one simultaneous onset. */
  onsetTolerance?: number;
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
}

interface IndexedNote {
  readonly note: Note;
  readonly sourceIndex: number;
  readonly identity: string;
}

interface Candidate {
  readonly indexed: IndexedNote;
  readonly emission: number;
}

// Keep role grouping aligned with the detector/harmony onset contract.  A
// small amount of jitter is expected in imported piano MIDI, and grouping it
// here prevents a chord from being mistaken for several competing melody
// attacks.
const DEFAULT_ONSET_TOLERANCE = 0.08;
const EPSILON = 1e-9;

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

function candidateEmission(
  groupIndex: number,
  candidate: IndexedNote,
  group: readonly IndexedNote[],
  groups: readonly (readonly IndexedNote[])[],
  typicalDuration: number,
): number {
  const minPitch = group.reduce((minimum, item) => Math.min(minimum, item.note.midi), Infinity);
  const maxPitch = highestMidi(group);
  const pitchRange = Math.max(1, maxPitch - minPitch);
  const pitchRank = clamp((candidate.note.midi - minPitch) / pitchRange);
  const globalPitch = clamp((candidate.note.midi - 36) / 60);
  const velocity = clamp(candidate.note.vel / 127);
  const duration = durationSalience(candidate.note.dur, typicalDuration);
  const topContext = localTopLineContext(groupIndex, candidate, groups);

  // Upper-voice position and local context lead; salience and duration help
  // break ties without making a right-hand label equivalent to melody.
  return (
    0.42 * pitchRank +
    0.2 * topContext +
    0.12 * globalPitch +
    0.14 * velocity +
    0.12 * duration
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
    });
  }

  const typicalDuration = median(playable.map(({ note }) => note.dur));
  const candidates: Candidate[][] = groups.map((group, groupIndex) =>
    group.map((item) => ({
      indexed: item,
      emission: candidateEmission(groupIndex, item, group, groups, typicalDuration),
    })),
  );

  // Viterbi-style dynamic programming keeps an upper voice coherent through
  // repeated contours and prevents a chord's highest note from winning solely
  // because it is in the right hand.
  const scores: number[][] = [];
  const previousChoices: number[][] = [];
  scores.push(candidates[0]!.map((candidate) => candidate.emission));
  previousChoices.push(candidates[0]!.map(() => -1));

  for (let groupIndex = 1; groupIndex < candidates.length; groupIndex++) {
    const current = candidates[groupIndex]!;
    const prior = candidates[groupIndex - 1]!;
    const priorScores = scores[groupIndex - 1]!;
    const currentScores: number[] = [];
    const currentPrevious: number[] = [];

    for (let currentIndex = 0; currentIndex < current.length; currentIndex++) {
      const currentCandidate = current[currentIndex]!;
      let bestScore = -Infinity;
      let bestPrevious = 0;

      for (let previousIndex = 0; previousIndex < prior.length; previousIndex++) {
        const previousCandidate = prior[previousIndex]!;
        const score =
          priorScores[previousIndex]! +
          transitionScore(previousCandidate.indexed.note, currentCandidate.indexed.note);
        if (
          score > bestScore + EPSILON ||
          (Math.abs(score - bestScore) <= EPSILON &&
            compareIndexed(previousCandidate.indexed, prior[bestPrevious]!.indexed) < 0)
        ) {
          bestScore = score;
          bestPrevious = previousIndex;
        }
      }

      currentScores.push(currentCandidate.emission + bestScore);
      currentPrevious.push(bestPrevious);
    }

    scores.push(currentScores);
    previousChoices.push(currentPrevious);
  }

  let selectedIndex = 0;
  const finalScores = scores[scores.length - 1]!;
  for (let index = 1; index < finalScores.length; index++) {
    if (
      finalScores[index]! > finalScores[selectedIndex]! + EPSILON ||
      (Math.abs(finalScores[index]! - finalScores[selectedIndex]!) <= EPSILON &&
        compareIndexed(
          candidates[candidates.length - 1]![index]!.indexed,
          candidates[candidates.length - 1]![selectedIndex]!.indexed,
        ) < 0)
    ) {
      selectedIndex = index;
    }
  }

  const selected = new Set<string>();
  for (let groupIndex = candidates.length - 1; groupIndex >= 0; groupIndex--) {
    const chosen = candidates[groupIndex]![selectedIndex]!;
    selected.add(chosen.indexed.identity);
    selectedIndex = previousChoices[groupIndex]![selectedIndex]!;
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
  });
}
