import { createHash } from "node:crypto";
import type { CanonicalMidi as CanonicalMidiFile, CanonicalMidiNote } from "./midi-corpus.js";

/**
 * Stable, engine-neutral roles used by the local MIDI corpus benchmark.
 *
 * These are lane labels, not claims about the original recording.  A role is
 * inferred from the canonical MIDI metadata and note statistics, and every
 * result keeps the original canonical note alongside the inferred label.
 */
export type MidiCorpusRole = "melody" | "harmony" | "bass" | "rhythm" | "other";

/**
 * More descriptive role labels used by the local reference corpus.  The
 * coarse `MidiCorpusRole` remains the stable grouping API; semantic roles are
 * deliberately advisory and carry a readiness state below.
 */
export type MidiCorpusSemanticRole =
  | "PIANO_FULL"
  | "PIANO_UPPER"
  | "PIANO_LOWER"
  | "MELODY"
  | "COUNTERMELODY"
  | "LEAD"
  | "RIFF"
  | "HARMONY"
  | "BASS"
  | "RHYTHM"
  | "DRUMS"
  | "UNKNOWN";

export type MidiRoleReadiness = "READY" | "READY_WITH_WARNINGS" | "MANUAL_VALIDATION_REQUIRED" | "NOT_AVAILABLE" | "FAILED";

export const MIDI_CORPUS_ROLES: readonly MidiCorpusRole[] = [
  "melody",
  "harmony",
  "bass",
  "rhythm",
  "other",
];

type CanonicalNoteWithMetadata = CanonicalMidiNote & {
  trackIndex?: number;
  channel?: number;
  program?: number;
  percussion?: boolean;
};

interface CanonicalTrackMetadata {
  index?: number;
  name?: string;
  percussion?: boolean;
}

/** Options are deliberately numeric and serializable for benchmark manifests. */
export interface MidiRoleClassificationOptions {
  /** Notes at or below this median pitch are considered bass candidates. */
  bassMedianMidi?: number;
  /** A lane with this many notes per onset is considered polyphonic. */
  harmonyNotesPerOnset?: number;
  /** Track-name hints can be disabled for deliberately anonymous fixtures. */
  useTrackNameHints?: boolean;
}

export interface MidiRoleLaneStats {
  laneKey: string;
  trackIndex: number | null;
  channel: number | null;
  program: number | null;
  trackName: string | null;
  noteCount: number;
  onsetCount: number;
  notesPerOnset: number;
  repeatedAttackCount: number;
  medianMidi: number | null;
  minMidi: number | null;
  maxMidi: number | null;
  medianDurationTicks: number | null;
  percussion: boolean;
}

export interface MidiRoleClassification {
  laneKey: string;
  role: MidiCorpusRole;
  semanticRole: MidiCorpusSemanticRole;
  readiness: MidiRoleReadiness;
  ambiguity: "low" | "medium" | "high";
  signals: readonly string[];
  stats: MidiRoleLaneStats;
  /** Short machine-readable rationale, useful in audit reports. */
  reason: string;
}

export type CanonicalMidiRoleNote = CanonicalMidiNote & {
  role: MidiCorpusRole;
  laneKey: string;
  semanticRole: MidiCorpusSemanticRole;
};

export interface MidiRoleSemanticLayers {
  fullSymbolic: readonly CanonicalMidiRoleNote[];
  pianoTarget: readonly CanonicalMidiRoleNote[];
  melody: readonly CanonicalMidiRoleNote[];
  harmony: readonly CanonicalMidiRoleNote[];
  bassRoot: readonly CanonicalMidiRoleNote[];
  rhythmAttacks: readonly CanonicalMidiRoleNote[];
}

export interface MidiRoleLayers {
  all: readonly CanonicalMidiRoleNote[];
  byRole: Readonly<Record<MidiCorpusRole, readonly CanonicalMidiRoleNote[]>>;
  lanes: readonly MidiRoleClassification[];
  semantic: MidiRoleSemanticLayers;
}

/** Stable consumer-facing projections for role-aware alignment/evaluation. */
export type MidiRoleProjection =
  | "full-symbolic"
  | "piano-full"
  | "melody"
  | "harmony"
  | "bass-root"
  | "rhythm"
  | "other";

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const integerOrNull = (value: unknown): number | null => {
  const number = finite(value);
  return number !== null && Number.isInteger(number) ? number : null;
};

