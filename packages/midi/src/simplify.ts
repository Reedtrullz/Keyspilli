import { sourcePedalErrors } from "./source-pedal.js";
import { compilePhrasePlan, applyPhrasePlan, type PhrasePlanV1 } from "./phrase-plan.js";
import { inferSourceHandLanes } from "./source-hand-lanes.js";
import { splitHands, detectBassPattern, detectKey } from "./analyze.js";
import { Note, ParsedMidi, SongMeta, Variant, DifficultyLevel, LEVEL_ORDER, PUBLIC_DIFFICULTY_ORDER, ChordLabel, SourcePreparationChange } from "./types.js";
import { quantize } from "./quantize.js";
import { midiBeatToNativeSeconds } from "./parse.js";
import { BEGINNER_OFFGRID_CANDIDATE, LADDER_TOL, PLAYABILITY_LIMITS, validateShortStudySource, validateVariants } from "./validate.js";
import { sanitizeImportedNotes } from "./clean.js";
import { validateChordLabels } from "./chords.js";
import { type MetalArrangementTraceEvent, type MetalArrangementTraceSink } from "./metal-arrange.js";
import { assessBeginnerOffGridCandidate, selectBeginnerOffGridRhCandidates } from "./beginner-offgrid.js";
import { selectProtectedSemanticLocalThinning } from "./density-normalization-audit.js";
import { assertSourceWorkload, normalizeTimeSigEvents, sourceMeasures } from "./simplify/source-workload.js";
import { normalizeTempoBpm, normalizePianoRange, rootOf, maxNoteEnd, onsetGroups } from "./simplify/shared.js";
import { stripLearnerTrace, seedLearnerTrace, learnerTraceRefs, emitLearnerStageTrace, resolveBeginnerOffGridRejections, resolveBeginnerOffGridRejectionsFromLineage, learnerSourceKey, emitDifficultyTrace } from "./simplify/learner-trace.js";
import type { LearnerInternalNote } from "./simplify/learner-trace.js";
import { shouldRedistributeInnerVoices, redistributeInnerVoices, isDenseContinuousWall, shouldRebalanceForLearner, splitPreservingHands, capAttackDensity, trimSamePitchOverlaps, capPlayableSounding, spaceHandAttacks, sparseLeftHandAnchors, capSemanticBeginnerHands, preserveRhLadder, preserveMetalLhLadder, collisionAwareSparseLeftHandAnchors } from "./simplify/playability.js";
import { padPitches, capSoundingSpan, topVoices, metalLeftHandTexture, thinChord, reduceMediumRhythm, selectEasyMelody, melodyOnly, chordsAt } from "./simplify/texture.js";
import { reduceMetalRhRealism } from "./simplify/metal-rh.js";

// Public API re-exported from the submodules; keep this list in sync.
export { SAFE_TEMPO_BPM, normalizeTempoBpm, normalizePianoRange } from "./simplify/shared.js";
export { assertSourceWorkload } from "./simplify/source-workload.js";
export { padPitches, reduceMediumRhythm, melodyOnly } from "./simplify/texture.js";

export interface VariantOptions {
  /** Explicit source-bound pilot; never selected by default or from inferred roles. */
  phrasePlan?: PhrasePlanV1;
  /** SHA-256 of actual supplied bytes, computed by the caller before parsing. */
  sourceSha256?: string;
  /** 16th-note grid (beats) used for note slicing */
  grid?: number;
  /** octave-shift notes outside the piano range (21-108) into it */
  normalizeRange?: boolean;
  /** Opt-in tutorial lane inference for source profile; uncertain lanes abstain. */
  inferSourceHands?: boolean;
  /**
   * Optional hard ceiling for imported note sustains, in beats.  Audio
   * transcriptions often inherit a detector's tail (or a pedal resonance)
   * instead of a real note-off; callers that have a transcription source can
   * use this to keep those tails from masking the next melodic attack. Pass
   * `null` for a human-authored source whose long sustains are intentional.
   */
  maxDurBeats?: number | null;
  /**
   * Arrangement intent. `source` keeps the imported staff assignment as
   * faithfully as possible, including retained bass pitches. `learner`
   * applies conservative two-hand, melody-over-chords shaping. `metal` uses
   * the same learner safety gates but treats the supplied RH/LH roles as a
   * semantic piano cover, retaining sparse harmonic anchors at every level.
   */
  arrangementProfile?: "source" | "learner" | "metal";
  /** Source-only lane for owner-selected backing harmony/bass; emits only source pitches. */
  safeLeftHandOnly?: boolean;
  /**
   * The source is an audio transcription whose one-staff pitch stream may
   * need inferred inner-voice placement. Keep this opt-in so curated MIDI
   * and MusicXML arrangements are never octave-revoiced by a shape-only
   * heuristic.
   */
  audioDerived?: boolean;
  /** Authoritative harmony from a role-aware arranger. Avoid per-level re-inference. */
  chords?: ChordLabel[];
  /**
   * Experimental source-preserving candidate only. Protected identities rank
   * ahead of unlabelled co-onset voices in the existing Advanced candidate and
   * register-span caps; all hand, duration, and playability guards still apply.
   * Lower levels may change through their existing ladder dependency, but this
   * option is not applied directly to their selectors. Catalog ingestion leaves
   * this unset.
   */
  protectedIdentitySources?: readonly NonNullable<Note["identitySource"]>[];
  /** Optional development-only lineage sidecar; never changes variant bytes. */
  trace?: MetalArrangementTraceSink;
}

