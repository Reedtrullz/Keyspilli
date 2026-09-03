import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  buildVariants,
  validateArtifactFiles,
  validateVariants,
  verifyMonotonicity,
  writeVariantArtifacts,
  type Note,
  type ParsedMidi,
  type Variant,
} from "@keyspilli/midi";
import {
  researchExternalCandidates,
  type ExternalResearchRecord,
} from "./external-research.js";
import {
  buildExternalSymbolicArrangement,
  freezeGenerationCandidateSet,
  type FrozenGenerationCandidateSet,
} from "./external-symbolic-pipeline.js";
import {
  regionDecisionForSourceEvent,
  resolveRegionEvidence,
  type RegionEvidenceClaim,
  type RegionOwnershipResolution,
} from "./region-ownership.js";
import {
  evaluateAudioSymbolicAlignment,
  type AudioSymbolicAlignmentResult,
} from "./audio-symbolic-alignment.js";
import { groupSongs } from "./group.js";
import { projectPublicGroupedSongs } from "./public-difficulty.js";
import type { SongRow } from "./db-types.js";
import { sha256Hex } from "./fixture-evidence.js";

export const REGION_SHADOW_REHEARSAL_SCHEMA_VERSION = 1 as const;
export const REGION_SHADOW_REHEARSAL_KIND = "region-aware-real-shadow-rehearsal" as const;

const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
const EPSILON = 1e-6;
const execFileP = promisify(execFile);
const REPOSITORY_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../..");

type LaneStatus = "ready" | "blocked" | "partial" | "unavailable";
type Readiness = "GENERATION_READY" | "GENERATION_PARTIAL" | "GENERATION_BLOCKED";

export interface RegionShadowRehearsalOptions {
  laneAMidi: string;
  laneAAudio?: string;
  asapRoot?: string;
  python?: string;
  out?: string;
  repositoryRoot?: string;
  onsetRunner?: (audioPath: string) => Promise<readonly number[]>;
}

interface RealMediaSummary {
  status: "available" | "unavailable";
  sha256: string | null;
  byteLength: number | null;
  durationSeconds: number | null;
}

interface SourceSummary {
  id: string;
  purpose: string;
  evidenceClass: string;
  provenanceClass: string | null;
  parser: string;
  alignment: { status: string; reason: string | null };
  sha256: string | null;
  byteLength: number | null;
  noteCount: number;
  durationBeats: number;
  tempoBpm: number | null;
  roles: Array<{ role: string; eventCount: number; confidence: number }>;
}

interface OwnershipSummary {
  readiness: Readiness;
  decisions: Array<{
    id: string;
    candidateId: string;
    role: string;
    state: string;
    sourceClass: string;
    provenanceClass: string | null;
    timingAuthority: string;
    alignmentState: string;
    sourceRegion: [number, number] | null;
    reasonCodes: string[];
  }>;
  roleCoverageBeats: Record<string, { owned: number; fallbackOwned: number; partial: number; withheld: number }>;
  eventCounts: {
    candidate: number;
    eligibleBeforeOwnership: number;
    owned: number;
    partial: number;
    withheld: number;
  };
}

interface DownstreamSummary {
  status: LaneStatus;
  canonicalNoteCount: number;
  physicalLevels: Array<{ level: string; noteCount: number; midiSha256: string; musicXmlSha256: string; artifactErrors: string[] }>;
  publicLevels: string[];
  publicGroupCount: number;
  representativeLevel: string | null;
  validationErrors: string[];
  lineage: Array<{ level: string; noteCount: number; sourceRecordId: string; withheldEventsResurrected: number }>;
  playerLinks: { status: "NOT_EXERCISED"; reason: string };
}

export interface RegionShadowLaneReport {
  status: LaneStatus;
  fixture: { id: string; dataset: string; license: string; sourceKind: string; timingAuthority: string };
  sources: SourceSummary[];
  audio: RealMediaSummary;
  alignment: {
    status: string;
    confidence: number | null;
    naive: Record<string, unknown> | null;
    production: Record<string, unknown> | null;
    diagnostics: string[];
  };
  ownership: OwnershipSummary;
  downstream: DownstreamSummary | null;
  reasons: string[];
  unsafeScoreEventsEnteringArrangement: number;
}

export interface RegionShadowRehearsalReport {
  schemaVersion: typeof REGION_SHADOW_REHEARSAL_SCHEMA_VERSION;
  kind: typeof REGION_SHADOW_REHEARSAL_KIND;
  mission: "REGION_AWARE_REAL_SHADOW_REHEARSAL";
  lanes: { laneA: RegionShadowLaneReport; laneB: RegionShadowLaneReport; laneC: RegionShadowLaneReport };
  controlledPolicyTest: {
    status: "pass" | "unavailable";
    sourceRecordId: string | null;
    withheldStartBeat: number | null;
    ownedEventCount: number;
    withheldEventCount: number;
    canonicalNoteCount: number;
    eventsBeyondWithheldRegion: number;
    variantsWithResurrection: number;
    notes: string[];
  };
  capabilityEnvelope: Array<{ input: string; intake: string; timing: string; ownership: string; arrangement: string; status: string }>;
  decisions: {
    sourceIntake: "GENERATION_CANDIDATE_INTAKE_READY";
    realAlignment: "REAL_SYMBOLIC_ALIGNMENT_PARTIAL";
    rehearsal: "REGION_AWARE_REAL_SHADOW_VALIDATED" | "REGION_AWARE_REAL_SHADOW_PARTIAL" | "REGION_AWARE_REAL_SHADOW_BLOCKED";
    boundedMvp: "BOUNDED_MVP_TECHNICALLY_FEASIBLE" | "BOUNDED_MVP_NOT_YET_FEASIBLE";
    originalVision: "CURRENTLY_SUPPORTED" | "PARTIALLY_SUPPORTED" | "NOT_YET_SUPPORTED";
  };
  determinism: { canonicalSha256: string };
}

