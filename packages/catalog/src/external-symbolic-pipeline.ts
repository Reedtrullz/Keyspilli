import { createHash } from "node:crypto";
import {
  buildMetalArrangement,
  buildVariants,
  keyName,
  type ChordLabel,
  type Note,
  type ParsedMidi,
  type Variant,
} from "@keyspilli/midi";
import type { OmrEventInput, OmrScoreInput } from "./omr-consensus.js";
import {
  assertGenerationEvidence,
  canonicalEvidenceCandidateSet,
  type EvidenceFirewallOptions,
  type EvidenceRole,
  type EvidenceRoleRecord,
  type ExternalEvidenceCandidate,
} from "./external-evidence.js";
import type { ExternalResearchRecord } from "./external-research.js";
import {
  buildSectionAwarePianoCandidate,
  type PianoSectionBuildInput,
  type PianoSectionBuildResult,
  type PianoSectionSource,
  type PianoSectionWindow,
} from "./piano-section-builder.js";

export interface FrozenGenerationCandidate {
  recordId: string;
  candidate: ExternalEvidenceCandidate;
  score: OmrScoreInput;
  roles: readonly EvidenceRoleRecord[];
  sections?: readonly { id: string; candidate: [number, number]; confidence?: number }[];
}

export interface GenerationSection {
  id: string;
  candidate: [number, number];
  confidence?: number;
}

export interface FreezeGenerationCandidateConfig extends EvidenceFirewallOptions {
  /** Require the research bridge to have an aligned status. */
  requireAlignment?: boolean;
  /** Alias accepted by callers that use the shorter gate name. */
  requireAligned?: boolean;
  /** Minimum confidence across candidate, role, and section evidence. */
  minimumConfidence?: number;
  minConfidence?: number;
  confidenceThreshold?: number;
  /** Explicit section windows, keyed by record id or supplied as rows. */
  sections?: Readonly<Record<string, readonly GenerationSection[]>> | readonly (GenerationSection & { recordId: string })[];
}

export interface FrozenGenerationCandidateSet {
  schemaVersion: 1;
  selected: readonly FrozenGenerationCandidate[];
  rejected: readonly { recordId: string; reasons: string[] }[];
  digest: string;
}

const ROLES = new Set<EvidenceRole>(["melody", "harmony", "bass-root", "rhythm", "timing-only"]);
const PHYSICAL_KEY = /(?:path|file|locator|artifact)$/i;
const PATH_VALUE = /^(?:file:\/\/|[A-Za-z]:[\\/]|[\\/~])|\/(?:Users|private|tmp|var|home|Volumes|root|opt|workspace|srv|etc|mnt|data)(?:[\\/]|$)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRawPayloadKey(key: string, allowStructuralEvents = false): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (normalized === "bytelength") return false;
  if (allowStructuralEvents && normalized === "events") return false;
  // Some symbolic adapters expose columnar note data under payload. Keep
  // scalar typed score fields (pitch/start/duration) available for local
  // realization, but never carry the arbitrary parallel arrays into frozen
  // metadata or its commitment.
  if (["pitches", "starts", "durations", "midimeta"].includes(normalized)) return true;
  return /notes?|events?|bytes?/.test(normalized);
}

function validCoverageNote(value: unknown): value is Note {
  return isRecord(value)
    && finite(value.midi) && Number.isInteger(value.midi) && value.midi >= 0 && value.midi <= 127
    && finite(value.start) && value.start >= 0
    && finite(value.dur) && value.dur > 0
    && finite(value.vel) && Number.isInteger(value.vel) && value.vel >= 1 && value.vel <= 127
    && (value.hand === undefined || value.hand === "R" || value.hand === "L");
}

function safeMetadata(value: unknown, key = ""): unknown {
  if (isRawPayloadKey(key) || PHYSICAL_KEY.test(key)) return undefined;
  if (Array.isArray(value)) return value.map((item) => safeMetadata(item, key)).filter((item) => item !== undefined);
  if (typeof value === "string") return redactPath(value);
  if (!isRecord(value)) return value;
  const entries = Object.keys(value).sort()
    .map((childKey) => [childKey, safeMetadata(value[childKey], childKey)] as const)
    .filter(([, child]) => child !== undefined);
  return entries.length || Object.keys(value).length === 0 ? Object.fromEntries(entries) : undefined;
}

/** Scores are the normalized realization input, so their event rows remain; only locators are removed. */
function safeScoreMetadata(value: unknown, key = ""): unknown {
  if (PHYSICAL_KEY.test(key) || isRawPayloadKey(key, true)) return undefined;
  if (Array.isArray(value)) return value.map((item) => safeScoreMetadata(item, key)).filter((item) => item !== undefined);
  if (typeof value === "string") return redactPath(value);
  if (!isRecord(value)) return value;
  const entries = Object.keys(value).sort()
    .map((childKey) => [childKey, safeScoreMetadata(value[childKey], childKey)] as const)
    .filter(([, child]) => child !== undefined);
  // Keep the established empty score metadata object shape when all of its
  // contents were redacted; nested payload containers may still disappear.
  return entries.length || Object.keys(value).length === 0 || key === "metadata" ? Object.fromEntries(entries) : undefined;
}

function redactPath(value: string): string {
  if (/^https?:\/\//i.test(value.trim())) return value;
  const physical = /(?:file:\/\/[^\s,;)}\]]+|\\\\[^\s,;)}\]]+|(?<![A-Za-z0-9:])(?:[A-Za-z]:[\\/]|~[\\/]|\/(?:Users|private|tmp|var|home|Volumes|root|opt|workspace|srv|etc|mnt|data)(?:[\\/]|$))[^\s,;)}\]]*|(?<![A-Za-z0-9:/])\/(?=[^\s,;)}\]]*\/)[^\s,;)}\]]+|(?<![A-Za-z0-9:/])\/[A-Za-z0-9._~-]+(?=$|[\s,;)}\]]))/gi;
  return value.replace(physical, "[redacted-path]");
}

function immutable<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const name of Object.getOwnPropertyNames(value)) immutable((value as Record<string, unknown>)[name]);
  }
  return value;
}

function deeplyFrozen(value: unknown, seen = new Set<unknown>()): boolean {
  if (!value || typeof value !== "object") return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Object.getOwnPropertyNames(value).every((name) => deeplyFrozen((value as Record<string, unknown>)[name], seen));
}

function confidenceValues(candidate: ExternalEvidenceCandidate, roles: readonly EvidenceRoleRecord[], sections: readonly GenerationSection[]): number[] {
  const values: number[] = [];
  for (const value of Object.values(candidate.confidence ?? {})) if (finite(value)) values.push(value);
  for (const role of roles) if (role && finite(role.confidence)) values.push(role.confidence);
  for (const section of sections) if (section && finite(section.confidence)) values.push(section.confidence);
  return values;
}