export function buildVariants(src: ParsedMidi, meta: SongMeta, opts: VariantOptions = {}): Variant[] {
  assertSourceWorkload(src, opts.grid);
  if (opts.phrasePlan !== undefined && (opts.arrangementProfile !== "source" || opts.audioDerived || opts.safeLeftHandOnly)) {
    throw new Error("phrase plan: pilot requires the ordinary source profile without audio-derived or backing-only selection");
  }
  const phrasePlan = opts.phrasePlan !== undefined ? compilePhrasePlan(src, opts.phrasePlan, opts.sourceSha256) : undefined;
  if (opts.chords) {
    if (opts.chords.length > 20_000 || opts.chords.some(chord => chord.beat + (chord.durationBeats ?? 0) > 4096)) {
      throw new Error("source workload exceeds supplied chord limits");
    }
    const chordErrors = validateChordLabels(opts.chords);
    if (chordErrors.length) throw new Error(`invalid supplied chords: ${chordErrors.join("; ")}`);
  }
  // Variants use a constant clock. Integrate source tempo changes before any
  // reduction; otherwise later scalar-BPM playback stretches the wrong notes.
  const sourceTempo = normalizeTempoBpm(src.tempoBpm);
  if (src.tempoEvents?.length && (
    !src.tempoEvents.some(event => event.tick === 0)
    || src.tempoEvents.some(event => Math.abs(60_000_000 / event.microsecondsPerQuarter - sourceTempo) > 1e-6)
  )) {
    const source = src;
    const beat = (value: number): number => midiBeatToNativeSeconds(source, value) * sourceTempo / 60;
    src = { ...source, tempoBpm: sourceTempo, tempoEvents: undefined,
      ...(source.sections ? {sections:source.sections.map(s=>({...s,startBeat:beat(s.startBeat),endBeat:beat(s.endBeat)}))} : {}),
      durationBeats: beat(source.durationBeats),
      ...(source.notationMeasures ? { notationMeasures: source.notationMeasures.map(measure => ({ ...measure, startBeat: beat(measure.startBeat), endBeat: beat(measure.endBeat) })) } : {}),
      ...(source.sourcePedal?{sourcePedal:{...source.sourcePedal,endBeat:beat(source.sourcePedal.endBeat),changes:source.sourcePedal.changes.map(e=>({...e,beat:beat(e.beat)}))}}:{}),
      notes: source.notes.map(note => ({ ...note, start: beat(note.start), dur: beat(note.start + note.dur) - beat(note.start) })),
      ...(source.timeSigEvents?.length ? {
        timeSigEvents: source.timeSigEvents.map((event) => ({ ...event, beat: beat(event.beat) })),
      } : {}),
    };
    if (opts.chords) opts = { ...opts, chords: opts.chords.map(chord => ({ ...chord,
      beat: beat(chord.beat),
      ...(chord.durationBeats === undefined ? {} : { durationBeats: beat(chord.beat + chord.durationBeats) - beat(chord.beat) }),
    })) };
  }
  assertSourceWorkload(src, opts.grid);
  const sourceTimeSigEvents = normalizeTimeSigEvents(src.timeSigEvents);
  const grid = opts.grid ?? 0.25;
  const metalProfile = opts.arrangementProfile === "metal";
  const learnerProfile = opts.arrangementProfile === "learner";
  const safeLeftHandOnly = opts.safeLeftHandOnly === true;
  const learnerSafetyProfile = learnerProfile || metalProfile;
  const protectedIdentitySources = new Set(opts.protectedIdentitySources ?? []);
  const tempo = normalizeTempoBpm(meta.tempo ?? src.tempoBpm);
  // Every source type passes through the same conservative structural cleanup.
  // YouTube ingestion may additionally run cleanTranscription() beforehand;
  // this second pass is intentionally idempotent and protects direct callers.
  const sourceChanges: SourcePreparationChange[] = [];
  const recordSourceChange = (before: Note[], after: Note[], reason: SourcePreparationChange["reason"]) => {
    // Snapshots retain neutral source locations, without mutable aliases or
    // development-only learner tags. Source bytes remain the exact reference.
    sourceChanges.push({ reason, before: structuredClone(before.map(stripLearnerTrace)), after: structuredClone(after.map(stripLearnerTrace)) });
  };
  const sanitizeOptions: Parameters<typeof sanitizeImportedNotes>[1] = {
    tempoBpm: tempo,
    onTransformation: change => recordSourceChange([change.before], change.after ? [change.after] : [], change.reason),
  };
  // Preserve the distinction between an omitted option (legacy direct-call
  // safety default) and an explicit null (human-authored source, no blanket
  // duration cap). Catalog ingestion always supplies one of these policies.
  if (opts.maxDurBeats !== undefined) sanitizeOptions.maxDurBeats = opts.maxDurBeats;
  const learnerTraceEvents: MetalArrangementTraceEvent[] = [];
  const learnerLineageEnabled = learnerProfile;
  const learnerTraceEnabled = learnerLineageEnabled && opts.trace !== undefined;
  const learnerTraceSink: MetalArrangementTraceSink | undefined = learnerTraceEnabled
    ? { record: (event) => { learnerTraceEvents.push(event); opts.trace?.record(event); } }
    : opts.trace;
  const learnerTraceSource = learnerLineageEnabled ? seedLearnerTrace(src.notes) : src.notes;
  const sourceIdentityByTraceRef = new Map<string, Note["identitySource"]>();
  if (protectedIdentitySources.size) {
    for (const note of learnerTraceSource) {
      for (const ref of learnerTraceRefs(note)) sourceIdentityByTraceRef.set(ref, note.identitySource);
    }
  }
  const clearMixedProtectedIdentity = (notes: Note[]): Note[] => {
    if (!protectedIdentitySources.size || !sourceIdentityByTraceRef.size) return notes;
    return notes.map((note) => {
      if (!note.identitySource || !protectedIdentitySources.has(note.identitySource)) return note;
      const refs = learnerTraceRefs(note);
      if (!refs.length) return { ...note, identitySource: undefined };
      const identities = new Set(refs.map((ref) => sourceIdentityByTraceRef.get(ref)));
      if (identities.size > 1 || identities.has(undefined)) return { ...note, identitySource: undefined };
      return note;
    });
  };
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "raw", learnerTraceSource, [], "learner-source");
  }
  const imported = sanitizeImportedNotes(learnerTraceSource, sanitizeOptions);
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "cleaned", imported, [{ stage: "raw", notes: learnerTraceSource }], "sanitize-import");
  }
  // Run the gated learner voice pass before quantization so co-onset evidence
  // from the transcription is not erased by the later grid merge.
  // Metal input is already role-aware and explicitly hand-labelled. Running
  // the generic one-staff rebalance would undo that semantic separation.
  const innerVoiceArrangement = learnerProfile && opts.audioDerived === true && shouldRedistributeInnerVoices(imported);
  const arrangedImported = innerVoiceArrangement ? redistributeInnerVoices(imported) : imported;
  const sourceHandInference = opts.arrangementProfile === "source" && opts.inferSourceHands
    ? inferSourceHandLanes(arrangedImported) : undefined;
  const base = quantize(sourceHandInference?.notes ?? arrangedImported, { grid: 0.125, minDur: 0.125, onTransformation: recordSourceChange });
  const normalized = opts.normalizeRange === false ? base : normalizePianoRange(base);
  const protectedNormalized = clearMixedProtectedIdentity(normalized);
  const shifted = base.filter((n, i) => normalized[i]!.midi !== n.midi);
  base.forEach((note, i) => {
    if (normalized[i]!.midi !== note.midi) recordSourceChange([note], [normalized[i]!], "octave-normalization");
  });
  const sourceWarnings = shifted.length
    ? [`${shifted.length} source notes were octave-normalized into the piano range 21-108`]
    : [];
  const arrangementWarnings = innerVoiceArrangement
    ? ["learner inner-voice redistribution applied (inferred staff assignment)"]
    : [];
  const warnings = [...sourceWarnings, ...arrangementWarnings,
    ...(sourceChanges.length ? [`Source preparation changed ${sourceChanges.length} event groups; inspect sourcePreparation for exact sanitization, quantization, merge and octave changes. Original source bytes remain the reference.`] : []),
    ...(src.repeatPlayback === "declared" ? ["Source occurrence lineage is declared in import metadata; it was not verified from repeat notation."] : []),
    ...(sourceHandInference ? [`tutorial source hand inference: ${sourceHandInference.reason} (not verified staff assignment)`] : []),
  ];
  const splitSource = protectedNormalized;
  const hasExplicitHands = splitSource.some((n) => n.hand !== undefined);
  const unlabeledSource = splitSource.filter((n) => n.hand === undefined);
  const pathologicalWall = isDenseContinuousWall(
    unlabeledSource.length ? unlabeledSource : splitSource,
    src.trackNames,
  );
  // Learner arrangements may correct a source that labels every staff note as
  // one hand. This is deliberately gated by `shouldRebalanceForLearner`; a
  // real cross-handed score and a genuinely monophonic melody keep the source
  // labels. Dense unlabeled transcription walls retain their existing safety
  // fallback below.
  const learnerRebalance = learnerProfile && shouldRebalanceForLearner(splitSource);
  const split = learnerRebalance
    ? splitHands(splitSource)
    : hasExplicitHands
      ? splitPreservingHands(splitSource, pathologicalWall && unlabeledSource.length > 0)
      : pathologicalWall
        ? { rh: splitSource.map((n) => ({ ...n, hand: "R" as const })), lh: [] as Note[] }
        : splitHands(splitSource);
  const { rh, lh } = split;
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "learner-arranged", [...rh, ...lh], [{ stage: "cleaned", notes: imported }], "range-and-hand-arrangement");
  }
  const key = meta.key ?? detectKey(imported).name;
  // Detect background pads before sustain capping; otherwise a long drone
  // shortened by the import sanitizer can stop looking like a pad and displace
  // the actual melody in the RH voice selector.
  const pads = padPitches(src.notes);
  const capLevel = (level: DifficultyLevel, notes: Note[]) => {
    const lim = PLAYABILITY_LIMITS[level]!;
    return capAttackDensity(notes, tempo, lim.maxDensity, lim.minMedianIoi);
  };

  // Use the hand-labeled split output, not the raw base, so the advanced
  // variant keeps L/R hand labels for two-staff rendering. Cap voices per
  // slice AND sounding span so full-band multitrack MIDIs stay a playable
  // piano texture; each easier level is then a reduction of the level above
  // so the ladder stays a true subset.
  const advancedRhSource = metalProfile ? reduceMetalRhRealism(rh, tempo, 8) : rh;
  const advancedSource = quantize(
    [
      ...capSoundingSpan(topVoices(advancedRhSource, 0.125, 4, pads, protectedIdentitySources), 12, "high", protectedIdentitySources),
      // Advanced keeps the imported LH attacks intact. Chord thinning is a
      // simplification operation; applying it here changed eighth-note bass
      // timing and introduced same-pitch overlaps in curated arrangements.
      // Learner rebalancing may intentionally keep a low bass plus a
      // mid-register shell (roughly a tenth); the historical 12-semitone
      // ceiling would discard the shell and recreate bass-only LH output.
      ...capSoundingSpan(lh, innerVoiceArrangement ? 19 : 12, "low", protectedIdentitySources),
    ],
    { grid: 0.125 },
  );
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "advanced-candidates", advancedSource, [{ stage: "learner-arranged", notes: [...rh, ...lh] }], "advanced-candidate-construction");
  }
  // The source-level validator allows up to 13 simultaneous notes for
  // advanced material because some faithful arrangements use large chords.
  // A learner still has two hands: cap the advanced texture at four held
  // notes per hand (eight total), shortening old sustains before dropping new
  // attacks. This specifically prevents the “sounds right but no human could
  // play it” failure mode while preserving the melody and chord attacks.
  const advanced = capLevel(
    "advanced",
    learnerSafetyProfile
      ? trimSamePitchOverlaps(capPlayableSounding(advancedSource, 8))
      : advancedSource,
  );
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "advanced-playable", advanced, [{ stage: "advanced-candidates", notes: advancedSource }], "advanced-playability");
  }
  const advancedRh = advanced.filter((n) => n.hand !== "L");
  const advancedLh = advanced.filter((n) => n.hand === "L");
  // Build learner lead candidates from the richer pre-cap stream. The
  // advanced playable cap is intentionally conservative for simultaneous
  // voices, but using that already-pruned result here can erase the connected
  // guitar landings that a medium/easy contour selector needs to choose from.
  // The final ladder intersection still guarantees every published learner
  // note exists in Advanced.
  const mediumRhCandidates = metalProfile ? advancedRhSource : advancedRh;
  const mediumLhTexture = metalProfile
    ? metalLeftHandTexture(advancedLh, 0.5, 3)
    : thinChord(advancedLh, 3);
  const mediumRhTexture = metalProfile
    ? [
      // Residual upper paths have already been reduced to a coherent source
      // lane by the metal arranger. Keep those sparse, evidence-backed
      // attacks available to the learner scheduler; applying topVoices here
      // again can discard every other beat before the source-aware contour
      // pass gets a chance to restore it. Guitar and other non-residual lanes
      // retain the existing voice cap to avoid widening dense textures.
      ...mediumRhCandidates.filter((note) => note.identitySource === "other" && note.midi >= 61),
      ...topVoices(
        mediumRhCandidates.filter((note) => note.identitySource !== "other"),
        0.125,
        3,
        pads,
      ),
    ]
    : topVoices(mediumRhCandidates, 0.125, 3, pads);
  const mediumTexture = [
    ...capSoundingSpan(mediumRhTexture, 12, "high"),
    ...capSoundingSpan(mediumLhTexture, innerVoiceArrangement ? 19 : 12, "low"),
  ];
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "medium-candidates", mediumTexture, [{ stage: "learner-arranged", notes: [...rh, ...lh] }], "medium-candidate-construction");
  }
  // A role-aware RH carries the song identity, but detector articulation is
  // not piano fingering. Progressively reduce its local phrase rate while the
  // LH keeps the existing accompaniment reduction.
  const mediumReduced = metalProfile
    ? [
      // Medium should still expose more lead detail than Easy, but a sixth-
      // note pulse at common metal tempos is a poor single-hand piano target.
      // Four attacks/sec gives a half-beat floor at 120 BPM while removing
      // detector chatter from the playable middle level.
      ...reduceMetalRhRealism(mediumTexture.filter((note) => note.hand !== "L"), tempo, 4, true, true),
      ...reduceMediumRhythm(mediumTexture.filter((note) => note.hand === "L")),
    ]
    : reduceMediumRhythm(mediumTexture);
  const medium = capLevel("medium", trimSamePitchOverlaps(quantize(
    mediumReduced,
    { grid: 0.125 },
  )));
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "medium-playable", medium, [{ stage: "medium-candidates", notes: mediumTexture }], "medium-playability");
  }
  const mediumRh = medium.filter((n) => n.hand !== "L");
  const mediumLh = medium.filter((n) => n.hand === "L");
  const easyRhSource = metalProfile ? reduceMetalRhRealism(mediumRh, tempo, 4, true, true) : mediumRh;
  const easyLhTexture = metalProfile
    ? metalLeftHandTexture(mediumLh, 0.75, 2)
    : trimSamePitchOverlaps(thinChord(mediumLh, 2).map((n) => (
      // Explicit source/learner imports already carry harmonic changes.
      // Keep the historical tonic revoice only for the unspecified profile.
      learnerProfile || opts.arrangementProfile === "source" ? { ...n } : { ...n, midi: rootOf(n.midi, key) }
    )));
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "easy-rh-input", easyRhSource, [{
      stage: "medium-playable",
      notes: medium.filter((note) => note.hand !== "L"),
    }], "easy-rh-input");
    emitLearnerStageTrace(learnerTraceSink, "easy-lh-input", easyLhTexture, [{
      stage: "medium-playable",
      notes: medium.filter((note) => note.hand === "L"),
    }], "easy-lh-input");
  }
  const easyMelody = !metalProfile && learnerProfile
    ? selectEasyMelody(easyRhSource, 0.125, 0.5, pads)
    : melodyOnly(easyRhSource, 0.125, 0.5, pads);
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "onset-group", easyRhSource, [{ stage: "easy-rh-input", notes: easyRhSource }], "easy-onset-grouping");
    emitLearnerStageTrace(learnerTraceSink, "selector-input", [...easyRhSource, ...easyLhTexture], [
      { stage: "easy-rh-input", notes: easyRhSource },
      { stage: "easy-lh-input", notes: easyLhTexture },
    ], "easy-selector-input");
    emitLearnerStageTrace(learnerTraceSink, "easy-voice-selection", easyMelody, [{ stage: "onset-group", notes: easyRhSource }], "easy-voice-selection");
  }
  const easyAssembledSource = [
    ...capSoundingSpan(easyMelody, 12, "high"),
    ...capSoundingSpan(
      easyLhTexture,
      innerVoiceArrangement ? 19 : 12,
      "low",
    ),
  ];
  const easyUncapped = trimSamePitchOverlaps(quantize(
    easyAssembledSource,
    { grid: 0.125 },
  ));
  const easy = capLevel("easy", opts.arrangementProfile === "source" ? [
    ...spaceHandAttacks(easyUncapped.filter(note => note.hand !== "L"), tempo),
    ...spaceHandAttacks(easyUncapped.filter(note => note.hand === "L"), tempo, 0.5),
  ].sort((a, b) => a.start - b.start || a.midi - b.midi) : easyUncapped);
  if (learnerTraceEnabled) {
    const easyDecision = [...easyMelody, ...easyLhTexture];
    emitLearnerStageTrace(learnerTraceSink, "decision", easyDecision, [
      { stage: "easy-voice-selection", notes: easyMelody },
      { stage: "easy-lh-input", notes: easyLhTexture },
    ], "easy-selection");
    emitLearnerStageTrace(learnerTraceSink, "easy-assembled", easyUncapped, [{ stage: "decision", notes: easyDecision }], "easy-assembly");
    emitLearnerStageTrace(learnerTraceSink, "easy-playable", easy, [{ stage: "easy-assembled", notes: easyUncapped }], "easy-playability");
  }
  // Each easier level is a reduction of the level above it, so the ladder
  // is a true subset (same melody, same moments) instead of a re-selection
  // that drifts apart in fast passages.
  const easyRh = easy.filter((n) => n.hand !== "L");
  const easyLh = easy.filter((n) => n.hand === "L");
  const veryEasyRhSource = metalProfile ? reduceMetalRhRealism(easyRh, tempo, 3, true) : easyRh;
  const veryEasyLhTexture = metalProfile ? metalLeftHandTexture(easyLh, 1, 2) : easyLh;
  const veryEasy = capLevel("very-easy", trimSamePitchOverlaps(quantize(
    [...capSoundingSpan(melodyOnly(veryEasyRhSource, 0.25, 0.5, pads), 12, "high"), ...veryEasyLhTexture],
    { grid: 0.25 },
  )));
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "very-easy-rh-input", veryEasyRhSource, [{
      stage: "easy-playable",
      notes: easy.filter((note) => note.hand !== "L"),
    }], "very-easy-rh-input");
    emitLearnerStageTrace(learnerTraceSink, "very-easy-playable", veryEasy, [{
      stage: "easy-playable",
      notes: easy,
    }], "very-easy-playability");
  }
  const meterBeats = src.timeSig[0] * (4 / src.timeSig[1]);
  const beatsPerMeasure = Number.isFinite(meterBeats) && meterBeats > 0 ? meterBeats : 4;
  const beginnerRhSource = metalProfile
    ? reduceMetalRhRealism(veryEasy.filter((n) => n.hand !== "L"), tempo, 2.5, true)
    : veryEasy.filter((n) => n.hand !== "L");
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "beginner-rh-input", beginnerRhSource, [{
      stage: "very-easy-playable",
      notes: veryEasy.filter((note) => note.hand !== "L"),
    }], "beginner-rh-input");
  }
  const beginnerRh = capSoundingSpan(melodyOnly(beginnerRhSource, 0.25, 0.5, pads), 12, "high");
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "beginner-rh-selected", beginnerRh, [{
      stage: "beginner-rh-input",
      notes: beginnerRhSource,
    }], "beginner-principal-selection");
  }
  const beginnerSource = quantize(
    [
      ...beginnerRh,
      ...(metalProfile || safeLeftHandOnly ? sparseLeftHandAnchors(veryEasy, Math.max(1, beatsPerMeasure / 2)) : []),
    ],
    { grid: 0.25 },
  );
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "beginner-assembled", beginnerSource, [
      { stage: "beginner-rh-selected", notes: beginnerRh },
      { stage: "very-easy-playable", notes: veryEasy.filter((note) => note.hand === "L") },
    ], "beginner-assembly");
  }
  const beginner = capLevel(
    "beginner",
    trimSamePitchOverlaps(metalProfile ? capSemanticBeginnerHands(beginnerSource) : beginnerSource),
  );
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "beginner-playable", beginner, [{
      stage: "beginner-assembled",
      notes: beginnerSource,
    }], "beginner-playability");
  }
  const veryBeginnerRhSource = metalProfile
    ? reduceMetalRhRealism(beginner.filter((n) => n.hand !== "L"), tempo, 2, true)
    : beginner.filter((n) => n.hand !== "L");
  const veryBeginnerRh = capSoundingSpan(
    melodyOnly(veryBeginnerRhSource, 0.5, 1, pads),
    12,
    "high",
  );
  const veryBeginnerSource = quantize(
    [
      ...veryBeginnerRh,
      ...(metalProfile || safeLeftHandOnly ? sparseLeftHandAnchors(beginner, Math.max(1, beatsPerMeasure)) : []),
    ],
    { grid: 0.5 },
  );
  const veryBeginner = capLevel(
    "very-beginner",
    trimSamePitchOverlaps(metalProfile ? capSemanticBeginnerHands(veryBeginnerSource) : veryBeginnerSource),
  );

  const rawSets: Record<DifficultyLevel, Note[]> = {
    "very-beginner": veryBeginner,
    beginner,
    "very-easy": veryEasy,
    easy,
    medium,
    advanced,
  };
  // Thin harder learner levels before canonicalizing the public ladder. A
  // post-ladder deletion can leave an easier note with no surviving parent.
  if (learnerProfile && !metalProfile) {
    for (const level of ["easy", "medium", "advanced"] as const) {
      rawSets[level] = selectProtectedSemanticLocalThinning(rawSets[level]!, tempo, level).notes;
    }
  }
  // The levels were density-capped top-down so every reduction sees the same
  // playable attack stream as its next harder neighbor. Intersect easier RH
  // material with that neighbor once more to canonicalize quantized starts.
  const sets: Record<DifficultyLevel, Note[]> = { ...rawSets };
  for (let i = LEVEL_ORDER.length - 2; i >= 0; i--) {
    const easier = LEVEL_ORDER[i]!;
    const harder = LEVEL_ORDER[i + 1]!;
    const metalBeginnerFallback = metalProfile
      && (easier === "very-beginner" || easier === "beginner");
    const ladderReduced = preserveRhLadder(
      sets[easier]!,
      sets[harder]!,
      // Source timing can sit halfway between the coarser Beginner grid.
      // Match that rounding distance, then snap back to the harder onset.
      opts.arrangementProfile === "source" && easier === "beginner" ? 0.13 : LADDER_TOL[easier] ?? 0.02,
      PLAYABILITY_LIMITS[easier]!.maxSim,
      pathologicalWall || metalBeginnerFallback,
      metalBeginnerFallback,
    );
    sets[easier] = trimSamePitchOverlaps(
      metalProfile
        ? preserveMetalLhLadder(ladderReduced, sets[harder]!, LADDER_TOL[easier] ?? 0.02)
        : ladderReduced,
    );
  }
  if (learnerProfile && !metalProfile) {
    sets.beginner = trimSamePitchOverlaps(preserveRhLadder(
      sets.beginner!,
      sets.easy!,
      LADDER_TOL.beginner ?? 0.02,
      PLAYABILITY_LIMITS.beginner!.maxSim,
    ));
    sets["very-beginner"] = trimSamePitchOverlaps(preserveRhLadder(
      sets["very-beginner"]!,
      sets.beginner!,
      LADDER_TOL["very-beginner"] ?? 0.26,
      PLAYABILITY_LIMITS["very-beginner"]!.maxSim,
    ));
  }
  const beginnerAfterLadder = sets.beginner!;
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "beginner-ladder", beginnerAfterLadder, [{
      stage: "beginner-playable",
      notes: beginner,
    }], "beginner-ladder-preservation");
  }
  // Promote the frozen collision-aware sparse-LH policy for the generic
  // learner Beginner only. Applying it after the ladder is finalized makes
  // the source of truth explicit: existing Beginner RH and finalized Very
  // Easy LH are the inputs, while every other level (including metal) stays
  // unchanged.
  if (learnerProfile && !metalProfile) {
    const beginner = sets.beginner!;
    const beginnerRh = beginner.filter((note) => note.hand !== "L");
    const sparseLh = collisionAwareSparseLeftHandAnchors(
      beginnerRh,
      sets["very-easy"]!,
      Math.max(1, beatsPerMeasure),
      tempo,
      PLAYABILITY_LIMITS.beginner!.maxDensity,
    );
    const existingKeys = new Set(beginner.map((note) => `${note.hand ?? "R"}:${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}`));
    sets.beginner = [...beginner, ...sparseLh.filter((note) => {
      const key = `L:${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}`;
      return !existingKeys.has(key);
    })].sort((a, b) => a.start - b.start || (a.hand === "L" ? 1 : -1) || a.midi - b.midi);
  }
  // Frozen Candidate A: after the existing ladder and sparse-LH stages, admit
  // at most one structurally supported source attack per meter window. The
  // shared selector owns eligibility/order; this callback owns the current
  // Beginner mechanical envelope. Candidate B is never callable here.
  if (learnerProfile && !metalProfile) {
    const beginnerBaseline = sets.beginner!;
    const rejected = learnerTraceEnabled
      ? resolveBeginnerOffGridRejections(learnerTraceEvents, imported)
      : resolveBeginnerOffGridRejectionsFromLineage(beginner, beginnerAfterLadder, imported);
    const durationBeats = Math.max(0, ...imported.map((note) => note.start + note.dur).filter(Number.isFinite));
    const selection = selectBeginnerOffGridRhCandidates({
      sourceNotes: imported,
      baselineNotes: beginnerBaseline,
      rejected,
      timeSig: src.timeSig,
      durationBeats,
      budget: 1,
      isLegal: (candidate, selected, baseline) => assessBeginnerOffGridCandidate(
        candidate,
        selected,
        baseline,
        {
          tempoBpm: tempo,
          durationBeats,
          maxSimultaneity: PLAYABILITY_LIMITS.beginner!.maxSim,
          maxDensity: PLAYABILITY_LIMITS.beginner!.maxDensity,
          minMedianIoiSeconds: PLAYABILITY_LIMITS.beginner!.minMedianIoi,
        },
      ).legal,
    });
    const additions = new Map(selection.emitted.map((candidate) => [learnerSourceKey(candidate.note), candidate.sourceKey]));
    sets.beginner = selection.selected.map((note) => {
      const sourceKey = additions.get(learnerSourceKey(note));
      if (!sourceKey) return note;
      const marked = { ...note, learnerTraceRefs: [sourceKey] } as LearnerInternalNote;
      Object.defineProperty(marked, BEGINNER_OFFGRID_CANDIDATE, { value: true, enumerable: true });
      return marked;
    });
  }
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "beginner-final", sets.beginner!, [{
      stage: "beginner-ladder",
      notes: beginnerAfterLadder,
    }, {
      stage: "raw",
      notes: learnerTraceSource,
    }], "beginner-finalization");
  }
  if (learnerTraceEnabled) {
    emitLearnerStageTrace(learnerTraceSink, "easy-ladder", sets.easy!, [{ stage: "easy-playable", notes: easy }], "easy-ladder-preservation");
    emitLearnerStageTrace(learnerTraceSink, "final", sets.easy!, [{ stage: "easy-ladder", notes: sets.easy! }], "easy-public-final");
  }
  if (opts.arrangementProfile === "source") {
    // A piano arrangement can finish in the bass after the RH part ends.
    // Keep that actual ending as a single LH line, rather than silent bars.
    const rhEnd = maxNoteEnd(sets.easy.filter(note => note.hand !== "L"));
    const tail = onsetGroups(sets.easy.filter(note => note.hand === "L" && note.start >= rhEnd))
      .map(group => group.reduce((a, b) => a.midi < b.midi ? a : b));
    sets.beginner = spaceHandAttacks([...sets.beginner!, ...tail], tempo);
  }
  const scores: Record<DifficultyLevel, number> = {
    "very-beginner": 1,
    beginner: 1.4,
    "very-easy": 2,
    easy: 2.6,
    medium: 3.4,
    advanced: 4.6,
  };
  const lhPattern = detectBassPattern(lh);
  const variants: Variant[] = LEVEL_ORDER.map((level) => {
    const internalNotes = sets[level]!.map((n) => ({ ...n }));
    emitDifficultyTrace(opts.trace, level, internalNotes, learnerTraceSource);
    const notes = learnerLineageEnabled ? internalNotes.map(stripLearnerTrace) : internalNotes;
    const pedalErrors=src.sourcePedal?sourcePedalErrors(notes,src.sourcePedal):[];
    const keepPedal=src.sourcePedal && level==="advanced" && opts.arrangementProfile==="source" && !pedalErrors.length;
    const variantWarnings=[...warnings,...(src.unsupportedControls?.length?[`Unsupported source semantics: ${src.unsupportedControls.join("; ")}.`]:[]),...(src.sourcePedal?[keepPedal?"Source CC64 is retained separately from arranged key holds; listening and physical playability are unverified.":`Source CC64 omitted from this reduction${pedalErrors.length?`: ${pedalErrors.join(" ")}`:"; use a supported Original arrangement"}.`]:[])];
    return {
      level,
      difficultyScore: scores[level]!,
      ...(src.sections?.length ? {sections:src.sections.map(s=>({...s}))} : {}),
      notes,
      ...(variantWarnings.length ? { warnings:variantWarnings } : {}),
      ...(sourceChanges.length ? { sourcePreparation: { schemaVersion: 1 as const, timebase: "variant-beats" as const, changes: structuredClone(sourceChanges) } } : {}),
      ...(keepPedal?{sourcePedal:structuredClone(src.sourcePedal)}:{}),
      chords: opts.chords
        ? opts.chords.map((chord) => ({ ...chord, notes: [...chord.notes] }))
        : chordsAt(notes, grid, src.durationBeats, opts.audioDerived !== true),
      bassPattern: level === "advanced" || level === "medium"
        ? lhPattern
        : level === "very-easy" || level === "easy" || (metalProfile && notes.some((note) => note.hand === "L"))
          ? "block"
          : "none",
      key,
      tempoBpm: tempo,
      timeSig: src.timeSig,
      ...(sourceTimeSigEvents.length ? { timeSigEvents: sourceTimeSigEvents.map((event) => ({ ...event, timeSig: [...event.timeSig] as [number, number] })) } : {}),
      measures: sourceMeasures(src, notes, sourceTimeSigEvents),
    };
  });
  if (!phrasePlan) return variants;
  return applyPhrasePlan(variants, phrasePlan, { sourceTempoBpm: sourceTempo, maxDurBeats: opts.maxDurBeats }).map(variant => {
    if (variant.phraseProtection?.status !== "preserved") return variant;
    return { ...variant,
      // Derived accompaniment metadata must describe the final restored notes.
      // Explicit source-supplied charts retain their separate existing authority.
      chords: opts.chords ? variant.chords : chordsAt(variant.notes, grid, src.durationBeats, true),
      bassPattern: variant.level === "advanced" || variant.level === "medium"
        ? detectBassPattern(variant.notes.filter(n => n.hand === "L")) : variant.bassPattern,
    };
  });
}