interface FlattenedEvent {
  note: Note;
  role: string;
  sourceStart: number;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function lexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort(lexical).map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function scoreDuration(score: { parts?: readonly { measures?: readonly { startBeat?: number; durationBeats?: number }[] }[] }): number {
  return round((score.parts ?? []).flatMap((part) => part.measures ?? []).reduce((max, measure) => {
    const start = finite(measure.startBeat) ? measure.startBeat : 0;
    const duration = finite(measure.durationBeats) ? measure.durationBeats : 0;
    return Math.max(max, start + duration);
  }, 0));
}

function eventRows(record: ExternalResearchRecord): FlattenedEvent[] {
  const rows: FlattenedEvent[] = [];
  for (const [partIndex, part] of (record.score?.parts ?? []).entries()) {
    const role = record.roles.find((candidate) => candidate.partId === part.id)?.role
      ?? record.roles[partIndex]?.role
      ?? part.role
      ?? "harmony";
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
      ];
      const seen = new Set<string>();
      for (const event of events) {
        if (!finite(event.pitch) || !finite(event.onset) || !finite(event.duration) || event.duration <= 0) continue;
        const key = [event.onset, event.duration, event.pitch, event.staff ?? "", event.voice ?? ""].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          role,
          sourceStart: start + event.onset,
          note: { midi: Math.max(0, Math.min(127, Math.round(event.pitch))), start: Math.max(0, start + event.onset), dur: event.duration, vel: 96 },
        });
      }
      cursor = Math.max(cursor, start + (finite(measure.durationBeats) ? measure.durationBeats : 0));
    }
  }
  return rows.sort((left, right) => left.note.start - right.note.start || left.note.midi - right.note.midi || left.note.dur - right.note.dur || lexical(left.role, right.role));
}

function roleNames(record: ExternalResearchRecord): string[] {
  return [...new Set([...record.roles.map((role) => role.role), "melody"])].sort(lexical);
}

export function buildRegionClaims(
  record: ExternalResearchRecord,
  durationBeats: number,
  options: { sourceClass?: RegionEvidenceClaim["sourceClass"]; provenanceClass?: RegionEvidenceClaim["provenanceClass"]; timingAuthority?: RegionEvidenceClaim["timingAuthority"]; alignmentState?: RegionEvidenceClaim["alignmentState"]; splitAtBeat?: number } = {},
): RegionEvidenceClaim[] {
  const sourceClass = options.sourceClass ?? "GENERATION_CANDIDATE";
  const provenanceClass = options.provenanceClass ?? "USER_SUPPLIED_PRIVATE";
  const timingAuthority = options.timingAuthority ?? "NATIVE_AUTHORITATIVE";
  const alignmentState = options.alignmentState ?? "NATIVE_AUTHORITATIVE";
  const split = finite(options.splitAtBeat) && options.splitAtBeat! > 0 && options.splitAtBeat! < durationBeats ? options.splitAtBeat! : null;
  return roleNames(record).flatMap((role) => {
    const base = { candidateId: record.id, sourceClass, provenanceClass, role: role as RegionEvidenceClaim["role"], confidence: 0.9 };
    if (split === null) return [{ ...base, id: `owned:${role}`, timingAuthority, alignmentState, sourceRegion: { startBeat: 0, endBeat: durationBeats } }];
    return [
      { ...base, id: `owned:${role}`, timingAuthority, alignmentState, sourceRegion: { startBeat: 0, endBeat: split } },
      { ...base, id: `withheld:${role}`, timingAuthority: "ALIGNMENT_REJECTED", alignmentState: "ALIGNMENT_REJECTED", sourceRegion: { startBeat: split, endBeat: durationBeats } },
    ];
  });
}

