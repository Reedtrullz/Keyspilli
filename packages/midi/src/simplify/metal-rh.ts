import { Note } from "../types.js";
import { selectGuitarLeadPath } from "../metal-arrange.js";
import { normalizeTempoBpm, isMetalInstrumentalSource } from "./shared.js";

/**
 * Keep the upper guitar line separate from a simultaneous low rhythm wall in
 * learner metal variants. The arranger has already reduced each stem to one
 * event per onset, so a high, moving lead phrase is the useful identity while
 * low attacks in that same phrase are almost always accompaniment leakage.
 * This is deliberately gated to legato learner levels; Advanced retains the
 * source detail and the vocal lane is never filtered here.
 */
function suppressLowGuitarLeadFiller(notes: Note[], legato: boolean): Note[] {
  if (!legato || notes.length < 4) return notes;
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  const guitar = sorted.filter((note) => note.identitySource === "guitar");
  if (guitar.length < 4) return notes;

  const leadPhraseNotes = new Set<Note>();
  for (const note of guitar) {
    if (note.midi > 62) continue;
    // Use a short sliding window instead of only consecutive events. A
    // separated stem can contain rests or vocal handoffs between the upper
    // lead and its low rhythm partials; those gaps must not hide the lead
    // evidence that tells us the low event belongs in the accompaniment.
    const high = guitar.filter((candidate) =>
      candidate.midi >= 68 && Math.abs(candidate.start - note.start) <= 4 + 1e-9,
    );
    const distinctHigh = new Set(high.map((note) => note.midi)).size;
    const highSpan = high.length
      ? Math.max(...high.map((note) => note.midi)) - Math.min(...high.map((note) => note.midi))
      : 0;
    // A few upper attacks with a moving contour are enough to distinguish a
    // lead/solo phrase from a low riff. Requiring both register and contour
    // keeps a single high chord partial from suppressing a genuine low lead.
    const leadLike = high.length >= 3
      && distinctHigh >= 3
      && (highSpan >= 5 || Math.max(...high.map((note) => note.midi)) >= 76);
    if (leadLike) leadPhraseNotes.add(note);
  }
  if (!leadPhraseNotes.size) return notes;
  return notes.filter((note) => !leadPhraseNotes.has(note));
}

/**
 * Remove a short guitar excursion when the source lane makes an obvious
 * return to the same pitch neighbourhood. The identity stream is often
 * interleaved with vocal anchors, so looking only at adjacent events misses
 * exactly these detector detours. This pass deliberately skips vocals while
 * finding guitar neighbours and is limited to legato learner levels; the
 * Advanced lane remains a faithful source-detail reference.
 */
function removeInterleavedGuitarDetours(notes: Note[], tempoBpm: number, legato: boolean): Note[] {
  if (!legato || notes.length < 3) return notes;
  const secondsPerBeat = 60 / normalizeTempoBpm(tempoBpm);
  let current = [...notes];
  // A second pass catches a pair of adjacent excursions without allowing a
  // long chain of removals to collapse an entire phrase into its endpoints.
  for (let pass = 0; pass < 2; pass++) {
    const sorted = current.sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
    const remove = new Set<Note>();
    for (const source of ["guitar", "other"] as const) {
      const sourceIndexes = sorted
        .map((note, index) => note.identitySource === source ? index : -1)
        .filter((index) => index >= 0);
      for (let position = 1; position < sourceIndexes.length - 1; position++) {
        const previous = sorted[sourceIndexes[position - 1]!]!;
        const note = sorted[sourceIndexes[position]!]!;
        const next = sorted[sourceIndexes[position + 1]!]!;
        const interveningVocal = sorted
          .slice(sourceIndexes[position]! + 1, sourceIndexes[position + 1]!)
          .find((candidate) => candidate.identitySource === "vocals");
        const phraseLanding = interveningVocal !== undefined
          && interveningVocal.start - note.start <= 1.5 + 1e-9
          && note.start - previous.start <= 1 + 1e-9
          && Math.abs(note.midi - previous.midi) <= 7;
        if (phraseLanding) continue;
        const intoBeats = note.start - previous.start;
        const outBeats = next.start - note.start;
        const durationSec = note.dur * secondsPerBeat;
        const downbeat = Math.abs(note.start - Math.round(note.start)) <= 1e-9;
        // A quiet, short detector spike on a barline is still removable. Real
        // downbeat landings are protected by their velocity/duration (and by
        // the high-landing guard below), rather than by timing alone.
        const downbeatAnchor = downbeat && (note.vel >= 90 || durationSec >= 0.35);
        const highLanding = note.midi >= 76
          && note.midi >= Math.max(previous.midi, next.midi)
          && (note.vel >= 90 || durationSec >= 0.35);
        const detour = intoBeats <= 1.5 + 1e-9
          && outBeats <= 1.5 + 1e-9
          && durationSec <= 0.35 + 1e-9
          && !downbeatAnchor
          && !highLanding
          && note.vel < 100
          && Math.abs(note.midi - previous.midi) >= 5
          && Math.abs(note.midi - next.midi) >= 5
          && Math.abs(previous.midi - next.midi) <= 5
          && Math.sign(note.midi - previous.midi) !== Math.sign(next.midi - note.midi);
        if (detour) remove.add(note);
      }
    }
    if (!remove.size) break;
    current = sorted.filter((note) => !remove.has(note));
  }
  return current;
}

/**
 * Remove an isolated guitar interjection immediately before a vocal anchor
 * when it would force a large, fast register handoff.  A vocal phrase is
 * identity-bearing, so it is never filtered; this gate only removes a weak
 * guitar singleton that has no nearby guitar support of its own.  Keeping
 * the gate source-aware is important: the reference arrangement has a dense
 * lower accompaniment, but its upper line does not alternate between distant
 * instrumental and vocal registers on every attack.
 */
function removeWeakGuitarVocalHandoffs(notes: Note[], tempoBpm: number, legato: boolean): Note[] {
  if (!legato || notes.length < 3) return notes;
  const secondsPerBeat = 60 / normalizeTempoBpm(tempoBpm);
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  const vocals = sorted.filter((note) => note.identitySource === "vocals");
  const instrumentals = sorted.filter((note) => isMetalInstrumentalSource(note.identitySource));
  if (vocals.length < 1 || instrumentals.length < 1) return notes;
  const maxVocalBracketBeats = 1.5;
  const maxHandoffBeats = 1;
  const maxSupportBeats = 0.75;
  return sorted.filter((note) => {
    if (!isMetalInstrumentalSource(note.identitySource)) return true;
    const source = note.identitySource;
    const nextVocal = vocals.find((vocal) => vocal.start >= note.start - 1e-9 && vocal.start - note.start <= maxVocalBracketBeats + 1e-9);
    // A guitar attack immediately before a vocal entrance is the risky case:
    // it can make the next singer note appear as a register jump. Restrict
    // this gate to that direction. Guitar attacks after a vocal are retained
    // so a phrase landing is not deleted merely because the next vocal is
    // farther away.
    if (!nextVocal) return true;

    const previousInstrumental = [...instrumentals]
      .reverse()
      .find((candidate) => candidate.identitySource === source && candidate.start < note.start - 1e-9);
    const nextInstrumental = instrumentals
      .find((candidate) => candidate.identitySource === source && candidate.start > note.start + 1e-9);
    const durationSec = note.dur * secondsPerBeat;
    const toVocal = nextVocal.start - note.start;
    const nextLeap = Math.abs(nextVocal.midi - note.midi);
    const terminalStepWorsensHandoff = previousInstrumental !== undefined
      && note.start - previousInstrumental.start <= maxSupportBeats + 1e-9
      && toVocal <= maxHandoffBeats + 1e-9
      // Legato scheduling may have already lengthened a selected detector
      // attack to the next vocal entrance. Permit that bounded extension
      // here, while still rejecting genuinely sustained (>~half-second)
      // bridge notes.
      && durationSec <= 0.55 + 1e-9
      && note.vel < 80
      && Math.abs(note.midi - previousInstrumental.midi) <= 5
      && nextLeap >= 12
      && nextLeap >= Math.abs(nextVocal.midi - previousInstrumental.midi) + 3;
    if (terminalStepWorsensHandoff) return false;
    const supportedByPrevious = previousInstrumental !== undefined
      && note.start - previousInstrumental.start <= maxSupportBeats + 1e-9;
    const supportedByNext = nextInstrumental !== undefined
      && nextInstrumental.start - note.start <= maxSupportBeats + 1e-9;
    if (supportedByPrevious || supportedByNext) return true;

    const abruptHandoff = toVocal <= maxHandoffBeats + 1e-9 && nextLeap >= 9;
    if (!abruptHandoff) return true;

    const protectedLanding = note.vel >= 90
      || durationSec >= 0.5
      || (note.midi >= 76 && (note.vel >= 80 || durationSec >= 0.35));
    if (protectedLanding) return true;
    return false;
  });
}