const note = (value: CanonicalMidiNote): CanonicalNoteWithMetadata => value as CanonicalNoteWithMetadata;

const trackMetadata = (file: CanonicalMidiFile): Map<number, CanonicalTrackMetadata> => {
  const candidate = file as unknown as { tracks?: unknown };
  const tracks = Array.isArray(candidate.tracks) ? candidate.tracks : [];
  const result = new Map<number, CanonicalTrackMetadata>();
  for (let index = 0; index < tracks.length; index += 1) {
    const raw = tracks[index];
    if (!raw || typeof raw !== "object") continue;
    const value = raw as Record<string, unknown>;
    result.set(index, {
      index: index,
      name: typeof value.name === "string" ? value.name : undefined,
      percussion: value.percussion === true,
    });
  }
  return result;
};

const compareNotes = (left: CanonicalMidiNote, right: CanonicalMidiNote): number => {
  const a = note(left);
  const b = note(right);
  return (a.startTick - b.startTick)
    || (a.midi - b.midi)
    || (a.endTick - b.endTick)
    || ((a.velocity ?? 0) - (b.velocity ?? 0))
    || ((a.trackIndex ?? -1) - (b.trackIndex ?? -1))
    || ((a.channel ?? -1) - (b.channel ?? -1))
    || ((a.program ?? -1) - (b.program ?? -1));
};

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const normalizedName = (name: string | null): string => (name ?? "").trim().toLowerCase();

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

/**
 * The role classifier works in ticks, but the piano semantic layers need to
 * tolerate the small onset jitter found in exported tutorial MIDI.  Keep the
 * tolerance in beats so the projection is independent of the file's PPQ.
 */
const PIANO_ONSET_TOLERANCE_BEATS = 0.08;
const PIANO_MELODY_COMFORTABLE_LEAP = 12;

interface PianoOnsetCluster {
  startBeats: number;
  notes: CanonicalMidiRoleNote[];
}

const comparePianoCandidates = (left: CanonicalMidiRoleNote, right: CanonicalMidiRoleNote): number => {
  const a = note(left);
  const b = note(right);
  return (b.midi - a.midi)
    || ((b.durationBeats ?? 0) - (a.durationBeats ?? 0))
    || ((b.velocity ?? 0) - (a.velocity ?? 0))
    || compareNotes(left, right);
};

/** Group one piano lane into stable, jitter-tolerant attack clusters. */
const pianoOnsetClusters = (values: readonly CanonicalMidiRoleNote[]): PianoOnsetCluster[] => {
  const ordered = [...values].sort(compareNotes);
  const clusters: PianoOnsetCluster[] = [];
  for (const value of ordered) {
    const startBeats = note(value).startBeats;
    const current = clusters[clusters.length - 1];
    if (!current || startBeats - current.startBeats > PIANO_ONSET_TOLERANCE_BEATS + 1e-9) {
      clusters.push({ startBeats, notes: [value] });
    } else {
      current.notes.push(value);
    }
  }
  return clusters;
};

/**
 * Select a single upper voice per attack.  Highest pitch is the normal rule;
 * when it would make an implausible leap, prefer the highest candidate within
 * an octave of the previous selected voice.  The fallback remains highest so
 * genuine octave jumps are not silently discarded.
 */
const selectPianoMelody = (clusters: readonly PianoOnsetCluster[]): CanonicalMidiRoleNote[] => {
  const selected: CanonicalMidiRoleNote[] = [];
  let previous: CanonicalMidiRoleNote | null = null;
  for (const cluster of clusters) {
    const candidates = [...cluster.notes].sort(comparePianoCandidates);
    const highest = candidates[0];
    if (!highest) continue;
    let choice = highest;
    if (previous && Math.abs(note(highest).midi - note(previous).midi) > PIANO_MELODY_COMFORTABLE_LEAP) {
      const nearby = candidates
        .filter((candidate) => Math.abs(note(candidate).midi - note(previous!).midi) <= PIANO_MELODY_COMFORTABLE_LEAP)
        .sort((left, right) => {
          const distance = Math.abs(note(left).midi - note(previous!).midi) - Math.abs(note(right).midi - note(previous!).midi);
          return distance || comparePianoCandidates(left, right);
        });
      choice = nearby[0] ?? highest;
    }
    selected.push(choice);
    previous = choice;
  }
  return selected;
};

