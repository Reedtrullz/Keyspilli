import {
  clipRegionNotes,
  parseMidi,
  selectPianoMelodyRegions,
  simplifyPianoAccompaniment,
  splitPianoRoles,
  writeMidi,
  type Note,
  type ParsedMidi,
  type PianoAccompanimentDiagnostics,
  type PianoAccompanimentOptions,
  type PianoRegionCandidate,
  type PianoRegionSelection,
  type PianoRegionSelectionOptions,
  type PianoRegionWindow,
  type PianoRoleOptions,
} from "@keyspilli/midi";

const EPSILON = 1e-9;
const DEFAULT_ONSET_TOLERANCE = 0.08;
const DEFAULT_TEMPO_BPM = 120;

/** Explicit beat-domain mapping for a local alternate candidate. */
export interface PianoSectionAlignment {
  /** Source beats are shifted by this amount before scaling. */
  offsetBeats?: number;
  /** Source beat distances are divided by this positive scale. */
  beatScale?: number;
  /** Optional octave/key adjustment, applied only to alternate melody notes. */
  transposeSemitones?: number;
}

/** A local source candidate. It may be supplied as parsed MIDI or plain notes. */
export interface PianoSectionSource {
  id: string;
  /** Optional local provenance label; direct-metal inputs are intentionally rejected. */
  sourceType?: string;
  parsed?: ParsedMidi;
  notes?: readonly Note[];
  alignment?: PianoSectionAlignment;
  /** Optional generic evidence consumed by the region selector. */
  selection?: Partial<PianoRegionCandidate>;
}

/** A caller-authored window in the primary candidate's beat domain. */
export interface PianoSectionWindow extends PianoRegionWindow {
  id: string;
  startBeat: number;
  endBeat: number;
}

export interface PianoSectionBuildInput {
  /** Canonical C candidate. Its melody and accompaniment define the timeline. */
  primary: PianoSectionSource;
  /** Optional aligned alternatives, such as a D/solo candidate. */
  alternates?: readonly PianoSectionSource[];
  /** Explicit primary-domain windows where candidate selection is allowed. */
  windows: readonly PianoSectionWindow[];
  tempoBpm?: number;
  timeSig?: [number, number];
  keySig?: number;
  keyMode?: 0 | 1;
  roleOptions?: PianoRoleOptions;
  accompanimentOptions?: PianoAccompanimentOptions;
  selectionOptions?: PianoRegionSelectionOptions;
}

export interface PianoSectionMidiArtifact {
  /** MIDI bytes are convenient for the local renderer; never published by this helper. */
  bytes: Uint8Array;
  /** Parsed bytes, so the returned artifact exercises the same round-trip contract. */
  parsed: ParsedMidi;
  /** Canonical note view before/after the byte round-trip. */
  notes: Note[];
}

export interface PianoSectionOutputDiagnostics {
  noteCount: number;
  melodyNoteCount: number;
  accompanimentNoteCount: number;
  protectedMelodyCount: number;
}

export interface PianoSectionBuildDiagnostics {
  schemaVersion: 1;
  primary: {
    id: string;
    inputNoteCount: number;
    melodyNoteCount: number;
    accompanimentNoteCount: number;
    protectedMelodyCount: number;
  };
  candidates: Record<string, {
    inputNoteCount: number;
    melodyNoteCount: number;
    accompanimentNoteCount: number;
    aligned: boolean;
    alignment?: PianoSectionAlignment;
  }>;
  selection: PianoRegionSelection["diagnostics"];
  regions: PianoRegionSelection["regions"];
  accompaniment: {
    easy: PianoAccompanimentDiagnostics;
    medium: PianoAccompanimentDiagnostics;
  };
  boundaries: {
    alternateRegionCount: number;
    clippedAlternateNoteCount: number;
    protectedPrimaryNotesPreserved: number;
  };
  outputs: Record<string, PianoSectionOutputDiagnostics>;
}