/**
 * A legato learner may tie detector re-attacks, but a repeated pitch inside a
 * changing guitar contour is still a real melodic event. Basic Pitch often
 * emits two or three same-pitch attacks immediately before a stepwise move;
 * collapsing those before contour selection is the main way a metal solo
 * becomes unnaturally sparse. Require a genuine local contour before
 * preserving the re-attack so a single-pitch rhythm wall keeps the existing
 * tie/thinning behaviour.
 */
function hasMovingGuitarContext(note: Note, source: Note[]): boolean {
  if (note.identitySource !== "guitar") return false;
  const context = source
    .filter((candidate) => candidate.identitySource === "guitar"
      && Math.abs(candidate.start - note.start) <= 2.5 + 1e-9)
    .sort((a, b) => a.start - b.start || b.vel - a.vel);
  if (new Set(context.map((candidate) => candidate.midi)).size < 3) return false;
  return context.some((candidate) => candidate.midi !== note.midi
    && Math.abs(candidate.start - note.start) <= 0.9 + 1e-9);
}

/**
 * Remove a very weak, short vocal fragment that immediately returns to the
 * same pitch. Basic Pitch can split one sung syllable into a tiny lower
 * contour flicker; making that flicker a learner attack is more distracting
 * than helpful. Keep this deliberately narrower than the guitar cleanup:
 * only repeated-pitch brackets are eligible, vocal notes remain untouched in
 * Advanced/source levels, and a sustained, loud, or otherwise substantial
 * centre note is always retained.
 */
function removeWeakVocalDetours(notes: Note[], tempoBpm: number, legato: boolean): Note[] {
  if (!legato || notes.length < 3) return notes;
  const secondsPerBeat = 60 / normalizeTempoBpm(tempoBpm);
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  const vocals = sorted.filter((note) => note.identitySource === "vocals");
  if (vocals.length < 3) return notes;

  const remove = new Set<Note>();
  const maxBracketBeats = 1;
  const maxCentreDurationSec = 0.35;
  const maxCentreVelocity = 70;
  const maxEndpointDistance = 2;
  const minExcursion = 3;

  for (let index = 1; index < vocals.length - 1; index++) {
    const previous = vocals[index - 1]!;
    const note = vocals[index]!;
    const next = vocals[index + 1]!;
    const beforeBeats = note.start - previous.start;
    const afterBeats = next.start - note.start;
    const durationSec = note.dur * secondsPerBeat;
    const centreIsWeak = note.vel <= maxCentreVelocity
      && note.vel <= Math.max(previous.vel, next.vel) * 0.8 + 1e-9;
    const repeatedBracket = previous.midi === next.midi;
    const isDetour = repeatedBracket
      && beforeBeats > 0
      && afterBeats > 0
      && beforeBeats <= maxBracketBeats + 1e-9
      && afterBeats <= maxBracketBeats + 1e-9
      && durationSec <= maxCentreDurationSec + 1e-9
      && note.vel < maxCentreVelocity
      && centreIsWeak
      && Math.abs(note.midi - previous.midi) >= minExcursion
      && Math.abs(note.midi - next.midi) >= minExcursion
      && Math.abs(previous.midi - next.midi) <= maxEndpointDistance;
    if (isDetour) remove.add(note);
  }

  return remove.size ? sorted.filter((note) => !remove.has(note)) : notes;
}

/**
 * Remove an unsupported residual-stem spike before learner merging can make
 * its neighbours look farther apart.  The `other` lane is often a full-mix
 * residue: a quiet, eighth-note detector hit can sit between two ordinary
 * upper attacks and sound like a random piano leap.  Keep this deliberately
 * residual-only and legato-only; vocals, dedicated guitar, and Advanced
 * source detail are not altered.
 */
function removeResidualUpperOutliers(notes: Note[], legato: boolean): Note[] {
  if (!legato || notes.length < 3) return notes;
  const residual = notes
    .filter((note) => note.identitySource === "other" && note.midi >= 61)
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  if (residual.length < 3) return notes;

  const remove = new Set<Note>();
  for (let index = 1; index < residual.length - 1; index++) {
    const previous = residual[index - 1]!;
    const note = residual[index]!;
    const next = residual[index + 1]!;
    const beforeBeats = note.start - previous.start;
    const afterBeats = next.start - note.start;
    if (beforeBeats > 1.5 + 1e-9 || afterBeats > 1.5 + 1e-9) continue;
    if (note.vel > 48 || note.dur > 0.375 + 1e-9) continue;
    if (Math.abs(note.midi - previous.midi) < 7 || Math.abs(note.midi - next.midi) < 7) continue;
    if (Math.abs(previous.midi - next.midi) > 5) continue;
    const hasSamePitchSupport = residual.some((candidate) => candidate !== note
      && candidate.midi === note.midi
      && Math.abs(candidate.start - note.start) <= 2 + 1e-9);
    if (hasSamePitchSupport) continue;
    remove.add(note);
  }
  return remove.size ? notes.filter((note) => !remove.has(note)) : notes;
}

/**
 * Remove a single weak guitar attack that is literally bracketed by vocal
 * attacks in the selected learner melody.  The pre-selection handoff guard
 * above cannot see this shape reliably: richer candidates can support the
 * guitar note before scheduling and then be discarded by the spacing/voice
 * selector.  Run this bounded post-selection pass so the decision is based
 * on the notes that will actually be played.
 *
 * This is intentionally narrower than a general source smoother.  Vocals are
 * immutable; a guitar run with a nearby guitar neighbour is retained; and a
 * strong, sustained, or high landing is retained.  Only an exact-pitch
 * redundant singleton or one that creates a >=7-semitone vocal handoff inside
 * one beat is removed.  Advanced/source detail bypasses the pass via
 * `legato=false`.
 */