/**
 * Decompose a named single-track piano target without changing note tags.
 * Layers are projections over the same role-note objects, so callers retain
 * the exact canonical timing/velocity/provenance fields and can safely use
 * object identity when comparing layers.
 */
const singlePianoSemanticLayers = (all: readonly CanonicalMidiRoleNote[]): MidiRoleSemanticLayers => {
  const pitched = all.filter((value) => value.percussion !== true);
  const clusters = pianoOnsetClusters(pitched);
  const melody = selectPianoMelody(clusters);
  const bassRoot = clusters.flatMap((cluster) => {
    const lowest = [...cluster.notes].sort((left, right) => {
      const pitch = note(left).midi - note(right).midi;
      return pitch || compareNotes(left, right);
    })[0];
    return lowest ? [lowest] : [];
  });
  const melodySet = new Set(melody);
  const harmony = pitched.filter((value) => !melodySet.has(value));
  // A rhythm projection is intentionally one attack representative per
  // onset.  The lowest note is the most useful representative for
  // accompaniment/rhythm diagnostics and is also the bassRoot projection.
  const rhythmAttacks = bassRoot;
  return {
    fullSymbolic: all,
    pianoTarget: pitched,
    melody,
    harmony,
    bassRoot,
    rhythmAttacks,
  };
};

const trackRoleHint = (name: string | null): { role: MidiCorpusRole; reason: string } | null => {
  const value = normalizedName(name);
  if (!value) return null;
  if (/\b(?:drum|drums|percussion|kit)\b/.test(value)) return { role: "rhythm", reason: "track-name:rhythm" };
  if (/\b(?:bass|low|sub)\b/.test(value)) return { role: "bass", reason: "track-name:bass" };
  if (/\b(?:lead\s+guitar|lead|vocal|vocals|voice|melody|solo|treble)\b/.test(value)) return { role: "melody", reason: "track-name:melody" };
  if (/\b(?:rhythm\s+guitar|rhythm\s+keys|harmony|chord|chords|accompaniment|accomp|piano|guitar|keys)\b/.test(value)) return { role: "harmony", reason: "track-name:harmony" };
  return null;
};

const laneKeyFor = (value: CanonicalMidiNote): string => {
  const n = note(value);
  const track = integerOrNull(n.trackIndex);
  const channel = integerOrNull(n.channel);
  const program = integerOrNull(n.program);
  return `track:${track ?? "?"}/channel:${channel ?? "?"}/program:${program ?? "?"}/percussion:${n.percussion === true ? 1 : 0}`;
};

const laneIdentity = (value: CanonicalMidiNote): { trackIndex: number | null; channel: number | null; program: number | null; percussion: boolean } => {
  const n = note(value);
  return {
    trackIndex: integerOrNull(n.trackIndex),
    channel: integerOrNull(n.channel),
    program: integerOrNull(n.program),
    percussion: n.percussion === true,
  };
};

const calculateLaneStats = (
  laneKey: string,
  values: readonly CanonicalMidiNote[],
  tracks: Map<number, CanonicalTrackMetadata>,
): MidiRoleLaneStats => {
  const ordered = [...values].sort(compareNotes);
  const identity = laneIdentity(ordered[0]!);
  const track = identity.trackIndex === null ? undefined : tracks.get(identity.trackIndex);
  const onsets = new Set(ordered.map((value) => note(value).startTick));
  const repeatedAttackCount = ordered.reduce((count, value, index) => {
    if (index === 0) return count;
    const current = note(value);
    const previous = note(ordered[index - 1]!);
    return current.midi === previous.midi ? count + 1 : count;
  }, 0);
  return {
    laneKey,
    trackIndex: identity.trackIndex,
    channel: identity.channel,
    program: identity.program,
    trackName: track?.name ?? null,
    noteCount: ordered.length,
    onsetCount: onsets.size,
    notesPerOnset: onsets.size > 0 ? ordered.length / onsets.size : 0,
    repeatedAttackCount,
    medianMidi: median(ordered.map((value) => note(value).midi)),
    minMidi: ordered.length > 0 ? Math.min(...ordered.map((value) => note(value).midi)) : null,
    maxMidi: ordered.length > 0 ? Math.max(...ordered.map((value) => note(value).midi)) : null,
    medianDurationTicks: median(ordered.map((value) => Math.max(0, note(value).endTick - note(value).startTick))),
    percussion: identity.percussion || track?.percussion === true || identity.channel === 9,
  };
};

