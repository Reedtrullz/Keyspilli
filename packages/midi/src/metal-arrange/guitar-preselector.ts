import type { Note } from "../types.js";
import type { GuitarLeadPreSelectorReasons, IdentityNote, GuitarLeadPreSelectorRescueResult, MetalStem, GuitarLeadPreSelectorDiagnostics, GuitarLeadPreSelectorRejectionReason, MetalArrangementTraceSink } from "./types.js";
import { EPS, toRegister } from "./shared.js";
import { traceParents, emitTrace, traceNote } from "./trace.js";

function freshGuitarLeadPreSelectorReasons(): GuitarLeadPreSelectorReasons {
  return {
    "selector-input": 0,
    "invalid-raw": 0,
    "rhythm-only": 0,
    "register-rejected": 0,
    "confidence-rejected": 0,
    "source-not-melodic": 0,
    other: 0,
  };
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
 * Opt-in, generation-only rescue for low guitar contours that were routed as
 * rhythm evidence before the lead selector saw them. This is deliberately
 * conservative: only existing singleton events in a connected, changing
 * 55--60 contour are returned. Harmonic stacks, stable walls, sub-register
 * events, and every non-guitar source remain excluded. The fixed 64-event cap
 * keeps the experiment from turning a rhythm stem into a second raw decoder.
 */
export function rescueGuitarPreSelectorCandidates(
  raw: Note[],
  eligible: Note[],
): GuitarLeadPreSelectorRescueResult {
  const maxRescuedEvents = 64;
  const groupToleranceBeats = 0.08;
  const connectedGapMaxBeats = 1.25;
  const minimumPhraseGroups = 4;
  const lowNotes = raw
    .filter((note) => (note.identitySource === "guitar" || note.identitySource === undefined)
      && note.hand !== "L"
      && Number.isInteger(note.midi)
      && Number.isFinite(note.start)
      && Number.isFinite(note.dur)
      && note.dur > 0
      && note.midi >= 55
      && note.midi <= 60)
    .slice()
    .sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur || a.vel - b.vel);
  const eligibleSet = new Set(eligible);
  const consideredCount = lowNotes.filter((note) => !eligibleSet.has(note)).length;
  const allGroups: Note[][] = [];
  const sortedRaw = raw
    .filter((note) => (note.identitySource === "guitar" || note.identitySource === undefined)
      && note.hand !== "L"
      && Number.isInteger(note.midi)
      && Number.isFinite(note.start)
      && Number.isFinite(note.dur)
      && note.dur > 0)
    .slice()
    .sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur || a.vel - b.vel);
  for (const note of sortedRaw) {
    const group = allGroups.at(-1);
    if (group && note.start - group.at(-1)!.start <= groupToleranceBeats + EPS) group.push(note);
    else allGroups.push([note]);
  }
  const groupByNote = new Map<Note, Note[]>();
  for (const group of allGroups) for (const note of group) groupByNote.set(note, group);
  const lowGroups = allGroups
    .filter((group) => group.some((note) => note.midi >= 55 && note.midi <= 60))
    .map((group) => group.filter((note) => note.midi >= 55 && note.midi <= 60));
  const phrases: Note[][][] = [];
  for (const group of lowGroups) {
    const phrase = phrases.at(-1);
    if (!phrase || group[0]!.start - phrase.at(-1)![0]!.start > connectedGapMaxBeats + EPS) phrases.push([group]);
    else phrase.push(group);
  }
  const qualifying = new Map<Note, Note>();
  for (const phrase of phrases) {
    if (phrase.length < minimumPhraseGroups) continue;
    const phraseNotes = phrase.flat();
    const counts = new Map<number, number>();
    for (const note of phraseNotes) counts.set(note.midi, (counts.get(note.midi) ?? 0) + 1);
    const dominantRatio = phraseNotes.length
      ? Math.max(...counts.values()) / phraseNotes.length
      : 1;
    const distinctPitches = counts.size;
    const starts = phrase.map((group) => group[0]!.start);
    const gaps = starts.slice(1).map((start, index) => start - starts[index]!).sort((a, b) => a - b);
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : Number.POSITIVE_INFINITY;
    if (distinctPitches < 3 || dominantRatio >= 0.75 || medianGap > 1 + EPS) continue;
    for (const group of phrase) {
      if (group.length !== 1) continue;
      const note = group[0]!;
      if (!eligibleSet.has(note) && note.midi >= 55 && note.midi <= 60 && groupByNote.get(note)?.length === 1) {
        qualifying.set(note, note);
      }
    }
  }
  const rescued: Note[] = [];
  let lastStart = Number.NEGATIVE_INFINITY;
  for (const note of [...qualifying.values()].sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur || a.vel - b.vel)) {
    if (rescued.length >= maxRescuedEvents) break;
    if (note.start - lastStart < 0.5 - EPS) continue;
    rescued.push(note);
    lastStart = note.start;
  }
  return {
    notes: rescued,
    diagnostics: {
      consideredCount,
      qualifyingGroupCount: qualifying.size,
      rescuedCount: rescued.length,
      maxRescuedEvents,
    },
  };
}