function removeIsolatedGuitarVocalSingletons(notes: Note[], tempoBpm: number, legato: boolean): Note[] {
  if (!legato || notes.length < 3) return notes;
  const secondsPerBeat = 60 / normalizeTempoBpm(tempoBpm);
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  const remove = new Set<Note>();
  const maxBracketBeats = 1;
  const maxConnectedGuitarGap = 0.75;

  for (let index = 1; index < sorted.length - 1; index++) {
    const note = sorted[index]!;
    const previous = sorted[index - 1]!;
    const next = sorted[index + 1]!;
    if (
      !isMetalInstrumentalSource(note.identitySource)
      || previous.identitySource !== "vocals"
      || next.identitySource !== "vocals"
    ) continue;
    const source = note.identitySource;
    const beforeBeats = note.start - previous.start;
    const afterBeats = next.start - note.start;
    if (beforeBeats > maxBracketBeats + 1e-9 || afterBeats > maxBracketBeats + 1e-9) continue;

    // Do not call a member of a connected guitar run a singleton merely
    // because a vocal note happens to sit on one side of it.  Search the
    // selected stream, not the richer pre-selection candidates.
    const previousInstrumental = [...sorted.slice(0, index)]
      .reverse()
      .find((candidate) => candidate.identitySource === source);
    const nextInstrumental = sorted.slice(index + 1)
      .find((candidate) => candidate.identitySource === source);
    if (
      (previousInstrumental && note.start - previousInstrumental.start <= maxConnectedGuitarGap + 1e-9)
      || (nextInstrumental && nextInstrumental.start - note.start <= maxConnectedGuitarGap + 1e-9)
    ) continue;

    const durationSec = note.dur * secondsPerBeat;
    const protectedLanding = note.vel >= 90
      || durationSec >= 0.5
      || (note.midi >= 76 && (note.vel >= 80 || durationSec >= 0.35));
    if (protectedLanding) continue;

    const redundant = note.midi === previous.midi || note.midi === next.midi;
    const directVocalLeap = Math.abs(next.midi - previous.midi);
    const adjacentLeap = Math.max(
      Math.abs(note.midi - previous.midi),
      Math.abs(next.midi - note.midi),
    );
    const createsLargeHandoff = adjacentLeap >= 7
      // A quiet guitar bridge can make a large vocal leap playable (for
      // example 64 -> 72 -> 80). Do not delete it merely because each leg
      // is wide; the singleton is disposable only when it is no better than
      // the direct vocal handoff it would replace.
      && adjacentLeap >= directVocalLeap;
    if (redundant || createsLargeHandoff) remove.add(note);
  }
  return remove.size ? sorted.filter((note) => !remove.has(note)) : notes;
}

function metalInstrumentalTransitionPenalty(previous: Note, note: Note, gapBeats: number): number {
  if (!isMetalInstrumentalSource(previous.identitySource)
    || previous.identitySource !== note.identitySource) return 0;
  if (!Number.isFinite(gapBeats) || gapBeats <= 0 || gapBeats > 1.5 + 1e-9) return 0;
  const leap = Math.abs(note.midi - previous.midi);
  if (leap < 5) return 0;
  const comfortable = gapBeats <= 0.5 + 1e-9 ? 5 : gapBeats <= 1 + 1e-9 ? 7 : 12;
  const excess = Math.max(0, leap - comfortable);
  // A fixed surcharge for a fast >=7-semitone travel prevents a low-weight
  // detector spike from winning over a connected step, while the excess term
  // still lets a phrase resolve by a genuine octave when no nearby option
  // exists. Add a little extra pressure above an octave: that is the common
  // register-flicker shape in separated guitar stems, not a hard rejection.
  const quietSpike = note.vel < 60 && note.dur <= 0.2 + 1e-9 && leap >= 7;
  return excess * 0.25
    + (leap >= 7 && gapBeats <= 1 + 1e-9 ? 0.35 : 0)
    + (leap >= 10 && gapBeats <= 1.5 + 1e-9 ? 0.6 : 0)
    + (leap >= 10 && gapBeats <= 1 + 1e-9 ? 3.5 : 0)
    + (quietSpike ? 2.5 : 0);
}

/**
 * Prefer a connected stepwise bridge when the scheduler would otherwise
 * leave a long hole in a lead phrase. This is intentionally a soft, local
 * penalty: a real rest, a source handoff, or a gap with no usable bridge is
 * left alone, while a quiet candidate that can fill the hole earns a chance
 * to survive the learner spacing pass.
 */
function metalInstrumentalCoveragePenalty(
  phrase: Note[],
  candidates: { note: Note; phraseIndex: number }[],
  previousIndex: number,
  currentIndex: number,
  minimumSpacingBeats: number,
): number {
  const previous = candidates[previousIndex]?.note;
  const current = candidates[currentIndex]?.note;
  if (
    !previous
    || !current
    || !isMetalInstrumentalSource(previous.identitySource)
    || previous.identitySource !== current.identitySource
  ) return 0;
  const source = previous.identitySource;
  const gapBeats = current.start - previous.start;
  const targetGap = Math.max(1, minimumSpacingBeats * 2);
  if (gapBeats <= targetGap + 1e-9) {
    // In a connected guitar lead, a comfortable half-/whole-beat connector
    // is positive evidence rather than a cost. The ordinary salience DP can
    // otherwise choose two loud endpoints and leave an unplayable hole even
    // though a supported stepwise attack exists between them. Keep this
    // reward guitar-only so residual fallback lanes do not regain detector
    // chatter merely because they are dense.
    return source === "guitar" && gapBeats >= minimumSpacingBeats - 1e-9
      && Math.abs(current.midi - previous.midi) <= 5
      ? -0.8
      : 0;
  }
  // Keep the bridge lookup local. Besides avoiding an allocation for every
  // DP edge, this bounds the nested scan on dense detector output to a small
  // phrase neighbourhood rather than turning the O(n^2) contour DP into an
  // accidental O(n^3) pass on long uploads.
  if (gapBeats > targetGap + 3 + 1e-9) return 0;

  const previousPhraseIndex = candidates[previousIndex]!.phraseIndex;
  const currentPhraseIndex = candidates[currentIndex]!.phraseIndex;
  // Candidate filtering removes vocals, so a candidate-only scan could make
  // a guitar bridge jump across an intervening vocal or other source event.
  // The original phrase is authoritative for source barriers.
  for (let phraseIndex = previousPhraseIndex + 1; phraseIndex < currentPhraseIndex; phraseIndex++) {
    if (phrase[phraseIndex]!.identitySource !== source) return 0;
  }

  let hasStepwiseBridge = false;
  for (let middleIndex = previousIndex + 1; middleIndex < currentIndex; middleIndex++) {
    const note = candidates[middleIndex]!.note;
    const beforeGap = note.start - previous.start;
    const afterGap = current.start - note.start;
    const directionTurns = Math.sign(note.midi - previous.midi) !== Math.sign(current.midi - note.midi);
    const quietShortSpike = note.vel < 70 && note.dur <= 0.25 + 1e-9
      && directionTurns
      && Math.max(Math.abs(note.midi - previous.midi), Math.abs(current.midi - note.midi)) >= 7;
    if (
      note.identitySource === source
      && beforeGap >= minimumSpacingBeats - 1e-9
      && afterGap >= minimumSpacingBeats - 1e-9
      && !quietShortSpike
      // A half-beat learner step can still cover a minor sixth in the
      // opening descent of a lead phrase. Keep the bridge criterion looser
      // than the transition comfort threshold; the DP's travel penalty
      // remains responsible for rejecting genuinely wide zig-zags.
      && Math.abs(note.midi - previous.midi) <= 9
      && Math.abs(current.midi - note.midi) <= 9
    ) {
      hasStepwiseBridge = true;
      break;
    }
  }
  if (!hasStepwiseBridge) return 0;
  return Math.min(6, 5 + (gapBeats - targetGap) * 1.5);
}

/**
 * Select a source-aware guitar path from a richer phrase candidate set. This
 * is a first-order dynamic program: every candidate can start a path, and a
 * later candidate may follow whenever the learner spacing floor is met. The
 * path maximises note salience minus local guitar travel cost, so a quiet
 * large leap loses to a connected step even when both attacks are otherwise
 * equally plausible. Vocal anchors are excluded by the caller and remain
 * mandatory in the returned phrase.
 */