export interface PianoSectionBuildResult {
  cOriginal: PianoSectionMidiArtifact;
  cMelodyOnly: PianoSectionMidiArtifact;
  cRevoicedEasy: PianoSectionMidiArtifact;
  cRevoicedMedium: PianoSectionMidiArtifact;
  cdSelectedMelodyOnly: PianoSectionMidiArtifact;
  cdFusedEasy: PianoSectionMidiArtifact;
  cdFusedMedium: PianoSectionMidiArtifact;
  selection: PianoRegionSelection;
  diagnostics: PianoSectionBuildDiagnostics;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampMidi(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)));
}

function noteKey(note: Note): string {
  return [
    note.midi,
    note.start.toFixed(9),
    note.dur.toFixed(9),
    note.vel,
    note.hand ?? "",
    note.identitySource ?? "",
    note.lyrics ?? "",
  ].join("|");
}

function compareNotes(left: Note, right: Note): number {
  return left.start - right.start
    || left.midi - right.midi
    || left.dur - right.dur
    || left.vel - right.vel
    || (left.hand ?? "").localeCompare(right.hand ?? "")
    || (left.identitySource ?? "").localeCompare(right.identitySource ?? "")
    || (left.lyrics ?? "").localeCompare(right.lyrics ?? "");
}

function validNote(note: Note): boolean {
  return finite(note.midi)
    && Number.isInteger(note.midi)
    && note.midi >= 0
    && note.midi <= 127
    && finite(note.start)
    && note.start >= 0
    && finite(note.dur)
    && note.dur > EPSILON
    && finite(note.vel)
    && note.vel > 0
    && note.vel <= 127;
}

function sortedNotes(notes: readonly Note[]): Note[] {
  const seen = new Set<string>();
  const result: Note[] = [];
  for (const note of notes) {
    if (!validNote(note)) continue;
    const copy = { ...note };
    const key = noteKey(copy);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(copy);
  }
  return result.sort(compareNotes);
}

function sourceNotes(source: PianoSectionSource): Note[] {
  return sortedNotes(source.parsed?.notes ?? source.notes ?? []);
}

function assertPianoSource(source: PianoSectionSource, role: "primary" | "alternate"): void {
  if (!source || typeof source.id !== "string" || source.id.trim() === "") {
    throw new Error(`${role} piano candidate requires a non-empty id`);
  }
  if (source.sourceType && /(?:^|[-_ ])(?:direct[-_ ]metal|metal[-_ ]transcription)(?:$|[-_ ])/i.test(source.sourceType)) {
    throw new Error(`${role} source ${source.id} is a direct-metal candidate; piano section builder accepts piano sources only`);
  }
  const scale = source.alignment?.beatScale;
  if (scale !== undefined && (!finite(scale) || scale <= EPSILON)) {
    throw new Error(`${role} source ${source.id} has an invalid beatScale`);
  }
  for (const [label, value] of [
    ["offsetBeats", source.alignment?.offsetBeats],
    ["transposeSemitones", source.alignment?.transposeSemitones],
  ] as const) {
    if (value !== undefined && !finite(value)) throw new Error(`${role} source ${source.id} has an invalid ${label}`);
  }
}

function validateWindows(windows: readonly PianoSectionWindow[] | undefined): PianoSectionWindow[] {
  if (!Array.isArray(windows)) throw new Error("piano section builder requires explicit windows");
  const seen = new Set<string>();
  const normalized = windows.map((window, index) => {
    if (!window || typeof window.id !== "string" || window.id.trim() === "") {
      throw new Error(`piano section window ${index} requires a non-empty id`);
    }
    if (!finite(window.startBeat) || !finite(window.endBeat) || window.startBeat < 0
      || window.endBeat <= window.startBeat + EPSILON) {
      throw new Error(`piano section window ${window.id} has invalid beat bounds`);
    }
    if (seen.has(window.id)) throw new Error(`duplicate piano section window id: ${window.id}`);
    seen.add(window.id);
    return { ...window };
  });
  const ordered = [...normalized].sort((left, right) => left.startBeat - right.startBeat || left.endBeat - right.endBeat || left.id.localeCompare(right.id));
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (current.startBeat < previous.endBeat - EPSILON) {
      throw new Error(`overlapping piano section windows: ${previous.id} and ${current.id}`);
    }
  }
  return normalized;
}