/**
 * Classify one canonical lane.  `isMelodyLane` is supplied by the collection
 * pass so anonymous high-register lanes have a deterministic tie-break.
 */
const classifyLane = (
  stats: MidiRoleLaneStats,
  options: Required<MidiRoleClassificationOptions>,
  isMelodyLane: boolean,
): MidiRoleClassification => {
  const withSemantic = (
    role: MidiCorpusRole,
    reason: string,
    semanticRole: MidiCorpusSemanticRole,
    readiness: MidiRoleReadiness,
    ambiguity: "low" | "medium" | "high",
    signals: readonly string[],
  ): MidiRoleClassification => ({ laneKey: stats.laneKey, role, semanticRole, readiness, ambiguity, signals, stats, reason });
  if (stats.percussion) return withSemantic("rhythm", "percussion-metadata", "DRUMS", "READY", "low", ["channel-9-or-percussion-track"]);
  if (options.useTrackNameHints) {
    const hint = trackRoleHint(stats.trackName);
    if (hint) {
      if (hint.role === "bass") return withSemantic(hint.role, hint.reason, "BASS", "READY", "low", ["track-name:bass", "low-register"]);
      if (hint.role === "melody") return withSemantic(hint.role, hint.reason, "LEAD", "READY_WITH_WARNINGS", "medium", ["track-name:melody"]);
      if (hint.role === "rhythm") return withSemantic(hint.role, hint.reason, "RHYTHM", "READY_WITH_WARNINGS", "medium", ["track-name:rhythm"]);
      if (/piano|keyboard|keys/i.test(stats.trackName ?? "")) {
        const semanticRole: MidiCorpusSemanticRole = (stats.medianMidi ?? 0) < 60 ? "PIANO_LOWER" : "PIANO_UPPER";
        return withSemantic(hint.role, hint.reason, semanticRole, "READY_WITH_WARNINGS", "medium", ["track-name:piano", "register"]);
      }
      return withSemantic(hint.role, hint.reason, "HARMONY", "READY_WITH_WARNINGS", "medium", ["track-name:harmony"]);
    }
  }
  if ((stats.medianMidi ?? 127) <= options.bassMedianMidi) {
    return withSemantic("bass", "low-register-median", "BASS", "READY_WITH_WARNINGS", "medium", ["low-register"]);
  }
  if (stats.notesPerOnset >= options.harmonyNotesPerOnset) {
    return withSemantic("harmony", "polyphonic-onsets", "HARMONY", "READY_WITH_WARNINGS", "medium", ["polyphonic-onsets"]);
  }
  if (isMelodyLane) return withSemantic("melody", "highest-melodic-lane", "MELODY", "READY_WITH_WARNINGS", "medium", ["highest-melodic-lane", "monophonic"]);
  return withSemantic("other", "unresolved-anonymous-lane", "UNKNOWN", "MANUAL_VALIDATION_REQUIRED", "high", ["anonymous-lane"]);
};

/**
 * Build deterministic role layers from a canonical MIDI file.
 *
 * The function is pure: it neither parses bytes nor mutates the supplied
 * canonical file.  Lane identity is track/channel/program based, while the
 * output order is always timeline/pitch/duration/velocity ordered.
 */