/** Keep an owner-authored short study exact and expose only levels that pass
 * the normal playability limits. No notes, pitches, or hands are synthesized. */
export function buildShortStudyVariants(
  source: ParsedMidi,
  meta: SongMeta,
  options: { maxDurBeats?: number | null } = {},
): Variant[] {
  assertSourceWorkload(source);
  const sourceErrors = validateShortStudySource(source.notes);
  if (sourceErrors.length) throw new Error(sourceErrors.join("; "));

  const sourceTempo = normalizeTempoBpm(source.tempoBpm);
  let parsed = source;
  if (source.tempoEvents?.length && (
    !source.tempoEvents.some((event) => event.tick === 0)
    || source.tempoEvents.some((event) => Math.abs(60_000_000 / event.microsecondsPerQuarter - sourceTempo) > 1e-6)
  )) {
    const beat = (value: number) => midiBeatToNativeSeconds(source, value) * sourceTempo / 60;
    parsed = {
      ...source,
      tempoBpm: sourceTempo,
      tempoEvents: undefined,
      durationBeats: beat(source.durationBeats),
      ...(source.notationMeasures ? { notationMeasures: source.notationMeasures.map(measure => ({ ...measure, startBeat: beat(measure.startBeat), endBeat: beat(measure.endBeat) })) } : {}),
      ...(source.sections ? {sections:source.sections.map(s=>({...s,startBeat:beat(s.startBeat),endBeat:beat(s.endBeat)}))} : {}),
      ...(source.sourcePedal?{sourcePedal:{...source.sourcePedal,endBeat:beat(source.sourcePedal.endBeat),changes:source.sourcePedal.changes.map(e=>({...e,beat:beat(e.beat)}))}}:{}),
      notes: source.notes.map((note) => ({ ...note, start: beat(note.start), dur: beat(note.start + note.dur) - beat(note.start) })),
      ...(source.timeSigEvents?.length ? { timeSigEvents: source.timeSigEvents.map((event) => ({ ...event, beat: beat(event.beat) })) } : {}),
    };
  }
  assertSourceWorkload(parsed);
  const tempoBpm = normalizeTempoBpm(meta.tempo ?? parsed.tempoBpm);
  const notes = parsed.notes.map((note) => ({ ...note }));
  if(parsed.sourcePedal){const errors=sourcePedalErrors(notes,parsed.sourcePedal);if(errors.length)throw new Error(errors.join(" "));}
  const timeSigEvents = normalizeTimeSigEvents(parsed.timeSigEvents);
  const scores: Record<(typeof PUBLIC_DIFFICULTY_ORDER)[number], number> = {
    beginner: 1.4,
    easy: 2.6,
    medium: 3.4,
    advanced: 4.6,
  };
  const candidates = PUBLIC_DIFFICULTY_ORDER.map((level): Variant => ({
    level,
    difficultyScore: scores[level],
    ...(parsed.sections?.length ? {sections:parsed.sections.map(s=>({...s}))} : {}),
    ...(parsed.sourcePedal?{sourcePedal:structuredClone(parsed.sourcePedal)}:{}),
    warnings: [
      ...(parsed.unsupportedControls?.length ? [`Unsupported source semantics: ${parsed.unsupportedControls.join("; ")}.`] : []),
      ...(parsed.sourcePedal ? ["Source CC64 is retained separately from physical key holds; musical review is unverified."] : []),
    ],
    notes: notes.map((note) => ({ ...note })),
    chords: [],
    bassPattern: "none",
    key: meta.key ?? detectKey(notes).name,
    tempoBpm,
    timeSig: [...parsed.timeSig] as [number, number],
    ...(timeSigEvents.length ? { timeSigEvents: timeSigEvents.map((event) => ({ ...event, timeSig: [...event.timeSig] as [number, number] })) } : {}),
    measures: sourceMeasures(parsed, notes, timeSigEvents),
  }));
  const available = candidates.filter((variant) => validateVariants([variant], {
    shortStudy: true,
    maxDurBeats: options.maxDurBeats ?? null,
  }).length === 0);
  if (!available.length) throw new Error("study does not pass any public level's playability limits");
  return available;
}