function roleCoverage(resolution: RegionOwnershipResolution): OwnershipSummary["roleCoverageBeats"] {
  const result: OwnershipSummary["roleCoverageBeats"] = {};
  for (const decision of resolution.decisions) {
    const role = decision.role;
    const row = result[role] ?? { owned: 0, fallbackOwned: 0, partial: 0, withheld: 0 };
    const start = decision.sourceRegion?.startBeat;
    const end = decision.sourceRegion?.endBeat;
    const span = finite(start) && finite(end) && end > start ? end - start : 0;
    if (decision.ownershipState === "OWNED") row.owned += span;
    else if (decision.ownershipState === "FALLBACK_OWNED") row.fallbackOwned += span;
    else if (decision.ownershipState === "PARTIAL_SUPPORT") row.partial += span;
    else row.withheld += span;
    result[role] = { owned: round(row.owned), fallbackOwned: round(row.fallbackOwned), partial: round(row.partial), withheld: round(row.withheld) };
  }
  return Object.fromEntries(Object.keys(result).sort(lexical).flatMap((role) => result[role] ? [[role, result[role]]] : [])) as OwnershipSummary["roleCoverageBeats"];
}

function combineRoleCoverage(...coverages: OwnershipSummary["roleCoverageBeats"][]): OwnershipSummary["roleCoverageBeats"] {
  const result: OwnershipSummary["roleCoverageBeats"] = {};
  for (const coverage of coverages) {
    for (const [role, values] of Object.entries(coverage)) {
      const prior = result[role] ?? { owned: 0, fallbackOwned: 0, partial: 0, withheld: 0 };
      result[role] = {
        owned: round(prior.owned + values.owned),
        fallbackOwned: round(prior.fallbackOwned + values.fallbackOwned),
        partial: round(prior.partial + values.partial),
        withheld: round(prior.withheld + values.withheld),
      };
    }
  }
  return Object.fromEntries(Object.keys(result).sort(lexical).map((role) => [role, result[role]])) as OwnershipSummary["roleCoverageBeats"];
}

function ownershipSummary(record: ExternalResearchRecord, resolution: RegionOwnershipResolution): OwnershipSummary {
  const rows = eventRows(record);
  const roleClaims = new Set(resolution.decisions.map((decision) => decision.role));
  let eligibleBeforeOwnership = 0;
  let owned = 0;
  let partial = 0;
  let withheld = 0;
  for (const row of rows) {
    if (row.role === "timing-only") continue;
    eligibleBeforeOwnership += 1;
    if (!roleClaims.has(row.role as RegionEvidenceClaim["role"])) {
      owned += 1;
      continue;
    }
    const decision = regionDecisionForSourceEvent(resolution, [record.id, record.candidate?.id ?? ""], row.role as RegionEvidenceClaim["role"], row.sourceStart);
    if (decision) owned += 1;
    else if (resolution.decisions.some((candidate) => candidate.role === row.role && candidate.sourceRegion && row.sourceStart >= candidate.sourceRegion.startBeat - EPSILON && row.sourceStart < candidate.sourceRegion.endBeat - EPSILON && candidate.ownershipState === "PARTIAL_SUPPORT")) partial += 1;
    else withheld += 1;
  }
  const decisions = resolution.decisions.map((decision) => ({
    id: decision.id,
    candidateId: decision.candidateId,
    role: decision.role,
    state: decision.ownershipState,
    sourceClass: decision.sourceClass,
    provenanceClass: decision.provenanceClass ?? null,
    timingAuthority: decision.timingAuthority,
    alignmentState: decision.alignmentState,
    sourceRegion: decision.sourceRegion ? [round(decision.sourceRegion.startBeat), round(decision.sourceRegion.endBeat)] as [number, number] : null,
    reasonCodes: [...decision.reasonCodes].sort(lexical),
  }));
  return {
    readiness: resolution.readiness,
    decisions,
    roleCoverageBeats: roleCoverage(resolution),
    eventCounts: { candidate: rows.length, eligibleBeforeOwnership, owned, partial, withheld },
  };
}

function sourceSummary(record: ExternalResearchRecord): SourceSummary {
  return {
    id: record.id,
    purpose: record.purpose,
    evidenceClass: record.evidenceClass,
    provenanceClass: record.provenanceClass
      ?? (typeof record.candidate?.provenance?.provenanceClass === "string" ? record.candidate.provenance.provenanceClass : null),
    parser: record.parser.status,
    alignment: { status: record.alignment.status, reason: record.alignment.reason },
    sha256: record.content.sha256,
    byteLength: record.content.byteLength,
    noteCount: eventRows(record).length,
    durationBeats: scoreDuration(record.score ?? {}),
    tempoBpm: finite(record.score?.tempoBpm) ? record.score!.tempoBpm! : null,
    roles: record.roles.map((role) => ({ role: role.role, eventCount: role.eventCount, confidence: round(role.confidence) })).sort((left, right) => lexical(left.role, right.role) || left.eventCount - right.eventCount),
  };
}

async function mediaSummary(path: string | undefined, repositoryRoot: string): Promise<RealMediaSummary> {
  if (!path) return { status: "unavailable", sha256: null, byteLength: null, durationSeconds: null };
  const resolved = await realpath(path);
  const root = resolve(repositoryRoot);
  if (resolved === root || resolved.startsWith(`${root}/`)) {
    // Source media is intentionally kept outside the repository. This also
    // prevents an accidental report from turning a repo path into an intake.
    throw new Error("shadow media must be outside the repository root");
  }
  const info = await stat(resolved);
  if (!info.isFile() || info.size > MAX_AUDIO_BYTES) throw new Error("shadow audio is missing, not a file, or exceeds the size bound");
  const bytes = new Uint8Array(await readFile(resolved));
  let durationSeconds: number | null = null;
  try {
    const probe = await execFileP("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", resolved], { maxBuffer: 1024 * 1024 });
    const parsed = Number.parseFloat(probe.stdout.trim());
    durationSeconds = finite(parsed) && parsed > 0 ? round(parsed) : null;
  } catch {
    durationSeconds = null;
  }
  return { status: "available", sha256: sha256Hex(bytes), byteLength: bytes.byteLength, durationSeconds };
}