function selectMetalInstrumentalContour(
  phrase: Note[],
  candidates: { note: Note; phraseIndex: number }[],
  weights: number[],
  minimumSpacingBeats: number,
  mandatory: ReadonlySet<Note> = new Set(),
): Note[] {
  if (!candidates.length) return [];
  const best = new Array<number>(candidates.length).fill(Number.NEGATIVE_INFINITY);
  const parent = new Array<number>(candidates.length).fill(-1);
  for (let index = 0; index < candidates.length; index++) {
    const current = candidates[index]!.note;
    // A phrase landing or a strong/sustained high attack is identity-bearing
    // even when its travel to the previous note is wider than comfortable.
    // Give it a bounded reward rather than making it an unconditional hard
    // constraint; two mandatory attacks inside one spacing window can still
    // resolve to the more salient one.
    const mandatoryBonus = 24;
    best[index] = weights[index]! + (mandatory.has(current) ? mandatoryBonus : 0);
    for (let previousIndex = 0; previousIndex < index; previousIndex++) {
      const previous = candidates[previousIndex]!.note;
      const gap = current.start - previous.start;
      if (gap < minimumSpacingBeats - 1e-9) continue;
      const transition = metalInstrumentalTransitionPenalty(previous, current, gap)
        + metalInstrumentalCoveragePenalty(phrase, candidates, previousIndex, index, minimumSpacingBeats);
      const score = best[previousIndex]! + weights[index]!
        + (mandatory.has(current) ? mandatoryBonus : 0)
        - transition;
      if (score > best[index]! + 1e-9) {
        best[index] = score;
        parent[index] = previousIndex;
      }
    }
  }
  let state = best.reduce((winner, score, index) => score > best[winner]! + 1e-9 ? index : winner, 0);
  const selected: Note[] = [];
  while (state >= 0) {
    selected.push({ ...candidates[state]!.note });
    state = parent[state]!;
  }
  const result = selected.reverse();
  return result;
}

/**
 * Apply the source-locked guitar tracker only to phrases that contain enough
 * temporal spread to represent a lead contour.  Very dense detector runs are
 * intentionally left to the existing learner scheduler: they already have a
 * level-specific spacing policy and forcing the source tracker onto them can
 * make the easier ladder collapse to the same attack set.  The helper returns
 * only notes that were present in the input phrase; it never synthesizes a
 * replacement pitch or changes any note payload.
 */
function selectMetalLearnerGuitarPhrase(phrase: Note[], minimumSpacingBeats: number): Note[] | undefined {
  if (phrase.length < 6) return undefined;
  const span = phrase.at(-1)!.start - phrase[0]!.start;
  if (!Number.isFinite(span) || span < 2) return undefined;
  const gaps = phrase.slice(1).map((note, index) => note.start - phrase[index]!.start);
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const middle = sortedGaps.length ? (sortedGaps.length - 1) * 0.5 : 0;
  const medianGap = sortedGaps.length
    ? sortedGaps[Math.floor(middle)]!
      + (sortedGaps[Math.ceil(middle)]! - sortedGaps[Math.floor(middle)]!) * (middle - Math.floor(middle))
    : 0;
  if (medianGap < 0.25 - 1e-9) return undefined;
  if (new Set(phrase.map((note) => note.midi)).size < 3) return undefined;
  const intervals = gaps.map((_, index) => Math.abs(phrase[index + 1]!.midi - phrase[index]!.midi));
  const largeLeapRatio = intervals.length
    ? intervals.filter((interval) => interval >= 7).length / intervals.length
    : 0;
  const repeatedRatio = intervals.length
    ? intervals.filter((interval) => interval === 0).length / intervals.length
    : 0;
  if (largeLeapRatio > 0.55 + 1e-9 || repeatedRatio > 0.75 + 1e-9) return undefined;

  return selectGuitarLeadPath(phrase, {
    minimumSpacingBeats: Math.max(0.5, minimumSpacingBeats),
    groupToleranceBeats: 0.08,
    phraseBreakBeats: 1.5,
    maxCandidatesPerGroup: 4,
    beamWidth: 24,
    allowGapRecovery: true,
    skipPenalty: 1.5,
    minimumPhraseGroups: 4,
  }).notes;
}

/**
 * Restore supported residual attacks that a learner interval pass skipped
 * from an otherwise sparse, beat-level phrase. Residual detector paths can
 * arrive at the learner reducer with a coherent one-beat contour but still
 * lose every other attack to salience ties. In that narrow case, adding back
 * existing source-tagged events keeps the melody recognizable without
 * synthesizing notes or relaxing the piano spacing floor. Dedicated guitar,
 * vocal phrases, dense textures, and Advanced (non-legato) remain unchanged.
 */