export function classifyMidiRoles(
  file: CanonicalMidiFile,
  options: MidiRoleClassificationOptions = {},
): MidiRoleLayers {
  const resolved: Required<MidiRoleClassificationOptions> = {
    bassMedianMidi: options.bassMedianMidi ?? 48,
    harmonyNotesPerOnset: options.harmonyNotesPerOnset ?? 1.5,
    useTrackNameHints: options.useTrackNameHints ?? true,
  };
  const tracks = trackMetadata(file);
  const grouped = new Map<string, CanonicalMidiNote[]>();
  for (const value of file.notes) {
    const key = laneKeyFor(value);
    const lane = grouped.get(key) ?? [];
    lane.push(value);
    grouped.set(key, lane);
  }
  const stats = [...grouped.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([laneKey, values]) => calculateLaneStats(laneKey, values, tracks));
  const melodicCandidates = stats
    .filter((value) => !value.percussion && value.notesPerOnset < resolved.harmonyNotesPerOnset)
    .sort((left, right) => ((right.medianMidi ?? -1) - (left.medianMidi ?? -1)) || compareText(left.laneKey, right.laneKey));
  const melodyLane = melodicCandidates[0]?.laneKey ?? null;
  const singlePianoTrack = tracks.size === 1 && [...tracks.values()].some((track) => /piano|keyboard|keys/i.test(track.name ?? ""));
  const classifications = stats.map((value) => {
    const classification = classifyLane(value, resolved, value.laneKey === melodyLane);
    return singlePianoTrack
      ? { ...classification, semanticRole: "PIANO_FULL" as const, readiness: "READY_WITH_WARNINGS" as const, ambiguity: "medium" as const, signals: [...classification.signals, "single-piano-track"] }
      : classification;
  });

  const classificationByLane = new Map(classifications.map((value) => [value.laneKey, value]));
  const all = [...file.notes]
    .sort(compareNotes)
    .map((value) => {
      const laneKey = laneKeyFor(value);
      const classification = classificationByLane.get(laneKey);
      const role = classification?.role ?? "other";
      const semanticRole = classification?.semanticRole ?? "UNKNOWN";
      return { ...value, role, laneKey, semanticRole } as CanonicalMidiRoleNote;
    });
  const byRole: Record<MidiCorpusRole, readonly CanonicalMidiRoleNote[]> = {
    melody: all.filter((value) => value.role === "melody"),
    harmony: all.filter((value) => value.role === "harmony"),
    bass: all.filter((value) => value.role === "bass"),
    rhythm: all.filter((value) => value.role === "rhythm"),
    other: all.filter((value) => value.role === "other"),
  };
  const semantic: MidiRoleSemanticLayers = {
    // `fullSymbolic` is the complete pitched source representation.  Drum
    // events remain available through `all`/`byRole.rhythm`, but must never be
    // mistaken for pitched symbolic material in melody/harmony/bass metrics.
    fullSymbolic: all.filter((value) => value.percussion !== true),
    pianoTarget: all.filter((value) => value.semanticRole === "PIANO_FULL" || value.semanticRole === "PIANO_UPPER" || value.semanticRole === "PIANO_LOWER"),
    melody: all.filter((value) => value.semanticRole === "MELODY" || value.semanticRole === "LEAD" || value.semanticRole === "COUNTERMELODY"),
    harmony: all.filter((value) => value.semanticRole === "HARMONY" || value.semanticRole === "RIFF"),
    bassRoot: all.filter((value) => value.semanticRole === "BASS"),
    rhythmAttacks: all.filter((value) => value.semanticRole === "RHYTHM" || value.semanticRole === "DRUMS"),
  };
  // A single named piano lane is a complete piano target even though the
  // coarse classifier reasonably calls it harmony from its polyphony.  The
  // remaining semantic projections are derived from onset clusters rather
  // than from the coarse lane role, which otherwise leaves melody/bass/rhythm
  // empty for a perfectly usable one-track piano reference.
  if (singlePianoTrack) return { all, byRole, lanes: classifications, semantic: singlePianoSemanticLayers(all) };
  return { all, byRole, lanes: classifications, semantic };
}

/** Alias emphasizing that the result is a set of role-specific layers. */
export const buildMidiRoleLayers = classifyMidiRoles;

/**
 * Select one role projection for a downstream aligner.  Semantic layers are
 * preferred when present; coarse lane projections remain the deterministic
 * fallback for files whose metadata did not permit semantic decomposition.
 * The returned arrays preserve canonical timeline order and object identity.
 */