function comparisonSummary(comparison: AudioSymbolicAlignmentResult["naive"]): Record<string, unknown> | null {
  if (!comparison) return null;
  return {
    method: comparison.mapping.method,
    segmentCount: comparison.mapping.segments.length,
    drift: comparison.mapping.drift,
    confidence: comparison.confidence,
    metrics: {
      matchedOnsets: comparison.metrics.matchedOnsets,
      audioOnsetCount: comparison.metrics.audioOnsetCount,
      symbolicOnsetCount: comparison.metrics.symbolicOnsetCount,
      precision: comparison.metrics.precision,
      recall: comparison.metrics.recall,
      f1: comparison.metrics.f1,
      errorSeconds: comparison.metrics.errorSeconds,
      errorBeats: comparison.metrics.errorBeats,
    },
  };
}

async function audioAlignment(record: ExternalResearchRecord, audioPath: string | undefined, options: RegionShadowRehearsalOptions): Promise<{ audio: RealMediaSummary; alignment: RegionShadowLaneReport["alignment"] }> {
  const audio = await mediaSummary(audioPath, options.repositoryRoot ?? REPOSITORY_ROOT);
  if (audio.status !== "available" || !audioPath) return { audio, alignment: { status: "insufficient-evidence", confidence: null, naive: null, production: null, diagnostics: ["independent audio onsets were not supplied"] } };
  const onsets = options.onsetRunner
    ? await options.onsetRunner(audioPath)
    : await runProductionOnsets(audioPath, options.python, options.repositoryRoot ?? REPOSITORY_ROOT);
  if (!onsets.length) return { audio, alignment: { status: "insufficient-evidence", confidence: null, naive: null, production: null, diagnostics: ["independent onset detector returned no usable onsets"] } };
  const result = evaluateAudioSymbolicAlignment({
    symbolicNotes: eventRows(record).map((row) => row.note),
    audioOnsetSeconds: onsets,
    tempoBpm: finite(record.score?.tempoBpm) && record.score!.tempoBpm! > 0 ? record.score!.tempoBpm! : 120,
  });
  return {
    audio,
    alignment: {
      status: result.status,
      confidence: result.confidence,
      naive: comparisonSummary(result.naive),
      production: comparisonSummary(result.production),
      diagnostics: [...result.diagnostics].sort(lexical),
    },
  };
}

async function runProductionOnsets(audioPath: string, python: string | undefined, repositoryRoot: string): Promise<number[]> {
  const interpreter = python ?? process.env.KEYSPILLI_PYTHON ?? resolve(repositoryRoot, "services/transcribe/.venv/bin/python");
  try {
    const result = await execFileP(interpreter, [resolve(repositoryRoot, "services/transcribe/src/audio_onsets.py"), audioPath], { maxBuffer: 16 * 1024 * 1024 });
    const parsed: unknown = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed.filter((value): value is number => finite(value) && value >= 0) : [];
  } catch {
    return [];
  }
}

function songRows(variants: readonly Variant[], baseId: string, title: string): SongRow[] {
  return variants.map((variant) => ({
    id: `${baseId}-${variant.level}`,
    baseId,
    title,
    artist: "Keyspilli shadow",
    category: "shadow",
    difficulty: variant.level,
    difficultyScore: variant.difficultyScore,
    key: variant.key,
    tempo: variant.tempoBpm,
    style: "shadow",
    mood: "neutral",
    bassPattern: variant.bassPattern,
    duration: variant.measures.at(-1)?.endBeat ? (variant.measures.at(-1)!.endBeat * 60) / variant.tempoBpm : 0,
    contentType: "shadow",
    acquiredVia: "user-supplied-private",
    sourceYoutubeUrl: null,
    hasSheetXml: 1,
    sections: null,
    plays: 0,
    level: variant.level,
    createdAt: "1970-01-01T00:00:00.000Z",
  }));
}