function restoreSparseResidualCoverage(
  cleaned: Note[],
  selected: Note[],
  minimumSpacingBeats: number,
  maxAttacksPerSecond: number,
): Note[] {
  if (maxAttacksPerSecond < 3.5 - 1e-9) return selected;
  const residual = cleaned
    .filter((note) => note.identitySource === "other" && note.midi >= 61)
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.dur - a.dur);
  if (residual.length < 4) return selected;

  const phrases: Note[][] = [];
  for (const note of residual) {
    const phrase = phrases.at(-1);
    const previous = phrase?.at(-1);
    if (!phrase || !previous || note.start - previous.start > 3 + 1e-9
      || note.start - phrase[0]!.start > 32 + 1e-9) phrases.push([note]);
    else phrase.push(note);
  }
  if (!phrases.length) return selected;

  const result = [...selected];
  const targetSpacing = Math.max(minimumSpacingBeats, 0.75);
  for (const phrase of phrases) {
    if (phrase.length < 4) continue;
    const phraseStart = phrase[0]!.start;
    const phraseEnd = phrase.at(-1)!.start;
    const span = phraseEnd - phraseStart;
    if (!Number.isFinite(span) || span < 4) continue;
    const availableDensity = phrase.length / Math.max(1, span);
    if (availableDensity < 0.75 - 1e-9 || availableDensity > 2.5 + 1e-9) continue;

    // Do not reintroduce an alternate instrumental lane next to a dedicated
    // guitar phrase. The source-lane selector owns that decision; this helper
    // is only for residual-only windows where no guitar evidence is nearby.
    const nearbyGuitar = cleaned.some((note) => note.identitySource === "guitar"
      && note.start >= phraseStart - 1.5 - 1e-9
      && note.start <= phraseEnd + 1.5 + 1e-9);
    if (nearbyGuitar) continue;

    const inPhrase = (note: Note): boolean => note.identitySource === "other"
      && note.start >= phraseStart - 1e-9
      && note.start <= phraseEnd + 1e-9;
    const kept = result.filter(inPhrase).sort((a, b) => a.start - b.start);
    // Source-aware fusion may intentionally select no residual material for
    // this phrase. Do not resurrect that lane merely because raw candidates
    // remain in `cleaned`; coverage recovery is only a denser selection of an
    // already selected residual phrase.
    if (!kept.length) continue;
    const selectedDensity = kept.length / Math.max(1, span);
    if (selectedDensity >= 0.95 - 1e-9) continue;
    if (kept.length >= phrase.length) continue;

    const vocalIntervals = result
      .filter((note) => note.identitySource === "vocals")
      .map((note) => ({ start: note.start, end: note.start + note.dur }));
    const tooCloseToPlayedAttack = (note: Note): boolean => result.some((played) =>
      played.hand !== "L"
      && Math.abs(played.start - note.start) < minimumSpacingBeats - 1e-9,
    );
    let candidates = phrase.filter((note) => {
      if (kept.some((other) => Math.abs(other.start - note.start) <= 1e-9)) return false;
      if (note.vel < 56 && note.dur < 0.3) return false;
      if (tooCloseToPlayedAttack(note)) return false;
      return !vocalIntervals.some((interval) => interval.start <= note.start + 1e-9
        && interval.end > note.start + 1e-9);
    });
    if (!candidates.length) continue;

    const targetCount = Math.min(
      phrase.length,
      Math.max(kept.length, Math.floor(span / targetSpacing + 1 + 1e-9)),
    );
    while (kept.length < targetCount) {
      let winner: Note | undefined;
      let winnerScore = Number.NEGATIVE_INFINITY;
      for (const candidate of candidates) {
        if (kept.some((note) => Math.abs(note.start - candidate.start) < targetSpacing - 1e-9)) continue;
        if (tooCloseToPlayedAttack(candidate)) continue;
        const nearestGrid = Math.round((candidate.start - phraseStart) / targetSpacing) * targetSpacing + phraseStart;
        const gridFit = Math.max(0, 1 - Math.min(1, Math.abs(candidate.start - nearestGrid) / (targetSpacing * 0.6)));
        const previous = kept.filter((note) => note.start < candidate.start).at(-1);
        const next = kept.find((note) => note.start > candidate.start);
        const continuity = (previous && next)
          ? Math.max(0, 1 - (Math.abs(candidate.midi - previous.midi) + Math.abs(next.midi - candidate.midi)) / 24)
          : 0.5;
        const score = gridFit * 2 + continuity
          + Math.min(1, candidate.dur / 0.35)
          + Math.min(1, candidate.vel / 127);
        if (score > winnerScore + 1e-9) {
          winner = candidate;
          winnerScore = score;
        }
      }
      if (!winner) break;
      kept.push({ ...winner });
      kept.sort((a, b) => a.start - b.start);
      const candidateIndex = candidates.indexOf(winner);
      if (candidateIndex >= 0) candidates.splice(candidateIndex, 1);
    }

    // Replace the phrase atomically.  `kept` is derived from `result`, so
    // leaving retained entries in place and then appending `kept` would
    // duplicate every note that survived coverage recovery.  Remove all
    // residual entries in this span first, then append exactly the selected
    // copies; vocal and dedicated-guitar notes are outside `inPhrase` and are
    // untouched.
    for (let index = result.length - 1; index >= 0; index -= 1) {
      if (inPhrase(result[index]!)) result.splice(index, 1);
    }
    result.push(...kept.map((note) => ({ ...note })));
  }
  return result.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/**
 * Restore supported guitar lead attacks that the contour scheduler skipped
 * inside a connected phrase.  Metal learner levels are intentionally selected
 * from a richer source stream than Advanced, but a weighted interval pass can
 * still choose only endpoints around vocal anchors and leave the solo
 * unrecognisably sparse.  This pass is selection-only: it copies existing
 * source-tagged guitar notes, never changes their pitch or onset, keeps vocals
 * immutable, and respects the learner spacing floor.
 *
 * The gate is deliberately conservative.  A phrase must already have a
 * selected guitar attack, several distinct upper pitches, useful candidate
 * density, and a mostly connected contour.  Stable repeated walls and noisy
 * residual lanes therefore remain with their existing rhythm/source policy.
 */