export function selectMidiRoleNotes(
  layers: MidiRoleLayers,
  projection: MidiRoleProjection,
): readonly CanonicalMidiRoleNote[] {
  switch (projection) {
    case "full-symbolic":
      return layers.semantic.fullSymbolic;
    case "piano-full":
      return layers.semantic.pianoTarget;
    case "melody":
      return layers.semantic.melody.length ? layers.semantic.melody : layers.byRole.melody;
    case "harmony":
      return layers.semantic.harmony.length ? layers.semantic.harmony : layers.byRole.harmony;
    case "bass-root":
      return layers.semantic.bassRoot.length ? layers.semantic.bassRoot : layers.byRole.bass;
    case "rhythm":
      return layers.semantic.rhythmAttacks.length ? layers.semantic.rhythmAttacks : layers.byRole.rhythm;
    case "other":
      return layers.byRole.other;
  }
}

/** Alias for callers that describe the operation as role projection. */
export const projectMidiRole = selectMidiRoleNotes;

export interface SongIdentitySignatureOptions {
  /** Include canonical note timing/pitches when no useful metadata exists. */
  includeNotes?: boolean;
}

const textField = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized || null;
};

/**
 * Return a path-free SHA-256 identity for a canonical song.  Metadata is the
 * primary identity so baseline/current arrangements with the same title can
 * be compared; a compact note fingerprint disambiguates metadata-less files.
 */
export function songIdentitySignature(
  file: CanonicalMidiFile,
  options: SongIdentitySignatureOptions = {},
): string {
  const raw = file as unknown as Record<string, unknown>;
  const metadata = raw.metadata && typeof raw.metadata === "object" ? raw.metadata as Record<string, unknown> : {};
  const title = textField(raw.title) ?? textField(metadata.title) ?? null;
  const artist = textField(raw.artist) ?? textField(metadata.artist) ?? null;
  const includeNotes = options.includeNotes ?? (title === null && artist === null);
  const notes = [...file.notes].sort(compareNotes).map((value) => {
    const n = note(value);
    return [n.startTick, n.endTick, n.midi, n.velocity ?? 0, n.percussion === true ? 1 : 0];
  });
  const payload = includeNotes
    ? {
      schemaVersion: 1,
      title,
      artist,
      division: integerOrNull(raw.division),
      durationTicks: notes.length > 0 ? Math.max(...notes.map((value) => value[1]!)) : 0,
      noteCount: notes.length,
      notes,
    }
    : { schemaVersion: 1, title, artist };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Alias used by callers that call hashes fingerprints. */
export const songIdentityFingerprint = songIdentitySignature;

export interface RestrikeMetrics {
  noteCount: number;
  pitchedNoteCount: number;
  samePitchPairCount: number;
  restrikeCount: number;
  overlappingSamePitchCount: number;
  contiguousSamePitchCount: number;
  duplicateOnsetCount: number;
  samePitchPairRate: number;
  restrikeRate: number;
  overlappingRate: number;
  minGapTicks: number | null;
  medianGapTicks: number | null;
  p95GapTicks: number | null;
  byRole: Readonly<Partial<Record<MidiCorpusRole, Pick<RestrikeMetrics, "samePitchPairCount" | "restrikeCount" | "overlappingSamePitchCount" | "contiguousSamePitchCount">>>>;
}

export interface RestrikeMetricsOptions {
  /** Maximum silence between same-pitch attacks still considered a restrike. */
  maxGapTicks?: number;
  /** A zero/small positive gap is a contiguous attack rather than a wall. */
  contiguousToleranceTicks?: number;
  division?: number;
}

interface RestrikeEvent {
  role?: MidiCorpusRole;
  gapTicks: number;
  overlap: boolean;
  contiguous: boolean;
  duplicateOnset: boolean;
  restrike: boolean;
}

const medianInteger = (values: readonly number[]): number | null => median(values);

const restrikeNotes = (input: CanonicalMidiFile | readonly CanonicalMidiNote[]): { notes: readonly CanonicalMidiNote[]; division: number } => {
  if (Array.isArray(input)) return { notes: input, division: 480 };
  const file = input as CanonicalMidiFile;
  const raw = file as unknown as { division?: unknown };
  const division = finite(raw.division);
  return { notes: file.notes, division: division !== null && division > 0 ? division : 480 };
};

const calculateRestrikeEvents = (
  notes: readonly CanonicalMidiNote[],
  options: Required<Pick<RestrikeMetricsOptions, "maxGapTicks" | "contiguousToleranceTicks">>,
): RestrikeEvent[] => {
  const lanes = new Map<string, CanonicalMidiNote[]>();
  for (const value of notes) {
    const n = note(value);
    if (n.percussion === true || n.midi < 0 || n.midi > 127) continue;
    const key = `${laneKeyFor(value)}/pitch:${n.midi}`;
    const lane = lanes.get(key) ?? [];
    lane.push(value);
    lanes.set(key, lane);
  }
  const events: RestrikeEvent[] = [];
  for (const lane of lanes.values()) {
    const ordered = [...lane].sort(compareNotes);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = note(ordered[index - 1]!);
      const current = note(ordered[index]!);
      const gapTicks = current.startTick - previous.endTick;
      events.push({
        role: (ordered[index] as CanonicalMidiRoleNote).role,
        gapTicks,
        overlap: gapTicks < 0,
        contiguous: gapTicks >= 0 && gapTicks <= options.contiguousToleranceTicks,
        duplicateOnset: current.startTick === previous.startTick,
        restrike: gapTicks <= options.maxGapTicks,
      });
    }
  }
  return events;
};