function recordSections(recordId: string, record: ExternalResearchRecord, config: FreezeGenerationCandidateConfig): { sections: GenerationSection[]; invalid: boolean } {
  let configured: unknown[];
  if (Array.isArray(config.sections)) {
    if (config.sections.some((section) => !isRecord(section) || typeof section.recordId !== "string" || !section.recordId.trim())) return { sections: [], invalid: true };
    configured = config.sections.filter((section) => section.recordId === recordId);
  } else if (config.sections && typeof config.sections === "object") {
    const sectionMap = config.sections as Readonly<Record<string, readonly GenerationSection[] | null | undefined>>;
    if (Object.hasOwn(sectionMap, recordId)) {
      if (!Array.isArray(sectionMap[recordId])) return { sections: [], invalid: true };
      configured = [...sectionMap[recordId]!];
    } else configured = [];
  } else {
    configured = [];
  }
  const supplied = (configured.length ? configured : (record as unknown as { sections?: unknown }).sections) as unknown;
  if (supplied === undefined) return { sections: [], invalid: false };
  if (!Array.isArray(supplied)) return { sections: [], invalid: true };
  const seen = new Set<string>();
  const sections: GenerationSection[] = [];
  for (const section of supplied) {
    if (!isRecord(section) || typeof section.id !== "string" || !section.id.trim()
      || !Array.isArray(section.candidate) || section.candidate.length !== 2
      || !finite(section.candidate[0]) || !finite(section.candidate[1]) || section.candidate[1] <= section.candidate[0]
      || (section.confidence !== undefined && !finite(section.confidence))) return { sections: [], invalid: true };
    if (seen.has(section.id)) return { sections: [], invalid: true };
    seen.add(section.id);
    sections.push({ id: section.id, candidate: [section.candidate[0], section.candidate[1]], ...(finite(section.confidence) ? { confidence: section.confidence } : {}) });
  }
  sections.sort((a, b) => a.id.localeCompare(b.id) || a.candidate[0] - b.candidate[0] || a.candidate[1] - b.candidate[1]);
  return { sections, invalid: false };
}

function roleRecords(record: ExternalResearchRecord, candidate: ExternalEvidenceCandidate): EvidenceRoleRecord[] {
  const supplied = candidate.roles?.length ? candidate.roles : record.roles;
  return (supplied ?? []).flatMap((role) => {
    if (!role || !ROLES.has(role.role as EvidenceRole)) return [];
    return [safeMetadata(role) as EvidenceRoleRecord];
  }).sort((a, b) => a.role.localeCompare(b.role) || (b.confidence ?? -1) - (a.confidence ?? -1));
}

function rejection(recordId: string, reasons: string[]): { recordId: string; reasons: string[] } {
  return { recordId, reasons: [...new Set(reasons)].sort() };
}

function digest(selected: readonly FrozenGenerationCandidate[]): string {
  const metadata = selected.map((entry) => ({
    recordId: entry.recordId,
    candidate: canonicalEvidenceCandidateSet([entry.candidate])[0],
    // The score is deliberately non-enumerable on a frozen entry so callers
    // cannot accidentally persist normalized event rows in path-safe JSON.
    // It still belongs in the commitment: realization must not accept a
    // score that was swapped after the candidate set was frozen.
    score: safeScoreMetadata(entry.score),
    roles: entry.roles,
    ...(entry.sections ? { sections: entry.sections } : {}),
  })).sort((a, b) => a.recordId.localeCompare(b.recordId)
    || JSON.stringify(a.roles).localeCompare(JSON.stringify(b.roles))
    || JSON.stringify(a.sections ?? []).localeCompare(JSON.stringify(b.sections ?? []))
    || JSON.stringify(a.candidate).localeCompare(JSON.stringify(b.candidate)));
  return createHash("sha256").update(JSON.stringify(metadata)).digest("hex");
}

function hasUnsafeCandidateMetadata(value: unknown, key = ""): boolean {
  if (isRawPayloadKey(key) || PHYSICAL_KEY.test(key)) return true;
  if (typeof value === "string") return PATH_VALUE.test(value);
  if (Array.isArray(value)) return value.some((child) => hasUnsafeCandidateMetadata(child, key));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([childKey, child]) => hasUnsafeCandidateMetadata(child, childKey));
}

function isFrozenCandidateSet(value: unknown): value is FrozenGenerationCandidateSet {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.selected) || !Array.isArray(value.rejected)
    || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/i.test(value.digest)
    || !deeplyFrozen(value)) return false;
  if (value.selected.some((entry) => !isRecord(entry) || !Object.isFrozen(entry) || typeof entry.recordId !== "string"
    || !isRecord(entry.candidate) || !Object.isFrozen(entry.candidate) || hasUnsafeCandidateMetadata(entry.candidate)
    || !isRecord(entry.score) || !Object.isFrozen(entry.score) || !Array.isArray(entry.roles) || !Object.isFrozen(entry.roles)
    || entry.roles.some((role) => !isRecord(role) || !Object.isFrozen(role)))) return false;
  try {
    for (const entry of value.selected) assertGenerationEvidence(entry.candidate as ExternalEvidenceCandidate);
    return value.digest.toLowerCase() === digest(value.selected as FrozenGenerationCandidate[]).toLowerCase();
  } catch {
    return false;
  }
}