/**
 * Preserve detector notes below the RH register before octave registration can
 * turn them into a fake melody (raw 29/41 both become 65 in the RH window).
 * One representative attack per onset is enough for the LH rhythm lane; the
 * lead path is built from notes at or above MIDI 55 separately.
 */
export function rawLowRhythmEvents(
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

export function classifyGuitarPreSelector(
  stem: MetalStem | undefined,
  raw: IdentityNote[],
  eligible: IdentityNote[],
  routedRhythm: IdentityNote[],
  upper: IdentityNote[],
): GuitarLeadPreSelectorDiagnostics {
  const reasons = freshGuitarLeadPreSelectorReasons();
  const validRawCount = raw.length;
  const rawSourceCount = stem?.midi.notes.length ?? validRawCount;
  reasons["invalid-raw"] = Math.max(0, rawSourceCount - validRawCount);
  const eligibleSet = new Set(eligible);
  const upperSet = new Set(upper);
  const routedAt = (note: IdentityNote): boolean => routedRhythm.some((candidate) =>
    note.midi <= 60 && Math.abs(candidate.start - note.start) <= 0.08 + EPS,
  );
  for (const note of raw) {
    let reason: GuitarLeadPreSelectorRejectionReason;
    if (note.hand === "L") reason = "source-not-melodic";
    else if (eligibleSet.has(note)) reason = "selector-input";
    else if (routedAt(note)) reason = "rhythm-only";
    else if (note.midi < 45) reason = "register-rejected";
    else if (note.midi >= 61 && !upperSet.has(note)) reason = "confidence-rejected";
    else reason = "other";
    reasons[reason] += 1;
  }
  return {
    rawSourceCount,
    validRawCount,
    selectorInputCount: eligible.length,
    removedCount: Math.max(0, validRawCount - eligible.length),
    reasons,
  };
}

export function emitGuitarPreSelectorTrace(
  sink: MetalArrangementTraceSink | undefined,
  raw: IdentityNote[],
  eligible: IdentityNote[],
  routedRhythm: IdentityNote[],
  upper: IdentityNote[],
  rescued: readonly IdentityNote[] = [],
): void {
  if (!sink) return;
  const eligibleSet = new Set(eligible);
  const rescuedSet = new Set(rescued);
  const upperSet = new Set(upper);
  const routedAt = (note: IdentityNote): boolean => routedRhythm.some((candidate) =>
    note.midi <= 60 && Math.abs(candidate.start - note.start) <= 0.08 + EPS,
  );
  const reasonFor = (note: IdentityNote): GuitarLeadPreSelectorRejectionReason => {
    if (note.hand === "L") return "source-not-melodic";
    if (eligibleSet.has(note)) return "selector-input";
    if (routedAt(note)) return "rhythm-only";
    if (note.midi < 45) return "register-rejected";
    if (note.midi >= 61 && !upperSet.has(note)) return "confidence-rejected";
    return "other";
  };
  for (const note of raw) {
    const rawKey = traceParents(note)[0];
    if (!rawKey) continue;
    emitTrace(sink, {
      key: `eligibility:${rawKey}`,
      stage: "eligibility",
      parentKeys: [rawKey],
      source: "guitar",
      sourceStem: note.traceSourceStem ?? "guitar",
      note: traceNote({ ...note, rawMidi: note.midi }),
      selected: eligibleSet.has(note),
      selectionReason: rescuedSet.has(note) ? "preselector-rescue:low-contour" : reasonFor(note),
    });
  }
  const sorted = eligible.slice().sort((a, b) => a.start - b.start || a.midi - b.midi || b.vel - a.vel);
  const groups: IdentityNote[][] = [];
  for (const note of sorted) {
    const previous = groups.at(-1);
    if (!previous || note.start - previous.at(-1)!.start > 0.08 + EPS) groups.push([note]);
    else previous.push(note);
  }
  for (const [index, group] of groups.entries()) {
    const parentKeys = group.flatMap((note) => {
      const rawKey = traceParents(note)[0];
      return rawKey ? [`eligibility:${rawKey}`] : [];
    });
    emitTrace(sink, {
      key: `onset-group:guitar:${index}:${group[0]!.start.toFixed(6)}`,
      stage: "onset-group",
      parentKeys,
      source: "guitar",
      sourceStem: group[0]!.traceSourceStem ?? "guitar",
      note: traceNote({ ...group[0]!, rawMidi: group[0]!.midi }),
      selected: true,
      selectionReason: "selector-onset-group",
    });
  }
  for (const note of eligible) {
    const rawKey = traceParents(note)[0];
    if (!rawKey) continue;
    emitTrace(sink, {
      key: `selector-input:${rawKey}`,
      stage: "selector-input",
      parentKeys: [`eligibility:${rawKey}`],
      source: "guitar",
      sourceStem: note.traceSourceStem ?? "guitar",
      note: traceNote({ ...note, rawMidi: note.midi }),
      selected: true,
      selectionReason: rescuedSet.has(note)
        ? "preselector-rescue:low-contour"
        : "eligible-for-guitar-lead-selector",
    });
  }
}

export function suppressLowGuitarPulseRuns(notes: IdentityNote[], externalLeadContext: IdentityNote[] = []): GuitarPulseLanes {
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