/**
 * Measure same-pitch attacks without collapsing them.  Negative gaps expose
 * overlapping note-offs (often an accidental sustain/restrike interaction),
 * while contiguous attacks remain visible as legitimate re-articulations.
 */
export function measureRestrikes(
  input: CanonicalMidiFile | readonly CanonicalMidiNote[],
  options: RestrikeMetricsOptions = {},
): RestrikeMetrics {
  const source = restrikeNotes(input);
  const maxGapTicks = options.maxGapTicks ?? source.division;
  const contiguousToleranceTicks = options.contiguousToleranceTicks ?? Math.max(1, Math.round(source.division * 0.02));
  const events = calculateRestrikeEvents(source.notes, { maxGapTicks, contiguousToleranceTicks });
  const gaps = events.map((value) => value.gapTicks);
  const byRoleMutable: Record<string, Pick<RestrikeMetrics, "samePitchPairCount" | "restrikeCount" | "overlappingSamePitchCount" | "contiguousSamePitchCount">> = {};
  for (const event of events) {
    const role = event.role ?? "other";
    const current = byRoleMutable[role] ?? { samePitchPairCount: 0, restrikeCount: 0, overlappingSamePitchCount: 0, contiguousSamePitchCount: 0 };
    current.samePitchPairCount += 1;
    if (event.restrike) current.restrikeCount += 1;
    if (event.overlap) current.overlappingSamePitchCount += 1;
    if (event.contiguous) current.contiguousSamePitchCount += 1;
    byRoleMutable[role] = current;
  }
  const pitchedNoteCount = source.notes.filter((value) => note(value).percussion !== true && note(value).midi >= 0 && note(value).midi <= 127).length;
  const samePitchPairCount = events.length;
  const restrikeCount = events.filter((value) => value.restrike).length;
  const overlappingSamePitchCount = events.filter((value) => value.overlap).length;
  const contiguousSamePitchCount = events.filter((value) => value.contiguous).length;
  const duplicateOnsetCount = events.filter((value) => value.duplicateOnset).length;
  return {
    noteCount: source.notes.length,
    pitchedNoteCount,
    samePitchPairCount,
    restrikeCount,
    overlappingSamePitchCount,
    contiguousSamePitchCount,
    duplicateOnsetCount,
    samePitchPairRate: pitchedNoteCount > 0 ? samePitchPairCount / pitchedNoteCount : 0,
    restrikeRate: pitchedNoteCount > 0 ? restrikeCount / pitchedNoteCount : 0,
    overlappingRate: samePitchPairCount > 0 ? overlappingSamePitchCount / samePitchPairCount : 0,
    minGapTicks: gaps.length > 0 ? Math.min(...gaps) : null,
    medianGapTicks: medianInteger(gaps),
    p95GapTicks: gaps.length > 0 ? [...gaps].sort((a, b) => a - b)[Math.min(gaps.length - 1, Math.ceil(gaps.length * 0.95) - 1)]! : null,
    byRole: byRoleMutable as RestrikeMetrics["byRole"],
  };
}