function restoreSparseGuitarCoverage(
  sourceCandidates: Note[],
  selected: Note[],
  minimumSpacingBeats: number,
): Note[] {
  const guitarCandidates = sourceCandidates
    .filter((note) => note.identitySource === "guitar" && note.midi >= 61)
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.dur - a.dur);
  if (guitarCandidates.length < 6) return selected;

  const phrases: Note[][] = [];
  for (const note of guitarCandidates) {
    const phrase = phrases.at(-1);
    const previous = phrase?.at(-1);
    if (!phrase || !previous || note.start - previous.start > 1.5 + 1e-9
      || note.start - phrase[0]!.start > 32 + 1e-9) {
      phrases.push([note]);
    } else {
      phrase.push(note);
    }
  }

  const result = [...selected];
  const vocalNotes = result.filter((note) => note.identitySource === "vocals");
  // Keep a useful coverage target separate from the physical learner floor:
  // a valid phrase may add at half-beat spacing, while the target remains
  // conservative enough not to restore every detector attack.
  const targetSpacing = Math.max(minimumSpacingBeats, 0.75);
  const coverageFloor = Math.max(minimumSpacingBeats, 0.5);
  const keyFor = (note: Note): string => `${note.identitySource ?? ""}:${note.start.toFixed(6)}:${note.midi}`;
  const selectedKeys = new Set(result.map(keyFor));
  const tooCloseToPlayedAttack = (note: Note): boolean => result.some((played) =>
    played.hand !== "L"
    && Math.abs(played.start - note.start) < minimumSpacingBeats - 1e-9,
  );

  for (const phrase of phrases) {
    if (phrase.length < 6) continue;
    const phraseStart = phrase[0]!.start;
    const phraseEnd = phrase.at(-1)!.start;
    const span = phraseEnd - phraseStart;
    if (!Number.isFinite(span) || span < 2) continue;

    const distinctPitches = new Set(phrase.map((note) => note.midi));
    if (distinctPitches.size < 3) continue;
    const intervals = phrase.slice(1).map((note, index) => Math.abs(note.midi - phrase[index]!.midi));
    const largeLeapRatio = intervals.length
      ? intervals.filter((interval) => interval >= 7).length / intervals.length
      : 0;
    const repeatedRatio = intervals.length
      ? intervals.filter((interval) => interval === 0).length / intervals.length
      : 0;
    if (largeLeapRatio > 0.45 + 1e-9 || repeatedRatio > 0.75 + 1e-9) continue;
    if (phrase.length / Math.max(1, span) < 1.25 - 1e-9) continue;

    const inPhrase = (note: Note): boolean => note.identitySource === "guitar"
      && note.start >= phraseStart - 1e-9
      && note.start <= phraseEnd + 1e-9;
    const kept = result.filter(inPhrase).sort((a, b) => a.start - b.start);
    // Recovery must refine an already selected guitar phrase, never create a
    // new instrumental source in a section that the lane selector rejected.
    if (!kept.length) continue;

    const targetCount = Math.min(
      phrase.length,
      Math.max(kept.length, Math.floor(span / targetSpacing + 1 + 1e-9)),
    );
    if (targetCount <= kept.length) continue;

    const available = phrase.filter((note) => !selectedKeys.has(keyFor(note)));
    while (kept.length < targetCount) {
      let winner: Note | undefined;
      let winnerScore = Number.NEGATIVE_INFINITY;
      for (const candidate of available) {
        if (selectedKeys.has(keyFor(candidate)) || tooCloseToPlayedAttack(candidate)) continue;
        if (vocalNotes.some((vocal) => Math.abs(vocal.start - candidate.start) < minimumSpacingBeats - 1e-9)) continue;

        const previous = kept.filter((note) => note.start < candidate.start).at(-1);
        const next = kept.find((note) => note.start > candidate.start);
        const beforeGap = previous ? candidate.start - previous.start : Number.POSITIVE_INFINITY;
        const afterGap = next ? next.start - candidate.start : Number.POSITIVE_INFINITY;
        const stepToPrevious = previous ? Math.abs(candidate.midi - previous.midi) : 0;
        const stepToNext = next ? Math.abs(next.midi - candidate.midi) : 0;
        const bridgesGap = previous !== undefined && next !== undefined
          && beforeGap >= targetSpacing - 1e-9
          && afterGap >= targetSpacing - 1e-9;
        const stepwise = (previous !== undefined && stepToPrevious <= 5)
          || (next !== undefined && stepToNext <= 5);
        const quietLargeLeap = candidate.vel < 70 && candidate.dur <= 0.25 + 1e-9
          && ((previous !== undefined && stepToPrevious >= 7) || (next !== undefined && stepToNext >= 7));
        const gridDistance = Math.abs((candidate.start - phraseStart) / targetSpacing
          - Math.round((candidate.start - phraseStart) / targetSpacing));
        const gridFit = Math.max(0, 1 - Math.min(1, gridDistance));
        const endpoint = previous === undefined || next === undefined;
        const score = (bridgesGap ? 4 : 0)
          + (stepwise ? 2.5 : 0)
          + gridFit
          + Math.min(1, candidate.dur / 0.35)
          + Math.min(1, candidate.vel / 127)
          + (endpoint ? 1.5 : 0)
          - (quietLargeLeap ? 3 : 0)
          - Math.max(0, Math.max(stepToPrevious, stepToNext) - 7) * 0.2;
        if (score > winnerScore + 1e-9) {
          winner = candidate;
          winnerScore = score;
        }
      }
      if (!winner) break;
      const copy = { ...winner };
      kept.push(copy);
      kept.sort((a, b) => a.start - b.start);
      result.push(copy);
      selectedKeys.add(keyFor(copy));
    }

    // The greedy add-only pass can be trapped when every omitted candidate is
    // just inside the floor of an existing attack. In that case, choose a
    // larger source-locked subset from the cleaned phrase, allowing a bounded
    // replacement of a weak attack rather than resurrecting pre-cleanup data.
    if (kept.length < targetCount) {
      const fixed = result.filter((note) => !inPhrase(note) && note.hand !== "L");
      const candidates = phrase.filter((note) => note.hand !== "L"
        && !fixed.some((played) => Math.abs(played.start - note.start) < coverageFloor - 1e-9));
      const previousCompatible = candidates.map((note, index) => {
        let low = 0;
        let high = index - 1;
        let compatible = -1;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          if (note.start - candidates[middle]!.start >= coverageFloor - 1e-9) {
            compatible = middle;
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }
        return compatible;
      });
      const weights = candidates.map((candidate, index) => {
        const previous = candidates[index - 1];
        const next = candidates[index + 1];
        const selectedBonus = selectedKeys.has(keyFor(candidate)) ? 6 : 0;
        const endpoint = index === 0 || index === candidates.length - 1;
        const stepwise = (previous !== undefined && Math.abs(candidate.midi - previous.midi) <= 5)
          || (next !== undefined && Math.abs(next.midi - candidate.midi) <= 5);
        const quietLargeLeap = candidate.vel < 70 && candidate.dur <= 0.25 + 1e-9
          && ((previous !== undefined && Math.abs(candidate.midi - previous.midi) >= 7)
            || (next !== undefined && Math.abs(next.midi - candidate.midi) >= 7));
        const gridDistance = Math.abs((candidate.start - phraseStart) / targetSpacing
          - Math.round((candidate.start - phraseStart) / targetSpacing));
        return selectedBonus
          + (endpoint ? 2 : 0)
          + (stepwise ? 2 : 0)
          + Math.max(0, 1 - Math.min(1, gridDistance))
          + Math.min(1, candidate.dur / 0.35)
          + Math.min(1, candidate.vel / 127)
          - (quietLargeLeap ? 3 : 0);
      });
      const dp = Array.from({ length: candidates.length + 1 }, () =>
        new Array<number>(targetCount + 1).fill(Number.NEGATIVE_INFINITY));
      const take = Array.from({ length: candidates.length + 1 }, () =>
        new Array<boolean>(targetCount + 1).fill(false));
      dp[0]![0] = 0;
      for (let candidateIndex = 1; candidateIndex <= candidates.length; candidateIndex += 1) {
        dp[candidateIndex]![0] = 0;
        for (let count = 1; count <= targetCount; count += 1) {
          const skipped = dp[candidateIndex - 1]![count]!;
          const parent = previousCompatible[candidateIndex - 1]! + 1;
          const parentScore = dp[parent]![count - 1]!;
          const included = parentScore > Number.NEGATIVE_INFINITY / 2
            ? parentScore + weights[candidateIndex - 1]!
            : Number.NEGATIVE_INFINITY;
          if (included > skipped + 1e-9) {
            dp[candidateIndex]![count] = included;
            take[candidateIndex]![count] = true;
          } else {
            dp[candidateIndex]![count] = skipped;
          }
        }
      }
      let count = targetCount;
      while (count > kept.length && dp[candidates.length]![count]! <= Number.NEGATIVE_INFINITY / 2) count -= 1;
      if (count > kept.length) {
        const chosen: Note[] = [];
        let candidateIndex = candidates.length;
        while (candidateIndex > 0 && count > 0) {
          if (take[candidateIndex]![count]) {
            chosen.push({ ...candidates[candidateIndex - 1]! });
            candidateIndex = previousCompatible[candidateIndex - 1]! + 1;
            count -= 1;
          } else {
            candidateIndex -= 1;
          }
        }
        chosen.reverse();
        if (chosen.length > kept.length) {
          for (let resultIndex = result.length - 1; resultIndex >= 0; resultIndex -= 1) {
            if (inPhrase(result[resultIndex]!)) {
              selectedKeys.delete(keyFor(result[resultIndex]!));
              result.splice(resultIndex, 1);
            }
          }
          result.push(...chosen);
          for (const note of chosen) selectedKeys.add(keyFor(note));
        }
      }
    }
  }
  return result.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/**
 * Select a physically phrased metal RH path inside each real phrase. This is
 * tempo-aware and local, because a whole-song density average cannot see a
 * half-second detector burst. Pitch and attack choices are selection-only so
 * every easier level remains traceable to its harder neighbor.
 */