function sourceTemplate(source: PianoSectionSource, fallback?: ParsedMidi): ParsedMidi {
  const parsed = source.parsed ?? fallback;
  const notes = sourceNotes(source);
  const duration = parsed?.durationBeats ?? notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0);
  return {
    format: parsed?.format ?? 1,
    division: parsed?.division ?? 480,
    tempoBpm: finite(parsed?.tempoBpm) && parsed!.tempoBpm > 0 ? parsed!.tempoBpm : DEFAULT_TEMPO_BPM,
    ...(parsed?.tempoMetaPresent === undefined ? {} : { tempoMetaPresent: parsed.tempoMetaPresent }),
    keySig: parsed?.keySig ?? 0,
    keyMode: parsed?.keyMode ?? 0,
    timeSig: parsed?.timeSig ?? [4, 4],
    notes,
    trackNames: [...(parsed?.trackNames ?? [])],
    durationBeats: Math.max(duration, notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0)),
    ...(parsed?.title ? { title: parsed.title } : {}),
  };
}

function withHand(notes: readonly Note[], hand: "R" | "L"): Note[] {
  return sortedNotes(notes.map((note) => ({ ...note, hand })));
}

function dedupeNotes(notes: readonly Note[]): Note[] {
  return sortedNotes(notes);
}

function alignNotes(notes: readonly Note[], alignment: PianoSectionAlignment | undefined): Note[] {
  const offset = finite(alignment?.offsetBeats) ? alignment!.offsetBeats! : 0;
  const scale = finite(alignment?.beatScale) && alignment!.beatScale! > EPSILON ? alignment!.beatScale! : 1;
  const transpose = finite(alignment?.transposeSemitones) ? alignment!.transposeSemitones! : 0;
  const aligned: Note[] = [];
  for (const note of notes) {
    const start = (note.start - offset) / scale;
    const end = start + note.dur / scale;
    // An alternate can begin before the primary beat domain when an explicit
    // offset places a source note across beat zero.  Clip that positive
    // overlap before sortedNotes(), whose validation intentionally rejects
    // negative starts.  Notes ending at/before zero have no usable overlap.
    if (end <= EPSILON) continue;
    const clippedStart = Math.max(0, start);
    aligned.push({
      ...note,
      start: clippedStart,
      dur: end - clippedStart,
      midi: clampMidi(note.midi + transpose),
    });
  }
  return sortedNotes(aligned);
}

function subtractRegions(note: Note, regions: readonly { startBeat: number; endBeat: number }[]): Note[] {
  let pieces: Array<{ start: number; end: number }> = [{ start: note.start, end: note.start + note.dur }];
  for (const region of regions) {
    const next: Array<{ start: number; end: number }> = [];
    for (const piece of pieces) {
      const left = Math.max(piece.start, -Infinity);
      const right = Math.min(piece.end, region.startBeat);
      if (right > left + EPSILON) next.push({ start: left, end: right });
      const afterStart = Math.max(piece.start, region.endBeat);
      if (piece.end > afterStart + EPSILON) next.push({ start: afterStart, end: piece.end });
    }
    pieces = next;
  }
  return pieces.map((piece) => ({
    ...note,
    start: piece.start,
    dur: piece.end - piece.start,
  }));
}