/** Alias for metric-oriented call sites. */
export const restrikeMetrics = measureRestrikes;

export interface AccompanimentRestrikeMetrics {
  attackCount: number;
  sameHarmonyRepeatedAttackCount: number;
  sameHarmonyRepeatedAttackRate: number;
  equivalentChordIntervalMedianBeats: number | null;
  meanChordHoldBeats: number | null;
  attacksWithoutHarmonicChange: number;
  fullChordAttacksPerSecond: number | null;
  rootAttacksPerSecond: number | null;
  pitchClassSetRepeatRate: number;
}

export interface AccompanimentRestrikeOptions {
  onsetToleranceBeats?: number;
  division?: number;
  tempoBpm?: number;
}

/**
 * Measure accompaniment re-strikes by equivalent pitch-class set.  This is a
 * diagnostic, not a rule that forces a two-second pulse: the caller can
 * compare the result with the section tempo and harmonic-change rate.
 */
export function measureAccompanimentRestrikes(
  input: CanonicalMidiFile | readonly CanonicalMidiNote[],
  options: AccompanimentRestrikeOptions = {},
): AccompanimentRestrikeMetrics {
  const source = restrikeNotes(input);
  const division = options.division ?? source.division;
  const tolerance = options.onsetToleranceBeats ?? 0.08;
  const notes = source.notes.filter((value) => note(value).percussion !== true && note(value).midi >= 0 && note(value).midi <= 127);
  const groups: CanonicalMidiNote[][] = [];
  for (const value of [...notes].sort(compareNotes)) {
    const current = groups.at(-1);
    const start = note(value).startTick / division;
    const groupStart = current ? note(current[0]!).startTick / division : null;
    if (current && groupStart !== null && start - groupStart <= tolerance + 1e-9) current.push(value);
    else groups.push([value]);
  }
  const pitchSet = (group: readonly CanonicalMidiNote[]): string => [...new Set(group.map((value) => note(value).midi % 12))].sort((a, b) => a - b).join(",");
  const sets = groups.map(pitchSet);
  const repeated = sets.reduce((count, value, index) => index > 0 && value === sets[index - 1] ? count + 1 : count, 0);
  const intervals: number[] = [];
  let unchanged = 0;
  let fullChord = 0;
  let rootAttacks = 0;
  let holdTotal = 0;
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]!;
    holdTotal += Math.max(...group.map((value) => note(value).durationBeats), 0);
    if (group.length >= 3) fullChord += 1;
    if (group.length > 0) rootAttacks += 1;
    if (index > 0 && sets[index] === sets[index - 1]) {
      unchanged += 1;
      intervals.push(note(group[0]!).startTick / division - note(groups[index - 1]![0]!).startTick / division);
    }
  }
  const durationBeats = groups.length > 0
    ? Math.max(...groups.map((group) => Math.max(...group.map((value) => note(value).startTick / division + note(value).durationBeats), 0))) - Math.min(...groups.map((group) => note(group[0]!).startTick / division))
    : 0;
  const tempo = finite(options.tempoBpm) && options.tempoBpm! > 0 ? options.tempoBpm! : null;
  return {
    attackCount: groups.length,
    sameHarmonyRepeatedAttackCount: repeated,
    sameHarmonyRepeatedAttackRate: groups.length > 0 ? repeated / groups.length : 0,
    equivalentChordIntervalMedianBeats: median(intervals),
    meanChordHoldBeats: groups.length > 0 ? holdTotal / groups.length : null,
    attacksWithoutHarmonicChange: unchanged,
    fullChordAttacksPerSecond: tempo && durationBeats > 0 ? fullChord / (durationBeats * 60 / tempo) : null,
    rootAttacksPerSecond: tempo && durationBeats > 0 ? rootAttacks / (durationBeats * 60 / tempo) : null,
    pitchClassSetRepeatRate: groups.length > 1 ? repeated / (groups.length - 1) : 0,
  };
}

export const accompanimentRestrikeMetrics = measureAccompanimentRestrikes;