/** Validate and freeze generation candidates before any reference/benchmark work. */
export function freezeGenerationCandidateSet(
  records: readonly ExternalResearchRecord[],
  config: FreezeGenerationCandidateConfig = {},
): FrozenGenerationCandidateSet {
  const selected: FrozenGenerationCandidate[] = [];
  const rejected: { recordId: string; reasons: string[] }[] = [];
  const threshold = config.minimumConfidence ?? config.minConfidence ?? config.confidenceThreshold;
  for (const record of records ?? []) {
    const recordId = typeof record?.id === "string" && record.id.trim() ? record.id : "[unknown-record]";
    const reasons: string[] = [];
    if (!record || record.purpose === "BENCHMARK_REFERENCE" || record.evidenceClass === "BENCHMARK_REFERENCE") reasons.push("benchmark/reference evidence cannot enter generation");
    if (!record || typeof record.songId !== "string" || !record.songId.trim()) reasons.push("missing song identity");
    if (!record || record.parser?.status !== "parsed") reasons.push("candidate parser status is not parsed");
    if (!record || record.generationUsable !== true) reasons.push("candidate is not marked generation-usable");
    if (!record?.candidate) reasons.push("missing generation candidate");
    if (!record?.score) reasons.push("missing normalized score");
    const candidate = record?.candidate;
    if (candidate) {
      try {
        assertGenerationEvidence(candidate, config);
      } catch (error) {
        reasons.push(error instanceof Error ? error.message : "candidate failed generation evidence validation");
      }
      if (!candidate.provenance?.sourceRef?.trim()) reasons.push("missing logical source identity");
      if (!candidate.content?.sha256) reasons.push("missing content hash");
      const acquisition = candidate.provenance?.acquisition ?? candidate.provenance?.acquiredVia;
      if (typeof acquisition !== "string" || !/^local-/i.test(acquisition)) reasons.push("missing local acquisition evidence");
      if (!record.content?.sha256 || !/^[a-f0-9]{64}$/i.test(record.content.sha256)) reasons.push("record is missing a valid content hash");
      else if (candidate.content?.sha256 && record.content.sha256.toLowerCase() !== candidate.content.sha256.toLowerCase()) reasons.push("candidate content hash does not match record identity");
      if (record.acquisition?.status !== "local-bytes" && record.acquisition?.status !== "local-file") reasons.push("record acquisition is not local");
      if (record.evidenceClass !== candidate.evidenceClass || record.purpose !== candidate.purpose) reasons.push("record and candidate evidence identity disagree");
    }
    if (config.requireAlignment || config.requireAligned) {
      if (record?.alignment?.status !== "aligned") reasons.push(`alignment is ${record?.alignment?.status ?? "unavailable"}; aligned status is required`);
    } else if (["ambiguous", "rejected"].includes(record?.alignment?.status ?? "")) {
      reasons.push(`alignment is ${record.alignment.status}`);
    }
    const sectionResult = record && candidate ? recordSections(recordId, record, config) : { sections: [], invalid: false };
    if (sectionResult.invalid) reasons.push("malformed section window");
    const roles = candidate && record ? roleRecords(record, candidate) : [];
    if (threshold !== undefined && (!finite(threshold) || threshold < 0 || threshold > 1)) reasons.push("invalid confidence threshold");
    const candidateConfidence = confidenceValues(candidate ?? {} as ExternalEvidenceCandidate, roles, sectionResult.sections);
    if (threshold !== undefined && finite(threshold) && (!candidateConfidence.length || candidateConfidence.some((value) => value < threshold))) reasons.push(`confidence is below required threshold ${threshold}`);
    if (reasons.length || !candidate || !record?.score) {
      rejected.push(rejection(recordId, reasons.length ? reasons : ["candidate is unavailable"]));
      continue;
    }
    const safeCandidate = safeMetadata(candidate) as ExternalEvidenceCandidate;
    const localScore = immutable(safeScoreMetadata(record.score) as OmrScoreInput);
    const frozen: FrozenGenerationCandidate = {
      recordId,
      candidate: safeCandidate,
      roles,
      ...(sectionResult.sections.length ? { sections: sectionResult.sections } : {}),
    } as unknown as FrozenGenerationCandidate;
    // Keep normalized score events available to local realization while making
    // the path-safe JSON representation metadata-only.
    Object.defineProperty(frozen, "score", {
      value: localScore,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    selected.push(frozen);
  }
  selected.sort((a, b) => a.recordId.localeCompare(b.recordId)
    || (a.roles[0]?.role ?? "").localeCompare(b.roles[0]?.role ?? "")
    || (a.sections?.[0]?.id ?? "").localeCompare(b.sections?.[0]?.id ?? "")
    || String(a.candidate.content.sha256 ?? "").localeCompare(String(b.candidate.content.sha256 ?? "")));
  rejected.sort((a, b) => a.recordId.localeCompare(b.recordId));
  const result: FrozenGenerationCandidateSet = { schemaVersion: 1, selected, rejected, digest: digest(selected) };
  return immutable(result);
}

export interface ExternalSymbolicArrangementInput {
  candidateSet?: FrozenGenerationCandidateSet;
  frozen?: FrozenGenerationCandidateSet;
  candidates?: readonly FrozenGenerationCandidate[];
  /** Explicit local builder sources; no source outside the frozen set is used. */
  sources?: readonly PianoSectionSource[];
  primary?: PianoSectionSource;
  alternates?: readonly PianoSectionSource[];
  builderInput?: PianoSectionBuildInput;
  windows?: readonly PianoSectionWindow[];
  primaryRecordId?: string;
  /** Select the preservation-oriented piano route or semantic band route. */
  mode?: "auto" | "direct-piano" | "semantic-band";
  /** Select a different frozen candidate for a role/section window. */
  roleSelections?: readonly ExternalRoleSelection[];
  /** Explicit beat maps from a candidate into the target recording domain. */
  alignmentMaps?: Readonly<Record<string, PianoSectionSource["alignment"]>>;
  fallbackEnabled?: boolean;
}

export interface ExternalRoleSelection {
  role: EvidenceRole;
  candidateId: string;
  sectionIds?: readonly string[];
}

export interface ExternalSemanticSong {
  schemaVersion: 1;
  melody: readonly Note[];
  harmony: readonly ChordLabel[];
  bass: readonly Note[];
  rhythm: readonly Note[];
  timingOnly: readonly Note[];
  sections: readonly { id: string; startBeat: number; endBeat: number; source: string | null; confidence: number }[];
}

export interface ExternalOutputProvenance {
  recordId: string;
  candidateId?: string;
  evidenceClass: string;
  role: EvidenceRole;
  sectionId?: string;
  confidence?: number;
}

export interface ExternalSymbolicArrangementResult {
  status: "symbolic" | "fallback" | "unavailable";
  selectedRecordIds: string[];
  notes?: readonly Note[];
  artifact?: unknown;
  route?: "EXTERNAL_SYMBOLIC_FIRST" | "AUDIO_AMT_FALLBACK";
  mode?: "direct-piano" | "semantic-band";
  evidenceClass?: "AUDIO_AMT_FALLBACK" | string;
  canonical?: ParsedMidi;
  variants?: { advanced: Variant; medium: Variant; easy: Variant };
  /** Named aliases make the generated levels convenient for local callers. */
  advanced?: Variant;
  medium?: Variant;
  easy?: Variant;
  outputs?: { canonical: ParsedMidi; advanced: Variant; medium: Variant; easy: Variant };
  semantic?: ExternalSemanticSong;
  semanticSong?: ExternalSemanticSong;
  provenance: readonly ExternalOutputProvenance[];
  fallbackReason?: string;
  diagnostics: Record<string, unknown>;
}

function scoreNotes(
  score: OmrScoreInput,
  includePart: (part: OmrScoreInput["parts"][number]) => boolean = () => true,
): Note[] {
  const notes: Note[] = [];
  for (const part of score.parts ?? []) {
    if (!includePart(part)) continue;
    let cursor = 0;
    for (const measure of part.measures ?? []) {
      const start = finite(measure.startBeat) ? measure.startBeat : cursor;
      const events = [
        ...(measure.events ?? []),
        ...(measure.staves ?? []).flatMap((staff) => [
          ...(staff.events ?? []),
          ...(staff.voices ?? []).flatMap((voice) => voice.events ?? []),
        ]),
        ...(measure.voices ?? []).flatMap((voice) => voice.events ?? []),
      ] as OmrEventInput[];
      for (const event of events) {
        if (!finite(event.pitch) || !finite(event.onset) || !finite(event.duration) || event.duration <= 0) continue;
        const role = event.role ?? part.role;
        notes.push({ midi: Math.max(0, Math.min(127, Math.round(event.pitch))), start: Math.max(0, start + event.onset), dur: event.duration, vel: 96, ...(role === "melody" ? { hand: "R" as const } : role === "harmony" ? { hand: "L" as const } : {}) });
      }
      cursor = Math.max(cursor, start + (finite(measure.durationBeats) ? measure.durationBeats : 0));
    }
  }
  return notes;
}

function scorePartEvents(part: OmrScoreInput["parts"][number]): OmrEventInput[] {
  const events = (part.measures ?? []).flatMap((measure) => [
    ...(measure.events ?? []),
    ...(measure.staves ?? []).flatMap((staff) => [
      ...(staff.events ?? []),
      ...(staff.voices ?? []).flatMap((voice) => voice.events ?? []),
    ]),
    ...(measure.voices ?? []).flatMap((voice) => voice.events ?? []),
  ]);
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = [event.onset, event.duration, event.pitch, event.staff ?? "", event.voice ?? ""].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scorePartNotes(part: OmrScoreInput["parts"][number], alignment?: PianoSectionSource["alignment"]): Note[] {
  const offset = finite(alignment?.offsetBeats) ? alignment!.offsetBeats! : 0;
  const scale = finite(alignment?.beatScale) && alignment!.beatScale! > 0 ? alignment!.beatScale! : 1;
  const transpose = finite(alignment?.transposeSemitones) ? alignment!.transposeSemitones! : 0;
  const notes: Note[] = [];
  let cursor = 0;
  for (const measure of part.measures ?? []) {
    const start = finite(measure.startBeat) ? measure.startBeat : cursor;
    for (const event of scorePartEvents({ ...part, measures: [measure] })) {
      if (!finite(event.pitch) || !finite(event.onset) || !finite(event.duration) || event.duration <= 0) continue;
      const mappedStart = (start + event.onset - offset) / scale;
      const mappedEnd = mappedStart + event.duration / scale;
      if (mappedEnd <= 0) continue;
      const role = event.role ?? part.role;
      const hand = role === "melody" ? "R" : role === "harmony" ? "L" : undefined;
      notes.push({
        midi: Math.max(0, Math.min(127, Math.round(event.pitch + transpose))),
        start: Math.max(0, mappedStart),
        dur: mappedEnd - Math.max(0, mappedStart),
        vel: 96,
        ...(hand ? { hand } : {}),
      });
    }
    cursor = Math.max(cursor, start + (finite(measure.durationBeats) ? measure.durationBeats : 0));
  }
  return notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

function clipNotesToWindows(notes: readonly Note[], windows: readonly PianoSectionWindow[]): Note[] {
  if (!windows.length) return [...notes];
  const clipped: Note[] = [];
  for (const note of notes) {
    for (const window of windows) {
      const start = Math.max(note.start, window.startBeat);
      const end = Math.min(note.start + note.dur, window.endBeat);
      if (end <= start + 1e-9) continue;
      clipped.push({ ...note, start, dur: end - start });
    }
  }
  const seen = new Set<string>();
  return clipped
    .sort((left, right) => left.start - right.start || left.midi - right.midi || left.dur - right.dur || left.vel - right.vel)
    .filter((note) => {
      const key = [note.midi, note.start.toFixed(9), note.dur.toFixed(9), note.vel, note.hand ?? ""].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function scoreKeyMode(score: OmrScoreInput): 0 | 1 {
  const root = score as unknown as Record<string, unknown>;
  if (root.keyMode === 1 || (isRecord(score.metadata) && score.metadata.keyMode === 1)) return 1;
  return 0;
}

function scoreTimeSignature(score: OmrScoreInput): [number, number] {
  const signature = score.timeSignature;
  if (Array.isArray(signature) && signature.length === 2 && finite(signature[0]) && finite(signature[1])
    && signature[0] > 0 && signature[1] > 0) return [signature[0], signature[1]];
  return [4, 4];
}

function parsedFromNotes(score: OmrScoreInput, notes: readonly Note[], title?: string): ParsedMidi {
  const duration = notes.reduce((max, note) => Math.max(max, note.start + note.dur), 0);
  const tempoBpm = finite(score.tempoBpm) && score.tempoBpm! > 0 ? score.tempoBpm! : 120;
  const timeSig = scoreTimeSignature(score);
  return {
    format: 1,
    division: 480,
    tempoBpm,
    tempoMetaPresent: true,
    keySig: finite(score.keySignature) ? score.keySignature! : 0,
    keyMode: scoreKeyMode(score),
    timeSig,
    notes: [...notes],
    trackNames: [title ?? score.title ?? "External symbolic"],
    durationBeats: duration,
    ...(title || score.title ? { title: title ?? score.title } : {}),
  };
}

function sourceRole(entry: FrozenGenerationCandidate, part: OmrScoreInput["parts"][number]): EvidenceRole {
  const name = `${part.name ?? ""} ${part.id}`.toLowerCase();
  // OMR adapters may mark a part as percussion without giving it a helpful
  // name. Treat that explicit signal (and common click/timing labels) as
  // timing-only so direct-piano preservation cannot promote drum hits into
  // melody notes.
  if (part.percussion === true || /drum|percussion|kit|click|metronome|timing/.test(name)) return "timing-only";
  if (/vocal|voice|lead|melody|solo|treble/.test(name)) return "melody";
  if (/bass|low/.test(name)) return "bass-root";
  if (/rhythm|guitar|chord|harmony|accomp|piano|pad/.test(name)) return "harmony";
  const partEvidence = entry.roles.find((role) => String(role.partId ?? "") === part.id || String(role.partName ?? "") === String(part.name ?? ""));
  if (partEvidence && ROLES.has(partEvidence.role as EvidenceRole)) return partEvidence.role as EvidenceRole;
  const scoreRole = part.role;
  if (scoreRole === "melody") return "melody";
  if (scoreRole === "harmony") return "harmony";
  if (scoreRole === "rhythm") return "rhythm";
  const broad = entry.roles.find((role) => ROLES.has(role.role as EvidenceRole));
  return broad?.role as EvidenceRole ?? "harmony";
}

function generationScoreNotes(entry: FrozenGenerationCandidate): Note[] {
  // Timing-only/drum parts are useful for semantic rhythm diagnostics but are
  // never melody input for the direct piano preservation route.
  return scoreNotes(entry.score, (part) => sourceRole(entry, part) !== "timing-only");
}

function selectedEntryForId(
  candidates: readonly FrozenGenerationCandidate[],
  candidateId: unknown,
): FrozenGenerationCandidate | undefined {
  if (typeof candidateId !== "string" || !candidateId.trim()) return undefined;
  const normalized = candidateId.trim();
  return candidates.find((entry) => entry.recordId === normalized || entry.candidate.id === normalized);
}

function roleSelectionFor(
  input: ExternalSymbolicArrangementInput,
  role: EvidenceRole,
  sectionIds: readonly string[],
  candidates: readonly FrozenGenerationCandidate[],
): string | undefined {
  const selection = (input.roleSelections ?? []).find((item) => item.role === role
    && (!item.sectionIds?.length || sectionIds.some((sectionId) => item.sectionIds!.includes(sectionId))));
  return selectedEntryForId(candidates, selection?.candidateId)?.recordId;
}

function inputWindows(input: ExternalSymbolicArrangementInput): readonly PianoSectionWindow[] {
  return input.windows !== undefined ? input.windows : input.builderInput?.windows ?? [];
}

function windowSectionIds(window: PianoSectionWindow): string[] {
  return [window.sectionId, window.id]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function windowCandidateLock(
  window: PianoSectionWindow,
  candidates: readonly FrozenGenerationCandidate[],
): FrozenGenerationCandidate | undefined {
  const raw = window as unknown as Record<string, unknown>;
  if (raw.candidateId === undefined) return undefined;
  return selectedEntryForId(candidates, raw.candidateId);
}

function windowCandidateAllowList(
  window: PianoSectionWindow,
  candidates: readonly FrozenGenerationCandidate[],
): string[] | undefined {
  const raw = window as unknown as Record<string, unknown>;
  const value = raw.allowedCandidateIds ?? raw.candidateIds;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidateId) => selectedEntryForId(candidates, candidateId)?.recordId ?? []);
}

function entryAllowedForWindow(
  entry: FrozenGenerationCandidate,
  window: PianoSectionWindow,
): boolean {
  const raw = window as unknown as Record<string, unknown>;
  const aliases = [entry.recordId, entry.candidate.id, entry.candidate.candidateId, entry.candidate.name]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  if (typeof raw.candidateId === "string" && raw.candidateId.trim() && !aliases.includes(raw.candidateId.trim())) return false;
  const allowValue = raw.allowedCandidateIds ?? raw.candidateIds;
  if (allowValue === undefined) return true;
  if (!Array.isArray(allowValue)) return false;
  return allowValue.some((value) => typeof value === "string" && aliases.includes(value.trim()));
}

function windowCandidateSelectionError(
  input: ExternalSymbolicArrangementInput,
  candidates: readonly FrozenGenerationCandidate[],
): string | null {
  for (const window of inputWindows(input)) {
    const raw = window as unknown as Record<string, unknown>;
    const sectionIds = windowSectionIds(window);
    if (raw.candidateId !== undefined) {
      if (typeof raw.candidateId !== "string" || !raw.candidateId.trim()) return `window ${window.id ?? "[unknown]"} has a malformed candidateId lock`;
      if (!windowCandidateLock(window, candidates)) return `window ${window.id ?? "[unknown]"} references an unfrozen candidate`;
    }
    const allowValue = raw.allowedCandidateIds ?? raw.candidateIds;
    if (allowValue !== undefined) {
      if (!Array.isArray(allowValue) || !allowValue.length || allowValue.some((candidateId) => typeof candidateId !== "string" || !candidateId.trim())) {
        return `window ${window.id ?? "[unknown]"} has a malformed candidate allow-list`;
      }
      const allowed = windowCandidateAllowList(window, candidates) ?? [];
      if (allowed.length !== allowValue.length) return `window ${window.id ?? "[unknown]"} references an unfrozen candidate in its allow-list`;
      const lock = windowCandidateLock(window, candidates)?.recordId;
      if (lock && !allowed.includes(lock)) return `window ${window.id ?? "[unknown]"} candidateId is outside its allow-list`;
    }
    const roleSelected = roleSelectionFor(input, "melody", sectionIds, candidates);
    const lock = windowCandidateLock(window, candidates)?.recordId;
    if (lock && roleSelected && lock !== roleSelected) {
      return `window ${window.id ?? "[unknown]"} candidateId conflicts with its melody role selection`;
    }
    if (roleSelected && windowCandidateAllowList(window, candidates) && !windowCandidateAllowList(window, candidates)!.includes(roleSelected)) {
      return `window ${window.id ?? "[unknown]"} melody role selection is outside its candidate allow-list`;
    }
  }
  return null;
}

function roleSelectionError(
  input: ExternalSymbolicArrangementInput,
  candidates: readonly FrozenGenerationCandidate[],
  mode: "direct-piano" | "semantic-band",
): string | null {
  if (input.roleSelections === undefined) return null;
  if (!Array.isArray(input.roleSelections)) return "roleSelections must be an array";
  const windowIds = new Set<string>();
  for (const window of inputWindows(input)) {
    if (typeof window?.id === "string" && window.id.trim()) windowIds.add(window.id);
    if (typeof window?.sectionId === "string" && window.sectionId.trim()) windowIds.add(window.sectionId);
  }
  for (const selection of input.roleSelections) {
    if (!isRecord(selection) || !ROLES.has(selection.role as EvidenceRole)) return "role selection has an unsupported role";
    if (!selectedEntryForId(candidates, selection.candidateId)) return "role selection references an unfrozen candidate";
    if (mode === "direct-piano" && selection.role !== "melody") return "direct-piano role selections support melody only";
    if (selection.sectionIds === undefined || (Array.isArray(selection.sectionIds) && selection.sectionIds.length === 0)) continue;
    if (mode === "semantic-band") return "section-scoped role selections are unsupported for semantic-band realization";
    if (!Array.isArray(selection.sectionIds) || selection.sectionIds.some((sectionId) => typeof sectionId !== "string" || !sectionId.trim())) {
      return "role selection has malformed sectionIds";
    }
    if (!inputWindows(input).length) return "section-scoped role selections require explicit input windows";
    for (const sectionId of selection.sectionIds) {
      if (!windowIds.has(sectionId)) return `role selection references unsupported sectionId ${sectionId}`;
    }
  }
  return null;
}

function selectedWindows(
  input: ExternalSymbolicArrangementInput,
  candidates: readonly FrozenGenerationCandidate[],
  primaryOverride?: FrozenGenerationCandidate,
): PianoSectionWindow[] {
  const windows = inputWindows(input).map((window) => {
    const sectionIds = windowSectionIds(window);
    const locked = windowCandidateLock(window, candidates)?.recordId;
    const selected = locked ?? roleSelectionFor(input, "melody", sectionIds, candidates);
    const allowed = windowCandidateAllowList(window, candidates);
    return {
      ...window,
      ...(selected ? { candidateId: selected } : {}),
      ...(allowed ? { allowedCandidateIds: allowed } : {}),
    };
  });
  if (windows.length) return windows;
  const primary = primaryOverride ?? selectedEntryForId(candidates, input.primaryRecordId) ?? candidates[0];
  const duration = primary ? generationScoreNotes(primary).reduce((max, note) => Math.max(max, note.start + note.dur), 0) : 0;
  return primary && duration > 0 ? [{ id: "full", startBeat: 0, endBeat: duration, candidateId: primary.recordId }] : [];
}

function alignmentFor(entry: FrozenGenerationCandidate, input: ExternalSymbolicArrangementInput): PianoSectionSource["alignment"] | undefined {
  return input.alignmentMaps?.[entry.recordId]
    ?? (entry.candidate.id ? input.alignmentMaps?.[entry.candidate.id] : undefined);
}

function directPianoSource(entry: FrozenGenerationCandidate, input: ExternalSymbolicArrangementInput): PianoSectionSource {
  const alignment = alignmentFor(entry, input);
  const offset = finite(alignment?.offsetBeats) ? alignment!.offsetBeats! : 0;
  const scale = finite(alignment?.beatScale) && alignment!.beatScale! > 0 ? alignment!.beatScale! : 1;
  const transpose = finite(alignment?.transposeSemitones) ? alignment!.transposeSemitones! : 0;
  const notes = generationScoreNotes(entry).flatMap((note) => {
    const start = (note.start - offset) / scale;
    const end = start + note.dur / scale;
    if (end <= 0) return [];
    const clippedStart = Math.max(0, start);
    return [{ ...note, start: clippedStart, dur: end - clippedStart, midi: Math.max(0, Math.min(127, note.midi + transpose)) }];
  });
  return {
    id: entry.recordId,
    sourceType: "direct-piano",
    // `parsed` and `notes` are reconstructed from the frozen normalized score;
    // caller-provided source payloads never become generation notes.
    parsed: parsedFromNotes(entry.score, notes, entry.score.title ?? entry.recordId),
    notes,
  };
}

function trustedPianoSource(
  entry: FrozenGenerationCandidate,
  input: ExternalSymbolicArrangementInput,
  overlay?: PianoSectionSource,
): PianoSectionSource {
  const source = directPianoSource(entry, input);
  if (!overlay) return source;
  const alignment = alignmentFor(entry, input);
  return {
    ...source,
    // Selection evidence is metadata consumed by the region scorer. Preserve
    // it for callers, but never copy parsed/note payloads across the boundary.
    ...(overlay.selection ? { selection: { ...overlay.selection } } : {}),
    ...(!alignment && overlay.alignment ? { alignment: { ...overlay.alignment } } : {}),
  };
}

function semanticBandSources(
  entry: FrozenGenerationCandidate,
  input: ExternalSymbolicArrangementInput,
  windows: readonly PianoSectionWindow[] = [],
): {
  stems: Array<{ role: "vocals" | "bass" | "guitar" | "other" | "drums"; midi: ParsedMidi; confidence?: number }>;
  semantic: ExternalSemanticSong;
} {
  const groups = new Map<string, Note[]>();
  const timingOnly: Note[] = [];
  const harmony: Note[] = [];
  const bass: Note[] = [];
  const melody: Note[] = [];
  const rhythm: Note[] = [];
  const mapRole = (role: EvidenceRole): "vocals" | "bass" | "guitar" | "other" | "drums" => role === "melody" ? "vocals" : role === "bass-root" ? "bass" : role === "timing-only" ? "drums" : role === "harmony" ? "guitar" : "other";
  const explicitWindows = inputWindows(input).length > 0;
  for (const part of entry.score.parts ?? []) {
    const role = sourceRole(entry, part);
    const target = mapRole(role);
    const mapped = scorePartNotes(part, input.alignmentMaps?.[entry.recordId]);
    const entryWindows = windows.filter((window) => {
      return entryAllowedForWindow(entry, window);
    });
    const notes = explicitWindows
      ? entryWindows.length ? clipNotesToWindows(mapped, entryWindows) : []
      : mapped;
    if (target === "drums") timingOnly.push(...notes);
    else if (target === "vocals") melody.push(...notes);
    else if (target === "bass") bass.push(...notes);
    else if (target === "guitar") { harmony.push(...notes); rhythm.push(...notes); }
    else rhythm.push(...notes);
    groups.set(target, [...(groups.get(target) ?? []), ...notes]);
  }
  const stems = [...groups.entries()].filter(([, notes]) => notes.length).map(([role, notes]) => ({
    role: role as "vocals" | "bass" | "guitar" | "other" | "drums",
    midi: parsedFromNotes(entry.score, notes, `${entry.recordId}:${role}`),
    confidence: entry.roles.find((item) => item.role === (role === "vocals" ? "melody" : role === "bass" ? "bass-root" : role === "drums" ? "timing-only" : "harmony"))?.confidence,
  }));
  const sections = windows.map((window) => ({ id: window.id ?? "section", startBeat: window.startBeat, endBeat: window.endBeat, source: entry.recordId, confidence: finite(window.confidence) ? window.confidence! : 1 }));
  return { stems, semantic: { schemaVersion: 1, melody, harmony: [], bass, rhythm, timingOnly, sections } };
}

function fallbackResult(input: ExternalSymbolicArrangementInput, reason: string): ExternalSymbolicArrangementResult {
  const fallbackEnabled = input.fallbackEnabled !== false;
  return {
    status: fallbackEnabled ? "fallback" : "unavailable",
    selectedRecordIds: [],
    route: "AUDIO_AMT_FALLBACK",
    evidenceClass: "AUDIO_AMT_FALLBACK",
    provenance: [],
    fallbackReason: reason,
    diagnostics: { schemaVersion: 1, candidateCount: 0, fallbackEnabled, reason },
  };
}

function routeFor(entry: FrozenGenerationCandidate, requested: ExternalSymbolicArrangementInput["mode"]): "direct-piano" | "semantic-band" {
  if (requested === "direct-piano" || requested === "semantic-band") return requested;
  if (entry.candidate.evidenceClass === "PIANO_COVER_SYMBOLIC") return "direct-piano";
  const names = (entry.score.parts ?? []).map((part) => `${part.name ?? ""} ${part.id}`.toLowerCase());
  const hasBandLane = names.some((name) => /drum|percussion|kit|bass|guitar|vocal|voice/.test(name));
  const hasPianoLane = names.some((name) => /piano|keyboard|keys|grand/.test(name));
  // Native symbolic evidence can be either a piano-target score or a full
  // band score. Keep an explicitly named piano score on the preservation
  // path; only scores with recognizable band lanes need semantic routing.
  if (hasPianoLane && !hasBandLane) return "direct-piano";
  if ((entry.score.parts ?? []).length <= 2 && entry.roles.every((role) => role.role === "melody" || role.role === "harmony")) return "direct-piano";
  return "semantic-band";
}

function variantsFor(canonical: ParsedMidi, mode: "direct-piano" | "semantic-band", chords?: readonly ChordLabel[]): { advanced: Variant; medium: Variant; easy: Variant } {
  const all = buildVariants(canonical, {
    title: canonical.title ?? "External symbolic arrangement",
    artist: "external-symbolic",
    tempo: canonical.tempoBpm,
    key: keyName(canonical.keySig, canonical.keyMode === 1),
  }, {
    arrangementProfile: mode === "semantic-band" ? "metal" : "learner",
    audioDerived: false,
    maxDurBeats: null,
    ...(chords?.length ? { chords: [...chords] } : {}),
  });
  const byLevel = new Map(all.map((variant) => [variant.level, variant]));
  const advanced = byLevel.get("advanced");
  const medium = byLevel.get("medium");
  const easy = byLevel.get("easy");
  if (!advanced || !medium || !easy) throw new Error("symbolic variant builder did not return Advanced, Medium, and Easy");
  return { advanced, medium, easy };
}

function outputProvenance(
  entries: readonly FrozenGenerationCandidate[],
  windows: readonly PianoSectionWindow[],
  selectedIds: readonly string[],
  role: EvidenceRole,
): ExternalOutputProvenance[] {
  const selected = entries.filter((entry) => selectedIds.includes(entry.recordId));
  const sections = windows.length ? windows : [{ id: "full", startBeat: 0, endBeat: 0 } as PianoSectionWindow];
  return selected.flatMap((entry) => sections.map((section) => ({
    recordId: entry.recordId,
    candidateId: entry.candidate.id,
    evidenceClass: entry.candidate.evidenceClass,
    role,
    ...(section.id ? { sectionId: section.id } : {}),
    ...(entry.roles.find((item) => item.role === role)?.confidence !== undefined ? { confidence: entry.roles.find((item) => item.role === role)?.confidence } : {}),
  })));
}

/** Realize only already-frozen candidates; no benchmark/reference source reaches either branch. */
export function buildExternalSymbolicArrangement(input: ExternalSymbolicArrangementInput): ExternalSymbolicArrangementResult {
  const set = input.candidateSet ?? input.frozen;
  if (!isFrozenCandidateSet(set)) return fallbackResult(input, "an immutable, digest-consistent frozen candidate set is required");
  const selected = [...set.selected].filter((entry) => entry.candidate.purpose !== "BENCHMARK_REFERENCE" && entry.candidate.evidenceClass !== "BENCHMARK_REFERENCE");
  if (!selected.length) return fallbackResult(input, "no frozen generation candidate is available");
  const supplied = input.sources
    ? input.sources.flatMap((source) => {
      const entry = selectedEntryForId(selected, source.id);
      return entry ? [{ entry, source }] : [];
    })
    : selected.map((entry) => ({ entry, source: undefined }));
  const requestedPrimary = selectedEntryForId(selected, input.primary?.id)
    ?? selectedEntryForId(selected, input.primaryRecordId);
  const primaryEntry = requestedPrimary ?? supplied[0]?.entry ?? selected[0]!;
  const mode = routeFor(primaryEntry, input.mode);
  const windowSelectionError = windowCandidateSelectionError(input, selected);
  if (windowSelectionError) return fallbackResult(input, windowSelectionError);
  const selectionError = roleSelectionError(input, selected, mode);
  if (selectionError) return fallbackResult(input, selectionError);
  const windows = selectedWindows(input, selected, primaryEntry);
  const suppliedRecordIds = new Set(supplied.map(({ entry }) => entry.recordId));
  const missingWindowSources = [...new Set(windows
    .map((window) => window.candidateId)
    .filter((candidateId): candidateId is string => typeof candidateId === "string" && candidateId.length > 0))]
    .filter((candidateId) => input.sources !== undefined && !suppliedRecordIds.has(candidateId));
  if (missingWindowSources.length) {
    return fallbackResult(input, `window candidate source is not supplied: ${missingWindowSources.join(", ")}`);
  }

  if (mode === "semantic-band") {
    try {
      const roleIds = new Map<EvidenceRole, string>();
      for (const selection of input.roleSelections ?? []) {
        const entry = selectedEntryForId(selected, selection.candidateId);
        if (entry) roleIds.set(selection.role, entry.recordId);
      }
      const sourceEntries = [...new Map<string, FrozenGenerationCandidate>(selected.map((entry) => [entry.recordId, entry])).values()];
      const allStems: Array<{ role: "vocals" | "bass" | "guitar" | "other" | "drums"; midi: ParsedMidi; confidence?: number }> = [];
      const semanticByEntry = sourceEntries.map((entry) => {
        const built = semanticBandSources(entry, input, windows);
        let included = false;
        for (const stem of built.stems) {
          const evidenceRole: EvidenceRole = stem.role === "vocals" ? "melody" : stem.role === "bass" ? "bass-root" : stem.role === "drums" ? "timing-only" : "harmony";
          const selectedForRole = roleIds.get(evidenceRole);
          if (selectedForRole && selectedForRole !== entry.recordId) continue;
          allStems.push(stem);
          included = true;
        }
        return { entry, built, included };
      });
      // buildMetalArrangement deliberately accepts one stem per semantic lane;
      // merge multiple parts from one candidate before invoking it.
      const merged = new Map<string, { notes: Note[]; confidence?: number }>();
      for (const stem of allStems) {
        const existing = merged.get(stem.role) ?? { notes: [], confidence: stem.confidence };
        existing.notes.push(...stem.midi.notes);
        existing.confidence = existing.confidence ?? stem.confidence;
        merged.set(stem.role, existing);
      }
      const stems = [...merged.entries()].map(([role, value]) => ({
        role: role as "vocals" | "bass" | "guitar" | "other" | "drums",
        midi: parsedFromNotes(primaryEntry.score, value.notes, `${primaryEntry.recordId}:${role}`),
        ...(value.confidence === undefined ? {} : { confidence: value.confidence }),
      }));
      if (!stems.some((stem) => stem.role !== "drums")) return fallbackResult(input, "full-band candidate has no pitched semantic roles");
      const metal = buildMetalArrangement({ stems, title: primaryEntry.score.title ?? primaryEntry.recordId });
      const variants = variantsFor(metal.parsed, mode, metal.chords);
      const semantic: ExternalSemanticSong = {
        schemaVersion: 1,
        melody: metal.ir.identity,
        harmony: metal.chords,
        bass: merged.get("bass")?.notes ?? [],
        rhythm: [...(merged.get("guitar")?.notes ?? []), ...(merged.get("other")?.notes ?? [])],
        timingOnly: merged.get("drums")?.notes ?? [],
        sections: metal.ir.sections.map((section, index) => ({
          id: windows[index]?.id ?? `section-${index + 1}`,
          startBeat: section.startBeat,
          endBeat: section.endBeat,
          source: section.source === "rest" ? null : primaryEntry.recordId,
          confidence: section.confidence,
        })),
      };
      const selectedRecordIds = [...new Set(semanticByEntry.filter(({ included }) => included).map(({ entry }) => entry.recordId))].sort();
      return {
        status: "symbolic",
        route: "EXTERNAL_SYMBOLIC_FIRST",
        mode,
        evidenceClass: primaryEntry.candidate.evidenceClass,
        selectedRecordIds,
        canonical: metal.parsed,
        variants,
        advanced: variants.advanced,
        medium: variants.medium,
        easy: variants.easy,
        outputs: { canonical: metal.parsed, ...variants },
        semantic,
        semanticSong: semantic,
        notes: variants.medium.notes,
        artifact: variants.medium,
        provenance: [
          ...outputProvenance(selected, windows, selectedRecordIds, "melody"),
          ...outputProvenance(selected, windows, selectedRecordIds, "harmony"),
          ...outputProvenance(selected, windows, selectedRecordIds, "bass-root"),
          ...outputProvenance(selected, windows, selectedRecordIds, "timing-only"),
        ],
        diagnostics: { schemaVersion: 1, candidateSetDigest: set.digest, builder: metal.stats, warnings: metal.warnings },
      };
    } catch (error) {
      return fallbackResult(input, error instanceof Error ? error.message : "semantic-band realization failed");
    }
  }

  if (!supplied.length) return fallbackResult(input, "no source matched the frozen candidate set");
  const selectedPrimary = primaryEntry;
  const primaryOverlay = input.primary && selectedEntryForId(selected, input.primary.id)?.recordId === selectedPrimary.recordId
    ? input.primary
    : supplied.find(({ entry }) => entry.recordId === selectedPrimary.recordId)?.source;
  const primary = trustedPianoSource(selectedPrimary, input, primaryOverlay);
  const alternateRows = input.alternates
    ? input.alternates.flatMap((source) => {
      const entry = selectedEntryForId(selected, source.id);
      return entry && entry.recordId !== selectedPrimary.recordId ? [{ entry, source }] : [];
    })
    : supplied.filter(({ entry }) => entry.recordId !== selectedPrimary.recordId);
  const alternates = alternateRows.map(({ entry, source }) => trustedPianoSource(entry, input, source));
  const directWindows = windows;
  if (!directWindows.length && !input.builderInput) return fallbackResult(input, "explicit section windows are required for symbolic realization");
  const builderInput: PianoSectionBuildInput = input.builderInput
    ? {
      ...input.builderInput,
      primary,
      alternates,
      windows: directWindows,
    }
    : { primary, alternates, windows: directWindows };
  try {
    const built: PianoSectionBuildResult = buildSectionAwarePianoCandidate(builderInput);
    const canonical = built.cdFusedMedium.parsed;
    const variants = variantsFor(canonical, "direct-piano");
    const directSelectedIds = [...new Set(built.selection.selectedCandidateIds)].sort();
    return {
      status: "symbolic",
      route: "EXTERNAL_SYMBOLIC_FIRST",
      mode: "direct-piano",
      evidenceClass: primaryEntry.candidate.evidenceClass,
      selectedRecordIds: directSelectedIds,
      canonical,
      variants,
      advanced: variants.advanced,
      medium: variants.medium,
      easy: variants.easy,
      outputs: { canonical, ...variants },
      notes: variants.medium.notes,
      artifact: variants.medium,
      provenance: outputProvenance(selected, directWindows, directSelectedIds, "melody"),
      diagnostics: { schemaVersion: 1, candidateSetDigest: set.digest, builder: built.diagnostics },
    };
  } catch (error) {
    return fallbackResult(input, error instanceof Error ? error.message : "symbolic realization failed");
  }
}

export interface ExternalRouteCoverageAttribution {
  evidenceClass?: string;
  /** Short aliases accepted for adapters that already use class/index terminology. */
  class?: string;
  noteIndices?: readonly number[];
  indices?: readonly number[];
  noteIndex?: number;
  index?: number;
  noteCount?: number;
  durationBeats?: number;
  duration?: number;
  confidence?: number;
}

export interface ExternalRouteCoverageInput {
  notes?: readonly Note[];
  result?: { notes?: readonly Note[] };
  totalNotes?: number;
  totalDurationBeats?: number;
  attributions?: readonly ExternalRouteCoverageAttribution[];
  attribution?: readonly ExternalRouteCoverageAttribution[];
  noteAttribution?: readonly ExternalRouteCoverageAttribution[];
  evidence?: readonly ExternalRouteCoverageAttribution[];
}

export type RouteCoverageAttribution = ExternalRouteCoverageAttribution;
export type RouteCoverageInput = ExternalRouteCoverageInput;

export interface ExternalRouteCoverageRow {
  noteCount: number | null;
  notePercentage: number | null;
  durationBeats: number | null;
  durationPercentage: number | null;
  confidence: { min: number | null; median: number | null; max: number | null };
}

export interface ExternalRouteCoverageResult {
  totalNotes: number;
  totalDurationBeats: number;
  byEvidenceClass: Record<string, ExternalRouteCoverageRow>;
  attributedNotePercentage: number | null;
  attributedDurationPercentage: number | null;
  diagnostics: string[];
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return rounded(sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2);
}

/** Report route coverage using explicit class-to-note attribution only. */
export function evaluateRouteCoverage(input: ExternalRouteCoverageInput): ExternalRouteCoverageResult {
  const diagnostics: string[] = [];
  const rawNotes = input.notes ?? input.result?.notes;
  let invalidData = false;
  const notes = rawNotes === undefined ? [] : Array.isArray(rawNotes)
    ? rawNotes.filter(validCoverageNote)
    : [];
  if (rawNotes !== undefined && !Array.isArray(rawNotes)) { diagnostics.push("notes must be an array"); invalidData = true; }
  else if (Array.isArray(rawNotes) && notes.length !== rawNotes.length) { diagnostics.push("route notes contained malformed entries"); invalidData = true; }
  const totalNotes = input.totalNotes === undefined
    ? notes.length
    : finite(input.totalNotes) && Number.isInteger(input.totalNotes) && input.totalNotes >= 0
      ? input.totalNotes : (diagnostics.push("total note count must be a non-negative integer"), invalidData = true, 0);
  const totalDurationBeats = input.totalDurationBeats === undefined
    ? notes.reduce((sum, note) => sum + (finite(note.dur) && note.dur > 0 ? note.dur : 0), 0)
    : finite(input.totalDurationBeats) && input.totalDurationBeats >= 0
      ? input.totalDurationBeats : (diagnostics.push("total duration must be a non-negative finite number"), invalidData = true, 0);
  const sourceAttributions: unknown = [input.attributions, input.attribution, input.noteAttribution, input.evidence].find((value) => value !== undefined);
  const rawAttributions: unknown[] = sourceAttributions === undefined ? [] : Array.isArray(sourceAttributions) ? [...sourceAttributions] : (diagnostics.push("evidence attribution must be an array"), invalidData = true, []);
  const attributions = rawAttributions.sort((a, b) => {
    const left = isRecord(a) ? a : {};
    const right = isRecord(b) ? b : {};
    return String(left.evidenceClass ?? left.class ?? "").localeCompare(String(right.evidenceClass ?? right.class ?? ""))
      || (Number(left.noteIndex ?? left.index ?? (Array.isArray(left.noteIndices) ? left.noteIndices[0] : undefined) ?? (Array.isArray(left.indices) ? left.indices[0] : undefined) ?? -1)
        - Number(right.noteIndex ?? right.index ?? (Array.isArray(right.noteIndices) ? right.noteIndices[0] : undefined) ?? (Array.isArray(right.indices) ? right.indices[0] : undefined) ?? -1));
  });
  const rows = new Map<string, { indices: Set<number>; noteCount: number; duration: number; confidence: number[]; aggregate: boolean }>();
  const owner = new Map<number, string>();
  for (const rawAttribution of attributions) {
    const attribution = isRecord(rawAttribution) ? rawAttribution as ExternalRouteCoverageAttribution : null;
    if (!attribution) { diagnostics.push("invalid explicit evidence attribution"); invalidData = true; continue; }
    const evidenceClass = typeof attribution?.evidenceClass === "string" ? attribution.evidenceClass : typeof attribution?.class === "string" ? attribution.class : "";
    if (!evidenceClass.trim()) { diagnostics.push("invalid explicit evidence attribution"); invalidData = true; continue; }
    const row = rows.get(evidenceClass) ?? { indices: new Set<number>(), noteCount: 0, duration: 0, confidence: [], aggregate: false };
    const rawIndices = attribution.noteIndices ?? attribution.indices;
    if (rawIndices !== undefined && !Array.isArray(rawIndices)) { diagnostics.push(`evidence class ${evidenceClass} has invalid note indices`); invalidData = true; rows.set(evidenceClass, row); continue; }
    const indices = Array.isArray(rawIndices) ? [...rawIndices] : attribution.noteIndex !== undefined ? [attribution.noteIndex] : attribution.index !== undefined ? [attribution.index] : [];
    if (indices.length) {
      for (const index of indices) {
        if (!Number.isInteger(index) || index < 0 || index >= notes.length) { diagnostics.push(`evidence attribution index ${String(index)} is out of range`); invalidData = true; continue; }
        const previous = owner.get(index);
        if (previous && previous !== evidenceClass) { diagnostics.push(`note ${index} has conflicting evidence classes`); invalidData = true; }
        owner.set(index, evidenceClass);
        row.indices.add(index);
      }
      row.noteCount = row.indices.size;
      row.duration = [...row.indices].reduce((sum, index) => sum + (notes[index] && finite(notes[index]!.dur) && notes[index]!.dur > 0 ? notes[index]!.dur : 0), 0);
    } else if (attribution.noteCount !== undefined || attribution.durationBeats !== undefined || attribution.duration !== undefined) {
      const validCount = attribution.noteCount === undefined || (finite(attribution.noteCount) && Number.isInteger(attribution.noteCount) && attribution.noteCount >= 0);
      const validDuration = attribution.durationBeats === undefined && attribution.duration === undefined
        || (attribution.durationBeats !== undefined ? finite(attribution.durationBeats) && attribution.durationBeats >= 0 : finite(attribution.duration) && attribution.duration! >= 0);
      if (!validCount || !validDuration) { diagnostics.push(`evidence class ${evidenceClass} has invalid aggregate coverage`); invalidData = true; rows.set(evidenceClass, row); continue; }
      row.aggregate = true;
      row.noteCount += finite(attribution.noteCount) ? attribution.noteCount : 0;
      row.duration += finite(attribution.durationBeats) ? attribution.durationBeats : finite(attribution.duration) ? attribution.duration : 0;
    } else { diagnostics.push(`evidence class ${evidenceClass} has no note attribution`); invalidData = true; }
    if (attribution.confidence !== undefined) {
      if (finite(attribution.confidence) && attribution.confidence >= 0 && attribution.confidence <= 1) row.confidence.push(attribution.confidence);
      else { diagnostics.push(`evidence class ${evidenceClass} has invalid confidence`); invalidData = true; }
    }
    rows.set(evidenceClass, row);
  }
  const attributedNotes = [...owner.keys()];
  const completeNotes = !invalidData && attributions.length > 0 && attributedNotes.length === totalNotes && owner.size === totalNotes && diagnostics.every((item) => !/conflicting|out of range/i.test(item));
  const aggregateRows = [...rows.values()].some((row) => row.aggregate);
  const summedNotes = [...rows.values()].reduce((sum, row) => sum + row.noteCount, 0);
  const summedDuration = [...rows.values()].reduce((sum, row) => sum + row.duration, 0);
  const completeAggregate = !invalidData && attributions.length > 0 && aggregateRows && summedNotes === totalNotes && Math.abs(summedDuration - totalDurationBeats) < 1e-6;
  const complete = completeNotes || completeAggregate;
  if (!attributions.length) diagnostics.push("explicit evidence-class attribution is unavailable");
  else if (!complete) diagnostics.push("explicit evidence-class attribution is incomplete");
  const byEvidenceClass: Record<string, ExternalRouteCoverageRow> = {};
  for (const className of [...rows.keys()].sort()) {
    const row = rows.get(className)!;
    byEvidenceClass[className] = {
      noteCount: complete ? row.noteCount : null,
      notePercentage: complete && totalNotes > 0 ? rounded((row.noteCount / totalNotes) * 100) : null,
      durationBeats: complete ? rounded(row.duration) : null,
      durationPercentage: complete && totalDurationBeats > 0 ? rounded((row.duration / totalDurationBeats) * 100) : null,
      confidence: { min: row.confidence.length ? rounded(Math.min(...row.confidence)) : null, median: median(row.confidence), max: row.confidence.length ? rounded(Math.max(...row.confidence)) : null },
    };
  }
  return {
    totalNotes,
    totalDurationBeats: rounded(totalDurationBeats),
    byEvidenceClass,
    attributedNotePercentage: complete && totalNotes > 0 ? 100 : null,
    attributedDurationPercentage: complete && totalDurationBeats > 0 ? 100 : null,
    diagnostics: [...new Set(diagnostics)].sort(),
  };
}
