import type { ChordLabel, Note, ParsedMidi } from "./types.js";
import { midiBeatToNativeSeconds } from "./parse.js";
import type { MetalArrangementInput, MetalArrangementDebugOptions, MetalArrangementResult, MetalStemRole, IdentityNote, MetalIdentitySection, GuitarHarmonicAttack, MetalArrangementIR } from "./metal-arrange/types.js";
import { validNotes, beatsPerMeasure, EPS, notesIn, isUpperGuitarRhythmWall, isMetalInstrumentalSource, stripInternalIdentity, bassAt, pitchClassesAt, toRegister, pitchClass, uniqueSorted } from "./metal-arrange/shared.js";
import { traceRawNotes, traceParents, emitTrace, traceNote, metalTraceFinalKey } from "./metal-arrange/trace.js";
import { filterLowVocalDroneNotes, trustworthyVocalNotes, vocalSourceConfidence, melodicConfidence } from "./metal-arrange/vocals.js";
import { monophonicPath } from "./metal-arrange/monophonic.js";
import { selectGuitarLeadPathInternal, harmonicCloneDistance } from "./metal-arrange/guitar-lead.js";
import { supportedUpperRawNotes, upperHarmonicPath, selectResidualUpperMelodyPath, selectResidualOpeningContour, inferConservativeTopLine } from "./metal-arrange/upper-melody.js";
import type { UpperEvidenceLane } from "./metal-arrange/upper-melody.js";
import { rawLowRhythmEvents, rescueGuitarPreSelectorCandidates, classifyGuitarPreSelector, emitGuitarPreSelectorTrace, suppressLowGuitarPulseRuns } from "./metal-arrange/guitar-preselector.js";
import { inferSemanticGuitarHarmony, freshGuitarHarmonyDiagnostics, strictResidualHarmonyPhraseWindows, chordFor } from "./metal-arrange/harmony.js";
import { identityForWindow, suppressBoundaryBleed, stabilizeIdentityRegister } from "./metal-arrange/identity.js";

// Public API re-exported from the submodules; keep this list in sync.
export type { MetalStemRole, MetalStem, MetalArrangementInput, MetalArrangementTraceStage, MetalArrangementTraceOperation, MetalArrangementTraceEvent, MetalArrangementTraceSink, MetalArrangementDebugOptions, MetalIdentitySection, MetalArrangementIR, MetalArrangementResult, GuitarLeadPathOptions, GuitarLeadPathDiagnostics, GuitarLeadPreSelectorRejectionReason, GuitarLeadPreSelectorReasons, GuitarLeadPreSelectorDiagnostics, GuitarLeadPreSelectorRescueDiagnostics, GuitarLeadPreSelectorRescueResult, GuitarLeadRejectionReason, GuitarLeadRejectionReasons, GuitarLeadPathResult, GuitarHarmonyDiagnostics } from "./metal-arrange/types.js";
export { selectGuitarLeadPath } from "./metal-arrange/guitar-lead.js";
export { rescueGuitarPreSelectorCandidates } from "./metal-arrange/guitar-preselector.js";

/**
 * Turn separated band evidence into a deliberately piano-shaped canonical
 * arrangement. Drums contribute timing accents only; they are never emitted
 * as pitched notes.
 */