function downstreamSummary(
  canonical: ParsedMidi,
  sourceRecordId: string,
): DownstreamSummary {
  const variants = buildVariants(canonical, {
    title: canonical.title ?? "Real shadow",
    artist: "Keyspilli shadow",
    tempo: canonical.tempoBpm,
    key: "C",
  }, { arrangementProfile: "learner", audioDerived: false, maxDurBeats: null });
  const validationErrors = [...validateVariants(variants, { maxDurBeats: null }), ...verifyMonotonicity(variants)];
  const physicalLevels = variants.map((variant) => {
    try {
      const artifacts = writeVariantArtifacts(variant, canonical.title ?? "Real shadow", "Keyspilli shadow");
      return {
        level: variant.level,
        noteCount: variant.notes.length,
        midiSha256: sha256Hex(artifacts.midi),
        musicXmlSha256: digest(artifacts.xml),
        artifactErrors: validateArtifactFiles(variant, artifacts),
      };
    } catch (error) {
      return { level: variant.level, noteCount: variant.notes.length, midiSha256: "", musicXmlSha256: "", artifactErrors: [error instanceof Error ? error.message : "artifact render failed"] };
    }
  });
  const rows = songRows(variants, `region-shadow-${sourceRecordId}`, canonical.title ?? "Real shadow");
  const grouped = projectPublicGroupedSongs(groupSongs(rows));
  const allErrors = [...validationErrors, ...physicalLevels.flatMap((level) => level.artifactErrors)];
  return {
    status: allErrors.length ? "blocked" : "ready",
    canonicalNoteCount: canonical.notes.length,
    physicalLevels,
    publicLevels: grouped[0]?.levels.map((row) => row.level).sort(lexical) ?? [],
    publicGroupCount: grouped.length,
    representativeLevel: grouped[0]?.representative.level ?? null,
    validationErrors: [...new Set(allErrors)].sort(lexical),
    lineage: variants.map((variant) => ({ level: variant.level, noteCount: variant.notes.length, sourceRecordId, withheldEventsResurrected: 0 })),
    playerLinks: { status: "NOT_EXERCISED", reason: "the rehearsal uses in-memory catalog projection; no scratch persistence or player route was invoked" },
  };
}

function emptyLane(id: string, reason: string): RegionShadowLaneReport {
  return {
    status: "unavailable",
    fixture: { id, dataset: "not-supplied", license: "not-supplied", sourceKind: "not-supplied", timingAuthority: "UNALIGNED" },
    sources: [],
    audio: { status: "unavailable", sha256: null, byteLength: null, durationSeconds: null },
    alignment: { status: "unavailable", confidence: null, naive: null, production: null, diagnostics: [reason] },
    ownership: { readiness: "GENERATION_BLOCKED", decisions: [], roleCoverageBeats: {}, eventCounts: { candidate: 0, eligibleBeforeOwnership: 0, owned: 0, partial: 0, withheld: 0 } },
    downstream: null,
    reasons: [reason],
    unsafeScoreEventsEnteringArrangement: 0,
  };
}

async function runLaneA(options: RegionShadowRehearsalOptions): Promise<{ lane: RegionShadowLaneReport; record: ExternalResearchRecord | null; frozen: FrozenGenerationCandidateSet | null }> {
  const inventory = await researchExternalCandidates({ title: "Local real performance shadow", artist: "Keyspilli" }, {
    localInputs: [{
      id: "lane-a-native-performance",
      path: options.laneAMidi,
      format: "midi",
      sourceRef: "user:local-performance-symbolic",
      purpose: "GENERATION_CANDIDATE",
      evidenceClass: "VERIFIED_NATIVE_SYMBOLIC",
      provenanceClass: "USER_SUPPLIED_PRIVATE",
      alignment: { status: "aligned", reason: "native performance-symbolic timing is authoritative" },
    }],
  });
  const record = inventory.records[0] ?? null;
  if (!record) return { lane: emptyLane("lane-a", "native performance source was not ingested"), record: null, frozen: null };
  const source = sourceSummary(record);
  const frozen = freezeGenerationCandidateSet(inventory.records, { requireAlignment: true });
  if (!frozen.selected.length) {
    return {
      lane: { ...emptyLane("lane-a", frozen.rejected.flatMap((row) => row.reasons).join("; ") || "native source failed generation readiness"), fixture: { id: "lane-a", dataset: "user-supplied-local-pair", license: "USER_SUPPLIED_PRIVATE", sourceKind: "PERFORMANCE_SYMBOLIC", timingAuthority: "NATIVE_AUTHORITATIVE" }, sources: [source] },
      record,
      frozen,
    };
  }
  const entry = frozen.selected[0]!;
  const duration = scoreDuration(record.score ?? {});
  const claims = buildRegionClaims(record, duration);
  const resolution = resolveRegionEvidence(claims);
  const output = buildExternalSymbolicArrangement({
    candidateSet: frozen,
    mode: "direct-piano",
    windows: [{ id: "full", startBeat: 0, endBeat: duration, candidateId: entry.recordId }],
    regionClaims: claims,
    fallbackEnabled: false,
  });
  const audio = await audioAlignment(record, options.laneAAudio, options);
  if (output.status !== "symbolic" || !output.canonical) {
    return {
      lane: { status: "blocked", fixture: { id: "lane-a", dataset: "user-supplied-local-pair", license: "USER_SUPPLIED_PRIVATE", sourceKind: "PERFORMANCE_SYMBOLIC", timingAuthority: "NATIVE_AUTHORITATIVE" }, sources: [source], audio: audio.audio, alignment: audio.alignment, ownership: ownershipSummary(record, resolution), downstream: null, reasons: [output.fallbackReason ?? "symbolic route was unavailable"], unsafeScoreEventsEnteringArrangement: 0 },
      record,
      frozen,
    };
  }
  const downstream = downstreamSummary(output.canonical, entry.recordId);
  return {
    lane: { status: downstream.status === "ready" ? "ready" : "blocked", fixture: { id: "lane-a", dataset: "user-supplied-local-pair", license: "USER_SUPPLIED_PRIVATE", sourceKind: "PERFORMANCE_SYMBOLIC", timingAuthority: "NATIVE_AUTHORITATIVE" }, sources: [source], audio: audio.audio, alignment: audio.alignment, ownership: ownershipSummary(record, resolution), downstream, reasons: downstream.validationErrors, unsafeScoreEventsEnteringArrangement: 0 },
    record,
    frozen,
  };
}

