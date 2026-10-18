import type { Note } from "../types.js";
import type { GuitarLeadRejectionReasons, IdentityNote, GuitarLeadPathDiagnostics, GuitarLeadPathOptions, GuitarLeadRejectionReason, GuitarLeadPathResult } from "./types.js";
import { clamp, EPS } from "./shared.js";

function freshGuitarLeadRejectionReasons(): GuitarLeadRejectionReasons {
  return {
    "selected-primary": 0,
    "harmonic-stack-suppressed": 0,
    "duplicate-onset": 0,
    "register-rejected": 0,
    "leap-rejected": 0,
    "density-rejected": 0,
    "spacing-rejected": 0,
    "continuity-rejected": 0,
    "confidence-rejected": 0,
    "cleanup-rejected": 0,
    other: 0,
  };
}

interface GuitarLeadCandidate {
  id: number;
  note: IdentityNote;
  rawIndex: number;
  phraseId: number;
  groupIndex: number;
  confidence: number;
  melodicSupport: number;
  harmonicPenalty: number;
  wallLike: boolean;
  emission: number;
}

interface GuitarLeadHistory {
  candidate: GuitarLeadCandidate;
  previous?: GuitarLeadHistory;
}

interface GuitarLeadState {
  previous?: GuitarLeadCandidate;
  last?: GuitarLeadCandidate;
  history?: GuitarLeadHistory;
  score: number;
  skipped: number;
  selectedCount: number;
}

interface InternalGuitarLeadPathResult {
  notes: IdentityNote[];
  diagnostics: GuitarLeadPathDiagnostics;
}

function normalizedLeadPitch(note: Note): number {
  return note.midi;
}

export function harmonicCloneDistance(distance: number): boolean {
  return distance === 0 || distance === 7 || distance === 12 || distance === 19 || distance === 24;
}

function guitarLeadConfidence(note: IdentityNote, melodicSupport: number): number {
  const velocity = clamp(note.vel / 127, 0, 1);
  const duration = clamp(note.dur / 0.75, 0, 1);
  const raw = note.rawMidi ?? note.midi;
  const register = raw >= 72 ? 1 : raw >= 64 ? 0.85 : raw >= 61 ? 0.55 : raw >= 55 ? 0.25 : 0;
  return clamp(velocity * 0.42 + duration * 0.22 + melodicSupport * 0.24 + register * 0.12, 0, 1);
}

function guitarLeadWallLike(
  candidate: IdentityNote,
  neighbouringGroups: IdentityNote[][],
): boolean {
  const raw = candidate.rawMidi ?? candidate.midi;
  if (raw > 62) return false;
  const nearby = neighbouringGroups
    .flat()
    .filter((note) => Math.abs(note.start - candidate.start) <= 2 + EPS);
  if (nearby.length < 4) return false;
  const samePitch = nearby.filter((note) => (note.rawMidi ?? note.midi) === raw).length;
  const distinct = new Set(nearby.map((note) => note.rawMidi ?? note.midi));
  const starts = nearby
    .map((note) => note.start)
    .sort((a, b) => a - b)
    .filter((start, index, all) => index === 0 || start - all[index - 1]! > 0.08 + EPS);
  const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
  const medianGap = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]! : Infinity;
  const short = nearby.filter((note) => note.dur <= 0.6 + EPS).length / nearby.length;
  return samePitch / nearby.length >= 0.75
    && distinct.size <= 2
    && medianGap <= 0.75 + EPS
    && short >= 0.75;
}

