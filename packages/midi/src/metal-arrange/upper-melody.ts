import type { Note } from "../types.js";
import { EPS, toRegister, clamp, notesIn, isMetalInstrumentalSource } from "./shared.js";
import type { IdentityNote } from "./types.js";
import { monophonicPath } from "./monophonic.js";
import { instrumentalLaneQuality } from "./identity.js";

/**
 * Keep quiet upper detector events only when they have local support. A lone,
 * very short spike is usually bleed/reverb and can otherwise become a fake
 * RH melody after octave registration. Sustained or strongly articulated
 * notes remain eligible as phrase landings even when they are isolated.
 */
export function supportedUpperRawNotes(notes: Note[]): Note[] {
  const upper = notes.filter((note) => note.midi >= 61);
  return upper.filter((note) => note.vel >= 48 || note.dur >= 0.2 || upper.some((candidate) =>
    candidate !== note && Math.abs(candidate.start - note.start) <= 2 + EPS,
  ));
}

export interface UpperEvidenceLane {
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
export function upperHarmonicPath(notes: Note[], source: UpperEvidenceLane["source"]): IdentityNote[] {
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
  maxBaseDensity = 1.1,
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
  if (baseDensity > maxBaseDensity + EPS) return undefined;

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
  // Rounding a detector onset into adjacent beat buckets can still leave two
  // neighboring original events less than a half beat apart (for example,
  // when one falls just before a bucket boundary and the next just after it).
  // Keep the first supported attack and drop only the later duplicate; this
  // preserves source timing while enforcing the learner-safe spacing floor.
  const paced: IdentityNote[] = [];
  for (const note of selected) {
    const previous = paced.at(-1);
    if (!previous || note.start - previous.start >= 0.55 - EPS) paced.push(note);
  }
  return paced;
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
export function selectResidualUpperMelodyPath(notes: Note[], source: UpperEvidenceLane["source"]): IdentityNote[] {
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
  for (const [phraseIndex, phrase] of selectedPhrases.entries()) {
    // The first contiguous residual phrase is the only place where the
    // decoder may use a slightly denser beat-grid recovery. Opening residual
    // evidence commonly contains one attack per ~0.7 beat plus detector
    // partials; later phrases retain the stricter gate so this remains a
    // source-local opening cleanup rather than a song-wide density rewrite.
    const maxBaseDensity = phraseIndex === 0 ? 1.5 : 1.1;
    const regularized = regularizeSparseResidualPhrase(phrase, upper, source, maxBaseDensity);
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
export function selectResidualOpeningContour(
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
export function inferConservativeTopLine(
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