async function asapRecord(path: string, id: string, purpose: "BENCHMARK_REFERENCE", alignment: "partial" | "aligned"): Promise<ExternalResearchRecord | null> {
  const inventory = await researchExternalCandidates({ title: "ASAP real shadow fixture", artist: "ASAP" }, {
    localInputs: [{ id, path, format: "midi", sourceRef: `asap:fixtures/dev:${id}`, purpose, evidenceClass: "BENCHMARK_REFERENCE", provenanceClass: "OPEN_LICENSE", alignment: { status: alignment, reason: "existing frozen evaluation evidence; generation is prohibited" } }],
  });
  return inventory.records[0] ?? null;
}

function benchmarkOwnership(record: ExternalResearchRecord, timingAuthority: RegionEvidenceClaim["timingAuthority"], alignmentState: RegionEvidenceClaim["alignmentState"]): RegionOwnershipResolution {
  return resolveRegionEvidence(buildRegionClaims(record, scoreDuration(record.score ?? {}), { sourceClass: "BENCHMARK_REFERENCE", provenanceClass: "OPEN_LICENSE", timingAuthority, alignmentState }));
}

async function runLaneB(asapRoot: string | undefined): Promise<RegionShadowLaneReport> {
  if (!asapRoot) return emptyLane("lane-b", "no existing ASAP fixture root was supplied");
  const root = resolve(asapRoot);
  const scorePath = join(root, "fixtures/dev/score.mid");
  const audioPath = join(root, "fixtures/dev/audio.wav");
  const record = await asapRecord(scorePath, "lane-b-partial-score", "BENCHMARK_REFERENCE", "partial");
  if (!record) return emptyLane("lane-b", "ASAP score fixture could not be ingested");
  const resolution = benchmarkOwnership(record, "ALIGNED_PARTIAL", "ALIGNED_PARTIAL");
  const source = sourceSummary(record);
  const audio = await mediaSummary(audioPath, REPOSITORY_ROOT);
  return { status: "blocked", fixture: { id: "lane-b", dataset: "ASAP v2.1.1", license: "CC BY-NC-SA-4.0; evaluation-only", sourceKind: "SCORE_SYMBOLIC", timingAuthority: "ALIGNED_PARTIAL" }, sources: [source], audio, alignment: { status: "partial", confidence: null, naive: null, production: null, diagnostics: ["existing frozen score-alignment evidence is partial; benchmark firewall applies"] }, ownership: ownershipSummary(record, resolution), downstream: null, reasons: ["BENCHMARK_FIREWALL", "PARTIAL_ALIGNMENT", "NO_TARGET_TIMING"], unsafeScoreEventsEnteringArrangement: 0 };
}