function makeMidiArtifact(
  notes: readonly Note[],
  template: ParsedMidi,
  title: string,
): PianoSectionMidiArtifact {
  const canonical = dedupeNotes(notes);
  // Imported piano files often have generic track names and no per-note hand
  // field. Treat unlabelled events as right-hand material here; role
  // decomposition has already happened for every generated candidate, while
  // this keeps the C-original artifact a faithful round-trip of its input.
  //
  // When source provenance is present, encode it in the track name as well as
  // the hand. Standard MIDI has no per-note identity field, but parseMidi
  // deliberately infers both fields from these names. Keeping each
  // source/hand pair in its own deterministic track therefore preserves the
  // evaluator's provenance view across this local MIDI round-trip without
  // changing the public Note or MIDI contracts.
  const sourceLabel = (source: Note["identitySource"]): string => {
    if (source === "vocals") return "Vocals";
    if (source === "guitar") return "Guitar";
    if (source === "other") return "Other";
    return "Piano";
  };
  const sourceRank = (source: Note["identitySource"]): number => {
    if (source === "vocals") return 0;
    if (source === "guitar") return 1;
    if (source === "other") return 2;
    return 3;
  };
  const groups = new Map<string, { name: string; notes: Note[]; handRank: number; sourceRank: number }>();
  for (const note of canonical) {
    const hand = note.hand === "L" ? "left" : "right";
    const handRank = hand === "right" ? 0 : 1;
    const source = note.identitySource;
    const key = `${hand}:${source ?? "unknown"}`;
    const existing = groups.get(key);
    if (existing) {
      existing.notes.push(note);
      continue;
    }
    const label = sourceLabel(source);
    groups.set(key, {
      name: `${label} ${hand} hand`,
      notes: [note],
      handRank,
      sourceRank: sourceRank(source),
    });
  }
  const tracks = [...groups.values()]
    .sort((left, right) => left.handRank - right.handRank || left.sourceRank - right.sourceRank || left.name.localeCompare(right.name))
    .map(({ name, notes: groupedNotes }) => ({ name, notes: groupedNotes }));
  const bytes = writeMidi(canonical, {
    tempoBpm: finite(template.tempoBpm) && template.tempoBpm > 0 ? template.tempoBpm : DEFAULT_TEMPO_BPM,
    timeSig: template.timeSig,
    keySig: template.keySig,
    keyMode: template.keyMode,
    title,
    division: template.division,
    tracks,
  });
  return { bytes, parsed: parseMidi(bytes), notes: canonical };
}

function outputDiagnostics(
  notes: readonly Note[],
  melody: readonly Note[],
  protectedCount: number,
): PianoSectionOutputDiagnostics {
  return {
    noteCount: notes.length,
    melodyNoteCount: melody.length,
    accompanimentNoteCount: Math.max(0, notes.length - melody.length),
    protectedMelodyCount: protectedCount,
  };
}

function selectRegions(
  primary: PianoSectionSource,
  alternates: readonly PianoSectionSource[],
  primaryMelody: readonly Note[],
  alternateMelodies: ReadonlyMap<string, Note[]>,
  windows: readonly PianoSectionWindow[],
  options: PianoRegionSelectionOptions | undefined,
): PianoRegionSelection {
  const candidates: PianoRegionCandidate[] = [
    {
      ...(primary.selection ?? {}),
      id: primary.id,
      melodyNotes: primaryMelody,
    },
    ...alternates.map((source) => ({
      ...(source.selection ?? {}),
      id: source.id,
      melodyNotes: alternateMelodies.get(source.id) ?? [],
    })),
  ];
  return selectPianoMelodyRegions(candidates, windows, {
    role: "melody",
    ...(options ?? {}),
  });
}

function fusedMelody(
  primaryMelody: readonly Note[],
  alternateMelodies: ReadonlyMap<string, Note[]>,
  selection: PianoRegionSelection,
  primaryId: string,
  strictCoverage = false,
): { notes: Note[]; alternateRegionCount: number; clippedAlternateNoteCount: number } {
  const alternateRegions = selection.regions.filter((region) => region.candidateId !== primaryId);
  const blockedRegions = strictCoverage
    ? [...alternateRegions, ...selection.uncoveredWindows]
    : alternateRegions;
  const preserved = primaryMelody.flatMap((note) => subtractRegions(note, blockedRegions));
  const selectedAlternates: Note[] = [];
  let clippedAlternateNoteCount = 0;
  for (const region of alternateRegions) {
    const candidateNotes = alternateMelodies.get(region.candidateId) ?? [];
    const clipped = clipRegionNotes(candidateNotes, region, []);
    clippedAlternateNoteCount += clipped.length;
    selectedAlternates.push(...clipped);
  }
  return {
    notes: withHand(dedupeNotes([...preserved, ...selectedAlternates]), "R"),
    alternateRegionCount: alternateRegions.length,
    clippedAlternateNoteCount,
  };
}