function guitarLeadTransitionScore(
  previousPrevious: GuitarLeadCandidate | undefined,
  previous: GuitarLeadCandidate | undefined,
  current: GuitarLeadCandidate,
  minimumSpacingBeats: number,
  phraseBreakBeats: number,
): number {
  if (!previous) return 0;
  const gap = current.note.start - previous.note.start;
  if (gap > phraseBreakBeats + EPS) return 0;
  const interval = Math.abs(normalizedLeadPitch(current.note) - normalizedLeadPitch(previous.note));
  const articulated = current.note.vel >= 100
    || current.note.dur >= 0.6
    || ((current.note.rawMidi ?? current.note.midi) >= 88 && current.note.dur >= 0.45);
  let penalty = interval * 0.025;
  if (gap <= 0.5 + EPS && interval >= 7) penalty += 0.9 + (interval - 7) * 0.18;
  if (gap <= 1 + EPS && interval >= 9) penalty += 1.1;
  if (gap <= 1.5 + EPS && interval >= 12) penalty += 1.7;
  if (gap < minimumSpacingBeats + 0.125 && interval >= 5) penalty += 0.35;
  if (articulated) penalty *= 0.35;

  let reward = 0;
  if (interval <= 5) reward += 0.45;
  if (previousPrevious) {
    const incoming = normalizedLeadPitch(previous.note) - normalizedLeadPitch(previousPrevious.note);
    const outgoing = normalizedLeadPitch(current.note) - normalizedLeadPitch(previous.note);
    if (Math.sign(incoming) !== 0 && Math.sign(outgoing) !== 0 && Math.sign(incoming) !== Math.sign(outgoing)
      && Math.abs(incoming) >= 5 && Math.abs(outgoing) >= 5 && !articulated) {
      penalty += 0.8;
    }
    if (Math.abs(normalizedLeadPitch(current.note) - normalizedLeadPitch(previousPrevious.note)) <= 2
      && Math.abs(incoming) >= 9 && Math.abs(outgoing) >= 9 && !articulated) {
      penalty += 1.2;
    }
  }
  return reward - penalty;
}