export function reduceMetalRhRealism(
  notes: Note[],
  tempoBpm: number,
  maxAttacksPerSecond: number,
  legato = false,
  preserveGuitarCoverage = false,
): Note[] {
  if (!notes.length) return [];
  const safeTempo = normalizeTempoBpm(tempoBpm);
  const secondsPerBeat = 60 / safeTempo;
  const safeRate = Number.isFinite(maxAttacksPerSecond) && maxAttacksPerSecond > 0 ? maxAttacksPerSecond : 4;
  const minimumSpacingBeats = (safeTempo / 60) / safeRate;
  // Quantization can leave a one-grid sliver between two fragments that were
  // contiguous in the source stem. Allow only a short, tempo-aware silence
  // here: a larger gap is a real vocal re-attack and must remain playable.
  const maxVocalFragmentGapBeats = Math.min(0.125, 0.08 / secondsPerBeat);
  const dedupedSource = suppressLowGuitarLeadFiller(notes, legato)
    .sort((a, b) => a.start - b.start
      || Number(b.identitySource === "vocals") - Number(a.identitySource === "vocals")
      || b.vel - a.vel || b.dur - a.dur || b.midi - a.midi)
    .filter((note, index, all) => index === 0 || Math.abs(note.start - all[index - 1]!.start) > 1e-9);
  const source = removeResidualUpperOutliers(dedupedSource, legato);

  const merged: Note[] = [];
  let lastMergedAttackStart: number | undefined;
  let lastMergedVocal: Note | undefined;
  let lastMergedVocalAttackStart: number | undefined;
  for (const original of source) {
    const note = { ...original };
    const previous = merged.at(-1);
    const elapsedSec = previous && lastMergedAttackStart !== undefined
      ? (note.start - lastMergedAttackStart) * secondsPerBeat
      : Number.POSITIVE_INFINITY;
    const gapSec = previous
      ? Math.max(0, note.start - (previous.start + previous.dur)) * secondsPerBeat
      : Number.POSITIVE_INFINITY;
    const vocalGapBeats = lastMergedVocal
      ? Math.max(0, note.start - (lastMergedVocal.start + lastMergedVocal.dur))
      : Number.POSITIVE_INFINITY;
    const vocalAttackGapBeats = lastMergedVocalAttackStart === undefined
      ? Number.POSITIVE_INFINITY
      : note.start - lastMergedVocalAttackStart;
    // Basic Pitch commonly splits one sung syllable into adjacent fragments
    // at nearly the same pitch. Treat those as one sustained piano note; a
    // real gap or a pitch change still creates a fresh attack. This is limited
    // to the vocal lane so repeated guitar articulations remain available in
    // the harder metal levels.
    if (
      lastMergedVocal
      && note.identitySource === "vocals"
      && lastMergedVocal.midi === note.midi
      // A later learner level may have extended the previous note to fill a
      // playable gap. Keep the attack-to-attack bound as well as the silence
      // bound so that extension cannot turn a genuine re-attack into a
      // detector fragment.
      && vocalAttackGapBeats <= 0.5 + 1e-9
      && vocalGapBeats <= maxVocalFragmentGapBeats + 1e-9
    ) {
      lastMergedVocal.dur = Math.max(lastMergedVocal.dur, note.start + note.dur - lastMergedVocal.start);
      lastMergedVocal.vel = Math.max(lastMergedVocal.vel, note.vel);
      lastMergedAttackStart = note.start;
      lastMergedVocalAttackStart = note.start;
      continue;
    }
    if (note.identitySource === "vocals") {
      lastMergedVocal = note;
      lastMergedVocalAttackStart = note.start;
    }
    const preserveMelodicReattack = Boolean(
      previous
      && previous.midi === note.midi
      && (hasMovingGuitarContext(previous, source) || hasMovingGuitarContext(note, source)),
    );
    const shortFragmentMerge = legato
      && elapsedSec <= 0.4 + 1e-9
      && gapSec <= 0.2 + 1e-9
      && previous?.dur !== undefined
      && previous.dur <= 0.25 + 1e-9
      && note.dur <= 0.25 + 1e-9;
    if (
      previous
      && previous.identitySource !== "vocals"
      && note.identitySource !== "vocals"
      && previous.midi === note.midi
      && !preserveMelodicReattack
      // In a legato learner level, overlapping same-pitch guitar attacks are
      // one held piano tone rather than separate picked strikes. Keep the
      // advanced/source texture tighter so deliberate re-attacks remain
      // available there, while allowing a quarter-second fragment boundary
      // to collapse in the playable levels.
      && (elapsedSec <= (legato ? 0.25 : 0.09) + 1e-9 || shortFragmentMerge)
      && (gapSec <= (legato ? 0.125 : 0) + 1e-9 || shortFragmentMerge)
      && note.start <= previous.start + previous.dur + (legato
        ? shortFragmentMerge ? 0.5 : 0.25
        : 0.125) + 1e-9
    ) {
      previous.dur = Math.max(previous.dur, note.start + note.dur - previous.start);
      previous.vel = Math.max(previous.vel, note.vel);
      lastMergedAttackStart = note.start;
      continue;
    }
    merged.push(note);
    lastMergedAttackStart = note.start;
  }

  const vocalCleaned = removeWeakVocalDetours(merged, safeTempo, legato);
  const handoffCleaned = removeWeakGuitarVocalHandoffs(vocalCleaned, safeTempo, legato);
  const cleaned = removeInterleavedGuitarDetours(handoffCleaned.filter((note, index, all) => {
    if (note.identitySource === "vocals") return true;
    const previous = all[index - 1];
    const next = all[index + 1];
    if (!previous || !next) return true;
    // Keep the historical cleanup for a completely unlabeled triple while
    // preventing a guitar rule from treating vocal neighbours as guitar
    // evidence. Explicit source labels must match on all three notes.
    const sameSourceNeighbours = previous.identitySource === note.identitySource
      && next.identitySource === note.identitySource;
    const intoSec = (note.start - previous.start) * secondsPerBeat;
    const outSec = (next.start - note.start) * secondsPerBeat;
    const durationSec = note.dur * secondsPerBeat;
    const isHalfBeatAnchor = Math.abs(note.start * 2 - Math.round(note.start * 2)) <= 1e-9;
    const broadLegatoGuitarDetour = legato
      && note.identitySource === "guitar"
      && previous.identitySource === "guitar"
      && next.identitySource === "guitar"
      && intoSec <= 1.5 * secondsPerBeat + 1e-9
      && outSec <= 1.5 * secondsPerBeat + 1e-9
      && durationSec <= 0.35 + 1e-9
      && !isHalfBeatAnchor
      && note.vel < 100
      && Math.abs(note.midi - previous.midi) >= 5
      && Math.abs(note.midi - next.midi) >= 5
      && Math.abs(previous.midi - next.midi) <= 5;
    return !(
      (
        // A detector's short chord-tone detour often lasts a full eighth note
        // by the time Basic Pitch has merged overlapping partials. Treat that
        // as an ornamental hit when it sits between two nearby lead pitches;
        // otherwise the piano lane faithfully reproduces a guitar pick/noise
        // event as an awkward leap. Keep this local and source-aware below so
        // vocal anchors and deliberate wide figures are untouched.
        intoSec <= 0.4 + 1e-9
        && outSec <= 0.4 + 1e-9
        && durationSec <= 0.35 + 1e-9
        && Math.abs(note.midi - previous.midi) >= 5
        && Math.abs(note.midi - next.midi) >= 5
        && Math.abs(previous.midi - next.midi) <= 5
        // Keep a clearly intentional lead accent even when it reverses; the
        // quietness guard targets low-energy separated partials instead.
        && note.vel <= Math.max(previous.vel, next.vel) * 0.9 + 1e-9
        && sameSourceNeighbours
      )
      || broadLegatoGuitarDetour
    );
  }), safeTempo, legato);

  const phrases: Note[][] = [];
  for (const note of cleaned) {
    const phrase = phrases.at(-1);
    const previous = phrase?.at(-1);
    const restBeats = previous ? note.start - (previous.start + previous.dur) : Number.POSITIVE_INFINITY;
    if (!phrase || !previous || (restBeats >= 0.5 && restBeats * secondsPerBeat >= 0.35)) phrases.push([note]);
    else phrase.push(note);
  }

  const selected: Note[] = [];
  for (const phrase of phrases) {
    if (phrase.length <= 1) {
      selected.push(...phrase.map((note) => ({ ...note })));
      continue;
    }
    const protectedAnchors = phrase.filter((note) => note.identitySource === "vocals");
    const candidates = phrase.flatMap((note, phraseIndex) => note.identitySource !== "vocals"
      && protectedAnchors.every((anchor) => Math.abs(note.start - anchor.start) >= minimumSpacingBeats - 1e-9)
      ? [{ note, phraseIndex }]
      : []);
    const useContourDp = legato && candidates.some(({ note }) => isMetalInstrumentalSource(note.identitySource));
    const learnerGuitarPath = preserveGuitarCoverage && legato
      ? selectMetalLearnerGuitarPhrase(
        phrase.filter((note) => note.identitySource === "guitar" && note.hand !== "L" && note.midi >= 61),
        minimumSpacingBeats,
      ) ?? []
      : [];
    const guitarCoverageKeys = new Set(
      learnerGuitarPath.map((note) => `${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}`),
    );
    const noteKey = (note: Note): string => `${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}`;
    const mandatoryContourNotes = new Set(
      candidates
        .filter(({ note, phraseIndex }) => {
          const durationSec = note.dur * secondsPerBeat;
          const previousInstrumental = isMetalInstrumentalSource(note.identitySource)
            ? phrase.slice(0, phraseIndex).reverse().find((candidate) => candidate.identitySource === note.identitySource)
            : undefined;
          const nextPhraseNote = phrase[phraseIndex + 1];
          const instrumentalPhraseLanding = isMetalInstrumentalSource(note.identitySource)
            && nextPhraseNote?.identitySource === "vocals"
            && previousInstrumental !== undefined
            && note.start - previousInstrumental.start <= 1 + 1e-9
            && Math.abs(note.midi - previousInstrumental.midi) <= 7;
          return phraseIndex === 0
            || phraseIndex === phrase.length - 1
            || note.vel >= 100
            || (note.midi >= 76 && (note.vel >= 90 || durationSec >= 0.5))
            || instrumentalPhraseLanding
            || guitarCoverageKeys.has(noteKey(note));
        })
        .map(({ note }) => note),
    );
    const weights = candidates.map(({ note, phraseIndex: index }) => {
      const previous = phrase[index - 1];
      const next = phrase[index + 1];
      const endpoint = index === 0 || index === phrase.length - 1;
      const localExtremum = previous && next
        && ((note.midi > previous.midi && note.midi > next.midi) || (note.midi < previous.midi && note.midi < next.midi));
      const prominence = previous && next
        ? Math.min(Math.abs(note.midi - previous.midi), Math.abs(note.midi - next.midi))
        : 0;
      const stepConnector = previous && next
        && previous.identitySource === note.identitySource
        && next.identitySource === note.identitySource
        && Math.abs(note.midi - previous.midi) <= 4
        && Math.abs(next.midi - note.midi) <= 4;
      // A dense, stepwise guitar phrase contains useful connector attacks
      // even when each individual note is quieter than a detector spike. The
      // contour DP should prefer those connectors over leaving a one-beat
      // hole, but only when both local intervals are already comfortable.
      // This bonus is source/legato scoped; vocals and residual fallback keep
      // their existing salience policy.
      const coverageBonus = useContourDp
        && note.identitySource === "guitar"
        && stepConnector
        ? 3
        : 0;
      // A local salience score alone can prefer a quiet chord partial that
      // creates a large guitar jump. Look through vocal events for the nearest
      // guitar neighbours and lower that candidate's weight when the travel
      // is both fast and weak. This is intentionally a selection penalty (no
      // pitch replacement): phrase endpoints, dynamic/sustained landings, and
      // all vocal notes remain protected.
      let instrumentalTransitionPenalty = 0;
      const previousInstrumental = isMetalInstrumentalSource(note.identitySource)
        ? [...phrase.slice(0, index)]
        .reverse()
        .find((candidate) => candidate.identitySource === note.identitySource)
        : undefined;
      const nextInstrumental = isMetalInstrumentalSource(note.identitySource)
        ? phrase.slice(index + 1)
          .find((candidate) => candidate.identitySource === note.identitySource)
        : undefined;
      const instrumentalLocalExtremum = previousInstrumental && nextInstrumental
        && ((note.midi > previousInstrumental.midi && note.midi > nextInstrumental.midi)
          || (note.midi < previousInstrumental.midi && note.midi < nextInstrumental.midi));
      if (legato && isMetalInstrumentalSource(note.identitySource) && instrumentalLocalExtremum) {
        const durationSec = note.dur * secondsPerBeat;
        const protectedLead = endpoint
          || note.vel >= 100
          || durationSec >= 0.35
          || (note.midi >= 76 && note.vel >= 90);
        if (!protectedLead && note.vel < 100 && durationSec <= 0.35 + 1e-9) {
          for (const neighbour of [previousInstrumental, nextInstrumental]) {
            if (!neighbour) continue;
            const gapBeats = Math.abs(note.start - neighbour.start);
            const leap = Math.abs(note.midi - neighbour.midi);
            if (gapBeats <= 1.5 + 1e-9 && leap >= 7) instrumentalTransitionPenalty += 2.25;
            else if (gapBeats <= 1 + 1e-9 && leap >= 5) instrumentalTransitionPenalty += 0.45;
          }
        }
      }
      const beatPosition = Math.abs(note.start - Math.round(note.start));
      const halfBeatPosition = Math.abs(note.start * 2 - Math.round(note.start * 2));
      const localExtremumBonus = instrumentalTransitionPenalty > 0
        ? 0
        : localExtremum && prominence >= 3
          ? useContourDp ? 0.5 : 2 + Math.min(2, prominence / 6)
          : 0;
      return 1
        + Math.min(note.dur * secondsPerBeat, 0.75) * 1.5
        + Math.max(0, Math.min(1, note.vel / 127)) * 0.5
        + (endpoint ? 5 : 0)
        + localExtremumBonus
        + (stepConnector ? 0.75 : 0)
        + coverageBonus
        + (beatPosition <= 1e-6 ? 0.75 : halfBeatPosition <= 1e-6 ? 0.35 : 0)
        - (useContourDp ? 0 : instrumentalTransitionPenalty);
    });
    const phraseSelection: Note[] = [];
    if (useContourDp) {
      phraseSelection.push(...selectMetalInstrumentalContour(phrase, candidates, weights, minimumSpacingBeats, mandatoryContourNotes));
    } else {
      const previousCompatible = candidates.map(({ note }, index) => {
        let low = 0;
        let high = index - 1;
        let compatible = -1;
        while (low <= high) {
          const candidate = Math.floor((low + high) / 2);
          if (note.start - candidates[candidate]!.note.start >= minimumSpacingBeats - 1e-9) {
            compatible = candidate;
            low = candidate + 1;
          } else {
            high = candidate - 1;
          }
        }
        return compatible;
      });
      const best = new Array<number>(candidates.length + 1).fill(0);
      const take = new Array<boolean>(candidates.length).fill(false);
      for (let index = 0; index < candidates.length; index++) {
        const include = weights[index]! + best[previousCompatible[index]! + 1]!;
        const exclude = best[index]!;
        if (include > exclude + 1e-9) {
          best[index + 1] = include;
          take[index] = true;
        } else {
          best[index + 1] = exclude;
        }
      }
      for (let index = candidates.length - 1; index >= 0;) {
        const include = weights[index]! + best[previousCompatible[index]! + 1]!;
        if (take[index] && Math.abs(best[index + 1]! - include) <= 1e-9) {
          phraseSelection.push({ ...candidates[index]!.note });
          index = previousCompatible[index]!;
        } else {
          index -= 1;
        }
      }
      phraseSelection.reverse();
    }
    selected.push(...protectedAnchors.map((note) => ({ ...note })), ...phraseSelection);
  }

  const residualCovered = legato
    ? restoreSparseResidualCoverage(cleaned, selected, minimumSpacingBeats, safeRate)
    : selected;
  const handoffSelected = removeIsolatedGuitarVocalSingletons(residualCovered, safeTempo, legato);
  const sorted = removeInterleavedGuitarDetours(
    handoffSelected.sort((a, b) => a.start - b.start || a.midi - b.midi),
    safeTempo,
    legato,
  );
  if (!legato) return sorted;
  const coverageSelected = preserveGuitarCoverage
    ? restoreSparseGuitarCoverage(cleaned, sorted, minimumSpacingBeats)
    : sorted;
  return coverageSelected.sort((a, b) => a.start - b.start || a.midi - b.midi).map((note, index, all) => {
    const next = all[index + 1];
    if (!next) return { ...note };
    const gap = next.start - note.start;
    if (gap <= 0 || gap * secondsPerBeat > 0.5) return { ...note };
    return { ...note, dur: Math.min(gap, Math.max(note.dur, gap * 0.9)) };
  });
}