function mergeOptions(
  input: PianoAccompanimentOptions | undefined,
  level: "easy" | "medium",
): PianoAccompanimentOptions {
  const base = { ...(input ?? {}) };
  if (level === "easy") {
    return {
      ...base,
      maxLeftHandNotesPerAttack: base.maxLeftHandNotesPerAttack ?? base.maxNotesPerAttack ?? 2,
      maxLeftHandSpan: base.maxLeftHandSpan ?? base.maxLeftHandSpanSemitones ?? 19,
      maxLowRegisterNotes: base.maxLowRegisterNotes ?? base.lowRegisterMaxNotes ?? 2,
    };
  }
  return {
    ...base,
    maxLeftHandNotesPerAttack: base.maxLeftHandNotesPerAttack ?? base.maxNotesPerAttack ?? 3,
    maxLeftHandSpan: base.maxLeftHandSpan ?? base.maxLeftHandSpanSemitones ?? 24,
    maxLowRegisterNotes: base.maxLowRegisterNotes ?? base.lowRegisterMaxNotes ?? 2,
  };
}

/**
 * Build local C/D piano candidates from role-separated MIDI notes.
 *
 * This is intentionally a pure adapter: it does not read files, update the
 * catalog, call the production importer, or modify public Note/Variant
 * contracts. The caller owns any local rendering and listening workflow.
 */