export function buildMetalArrangement(
  input: MetalArrangementInput,
  debug: MetalArrangementDebugOptions = {},
): MetalArrangementResult {
  if (!input.stems.length) throw new Error("Metal arrangement requires at least one stem");
  const reference = input.stems.find((stem) => stem.role !== "drums")?.midi ?? input.stems[0]!.midi;
  const tempoBpm = reference.tempoBpm;
  if (!Number.isFinite(tempoBpm) || tempoBpm <= 0) throw new Error("metal arrangement requires a positive reference tempo");
  let normalizedTimelines = 0;
  input = { ...input, stems: input.stems.map((stem) => {
    const source = stem.midi;
    if (!Number.isFinite(source.tempoBpm) || source.tempoBpm <= 0) throw new Error(`invalid ${stem.role} stem tempo`);
    const events = source.tempoEvents ?? [];
    const differs = Math.abs(source.tempoBpm - tempoBpm) > 1e-6
      || (events.length > 0 && !events.some(event => event.tick === 0))
      || events.some(event => Math.abs(60_000_000 / event.microsecondsPerQuarter - tempoBpm) > 1e-6);
    if (!differs) return stem;
    normalizedTimelines += 1;
    const beat = (value: number): number => midiBeatToNativeSeconds(source, value) * tempoBpm / 60;
    return { ...stem, midi: { ...source, tempoBpm, tempoEvents: undefined,
      durationBeats: beat(source.durationBeats),
      notes: validNotes(stem).map(note => ({ ...note, start: beat(note.start), dur: beat(note.start + note.dur) - beat(note.start) })),
    } };
  }) };
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
  const trace = debug.trace;
  const vocalSourceNotes = traceRawNotes(vocalsStem, "vocals", trace);
  const guitarRaw = traceRawNotes(guitarStem, "guitar", trace);
  const otherRaw = traceRawNotes(otherStem, "other", trace);
  const bass = traceRawNotes(bassStem, "bass", trace);
  const drums = traceRawNotes(drumsStem, "drums", trace);
  const vocalRaw = filterLowVocalDroneNotes(vocalSourceNotes);
  const retainedVocalRaw = new Set(vocalRaw);
  for (const note of vocalSourceNotes) {
    const key = traceParents(note)[0];
    if (!key) continue;
    const retained = retainedVocalRaw.has(note);
    emitTrace(trace, {
      key: `cleaned:${key}`,
      stage: "cleaned",
      parentKeys: [key],
      source: "vocals",
      sourceStem: "vocals",
      note: traceNote({ ...note, rawMidi: note.midi }),
      selected: retained,
      selectionReason: retained ? "vocal-candidate-retained" : "low-vocal-drone-or-wall",
    });
  }
  const vocals = monophonicPath(vocalRaw, 60, 96, { exactOctaveWindow: 0.5 })
    .map((note) => ({ ...note, identitySource: "vocals" as const }));
  if (trace) {
    for (const [index, note] of vocals.entries()) {
      const parents = traceParents(note);
      emitTrace(trace, {
        key: `lead:vocals:${index}:${note.start.toFixed(6)}`,
        stage: "lead",
        parentKeys: parents,
        source: "vocals",
        sourceStem: note.traceSourceStem ?? "vocals",
        note: traceNote(note),
        selected: true,
        selectionReason: "monophonic-vocal-lead",
      });
    }
  }
  const trustedVocals = trustworthyVocalNotes(vocals);
  // Compare the raw phrase before an upper harmonic can route its own
  // fundamental out as rhythm. Only a longer selected co-onset fundamental
  // invalidates that partial; a genuine upper lead above short rhythm stays.
  const rawGuitarPhrase = selectGuitarLeadPathInternal(guitarRaw.map((note) => ({ ...note, identitySource: "guitar" as const })), {
    minimumSpacingBeats: 0.08, skipPenalty: 30, minimumPhraseGroups: 4,
  }).notes;
  const guitarMelodicRaw = guitarRaw.filter((note) =>
    !rawGuitarPhrase.some((selected) => selected.midi < note.midi
      && harmonicCloneDistance(note.midi - selected.midi)
      && Math.abs(selected.start - note.start) <= 0.08 + EPS
      && selected.dur >= note.dur + 0.15
      && selected.vel >= note.vel * 0.5));
  const guitarUpperRaw = supportedUpperRawNotes(guitarMelodicRaw);
  const otherUpperRaw = supportedUpperRawNotes(otherRaw);
  const guitarUpperEvidence = upperHarmonicPath(guitarMelodicRaw, "guitar");
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
  const guitarRawRhythm = rawLowRhythmEvents(guitarMelodicRaw, "guitar", guitarRawUpperContext);
  const otherRawRhythm = rawLowRhythmEvents(otherRaw, "other", otherRawUpperContext);
  const isRoutedRawLow = (note: Note, routed: IdentityNote[]): boolean =>
    note.midi <= 60 && routed.some((candidate) => Math.abs(candidate.start - note.start) <= 0.08 + EPS);
  // Split raw low material before octave registration. Otherwise MIDI 50–54
  // can become a false RH 62–66 line and the later pulse pass cannot recover
  // which detector event was really accompaniment.
  const guitarEligibleRaw = guitarMelodicRaw
    .filter((note) => note.hand !== "L"
      && (note.midi < 61 || guitarUpperRaw.includes(note))
      && note.midi >= 45
      && !isRoutedRawLow(note, guitarRawRhythm));
  const preSelectorRescue = debug.preSelectorRescue
    ? rescueGuitarPreSelectorCandidates(guitarRaw, guitarEligibleRaw)
    : undefined;
  const effectiveGuitarEligibleRaw = [
    ...guitarEligibleRaw,
    ...(preSelectorRescue?.notes ?? []),
  ];
  const guitarPathInput = effectiveGuitarEligibleRaw
    .map((note) => ({ ...note, identitySource: "guitar" as const }));
  const guitarPreSelector = classifyGuitarPreSelector(
    guitarStem,
    guitarRaw,
    effectiveGuitarEligibleRaw,
    guitarRawRhythm,
    guitarUpperRaw,
  );
  if (preSelectorRescue) guitarPreSelector.rescue = preSelectorRescue.diagnostics;
  emitGuitarPreSelectorTrace(
    trace,
    guitarRaw,
    effectiveGuitarEligibleRaw,
    guitarRawRhythm,
    guitarUpperRaw,
    preSelectorRescue?.notes,
  );
  // Resolve harmonic stacks and detector spikes while the raw guitar
  // candidates are still available. The integration uses a very small spacing
  // floor so Advanced keeps its source density; learner-level .5-beat floors
  // are applied later by reduceMetalRhRealism/buildVariants.
  const guitarLeadSelection = selectGuitarLeadPathInternal(guitarPathInput, {
    minimumSpacingBeats: 0.08,
    groupToleranceBeats: 0.08,
    phraseBreakBeats: 1.5,
    maxCandidatesPerGroup: 4,
    beamWidth: 24,
    allowGapRecovery: true,
    // Keep the source selector conservative at arrangement time. Learner
    // density/contour reducers make the intentional spacing decisions later;
    // this pass should resolve stacks and obvious detector artifacts without
    // deleting an entire attack group from Advanced/source identity. A high
    // skip cost makes the DP choose one representative per detector onset;
    // the lossy learner floors remain downstream where level policy is known.
    skipPenalty: 30,
    minimumPhraseGroups: 4,
  });
  const guitarPath = monophonicPath(
    guitarLeadSelection.notes.length ? guitarLeadSelection.notes : guitarPathInput,
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
  const rescuedGuitarKeys = new Set((preSelectorRescue?.notes ?? []).map((note) =>
    `${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}`));
  const isRescuedGuitarNote = (note: IdentityNote): boolean => rescuedGuitarKeys.has(
    `${note.start.toFixed(6)}:${(note.rawMidi ?? note.midi)}:${note.dur.toFixed(6)}:${note.vel}`,
  );
  // Rescue candidates still pass through the source-locked selector above,
  // but a later low-wall pass can mistake a selected changing contour for a
  // rhythm run. Preserve only those selector-selected rescue notes in RH;
  // rejected rescue candidates remain absent from both melody and rhythm.
  const selectedRescueLead = guitarPath.filter(isRescuedGuitarNote);
  const guitar = [
    ...guitarLanes.lead.filter((note) => !isRescuedGuitarNote(note)),
    ...selectedRescueLead,
  ].sort((a, b) => a.start - b.start || a.midi - b.midi || b.vel - a.vel);
  const rhythmGuitar = [
    ...guitarLanes.rhythm.filter((note) => !isRescuedGuitarNote(note)),
    ...guitarRawRhythm.filter((note) => !isRescuedGuitarNote(note)),
  ];
  const otherLanes = suppressLowGuitarPulseRuns(otherPath, [...guitarPath, ...sharedUpperEvidence]);
  const other = otherLanes.lead;
  const rhythmOther = [...otherLanes.rhythm, ...otherRawRhythm];
  const emitPathTrace = (
    stage: "lead" | "residual",
    rawNotes: IdentityNote[],
    selectedNotes: IdentityNote[],
    source: "guitar" | "other",
  ): void => {
    if (!trace) return;
    const selectedRefs = new Set(selectedNotes.flatMap((note) => traceParents(note)));
    for (const raw of rawNotes) {
      const rawKey = traceParents(raw)[0];
      if (!rawKey) continue;
      const selected = selectedRefs.has(rawKey);
      emitTrace(trace, {
        key: `${stage}:${rawKey}`,
        stage,
        parentKeys: [rawKey],
        source,
        sourceStem: raw.traceSourceStem ?? source,
        note: traceNote({ ...raw, rawMidi: raw.midi }),
        selected,
        selectionReason: selected
          ? stage === "lead" ? "selected-lead-event" : "selected-residual-contour"
          : stage === "lead" ? "rejected-harmonic-or-rhythm-candidate" : "rejected-residual-partial",
      });
    }
  };
  emitPathTrace("lead", guitarRaw, guitar, "guitar");
  emitPathTrace("residual", otherRaw, other, "other");
  for (const rhythm of [...rhythmGuitar, ...rhythmOther]) {
    const parents = traceParents(rhythm);
    if (!parents.length) continue;
    emitTrace(trace, {
      key: `decision:rhythm:${parents[0]}`,
      stage: "decision",
      parentKeys: parents,
      source: rhythm.identitySource ?? null,
      sourceStem: rhythm.traceSourceStem ?? rhythm.identitySource ?? null,
      note: traceNote({ ...rhythm, rawMidi: rhythm.rawMidi ?? rhythm.midi }),
      selected: false,
      selectionReason: "rhythm-wall-routed-out-of-RH",
    });
  }
  const dedicatedGuitarHarmony = guitarStem
    ? inferSemanticGuitarHarmony(guitarMelodicRaw, guitarPath, bass, "guitar", guitarStem.confidence)
    : { attacks: [], diagnostics: freshGuitarHarmonyDiagnostics() };
  const residualHarmonyWindows = guitarStem ? [] : strictResidualHarmonyPhraseWindows(otherUpperEvidence);
  const residualFallbackPhrases = residualHarmonyWindows.length;
  const inResidualHarmonyWindow = (start: number): boolean => residualHarmonyWindows.some((window) =>
    start >= window.start - 0.08 - EPS && start <= window.end + 0.08 + EPS,
  );
  const residualGuitarHarmony = !guitarStem && residualFallbackPhrases > 0
    ? inferSemanticGuitarHarmony(
      otherRaw.filter((note) => inResidualHarmonyWindow(note.start)),
      other.filter((note) => inResidualHarmonyWindow(note.start)),
      bass,
      "other",
      otherStem?.confidence,
    )
    : { attacks: [], diagnostics: freshGuitarHarmonyDiagnostics() };
  // Count the accepted residual phrase gates as fallback windows as well as
  // any later harmony windows that need raw-evidence fallback. This keeps the
  // diagnostic useful even when a gated phrase ends before the final grid
  // window and therefore has no raw notes in that tail window.
  if (residualFallbackPhrases > 0) residualGuitarHarmony.diagnostics.fallbackWindows = residualFallbackPhrases;
  const guitarHarmony = guitarStem ? dedicatedGuitarHarmony : residualGuitarHarmony;
  for (const [index, attack] of guitarHarmony.attacks.entries()) {
    const parents = attack.traceRefs ? [...attack.traceRefs].sort() : [];
    const clusterKey = `cluster:${attack.source}:${attack.start.toFixed(6)}:${index}`;
    const semanticKey = `semantic:${attack.source}:${attack.start.toFixed(6)}:${index}`;
    emitTrace(trace, {
      key: clusterKey,
      stage: "cluster",
      parentKeys: parents,
      source: attack.source,
      sourceStem: attack.source,
      selected: true,
      selectionReason: "onset-cluster",
      confidence: attack.confidence,
      semantic: {
        rootPc: attack.rootPc,
        quality: attack.quality,
        bassSupported: attack.bassSupported,
        memberCount: attack.memberCount,
      },
    });
    emitTrace(trace, {
      key: semanticKey,
      stage: "semantic",
      parentKeys: [clusterKey],
      source: attack.source,
      sourceStem: attack.source,
      selected: true,
      selectionReason: "semantic-harmonic-attack",
      confidence: attack.confidence,
      semantic: {
        rootPc: attack.rootPc,
        quality: attack.quality,
        bassSupported: attack.bassSupported,
        memberCount: attack.memberCount,
      },
    });
  }
  // Semantic guitar roots replace duplicate raw guitar stack evidence for
  // harmony only. The selected lead and residual `other` fallback remain
  // independent, so this cannot erase a playable RH contour.
  const semanticEvidence: IdentityNote[] = guitarHarmony.attacks.map((attack, index) => ({
    midi: attack.rootMidi,
    start: attack.start,
    dur: attack.dur,
    vel: Math.round(70 + attack.confidence * 40),
    identitySource: attack.source,
    traceRefs: [`semantic:${attack.source}:${attack.start.toFixed(6)}:${index}`],
    traceSourceStem: attack.source,
  }));
  const selectedHarmonicEvidence: IdentityNote[] = [
    ...semanticEvidence,
    ...(guitarStem ? guitarPath : []),
    ...otherPath,
  ];
  const rawHarmonicEvidence: Note[] = [...guitarRaw, ...otherRaw];
  const rawHarmonyTraceEvidence: IdentityNote[] = [...guitarRaw, ...otherRaw, ...bass];
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
  for (const [index, note] of stabilizedIdentity.entries()) {
    emitTrace(trace, {
      key: `decision:identity:${index}:${note.start.toFixed(6)}:${note.midi}`,
      stage: "decision",
      parentKeys: traceParents(note),
      source: note.identitySource ?? null,
      sourceStem: note.traceSourceStem ?? note.identitySource ?? null,
      note: traceNote(note),
      selected: true,
      selectionReason: "identity-window-and-register-selection",
    });
  }
  const publicIdentity = stabilizedIdentity.map(stripInternalIdentity);
  const chords: ChordLabel[] = [];
  const leftHand: Note[] = [];
  let previousRoot: number | undefined;
  for (let beat = 0; beat < durationBeats - EPS; beat += harmonyBeats) {
    const end = Math.min(durationBeats, beat + harmonyBeats);
    const bassNote = bassAt(bass, beat, end);
    const semanticInWindow = guitarHarmony.attacks
      .filter((attack) => attack.start >= beat - EPS && attack.start < end - EPS)
      .sort((a, b) => b.confidence - a.confidence || a.start - b.start);
    const semanticReliable = semanticInWindow.some((attack) => attack.confidence >= 0.55 && attack.memberCount >= 2);
    const evidence = pitchClassesAt(semanticReliable ? selectedHarmonicEvidence : rawHarmonicEvidence, beat, end);
    if (!semanticReliable && evidence.size > 0) guitarHarmony.diagnostics.fallbackWindows += 1;
    const semanticByRoot = new Map<number, { score: number; attack: GuitarHarmonicAttack }>();
    for (const attack of semanticInWindow) {
      const current = semanticByRoot.get(attack.rootPc);
      const score = attack.confidence + (attack.bassSupported ? 0.15 : 0);
      if (!current || score > current.score + EPS || (Math.abs(score - current.score) <= EPS && attack.start < current.attack.start)) {
        semanticByRoot.set(attack.rootPc, { score, attack });
      }
    }
    const semantic = [...semanticByRoot.values()].sort((a, b) => b.score - a.score || a.attack.start - b.attack.start)[0]?.attack;
    let rootPc = semantic?.rootPc
      ?? (bassNote ? ((bassNote.midi % 12) + 12) % 12 : previousRoot);
    if (rootPc === undefined && evidence.size) rootPc = [...evidence][0];
    if (rootPc === undefined) continue;
    previousRoot = rootPc;
    const chord = chordFor(rootPc, evidence, semanticReliable ? semantic?.quality : undefined);
    const duration = Math.max(0.25, end - beat);
    const semanticIndex = semantic ? guitarHarmony.attacks.indexOf(semantic) : -1;
    const semanticParent = semanticIndex >= 0
      ? `semantic:${semantic!.source}:${semantic!.start.toFixed(6)}:${semanticIndex}`
      : undefined;
    const fallbackParents = [...new Set(rawHarmonyTraceEvidence
      .filter((note) => note.start >= beat - 0.08 - EPS && note.start < end + 0.08 + EPS)
      .flatMap((note) => traceParents(note)))].sort();
    const chordKey = `chord:${beat.toFixed(6)}`;
    emitTrace(trace, {
      key: chordKey,
      stage: "chord",
      parentKeys: semanticParent ? [semanticParent] : fallbackParents,
      source: semantic?.source ?? null,
      sourceStem: semantic?.source ?? null,
      selected: true,
      selectionReason: semanticReliable ? "semantic-harmony-chord" : "raw-harmony-fallback",
      ...(semantic ? {
        confidence: semantic.confidence,
        semantic: {
          rootPc: semantic.rootPc,
          quality: semantic.quality,
          bassSupported: semantic.bassSupported,
          memberCount: semantic.memberCount,
        },
      } : {}),
    });
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
    leftHand.push({ midi: root, start: beat, dur: Math.min(duration, 1.5), vel: 68, hand: "L", traceRefs: [chordKey] } as Note & { traceRefs: string[] });
    emitTrace(trace, {
      key: `left-hand:${chordKey}:root`,
      stage: "left-hand",
      parentKeys: [chordKey],
      source: semantic?.source ?? null,
      sourceStem: semantic?.source ?? null,
      note: { midi: root, start: beat, dur: Math.min(duration, 1.5), vel: 68, hand: "L" },
      selected: true,
      selectionReason: semanticReliable ? "inferred-chord-root" : "raw-harmony-root-fallback",
    });
    if (chord.notes.length > 1) {
      const fifth = chord.notes.find((note) => note % 12 === (rootPc! + 7) % 12);
      if (fifth !== undefined) {
        leftHand.push({ midi: fifth, start: beat, dur: Math.min(duration, 1.5), vel: 62, hand: "L", traceRefs: [chordKey] } as Note & { traceRefs: string[] });
        emitTrace(trace, {
          key: `left-hand:${chordKey}:fifth`,
          stage: "left-hand",
          parentKeys: [chordKey],
          source: semantic?.source ?? null,
          sourceStem: semantic?.source ?? null,
          note: { midi: fifth, start: beat, dur: Math.min(duration, 1.5), vel: 62, hand: "L" },
          selected: true,
          selectionReason: semanticReliable ? "inferred-chord-fifth" : "raw-harmony-fifth-fallback",
        });
      }
    }
  }

  // A singleton semantic attack is a possible melodic lead, not an
  // accompaniment event. Multi-note stacks become one source-tagged LH root
  // strike, including the common low-root + selected-upper-fifth case.
  const semanticLeftHand: IdentityNote[] = [];
  const semanticSeen = new Set<string>();
  for (const [attackIndex, attack] of guitarHarmony.attacks.entries()) {
    if (attack.memberCount < 2 || attack.confidence < 0.5
      || !(attack.quality === "power"
        || attack.quality === "major"
        || attack.quality === "minor"
        || attack.quality === "sus2"
        || attack.quality === "sus4"
        || attack.quality === "single"
        || attack.quality === "unknown")) continue;
    const midi = toRegister(attack.rootMidi, 36, 54);
    const key = `${attack.source}:${midi}:${attack.start.toFixed(4)}`;
    if (semanticSeen.has(key)) continue;
    semanticSeen.add(key);
    const semanticTraceKey = `semantic:${attack.source}:${attack.start.toFixed(6)}:${attackIndex}`;
    semanticLeftHand.push({
      midi,
      start: attack.start,
      dur: Math.min(attack.dur, 0.75),
      vel: 58,
      hand: "L",
      identitySource: attack.source,
      traceRefs: [semanticTraceKey],
      traceSourceStem: attack.source,
    });
    emitTrace(trace, {
      key: `left-hand:${semanticTraceKey}`,
      stage: "left-hand",
      parentKeys: [semanticTraceKey],
      source: attack.source,
      sourceStem: attack.source,
      note: { midi, start: attack.start, dur: Math.min(attack.dur, 0.75), vel: 58, hand: "L" },
      selected: true,
      selectionReason: "semantic-rhythm-root",
      confidence: attack.confidence,
      semantic: {
        rootPc: attack.rootPc,
        quality: attack.quality,
        bassSupported: attack.bassSupported,
        memberCount: attack.memberCount,
      },
    });
  }
  const appendTaggedLeftHand = (note: Note): void => {
    const duplicateIndex = leftHand.findIndex((existing) => existing.hand === "L"
      && pitchClass(existing.midi) === pitchClass(note.midi)
      && Math.abs(existing.start - note.start) <= 0.08 + EPS);
    if (duplicateIndex < 0) {
      leftHand.push(note);
      return;
    }
    // Keep one root attack per onset. A semantic/rhythm event carries source
    // provenance, so it replaces an untagged chord shell; competing tagged
    // lanes retain the first deterministic winner.
    if (!leftHand[duplicateIndex]!.identitySource || leftHand[duplicateIndex]!.identitySource === note.identitySource) {
      leftHand[duplicateIndex] = note;
    }
  };
  // Merge semantic roots with the pre-existing chord shell by pitch class and
  // onset, not only by exact MIDI. The shell may voice the same root an
  // octave lower; keeping both would create a duplicate LH attack and hide
  // the source-tagged semantic event. Prefer the semantic note so its source
  // provenance and attack duration remain visible.
  for (const note of semanticLeftHand) appendTaggedLeftHand(note);
  const semanticAttackKeys = new Set(semanticLeftHand.map((note) => `${note.identitySource}:${note.start.toFixed(4)}`));
  const hasSemanticRootAt = (note: Note): boolean => semanticLeftHand.some((semantic) =>
    semantic.identitySource === note.identitySource
    && pitchClass(semantic.midi) === pitchClass(note.midi)
    && Math.abs(semantic.start - note.start) <= 0.08 + EPS,
  );

  // Stable low guitar walls are useful rhythmic evidence but poor RH melody.
  // Route them to a low register while preserving their original attacks;
  // the variant builder can then thin this explicit accompaniment lane per
  // difficulty without contaminating identity selection.
  for (const note of rhythmGuitar.filter((note) => !semanticAttackKeys.has(`${note.identitySource}:${note.start.toFixed(4)}`) && !hasSemanticRootAt(note))) {
    appendTaggedLeftHand({
      midi: toRegister(note.rawMidi ?? note.midi, 36, 54),
      start: note.start,
      dur: Math.min(Math.max(note.dur, 0.25), 0.75),
      vel: Math.max(40, Math.min(76, note.vel)),
      hand: "L",
      identitySource: note.identitySource,
      traceRefs: traceParents(note),
      traceSourceStem: note.traceSourceStem,
    } as IdentityNote);
  }
  for (const note of rhythmOther.filter((note) => !semanticAttackKeys.has(`${note.identitySource}:${note.start.toFixed(4)}`) && !hasSemanticRootAt(note))) {
    appendTaggedLeftHand({
      midi: toRegister(note.rawMidi ?? note.midi, 36, 54),
      start: note.start,
      dur: Math.min(Math.max(note.dur, 0.25), 0.75),
      vel: Math.max(40, Math.min(76, note.vel)),
      hand: "L",
      identitySource: note.identitySource,
      traceRefs: traceParents(note),
      traceSourceStem: note.traceSourceStem,
    } as IdentityNote);
  }

  const rhythmicAccents = drums.map((note) => note.start).filter((beat, index, all) => index === 0 || beat - all[index - 1]! >= 0.125);
  const preFinalNotes: IdentityNote[] = [
    ...stabilizedIdentity.map((note) => ({ ...note, hand: "R" as const })),
    ...leftHand.map((note) => ({ ...note } as IdentityNote)),
  ];
  const finalInternalNotes = uniqueSorted(preFinalNotes) as IdentityNote[];
  for (const note of finalInternalNotes) {
    emitTrace(trace, {
      key: metalTraceFinalKey(note),
      stage: "final",
      parentKeys: traceParents(note),
      source: note.identitySource ?? null,
      sourceStem: note.traceSourceStem ?? note.identitySource ?? null,
      note: traceNote(note),
      selected: true,
      selectionReason: note.hand === "L" ? "left-hand-emission" : "right-hand-identity",
    });
  }
  const notes = finalInternalNotes.map(stripInternalIdentity);
  const emittedSemanticKeys = new Set(notes
    .filter((note) => note.hand === "L" && note.identitySource)
    .map((note) => `${note.identitySource}:${note.midi}:${note.start.toFixed(4)}`));
  const emittedSemanticLeftHandEvents = semanticLeftHand.filter((note) => emittedSemanticKeys.has(`${note.identitySource}:${note.midi}:${note.start.toFixed(4)}`)).length;
  const warnings: string[] = [];
  if (normalizedTimelines) warnings.push(`${normalizedTimelines} stem timelines normalized through native seconds to ${tempoBpm} BPM`);
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
    stats: {
      identityNotes: publicIdentity.length,
      leftHandNotes: leftHand.length,
      chordEvents: chords.length,
      sourceSections,
      guitarLead: guitarLeadSelection.diagnostics,
      guitarPreSelector,
      guitarHarmony: {
        ...guitarHarmony.diagnostics,
        emittedLeftHandEvents: emittedSemanticLeftHandEvents,
      },
    },
    warnings,
  };
}