export function selectGuitarLeadPathInternal(
  inputNotes: Note[],
  options: GuitarLeadPathOptions = {},
): InternalGuitarLeadPathResult {
  const minimumSpacingBeats = Math.max(0, options.minimumSpacingBeats ?? 0.5);
  const groupToleranceBeats = Math.max(0, options.groupToleranceBeats ?? 0.08);
  const phraseBreakBeats = Math.max(0.5, options.phraseBreakBeats ?? 1.5);
  const maxCandidatesPerGroup = Math.max(1, Math.floor(options.maxCandidatesPerGroup ?? 4));
  const beamWidth = Math.max(4, Math.floor(options.beamWidth ?? 24));
  const skipPenalty = Math.max(0, options.skipPenalty ?? 1.5);
  const minimumPhraseGroups = Math.max(0, Math.floor(options.minimumPhraseGroups ?? 0));
  const rawCandidates = inputNotes
    .filter((note) => note.identitySource === "guitar" && note.hand !== "L")
    .filter((note) => Number.isFinite(note.start) && Number.isFinite(note.dur) && note.dur > 0 && Number.isFinite(note.midi))
    .map((note) => ({ ...note, rawMidi: note.midi, identitySource: "guitar" as const }));
  const diagnostics: GuitarLeadPathDiagnostics = {
    rawCandidateCount: rawCandidates.length,
    harmonicGroupCount: 0,
    selectedCount: 0,
    recoveredCount: 0,
    rejectedCount: 0,
    harmonicRejectedCount: 0,
    largeJumpRejectedCount: 0,
    rejectionReasons: freshGuitarLeadRejectionReasons(),
  };
  if (!rawCandidates.length) return { notes: [], diagnostics };
  const sorted = rawCandidates.sort((a, b) => a.start - b.start || a.midi - b.midi || b.vel - a.vel || b.dur - a.dur);
  const rawIndexByNote = new Map<IdentityNote, number>();
  sorted.forEach((note, index) => rawIndexByNote.set(note, index));
  const groups: IdentityNote[][] = [];
  for (const note of sorted) {
    const group = groups.at(-1);
    // Detector timing jitter is transitive: if each adjacent member is within
    // the tolerance, they belong to one physical attack. Comparing only with
    // the first member splits a 0/.07/.13 stack into two attacks and lets a
    // harmonic partial leak into the melodic path.
    if (group && note.start - group.at(-1)!.start <= groupToleranceBeats + EPS) group.push(note);
    else groups.push([note]);
  }
  diagnostics.harmonicGroupCount = groups.length;

  const phraseGroups: IdentityNote[][][] = [];
  for (const group of groups) {
    const phrase = phraseGroups.at(-1);
    const previous = phrase?.at(-1);
    if (!phrase || !previous || group[0]!.start - previous.at(-1)!.start > phraseBreakBeats + EPS) phraseGroups.push([group]);
    else phrase.push(group);
  }
  let nextId = 0;
  const allSelected = new Set<number>();
  const recovered = new Set<number>();
  const allCandidates = new Map<number, GuitarLeadCandidate>();
  const candidateByRawIndex = new Map<number, GuitarLeadCandidate>();

  for (const [phraseId, phrase] of phraseGroups.entries()) {
    const phraseCandidates: GuitarLeadCandidate[][] = phrase.map((group, phraseIndex) => {
      const neighbouringGroups = phrase.slice(Math.max(0, phraseIndex - 3), Math.min(phrase.length, phraseIndex + 4));
      const adjacentGroups = [phrase[phraseIndex - 1], phrase[phraseIndex + 1]].filter(
        (candidate): candidate is IdentityNote[] => Boolean(candidate),
      );
      const preliminary = group.map((note) => {
        // Melodic support comes from adjacent attack groups, not from the
        // octave/fifth stack at the same onset. Otherwise a loud harmonic
        // clone can support itself and defeat the contour evidence.
        const neighbours = adjacentGroups.flat();
        const nearest = neighbours.length
          ? Math.min(...neighbours.map((candidate) => Math.abs(normalizedLeadPitch(candidate) - normalizedLeadPitch(note))))
          : Infinity;
        const support = nearest <= 3 ? 1 : nearest <= 5 ? 0.8 : nearest <= 9 ? 0.35 : 0;
        return { note, support, confidence: guitarLeadConfidence(note, support) };
      });
      const qualityByNote = new Map(preliminary.map((entry) => [entry.note, entry.confidence]));
      const candidates = preliminary.map(({ note, support, confidence }) => {
        const raw = note.rawMidi ?? note.midi;
        const wallLike = guitarLeadWallLike(note, neighbouringGroups);
        const clonePeers = group.filter((peer) => peer !== note && harmonicCloneDistance(Math.abs((peer.rawMidi ?? peer.midi) - raw)));
        const strongerClone = clonePeers.some((peer) => (qualityByNote.get(peer) ?? 0) > confidence + 0.08
          || (peer.dur >= note.dur + 0.15 && peer.vel >= note.vel * 0.5));
        const highLanding = raw >= 88 && (note.vel >= 80 || note.dur >= 0.75);
        const harmonicPenalty = strongerClone ? (highLanding ? 0.15 : 0.7) : 0;
        const isolatedPenalty = support === 0 && note.vel < 70 && note.dur < 0.15 ? 0.9 : 0;
        const wallPenalty = wallLike ? 1.1 : 0;
        const endpoint = phraseIndex === 0 || phraseIndex === phrase.length - 1;
        const emission = 1.5
          + confidence * 2
          + support * 0.75
          // An upper guitar attack is more likely to be the melodic voice
          // than a registered low shell. Keep this preference independent of
          // velocity: Basic Pitch can assign the actual lead a quieter
          // velocity than a rhythm partial at the same onset.
          + (raw >= 72 ? 0.6 : raw >= 64 ? 0.15 : 0)
          + (endpoint ? 0.7 : 0)
          + (highLanding ? 0.75 : 0)
          - harmonicPenalty
          - isolatedPenalty
          - wallPenalty;
        return {
          id: nextId++,
          note,
          rawIndex: rawIndexByNote.get(note) ?? -1,
          phraseId,
          groupIndex: phraseIndex,
          confidence,
          melodicSupport: support,
          harmonicPenalty,
          wallLike,
          emission,
        } satisfies GuitarLeadCandidate;
      });
      for (const candidate of candidates) candidateByRawIndex.set(candidate.rawIndex, candidate);
      const retained = candidates
        .sort((a, b) => b.emission - a.emission || b.confidence - a.confidence || a.note.start - b.note.start || a.note.midi - b.note.midi)
        .slice(0, phrase.length < minimumPhraseGroups ? candidates.length : maxCandidatesPerGroup);
      for (const candidate of retained) allCandidates.set(candidate.id, candidate);
      return retained;
    });

    // Very short phrases do not contain enough temporal evidence for a
    // second-order path decision. Keep every existing candidate in those
    // groups and let the established monophonic/register chooser select the
    // stack representative downstream; this preserves sparse lead entries,
    // vocal handoffs, and octave-fold fixtures without weakening the long-
    // phrase DP's artifact rejection.
    if (phrase.length < minimumPhraseGroups) {
      phraseCandidates.flat().forEach((candidate) => allSelected.add(candidate.id));
      continue;
    }

    let states: GuitarLeadState[] = [{ score: 0, skipped: 0, selectedCount: 0 }];
    for (let phraseGroupIndex = 0; phraseGroupIndex < phraseCandidates.length; phraseGroupIndex += 1) {
      const group = phraseCandidates[phraseGroupIndex]!;
      const endpointGroup = phraseGroupIndex === 0 || phraseGroupIndex === phraseCandidates.length - 1;
      const nextStates: GuitarLeadState[] = [];
      for (const state of states) {
        const bestEmission = group[0]?.emission ?? 0;
        const weakGroup = bestEmission < 2.3;
        let emitted = false;
        if (!endpointGroup) {
          nextStates.push({
            ...state,
            score: state.score - (weakGroup ? skipPenalty * 0.55 : skipPenalty),
            skipped: state.skipped + 1,
          });
        }
        for (const candidate of group) {
          if (state.last && candidate.note.start - state.last.note.start < minimumSpacingBeats - EPS) continue;
          emitted = true;
          const transition = guitarLeadTransitionScore(
            state.previous,
            state.last,
            candidate,
            minimumSpacingBeats,
            phraseBreakBeats,
          );
          nextStates.push({
            previous: state.last,
            last: candidate,
            history: { candidate, previous: state.history },
            score: state.score + candidate.emission + transition,
            skipped: state.skipped,
            selectedCount: state.selectedCount + 1,
          });
        }
        // Keep a malformed/overlapping endpoint from deleting the entire
        // phrase. Normal phrases have at least one compatible endpoint; this
        // fallback only applies when every endpoint candidate violates the
        // spacing floor imposed by an earlier attack.
        if (endpointGroup && !emitted) {
          nextStates.push({
            ...state,
            score: state.score - (weakGroup ? skipPenalty * 0.55 : skipPenalty),
            skipped: state.skipped + 1,
          });
        }
      }
      const deduped = new Map<string, GuitarLeadState>();
      for (const state of nextStates) {
        const key = `${state.previous?.id ?? -1}:${state.last?.id ?? -1}`;
        const current = deduped.get(key);
        if (!current || state.score > current.score + EPS
          || (Math.abs(state.score - current.score) <= EPS && state.skipped < current.skipped)) deduped.set(key, state);
      }
      states = [...deduped.values()]
        .sort((a, b) => b.score - a.score || b.selectedCount - a.selectedCount || a.skipped - b.skipped
          || (a.last?.id ?? -1) - (b.last?.id ?? -1))
        .slice(0, beamWidth);
    }
    if (!states.length) continue;
    const winner = states.reduce((best, state) => state.score > best.score + EPS
      || (Math.abs(state.score - best.score) <= EPS && state.selectedCount > best.selectedCount) ? state : best, states[0]!);
    const selected: GuitarLeadCandidate[] = [];
    for (let history = winner.history; history; history = history.previous) selected.push(history.candidate);
    selected.reverse();
    selected.forEach((candidate) => allSelected.add(candidate.id));

    if (options.allowGapRecovery !== false && selected.length >= 2) {
      const selectedByStart = [...selected].sort((a, b) => a.note.start - b.note.start || a.id - b.id);
      for (let index = 1; index < selectedByStart.length; index++) {
        const previous = selectedByStart[index - 1]!;
        const current = selectedByStart[index]!;
        const gap = current.note.start - previous.note.start;
        // A gap is suspicious once it is materially wider than the active
        // learner floor.  Do not scale this by the floor itself: a diagnostic
        // caller may use a deliberately wide 1.5-beat floor to force a
        // bridge candidate, while normal Easy/Medium floors remain at .5.
        if (gap <= Math.max(1.25, minimumSpacingBeats + 0.5) + EPS) continue;
        const recoverySpacing = Math.min(0.5, minimumSpacingBeats);
        const between = phraseCandidates.flat().filter((candidate) => !allSelected.has(candidate.id)
          && candidate.note.start > previous.note.start + recoverySpacing - EPS
          && candidate.note.start < current.note.start - recoverySpacing + EPS
          && !candidate.wallLike
          && candidate.harmonicPenalty < 0.5);
        let bridge: GuitarLeadCandidate | undefined;
        let bridgeScore = Number.NEGATIVE_INFINITY;
        for (const candidate of between) {
          const before = candidate.note.start - previous.note.start;
          const after = current.note.start - candidate.note.start;
          if (before < recoverySpacing - EPS || after < recoverySpacing - EPS) continue;
          const ratio = before / gap;
          const interpolated = previous.note.midi + (current.note.midi - previous.note.midi) * ratio;
          const error = Math.abs(candidate.note.midi - interpolated);
          const stepwise = Math.abs(candidate.note.midi - previous.note.midi) <= 5
            && Math.abs(current.note.midi - candidate.note.midi) <= 5;
          const articulated = candidate.note.vel >= 80 || candidate.note.dur >= 0.25;
          if (error > (stepwise ? 5 : articulated ? 3 : 2.5)) continue;
          const score = candidate.emission + (stepwise ? 2.5 : 0) + (error <= 2 ? 1 : 0)
            + (articulated ? 0.8 : 0) - error * 0.35;
          if (score > bridgeScore + EPS) {
            bridge = candidate;
            bridgeScore = score;
          }
        }
        if (bridge) {
          allSelected.add(bridge.id);
          recovered.add(bridge.id);
          selectedByStart.splice(index, 0, bridge);
          index += 1;
        }
      }
    }
  }

  const selectedNotes = [...allCandidates.values()]
    .filter((candidate) => allSelected.has(candidate.id))
    .map((candidate) => ({ ...candidate.note, rawMidi: candidate.note.rawMidi ?? candidate.note.midi, identitySource: "guitar" as const, hand: "R" as const }))
    .sort((a, b) => a.start - b.start || a.midi - b.midi || b.vel - a.vel);
  diagnostics.selectedCount = selectedNotes.length;
  diagnostics.recoveredCount = recovered.size;
  diagnostics.rejectedCount = Math.max(0, diagnostics.rawCandidateCount - diagnostics.selectedCount);
  diagnostics.harmonicRejectedCount = [...allCandidates.values()]
    .filter((candidate) => !allSelected.has(candidate.id) && (candidate.harmonicPenalty > 0 || candidate.wallLike)).length;
  diagnostics.largeJumpRejectedCount = [...allCandidates.values()]
    .filter((candidate) => !allSelected.has(candidate.id)
      && candidate.harmonicPenalty <= 0
      && !candidate.wallLike
      && candidate.melodicSupport < 0.5).length;

  // Keep the forensic accounting separate from the selector's score and
  // state transitions.  Each valid raw guitar candidate receives exactly one
  // first-explanation outcome, so the aggregate can be used as a conservation
  // check without becoming another musical heuristic.  Register and cleanup
  // are intentionally zero here: those decisions happen after this selector.
  const rejectionReasons = diagnostics.rejectionReasons ?? freshGuitarLeadRejectionReasons();
  const selectedCandidates = [...allCandidates.values()]
    .filter((candidate) => allSelected.has(candidate.id))
    .sort((a, b) => a.note.start - b.note.start || a.note.midi - b.note.midi || a.id - b.id);
  const selectedByGroup = new Map<string, GuitarLeadCandidate[]>();
  for (const candidate of selectedCandidates) {
    const key = `${candidate.phraseId}:${candidate.groupIndex}`;
    const group = selectedByGroup.get(key) ?? [];
    group.push(candidate);
    selectedByGroup.set(key, group);
  }
  const incrementReason = (reason: GuitarLeadRejectionReason): void => {
    rejectionReasons[reason] += 1;
  };
  const previousSelected = (candidate: GuitarLeadCandidate): GuitarLeadCandidate | undefined => {
    for (let index = selectedCandidates.length - 1; index >= 0; index -= 1) {
      const previous = selectedCandidates[index]!;
      if (previous.phraseId === candidate.phraseId && previous.note.start < candidate.note.start - EPS) return previous;
    }
    return undefined;
  };
  const nextSelected = (candidate: GuitarLeadCandidate): GuitarLeadCandidate | undefined => {
    return selectedCandidates.find((next) => next.phraseId === candidate.phraseId
      && next.note.start > candidate.note.start + EPS);
  };
  for (let rawIndex = 0; rawIndex < sorted.length; rawIndex += 1) {
    const candidate = candidateByRawIndex.get(rawIndex);
    if (!candidate) {
      incrementReason("other");
      continue;
    }
    if (allSelected.has(candidate.id)) {
      incrementReason("selected-primary");
      continue;
    }

    const selectedAtOnset = selectedByGroup.get(`${candidate.phraseId}:${candidate.groupIndex}`) ?? [];
    const raw = candidate.note.rawMidi ?? candidate.note.midi;
    const exactDuplicate = selectedAtOnset.some((selected) => {
      const selectedRaw = selected.note.rawMidi ?? selected.note.midi;
      return selectedRaw === raw && Math.abs(selected.note.start - candidate.note.start) <= groupToleranceBeats + EPS;
    });
    const harmonicClone = selectedAtOnset.some((selected) => {
      const selectedRaw = selected.note.rawMidi ?? selected.note.midi;
      return harmonicCloneDistance(Math.abs(selectedRaw - raw));
    });
    const previous = previousSelected(candidate);
    const next = nextSelected(candidate);
    const spacingConflict = selectedCandidates.some((selected) => selected.phraseId === candidate.phraseId
      && selected.note.start !== candidate.note.start
      && Math.abs(selected.note.start - candidate.note.start) < minimumSpacingBeats - EPS);
    const incoming = previous ? candidate.note.midi - previous.note.midi : 0;
    const outgoing = next ? next.note.midi - candidate.note.midi : 0;
    const hasLargeLeap = (previous !== undefined
      && candidate.note.start - previous.note.start <= 1.5 + EPS
      && Math.abs(incoming) >= 7)
      || (next !== undefined
        && next.note.start - candidate.note.start <= 1.5 + EPS
        && Math.abs(outgoing) >= 7);
    const hasContinuityBreak = previous !== undefined && next !== undefined
      && Math.sign(incoming) !== 0
      && Math.sign(outgoing) !== 0
      && Math.sign(incoming) !== Math.sign(outgoing)
      && Math.abs(incoming) >= 5
      && Math.abs(outgoing) >= 5
      && Math.abs(next.note.midi - previous.note.midi) <= 5;
    const confidenceRejected = candidate.confidence < 0.4
      || (candidate.melodicSupport === 0 && candidate.note.vel < 70 && candidate.note.dur < 0.15);

    if (exactDuplicate) incrementReason("duplicate-onset");
    else if (harmonicClone || candidate.harmonicPenalty > 0 || candidate.wallLike) incrementReason("harmonic-stack-suppressed");
    else if (confidenceRejected) incrementReason("confidence-rejected");
    else if (spacingConflict) incrementReason("spacing-rejected");
    else if (hasContinuityBreak) incrementReason("continuity-rejected");
    else if (hasLargeLeap) incrementReason("leap-rejected");
    else if (!selectedAtOnset.length) incrementReason("density-rejected");
    else incrementReason("other");
  }
  diagnostics.rejectionReasons = rejectionReasons;
  return { notes: selectedNotes, diagnostics };
}

/**
 * Select a deterministic, guitar-only melodic path from existing candidates.
 * The public result strips the internal raw-pitch field but preserves source,
 * onset, duration, velocity, and pitch exactly.
 */
export function selectGuitarLeadPath(notes: Note[], options: GuitarLeadPathOptions = {}): GuitarLeadPathResult {
  const internal = selectGuitarLeadPathInternal(notes, options);
  return {
    notes: internal.notes.map(({ rawMidi: _rawMidi, ...note }) => ({ ...note, identitySource: "guitar" as const })),
    diagnostics: internal.diagnostics,
  };
}