export function buildSectionAwarePianoCandidate(input: PianoSectionBuildInput): PianoSectionBuildResult {
  const windows = validateWindows(input.windows);
  assertPianoSource(input.primary, "primary");
  const suppliedAlternates = [...(input.alternates ?? [])];
  for (const source of suppliedAlternates) assertPianoSource(source, "alternate");
  const alternateIds = new Set<string>();
  for (const source of suppliedAlternates) {
    if (source.id === input.primary.id) {
      throw new Error(`duplicate piano candidate id: ${source.id}`);
    }
    if (alternateIds.has(source.id)) throw new Error(`duplicate piano candidate id: ${source.id}`);
    alternateIds.add(source.id);
  }
  const alternates = suppliedAlternates;
  const template = sourceTemplate(input.primary);
  const roleOptions: PianoRoleOptions = {
    ...(input.roleOptions ?? {}),
    onsetTolerance: input.roleOptions?.onsetTolerance ?? DEFAULT_ONSET_TOLERANCE,
  };
  const primaryInputNotes = sourceNotes(input.primary);
  const primaryRoles = splitPianoRoles(primaryInputNotes, roleOptions);
  const primaryMelody = withHand(primaryRoles.melody, "R");
  const primaryAccompaniment = [...primaryRoles.accompaniment];

  const alternateMelodies = new Map<string, Note[]>();
  const candidateDiagnostics: PianoSectionBuildDiagnostics["candidates"] = {};
  candidateDiagnostics[input.primary.id] = {
    inputNoteCount: primaryInputNotes.length,
    melodyNoteCount: primaryMelody.length,
    accompanimentNoteCount: primaryAccompaniment.length,
    aligned: true,
  };
  for (const source of alternates) {
    const inputNotes = sourceNotes(source);
    const roles = splitPianoRoles(inputNotes, roleOptions);
    const aligned = alignNotes(roles.melody, source.alignment);
    alternateMelodies.set(source.id, withHand(aligned, "R"));
    candidateDiagnostics[source.id] = {
      inputNoteCount: inputNotes.length,
      melodyNoteCount: aligned.length,
      accompanimentNoteCount: roles.accompaniment.length,
      aligned: Boolean(source.alignment),
      ...(source.alignment ? { alignment: { ...source.alignment } } : {}),
    };
  }

  const selection = selectRegions(
    input.primary,
    alternates,
    primaryMelody,
    alternateMelodies,
    windows,
    input.selectionOptions,
  );
  const strictCoverage = Boolean(input.selectionOptions?.coverageGate && input.selectionOptions.coverageGate.enabled !== false);
  const fused = fusedMelody(primaryMelody, alternateMelodies, selection, input.primary.id, strictCoverage);

  const easySimplified = simplifyPianoAccompaniment(primaryAccompaniment, mergeOptions(input.accompanimentOptions, "easy"));
  const mediumSimplified = simplifyPianoAccompaniment(primaryAccompaniment, mergeOptions(input.accompanimentOptions, "medium"));
  const easyAccompaniment = withHand(easySimplified.notes, "L");
  const mediumAccompaniment = withHand(mediumSimplified.notes, "L");

  const tempoBpm = finite(input.tempoBpm) && input.tempoBpm > 0 ? input.tempoBpm : template.tempoBpm;
  const outputTemplate: ParsedMidi = {
    ...template,
    tempoBpm,
    ...(input.timeSig ? { timeSig: input.timeSig } : {}),
    ...(finite(input.keySig) ? { keySig: input.keySig } : {}),
    ...(input.keyMode === 0 || input.keyMode === 1 ? { keyMode: input.keyMode } : {}),
  };

  const cOriginal = makeMidiArtifact(primaryInputNotes, outputTemplate, `${input.primary.id} original`);
  const cMelodyOnly = makeMidiArtifact(primaryMelody, outputTemplate, `${input.primary.id} melody only`);
  const cRevoicedEasyNotes = dedupeNotes([...primaryMelody, ...easyAccompaniment]);
  const cRevoicedMediumNotes = dedupeNotes([...primaryMelody, ...mediumAccompaniment]);
  const cdSelectedMelodyOnly = makeMidiArtifact(fused.notes, outputTemplate, "selected piano melody only");
  const cRevoicedEasy = makeMidiArtifact(cRevoicedEasyNotes, outputTemplate, `${input.primary.id} revoiced easy`);
  const cRevoicedMedium = makeMidiArtifact(cRevoicedMediumNotes, outputTemplate, `${input.primary.id} revoiced medium`);
  const cdFusedEasyNotes = dedupeNotes([...fused.notes, ...easyAccompaniment]);
  const cdFusedMediumNotes = dedupeNotes([...fused.notes, ...mediumAccompaniment]);
  const cdFusedEasy = makeMidiArtifact(cdFusedEasyNotes, outputTemplate, "C/D fused easy");
  const cdFusedMedium = makeMidiArtifact(cdFusedMediumNotes, outputTemplate, "C/D fused medium");

  const outputs: PianoSectionBuildDiagnostics["outputs"] = {
    cOriginal: outputDiagnostics(cOriginal.notes, [], 0),
    cMelodyOnly: outputDiagnostics(cMelodyOnly.notes, cMelodyOnly.notes, primaryMelody.length),
    cRevoicedEasy: outputDiagnostics(cRevoicedEasy.notes, primaryMelody, primaryMelody.length),
    cRevoicedMedium: outputDiagnostics(cRevoicedMedium.notes, primaryMelody, primaryMelody.length),
    cdSelectedMelodyOnly: outputDiagnostics(cdSelectedMelodyOnly.notes, fused.notes, primaryMelody.length),
    cdFusedEasy: outputDiagnostics(cdFusedEasy.notes, fused.notes, primaryMelody.length),
    cdFusedMedium: outputDiagnostics(cdFusedMedium.notes, fused.notes, primaryMelody.length),
  };

  const diagnostics: PianoSectionBuildDiagnostics = {
    schemaVersion: 1,
    primary: {
      id: input.primary.id,
      inputNoteCount: primaryInputNotes.length,
      melodyNoteCount: primaryMelody.length,
      accompanimentNoteCount: primaryAccompaniment.length,
      protectedMelodyCount: primaryRoles.protectedMelody.length,
    },
    candidates: candidateDiagnostics,
    selection: selection.diagnostics,
    regions: selection.regions,
    accompaniment: {
      easy: easySimplified.diagnostics,
      medium: mediumSimplified.diagnostics,
    },
    boundaries: {
      alternateRegionCount: fused.alternateRegionCount,
      clippedAlternateNoteCount: fused.clippedAlternateNoteCount,
      protectedPrimaryNotesPreserved: primaryMelody.length,
    },
    outputs,
  };

  return {
    cOriginal,
    cMelodyOnly,
    cRevoicedEasy,
    cRevoicedMedium,
    cdSelectedMelodyOnly,
    cdFusedEasy,
    cdFusedMedium,
    selection,
    diagnostics,
  };
}