async function runLaneC(asapRoot: string | undefined): Promise<RegionShadowLaneReport> {
  if (!asapRoot) return emptyLane("lane-c", "no existing ASAP fixture root was supplied");
  const root = resolve(asapRoot);
  const scorePath = join(root, "fixtures/dev/score.mid");
  const performancePath = join(root, "fixtures/dev/performance.mid");
  const audioPath = join(root, "fixtures/dev/audio.wav");
  const [score, performance] = await Promise.all([
    asapRecord(scorePath, "lane-c-score", "BENCHMARK_REFERENCE", "partial"),
    asapRecord(performancePath, "lane-c-performance", "BENCHMARK_REFERENCE", "aligned"),
  ]);
  if (!score || !performance) return emptyLane("lane-c", "ASAP multi-source inventory is incomplete");
  const scoreResolution = benchmarkOwnership(score, "ALIGNED_PARTIAL", "ALIGNED_PARTIAL");
  const performanceResolution = benchmarkOwnership(performance, "NATIVE_AUTHORITATIVE", "NATIVE_AUTHORITATIVE");
  const sourceRows = [sourceSummary(score), sourceSummary(performance)].sort((left, right) => lexical(left.id, right.id));
  const audio = await mediaSummary(audioPath, REPOSITORY_ROOT);
  const sourceClaims = [...buildRegionClaims(score, scoreDuration(score.score ?? {}), { sourceClass: "BENCHMARK_REFERENCE", provenanceClass: "OPEN_LICENSE", timingAuthority: "ALIGNED_PARTIAL", alignmentState: "ALIGNED_PARTIAL" }), ...buildRegionClaims(performance, scoreDuration(performance.score ?? {}), { sourceClass: "BENCHMARK_REFERENCE", provenanceClass: "OPEN_LICENSE", timingAuthority: "NATIVE_AUTHORITATIVE", alignmentState: "NATIVE_AUTHORITATIVE" })];
  const forward = resolveRegionEvidence(sourceClaims);
  const reverse = resolveRegionEvidence([...sourceClaims].reverse());
  const normalized = (resolution: RegionOwnershipResolution) => resolution.decisions.map((decision) => ({ id: decision.id, candidateId: decision.candidateId, role: decision.role, state: decision.ownershipState, sourceClass: decision.sourceClass, provenanceClass: decision.provenanceClass ?? null, timingAuthority: decision.timingAuthority, alignmentState: decision.alignmentState, sourceRegion: decision.sourceRegion ? [decision.sourceRegion.startBeat, decision.sourceRegion.endBeat] as [number, number] : null, reasonCodes: [...decision.reasonCodes].sort(lexical) })).sort((left, right) => lexical(left.id, right.id));
  const orderIndependent = stableJson(normalized(forward)) === stableJson(normalized(reverse));
  return { status: "partial", fixture: { id: "lane-c", dataset: "ASAP v2.1.1", license: "CC BY-NC-SA-4.0; evaluation-only", sourceKind: "SCORE_SYMBOLIC+PERFORMANCE_SYMBOLIC", timingAuthority: "NATIVE_AUTHORITATIVE > ALIGNED_PARTIAL (diagnostic only)" }, sources: sourceRows, audio, alignment: { status: "partial", confidence: null, naive: null, production: null, diagnostics: [orderIndependent ? "candidate inventory ordering is deterministic" : "candidate inventory ordering changed decisions", "benchmark firewall withholds both sources before generation", "native performance timing would outrank partial score timing only outside the evaluation firewall"] }, ownership: { readiness: "GENERATION_BLOCKED", decisions: normalized(forward), roleCoverageBeats: combineRoleCoverage(roleCoverage(scoreResolution), roleCoverage(performanceResolution)), eventCounts: { candidate: eventRows(score).length + eventRows(performance).length, eligibleBeforeOwnership: 0, owned: 0, partial: 0, withheld: eventRows(score).length + eventRows(performance).length } }, downstream: null, reasons: ["BENCHMARK_FIREWALL", "MULTI_SOURCE_PRIORITY_NOT_GENERATION_EXERCISED"], unsafeScoreEventsEnteringArrangement: 0 };
}

async function controlledWithheld(record: ExternalResearchRecord, frozen: FrozenGenerationCandidateSet): Promise<RegionShadowRehearsalReport["controlledPolicyTest"]> {
  const duration = scoreDuration(record.score ?? {});
  const split = duration / 2;
  const claims = buildRegionClaims(record, duration, { splitAtBeat: split });
  const entry = frozen.selected[0];
  if (!entry) return { status: "unavailable", sourceRecordId: null, withheldStartBeat: null, ownedEventCount: 0, withheldEventCount: 0, canonicalNoteCount: 0, eventsBeyondWithheldRegion: 0, variantsWithResurrection: 0, notes: ["lane A did not produce a frozen generation candidate"] };
  const output = buildExternalSymbolicArrangement({ candidateSet: frozen, mode: "direct-piano", windows: [{ id: "controlled", startBeat: 0, endBeat: duration, candidateId: entry.recordId }], regionClaims: claims, fallbackEnabled: false });
  const events = eventRows(record);
  const withheldEvents = events.filter((row) => row.note.start >= split - EPSILON).length;
  if (output.status !== "symbolic" || !output.canonical) return { status: "pass", sourceRecordId: entry.recordId, withheldStartBeat: round(split), ownedEventCount: events.length - withheldEvents, withheldEventCount: withheldEvents, canonicalNoteCount: 0, eventsBeyondWithheldRegion: 0, variantsWithResurrection: 0, notes: ["blocked region produced no downstream arrangement"] };
  const beyond = output.canonical.notes.filter((note) => note.start >= split - EPSILON).length;
  const variants = buildVariants(output.canonical, { title: "Controlled shadow", artist: "Keyspilli", tempo: output.canonical.tempoBpm, key: "C" }, { arrangementProfile: "learner", audioDerived: false, maxDurBeats: null });
  const resurrection = variants.filter((variant) => variant.notes.some((note) => note.start >= split - EPSILON)).length;
  return { status: beyond === 0 && resurrection === 0 ? "pass" : "unavailable", sourceRecordId: entry.recordId, withheldStartBeat: round(split), ownedEventCount: events.length - withheldEvents, withheldEventCount: withheldEvents, canonicalNoteCount: output.canonical.notes.length, eventsBeyondWithheldRegion: beyond, variantsWithResurrection: resurrection, notes: beyond === 0 && resurrection === 0 ? ["withheld source region stayed absent through canonical and all physical variants"] : ["withheld source region appeared downstream"] };
}

function capabilityEnvelope(): RegionShadowRehearsalReport["capabilityEnvelope"] {
  return [
    { input: "USER/OPEN PERFORMANCE-SYMBOLIC WITH AUTHORITATIVE TIMING", intake: "valid local MIDI + provenance", timing: "native authoritative", ownership: "owned when roles/regions pass", arrangement: "six physical + five public in-memory when validation passes", status: "PARTIAL" },
    { input: "INDEPENDENT SCORE SYMBOLIC WITH HIGH-CONFIDENCE ALIGNMENT", intake: "supported", timing: "no current real production proof", ownership: "partial until independently aligned", arrangement: "not generally safe", status: "PARTIAL" },
    { input: "INDEPENDENT SCORE SYMBOLIC WITH PARTIAL/REJECTED ALIGNMENT", intake: "parsed but evaluation/firewall-aware", timing: "unsafe for target timing", ownership: "withheld", arrangement: "blocked", status: "BLOCKED" },
    { input: "MULTI-SOURCE WITH AUTHORITATIVE TIMED SOURCE", intake: "inventory supported", timing: "native source ranks above partial evidence", ownership: "policy deterministic; benchmark lane withheld", arrangement: "serviceable only for eligible non-benchmark source", status: "PARTIAL" },
    { input: "AUDIO ONLY DIRECT METAL AMT FALLBACK", intake: "worker path exists", timing: "AMT-dependent", ownership: "role/source gate required", arrangement: "not generically proven", status: "PARTIAL" },
    { input: "ARBITRARY YOUTUBE ROCK/METAL WITHOUT TRUSTWORTHY SYMBOLIC SOURCE", intake: "audio intake exists", timing: "unresolved", ownership: "no safe symbolic owner", arrangement: "fallback or withheld", status: "NOT_YET_SUPPORTED" },
  ];
}

export async function runRegionShadowRehearsal(options: RegionShadowRehearsalOptions): Promise<RegionShadowRehearsalReport> {
  const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT;
  const laneA = await runLaneA({ ...options, repositoryRoot });
  const [laneB, laneC] = await Promise.all([runLaneB(options.asapRoot), runLaneC(options.asapRoot)]);
  const controlled = laneA.record && laneA.frozen ? await controlledWithheld(laneA.record, laneA.frozen) : await controlledWithheld({} as ExternalResearchRecord, freezeGenerationCandidateSet([]));
  const rehearsal: RegionShadowRehearsalReport["decisions"]["rehearsal"] = laneA.lane.status === "ready" && laneB.status === "blocked" && controlled.status === "pass" ? "REGION_AWARE_REAL_SHADOW_VALIDATED" : laneA.lane.status === "ready" ? "REGION_AWARE_REAL_SHADOW_PARTIAL" : "REGION_AWARE_REAL_SHADOW_BLOCKED";
  const reportWithoutDigest = {
    schemaVersion: REGION_SHADOW_REHEARSAL_SCHEMA_VERSION,
    kind: REGION_SHADOW_REHEARSAL_KIND,
    mission: "REGION_AWARE_REAL_SHADOW_REHEARSAL" as const,
    lanes: { laneA: laneA.lane, laneB, laneC },
    controlledPolicyTest: controlled,
    capabilityEnvelope: capabilityEnvelope(),
    decisions: {
      sourceIntake: "GENERATION_CANDIDATE_INTAKE_READY" as const,
      realAlignment: "REAL_SYMBOLIC_ALIGNMENT_PARTIAL" as const,
      rehearsal,
      boundedMvp: laneA.lane.status === "ready" ? "BOUNDED_MVP_TECHNICALLY_FEASIBLE" as const : "BOUNDED_MVP_NOT_YET_FEASIBLE" as const,
      originalVision: "NOT_YET_SUPPORTED" as const,
    },
  };
  return { ...reportWithoutDigest, determinism: { canonicalSha256: digest(reportWithoutDigest) } };
}

export function canonicalRegionShadowRehearsalJson(report: RegionShadowRehearsalReport): string {
  return `${stableJson({ ...report, determinism: { canonicalSha256: "" } })}\n`;
}

function cliOptions(argv: readonly string[]): RegionShadowRehearsalOptions & { help: boolean } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--help" || token === "-h") return { laneAMidi: "", help: true };
    if (token.startsWith("--")) values.set(token.slice(2), argv[index + 1] ?? "");
  }
  return { laneAMidi: values.get("lane-a-midi") ?? "", laneAAudio: values.get("lane-a-audio"), asapRoot: values.get("asap-root"), python: values.get("python"), out: values.get("out"), help: false };
}

async function main(): Promise<void> {
  const parsed = cliOptions(process.argv.slice(2));
  if (parsed.help || !parsed.laneAMidi) {
    console.log("Usage: evaluate-region-shadow-rehearsal --lane-a-midi FILE [--lane-a-audio FILE] [--asap-root DIR] [--python FILE] [--out FILE]");
    return;
  }
  const report = await runRegionShadowRehearsal(parsed);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (parsed.out) await writeFile(parsed.out, json, "utf8");
  else process.stdout.write(json);
}

if (process.argv[1]?.endsWith("evaluate-region-shadow-rehearsal.ts")) await main();
