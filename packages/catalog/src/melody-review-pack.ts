/**
 * Local-only melody review planning.
 *
 * This module consumes path-free projections produced by the local reference
 * readiness/corpus tools. It does not read scores, notes, MIDI, or MusicXML,
 * and it never promotes automated evidence to a human musical decision.
 */

import type { LocalReferenceReadinessReport } from "./local-reference-readiness.js";
import type { ScoreReferenceCorpusReport } from "./score-reference-corpus.js";

export const MELODY_REVIEW_PACK_SCHEMA_VERSION = 1 as const;
export const MELODY_CORRECTION_LEDGER_SCHEMA_VERSION = 1 as const;

export type MelodyReviewDecision = "pending" | "accepted" | "rejected" | "corrected" | "skipped";
export type MelodyReviewPackStatus = "READY" | "PARTIAL" | "UNAVAILABLE";

export interface MelodyReviewInput {
  scores?: readonly unknown[];
  score?: unknown;
  [key: string]: unknown;
}

/** Accepted report projections; fields are read defensively at the boundary. */
export type MelodyReviewReportProjection = MelodyReviewInput | LocalReferenceReadinessReport | ScoreReferenceCorpusReport;

export interface MelodyReviewUnit {
  id: string;
  scoreId: string;
  artist: string;
  title: string;
  scoreHash: string | null;
  role: "melody";
  groupId: string;
  measureIds: string[];
  eventIds: string[];
  firstMeasureIndex: number | null;
  lastMeasureIndex: number | null;
  startBeat: number | null;
  endBeat: number | null;
  reasonCategories: string[];
  evidence: string[];
  priority: "high" | "medium" | "low";
  state: "REVIEW" | "BROKEN";
  decision: MelodyReviewDecision;
  confidence: { min: number; median: number; max: number } | null;
  estimatedEventCount: number | null;
  unlockValue: number;
  humanCost: number;
  evidenceScore: number;
  rankScore: number;
}

export interface MelodyReviewPack {
  schemaVersion: typeof MELODY_REVIEW_PACK_SCHEMA_VERSION;
  kind: "melody-review-pack";
  status: MelodyReviewPackStatus;
  scores: Array<{ id: string; artist: string; title: string; scoreHash: string | null; candidateUnits: number }>;
  bootstrap: {
    target: number;
    maximum: number;
    scoreIds: string[];
    decisions: MelodyReviewUnit[];
  };
  deferred: MelodyReviewUnit[];
  resolved: Array<{ scoreId: string; unitId: string; groupId?: string; decision: Exclude<MelodyReviewDecision, "pending"> }>;
  summary: {
    scoreCount: number;
    candidateScores: number;
    candidateUnits: number;
    bootstrapUnits: number;
    deferredUnits: number;
    resolvedUnits: number;
    sourceHashesAvailable: number;
    humanDecisions: number;
  };
  nonClaims: string[];
}

export interface MelodyCorrectionValues {
  pitch?: number;
  onset?: number;
  duration?: number;
  role?: "melody";
}

export interface MelodyCorrectionLedgerEntry {
  id?: string;
  scoreId: string;
  scoreHash: string;
  groupId?: string;
  unitId?: string;
  eventIds?: string[];
  decision: Exclude<MelodyReviewDecision, "pending">;
  rationale: string;
  correctedValues: MelodyCorrectionValues;
}

export interface MelodyCorrectionLedger {
  schemaVersion: typeof MELODY_CORRECTION_LEDGER_SCHEMA_VERSION;
  kind: "melody-correction-ledger";
  entries: MelodyCorrectionLedgerEntry[];
  nonClaims: string[];
}

export interface MelodyCorrectionLedgerValidation {
  valid: boolean;
  errors: string[];
  ledger: MelodyCorrectionLedger | null;
}

const HASH = /^[a-f0-9]{64}$/i;
const ROLES = new Set(["melody"]);
const PRIORITY_RANK: Record<MelodyReviewUnit["priority"], number> = { high: 3, medium: 2, low: 1 };
const STATE_RANK: Record<MelodyReviewUnit["state"], number> = { BROKEN: 2, REVIEW: 1 };
const DECISIONS = new Set<MelodyReviewDecision>(["pending", "accepted", "rejected", "corrected", "skipped"]);
const COMPLETED = new Set<Exclude<MelodyReviewDecision, "pending">>(["accepted", "rejected", "corrected", "skipped"]);

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: unknown): number | null {
  return finite(value) && Number.isInteger(value) ? value : null;
}

function number(value: unknown): number | null {
  return finite(value) ? value : null;
}

function rounded(value: number, digits = 6): number {
  const factor = 10 ** digits;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function redact(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/(?:file:\/\/)?(?:\/(?:Users|private|tmp|var|home|Volumes|root|opt|mnt|workspace|data|srv|etc)\/[^\s"'<>;,)]*|[A-Za-z]:[\\/][^\s"'<>;,)]*)/gi, "[redacted-path]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function text(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return redact(value) || fallback;
}

function id(value: unknown, fallback: string): string {
  const cleaned = text(value, fallback).replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160);
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : fallback;
}

function hash(value: unknown): string | null {
  return typeof value === "string" && HASH.test(value) ? value.toLowerCase() : null;
}

function stable(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as RecordValue)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => compare(left, right))
    .map(([key, item]) => [key, stable(item)]));
}

function naturalCompare(left: string, right: string): number {
  const leftMatch = /(\d+)(?:\D*)$/.exec(left);
  const rightMatch = /(\d+)(?:\D*)$/.exec(right);
  if (leftMatch && rightMatch) {
    const numeric = Number(leftMatch[1]) - Number(rightMatch[1]);
    if (numeric !== 0) return numeric;
  }
  return compare(left, right);
}

function uniqueSorted(values: readonly string[], comparator = compare): string[] {
  return [...new Set(values.filter(Boolean))].sort(comparator);
}

function scoreRows(input: unknown): RecordValue[] {
  const source = record(input);
  const values = array(source.scores);
  if (values.length) return values.map(record).filter((row) => Object.keys(row).length > 0);
  const single = record(source.score);
  return Object.keys(single).length ? [single] : [];
}

function sourceHash(score: RecordValue): string | null {
  const source = record(score.source);
  const pdf = record(source.pdf);
  const native = record(score.nativeMatch);
  return hash(score.scoreHash) ?? hash(score.sourceHash) ?? hash(pdf.sha256) ?? hash(source.sha256)
    ?? hash(native.sha256) ?? hash(record(native.artifact).sha256);
}

function reasonCategory(value: unknown): string {
  const raw = typeof value === "string" ? value.toLowerCase() : "unknown";
  if (raw.includes("pitch") || raw.includes("leap") || raw.includes("melody")) return "pitch";
  if (raw.includes("rhythm") || raw.includes("timing") || raw.includes("onset") || raw.includes("duration") || raw.includes("density")) return "timing";
  if (raw.includes("continuity") || raw.includes("tie") || raw.includes("overlap") || raw.includes("gap")) return "continuity";
  if (raw.includes("notation") || raw.includes("clef") || raw.includes("staff") || raw.includes("voice")) return "notation";
  if (raw.includes("structure") || raw.includes("measure") || raw.includes("unmatched") || raw.includes("invalid")) return "structure";
  return "other";
}

function role(value: unknown): string | null {
  return typeof value === "string" && ROLES.has(value.toLowerCase()) ? "melody" : null;
}

function priority(value: unknown): MelodyReviewUnit["priority"] {
  return value === "high" ? "high" : value === "low" ? "low" : "medium";
}

function state(value: unknown): MelodyReviewUnit["state"] {
  return value === "BROKEN" || value === "FAILED" ? "BROKEN" : "REVIEW";
}

function decision(value: unknown): MelodyReviewDecision {
  if (value === "accept" || value === "approved" || value === "accepted") return "accepted";
  if (value === "reject" || value === "rejected") return "rejected";
  if (value === "correct" || value === "corrected") return "corrected";
  if (value === "skip" || value === "skipped") return "skipped";
  return "pending";
}

function confidence(value: unknown): MelodyReviewUnit["confidence"] {
  const candidate = record(value);
  if (!finite(candidate.min) || !finite(candidate.median) || !finite(candidate.max)) return null;
  return { min: rounded(Math.max(0, Math.min(1, candidate.min))), median: rounded(Math.max(0, Math.min(1, candidate.median))), max: rounded(Math.max(0, Math.min(1, candidate.max))) };
}

/** Find only review projections; arbitrary note/event arrays are never traversed. */
function reviewCandidates(score: RecordValue): RecordValue[] {
  const candidates: RecordValue[] = [];
  const review = record(score.review);
  const quality = record(score.quality);
  const omr = record(score.omr);
  const roleQuality = record(omr.roleQuality);
  for (const value of array(review.regions)) candidates.push(record(value));
  for (const value of array(review.roleGroups)) candidates.push(record(value));
  for (const value of array(review.items)) candidates.push(record(value));
  for (const value of array(record(score.reviewQueue).items)) candidates.push(record(value));
  for (const value of array(roleQuality.reviewGroups)) candidates.push(record(value));
  // A quality row is a useful fallback projection only when it declares the
  // melody role and a review/broken state. Do not inspect its events.
  for (const value of array(quality.measures)) {
    const row = record(value);
    if (role(row.role) && (row.state === "REVIEW" || row.state === "BROKEN")) candidates.push(row);
  }
  return candidates.filter((candidate) => Object.keys(candidate).length > 0);
}

function extractMeasureIds(candidate: RecordValue): string[] {
  const values = array(candidate.measureIds);
  const one = candidate.measureId;
  return uniqueSorted([...values, one].map((value) => id(value, "")).filter(Boolean), naturalCompare);
}

function extractEventIds(candidate: RecordValue): string[] {
  // Event IDs are identifiers only; no note fields are accepted or copied.
  return uniqueSorted(array(candidate.eventIds).filter((value): value is string => typeof value === "string").map((value) => id(value, "")));
}

function candidatesForScore(score: RecordValue, scoreIndex: number): MelodyReviewUnit[] {
  const scoreId = id(score.id ?? score.scoreId, `score-${scoreIndex + 1}`);
  const artist = text(score.artist, "Unknown artist");
  const title = text(score.title, scoreId);
  const scoreHash = sourceHash(score);
  const merged = new Map<string, MelodyReviewUnit>();
  for (const candidate of reviewCandidates(score)) {
    if (role(candidate.role) !== "melody") continue;
    const measures = extractMeasureIds(candidate);
    const groupId = id(candidate.groupId ?? candidate.id, `${scoreId}:melody:${measures.join("+") || "unknown"}`);
    const backend = `${id(candidate.backendId, "backend")}\u0000${text(candidate.backendVersion, "unknown")}`;
    const key = `${scoreId}\u0000${backend}\u0000${measures.join("+") || groupId}`;
    const reasons = uniqueSorted([
      ...array(candidate.reasonCategories),
      candidate.reasonCategory,
      ...array(candidate.rootCauses),
      ...array(candidate.reasons),
      ...array(candidate.evidence),
      ...array(candidate.diagnostics),
    ].filter((value): value is string => typeof value === "string" && value.length > 0).map(reasonCategory));
    const evidence = uniqueSorted([
      ...array(candidate.evidence),
      ...array(candidate.diagnostics),
      ...array(candidate.reasons),
      ...array(candidate.rootCauses),
    ].map((value) => text(value)).filter(Boolean));
    const rawDecision = decision(candidate.decision ?? candidate.outcome ?? candidate.verdict ?? candidate.action);
    const stateValue = state(candidate.state);
    const confidenceValue = confidence(candidate.confidence);
    const priorityValue = priority(candidate.priorityClass ?? candidate.priority);
    const measureCount = Math.max(1, measures.length);
    const eventCount = integer(candidate.estimatedEventCount);
    const confidenceScore = confidenceValue?.median ?? (evidence.length ? Math.min(0.6, 0.2 + evidence.length * 0.1) : 0);
    const evidenceScore = rounded(Math.max(0, Math.min(1, 0.4 + confidenceScore * 0.45 + Math.min(0.15, evidence.length * 0.03) + (stateValue === "BROKEN" ? 0.1 : 0))));
    const unlockValue = rounded(Math.max(0, Math.min(1, 0.45 + PRIORITY_RANK[priorityValue] * 0.12 + Math.min(0.2, (measureCount - 1) * 0.04) + Math.min(0.12, (eventCount ?? 0) * 0.02) + (stateValue === "BROKEN" ? 0.08 : 0))));
    const humanCost = rounded(Math.max(1, 0.8 + measureCount * 0.65 + (eventCount ?? 0) * 0.08));
    const rankScore = rounded(unlockValue * 100 + evidenceScore * 30 + PRIORITY_RANK[priorityValue] * 3 + STATE_RANK[stateValue] - humanCost * 2);
    const item: MelodyReviewUnit = {
      id: id(candidate.id, `${scoreId}:melody:${measures.join("+") || "unknown"}:${reasons[0] ?? "other"}`),
      scoreId, artist, title, scoreHash, role: "melody", groupId,
      measureIds: measures, eventIds: extractEventIds(candidate),
      firstMeasureIndex: integer(candidate.firstMeasureIndex), lastMeasureIndex: integer(candidate.lastMeasureIndex),
      startBeat: number(candidate.startBeat), endBeat: number(candidate.endBeat),
      reasonCategories: reasons.length ? reasons : ["other"], evidence,
      priority: priorityValue, state: stateValue, decision: rawDecision,
      confidence: confidenceValue, estimatedEventCount: eventCount,
      unlockValue, humanCost, evidenceScore, rankScore,
    };
    const prior = merged.get(key);
    if (!prior) merged.set(key, item);
    else {
      prior.measureIds = uniqueSorted([...prior.measureIds, ...item.measureIds], naturalCompare);
      prior.eventIds = uniqueSorted([...prior.eventIds, ...item.eventIds]);
      prior.reasonCategories = uniqueSorted([...prior.reasonCategories, ...item.reasonCategories]);
      prior.evidence = uniqueSorted([...prior.evidence, ...item.evidence]);
      if (PRIORITY_RANK[item.priority] > PRIORITY_RANK[prior.priority]) prior.priority = item.priority;
      if (STATE_RANK[item.state] > STATE_RANK[prior.state]) prior.state = item.state;
      if (prior.decision === "pending" && item.decision !== "pending") prior.decision = item.decision;
      if (prior.firstMeasureIndex === null || (item.firstMeasureIndex !== null && item.firstMeasureIndex < prior.firstMeasureIndex)) prior.firstMeasureIndex = item.firstMeasureIndex;
      if (prior.lastMeasureIndex === null || (item.lastMeasureIndex !== null && item.lastMeasureIndex > prior.lastMeasureIndex)) prior.lastMeasureIndex = item.lastMeasureIndex;
      if (prior.startBeat === null || (item.startBeat !== null && item.startBeat < prior.startBeat)) prior.startBeat = item.startBeat;
      if (prior.endBeat === null || (item.endBeat !== null && item.endBeat > prior.endBeat)) prior.endBeat = item.endBeat;
      if (prior.confidence === null) prior.confidence = item.confidence;
      prior.estimatedEventCount = Math.max(prior.estimatedEventCount ?? 0, item.estimatedEventCount ?? 0) || null;
      prior.evidenceScore = Math.max(prior.evidenceScore, item.evidenceScore);
      prior.unlockValue = Math.max(prior.unlockValue, item.unlockValue);
      prior.humanCost = Math.max(prior.humanCost, item.humanCost);
      prior.rankScore = rounded(prior.unlockValue * 100 + prior.evidenceScore * 30 + PRIORITY_RANK[prior.priority] * 3 + STATE_RANK[prior.state] - prior.humanCost * 2);
    }
  }
  return [...merged.values()].map((item) => ({ ...item, id: item.id.replace(/^score-\d+:/, `${scoreId}:`) })).sort(compareUnits);
}

function compareUnits(left: MelodyReviewUnit, right: MelodyReviewUnit): number {
  return right.rankScore - left.rankScore || right.unlockValue - left.unlockValue || right.evidenceScore - left.evidenceScore
    || PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority] || compare(left.scoreId, right.scoreId)
    || (left.firstMeasureIndex ?? Number.MAX_SAFE_INTEGER) - (right.firstMeasureIndex ?? Number.MAX_SAFE_INTEGER)
    || compare(left.id, right.id) || compare(left.groupId, right.groupId);
}

function cloneUnit(unit: MelodyReviewUnit): MelodyReviewUnit {
  return JSON.parse(JSON.stringify(unit)) as MelodyReviewUnit;
}

/** Build the deterministic bounded queue. */
export function buildMelodyReviewPack(input: MelodyReviewInput | unknown = {}): MelodyReviewPack {
  const rows = scoreRows(input);
  const allScores = rows.map((score, index) => ({
    id: id(score.id ?? score.scoreId, `score-${index + 1}`),
    artist: text(score.artist, "Unknown artist"), title: text(score.title, "Untitled"), scoreHash: sourceHash(score),
    units: candidatesForScore(score, index),
  })).sort((left, right) => compare(left.id, right.id));
  const allUnits = allScores.flatMap((score) => score.units).filter((unit) => unit.decision === "pending").sort(compareUnits);
  const resolved = allScores.flatMap((score) => score.units.filter((unit) => unit.decision !== "pending").map((unit) => ({ scoreId: unit.scoreId, unitId: unit.id, groupId: unit.groupId, decision: unit.decision as Exclude<MelodyReviewDecision, "pending"> }))).sort((left, right) => compare(`${left.scoreId}\u0000${left.unitId}`, `${right.scoreId}\u0000${right.unitId}`));
  const byScore = new Map<string, MelodyReviewUnit[]>();
  for (const unit of allUnits) byScore.set(unit.scoreId, [...(byScore.get(unit.scoreId) ?? []), unit]);
  const scoreRanking = [...byScore.entries()].map(([scoreId, units]) => ({ scoreId, units, best: units[0]!, total: units.reduce((sum, unit) => sum + unit.rankScore, 0) })).sort((left, right) => compareUnits(left.best, right.best) || right.total - left.total || compare(left.scoreId, right.scoreId));
  const selectedScoreIds = scoreRanking.slice(0, Math.min(3, scoreRanking.length)).map((entry) => entry.scoreId);
  const selectedPool = selectedScoreIds.flatMap((scoreId) => {
    const units = allUnits.filter((unit) => unit.scoreId === scoreId);
    return units.length ? [units[0]!, ...units.slice(1)] : [];
  });
  // Seed each represented score before filling by global rank so a sufficiently
  // large bootstrap set is genuinely multi-score, rather than twenty rows
  // from the first score in a tie.
  const seeds = selectedScoreIds.map((scoreId) => selectedPool.find((unit) => unit.scoreId === scoreId)).filter((unit): unit is MelodyReviewUnit => Boolean(unit));
  const remainingPool = selectedPool.filter((unit) => !seeds.some((seed) => seed.id === unit.id && seed.scoreId === unit.scoreId)).sort(compareUnits);
  const target = Math.min(20, selectedPool.length);
  const decisions = [...seeds, ...remainingPool].slice(0, target).sort(compareUnits).map(cloneUnit);
  const selectedKeys = new Set(decisions.map((unit) => `${unit.scoreId}\u0000${unit.id}`));
  const deferred = allUnits.filter((unit) => !selectedKeys.has(`${unit.scoreId}\u0000${unit.id}`)).map(cloneUnit);
  const candidateScores = byScore.size;
  const status: MelodyReviewPackStatus = !rows.length || !allUnits.length ? "UNAVAILABLE" : allUnits.length < 10 ? "PARTIAL" : "READY";
  const scores = allScores.map(({ units, ...score }) => ({ ...score, candidateUnits: units.length }));
  const nonClaims = [
    "This is a local review queue only; it does not read, copy, publish, or commit source scores or raw notes.",
    "Automated OMR/readiness evidence is not a human decision about pitch, recognizability, or playability.",
    "A bootstrap queue may contain fewer than 10 decisions when fewer unresolved melody units are available.",
    "Correction-ledger values are references for a separate local application seam, not source-note data.",
  ];
  return JSON.parse(JSON.stringify(stable({
    schemaVersion: MELODY_REVIEW_PACK_SCHEMA_VERSION, kind: "melody-review-pack", status, scores,
    bootstrap: { target, maximum: 20, scoreIds: selectedScoreIds, decisions }, deferred, resolved,
    summary: {
      scoreCount: rows.length, candidateScores, candidateUnits: allUnits.length + resolved.length,
      bootstrapUnits: decisions.length, deferredUnits: deferred.length, resolvedUnits: resolved.length,
      sourceHashesAvailable: scores.filter((score) => score.scoreHash !== null).length, humanDecisions: resolved.length,
    }, nonClaims,
  }))) as MelodyReviewPack;
}

export function canonicalMelodyReviewPackJson(pack: MelodyReviewPack): string {
  return `${JSON.stringify(stable(pack), null, 2)}\n`;
}

function markdownCell(value: unknown): string {
  return text(value, "").replace(/\|/g, "\\|") || "—";
}

export function melodyReviewPackMarkdown(pack: MelodyReviewPack): string {
  const lines = [
    "# Melody review bootstrap",
    "",
    "Local-only, path-redacted review planning. This artifact contains review metadata and identifiers only; it does not contain source notes.",
    "",
    `- Status: **${pack.status}**`,
    `- Bootstrap decisions: ${pack.bootstrap.decisions.length} (maximum ${pack.bootstrap.maximum})`,
    `- Scores represented: ${pack.bootstrap.scoreIds.length || "none"}`,
    "",
    "## Bootstrap decisions",
    "",
    "| # | Score | Unit | Measures | Reasons | Evidence | Rank | Cost |",
    "| ---: | --- | --- | --- | --- | --- | ---: | ---: |",
  ];
  pack.bootstrap.decisions.forEach((unit, index) => lines.push(`| ${index + 1} | ${markdownCell(unit.artist)} — ${markdownCell(unit.title)} | ${markdownCell(unit.id)} | ${markdownCell(unit.measureIds.join(", "))} | ${markdownCell(unit.reasonCategories.join(", "))} | ${markdownCell(unit.evidence.join("; "))} | ${unit.rankScore} | ${unit.humanCost} |`));
  if (!pack.bootstrap.decisions.length) lines.push("| — | No unresolved melody review units available | — | — | — | — | — | — |");
  lines.push("", "## Deferred review units", "", `Deferred unresolved units: ${pack.deferred.length}`, "");
  for (const unit of pack.deferred) lines.push(`- ${markdownCell(unit.scoreId)} / ${markdownCell(unit.id)} (${markdownCell(unit.reasonCategories.join(", "))})`);
  if (!pack.deferred.length) lines.push("- None.");
  lines.push("", "## Boundaries", "", ...pack.nonClaims.map((claim) => `- ${claim}`), "");
  return lines.join("\n");
}

function htmlEscape(value: unknown): string {
  return markdownCell(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function melodyReviewPackHtml(pack: MelodyReviewPack): string {
  const rows = pack.bootstrap.decisions.map((unit, index) => `<tr><td>${index + 1}</td><td>${htmlEscape(`${unit.artist} — ${unit.title}`)}</td><td>${htmlEscape(unit.id)}</td><td>${htmlEscape(unit.measureIds.join(", "))}</td><td>${htmlEscape(unit.reasonCategories.join(", "))}</td><td>${unit.rankScore}</td></tr>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>Melody review bootstrap</title><h1>Melody review bootstrap</h1><p>Status: <strong>${htmlEscape(pack.status)}</strong>. Decisions: ${pack.bootstrap.decisions.length}.</p><table><thead><tr><th>#</th><th>Score</th><th>Unit</th><th>Measures</th><th>Reasons</th><th>Rank</th></tr></thead><tbody>${rows || "<tr><td colspan=6>No unresolved melody review units available.</td></tr>"}</tbody></table>`;
}

function normalizeLedgerEntry(value: unknown, index: number): MelodyCorrectionLedgerEntry | null {
  const row = record(value);
  const scoreId = id(row.scoreId, "");
  const scoreHash = hash(row.scoreHash);
  const decisionValue = row.decision as unknown;
  const rationale = text(row.rationale, "");
  const corrected = record(row.correctedValues ?? row.corrected);
  if (Object.keys(corrected).some((key) => !["pitch", "onset", "duration", "role"].includes(key))) return null;
  if (!scoreId || !scoreHash || !COMPLETED.has(decisionValue as Exclude<MelodyReviewDecision, "pending">) || !rationale) return null;
  const correctedValues: MelodyCorrectionValues = {};
  if (corrected.pitch !== undefined) correctedValues.pitch = corrected.pitch as number;
  if (corrected.onset !== undefined) correctedValues.onset = corrected.onset as number;
  if (corrected.duration !== undefined) correctedValues.duration = corrected.duration as number;
  if (corrected.role !== undefined) correctedValues.role = corrected.role as "melody";
  const eventIds = row.eventIds === undefined ? undefined : uniqueSorted(array(row.eventIds).filter((item): item is string => typeof item === "string").map((item) => id(item, "")));
  return {
    id: id(row.id, `ledger-${index + 1}`), scoreId, scoreHash,
    ...(row.groupId !== undefined ? { groupId: id(row.groupId, "") } : {}),
    ...(row.unitId !== undefined ? { unitId: id(row.unitId, "") } : {}),
    ...(eventIds !== undefined ? { eventIds } : {}),
    decision: decisionValue as MelodyCorrectionLedgerEntry["decision"], rationale, correctedValues,
  };
}

/** Validate and normalize a private correction ledger without touching notes. */
export function validateMelodyCorrectionLedger(value: unknown): MelodyCorrectionLedgerValidation {
  const row = record(value);
  const errors: string[] = [];
  if (row.schemaVersion !== MELODY_CORRECTION_LEDGER_SCHEMA_VERSION) errors.push("unsupported ledger schema version");
  if (row.kind !== "melody-correction-ledger") errors.push("ledger kind must be melody-correction-ledger");
  if (!Array.isArray(row.entries)) errors.push("ledger entries must be an array");
  const entries = Array.isArray(row.entries) ? row.entries.map(normalizeLedgerEntry).filter((entry): entry is MelodyCorrectionLedgerEntry => entry !== null) : [];
  if (Array.isArray(row.entries) && entries.length !== row.entries.length) errors.push("one or more ledger entries are malformed");
  const seen = new Map<string, MelodyCorrectionLedgerEntry>();
  for (const entry of entries) {
    if (!entry.groupId && !entry.unitId) errors.push(`${entry.id}: groupId or unitId is required`);
    if (entry.decision === "corrected" && Object.keys(entry.correctedValues).length === 0) errors.push(`${entry.id}: correctedValues are required for corrected decisions`);
    if (entry.decision !== "corrected" && Object.keys(entry.correctedValues).length > 0) errors.push(`${entry.id}: correctedValues require corrected decision`);
    for (const [key, item] of Object.entries(entry.correctedValues)) {
      if (key === "pitch" && (!finite(item) || !Number.isInteger(item) || item < 0 || item > 127)) errors.push(`${entry.id}: pitch must be an integer from 0 to 127`);
      if (key === "onset" && (!finite(item) || item < 0)) errors.push(`${entry.id}: onset must be finite and non-negative`);
      if (key === "duration" && (!finite(item) || item <= 0)) errors.push(`${entry.id}: duration must be finite and positive`);
      if (key === "role" && item !== "melody") errors.push(`${entry.id}: role must be melody`);
    }
    if (entry.eventIds !== undefined && entry.eventIds.length === 0) errors.push(`${entry.id}: eventIds cannot be empty`);
    const target = `${entry.scoreId}\u0000${entry.groupId ?? entry.unitId}`;
    const prior = seen.get(target);
    if (prior && JSON.stringify(prior) !== JSON.stringify(entry)) errors.push(`${entry.id}: conflicting duplicate target`);
    seen.set(target, entry);
  }
  if (errors.length) return { valid: false, errors: uniqueSorted(errors), ledger: null };
  const ledger: MelodyCorrectionLedger = {
    schemaVersion: MELODY_CORRECTION_LEDGER_SCHEMA_VERSION, kind: "melody-correction-ledger",
    entries: entries.sort((left, right) => compare(`${left.scoreId}\u0000${left.groupId ?? left.unitId}`, `${right.scoreId}\u0000${right.groupId ?? right.unitId}`)),
    nonClaims: ["This ledger records explicit local review decisions only; it contains no source-note arrays and does not itself apply corrections to catalog data."],
  };
  return { valid: true, errors: [], ledger };
}

/** Apply decisions to the path-free planner projection; stale hashes fail closed. */
export function applyMelodyCorrectionLedger(pack: MelodyReviewPack, value: unknown): MelodyReviewPack {
  const validation = validateMelodyCorrectionLedger(value);
  if (!validation.valid || !validation.ledger) throw new Error(`invalid correction ledger: ${validation.errors.join("; ")}`);
  const units = [...pack.bootstrap.decisions, ...pack.deferred];
  const byTarget = new Map<string, MelodyReviewUnit>();
  for (const unit of units) {
    byTarget.set(`${unit.scoreId}\u0000${unit.id}`, unit);
    byTarget.set(`${unit.scoreId}\u0000${unit.groupId}`, unit);
  }
  const resolvedByTarget = new Map<string, { scoreHash: string | null; decision: Exclude<MelodyReviewDecision, "pending"> }>();
  for (const resolved of pack.resolved) {
    const score = pack.scores.find((candidate) => candidate.id === resolved.scoreId);
    const resolvedValue = { scoreHash: score?.scoreHash ?? null, decision: resolved.decision };
    resolvedByTarget.set(`${resolved.scoreId}\u0000${resolved.unitId}`, resolvedValue);
    if (resolved.groupId) resolvedByTarget.set(`${resolved.scoreId}\u0000${resolved.groupId}`, resolvedValue);
  }
  const updated = new Map<string, MelodyReviewDecision>();
  for (const entry of validation.ledger.entries) {
    const unit = byTarget.get(`${entry.scoreId}\u0000${entry.unitId ?? entry.groupId}`);
    if (!unit) {
      const resolved = resolvedByTarget.get(`${entry.scoreId}\u0000${entry.unitId ?? entry.groupId}`);
      if (!resolved) throw new Error(`correction ledger target is not in the review pack: ${entry.scoreId}`);
      if (!resolved.scoreHash || resolved.scoreHash !== entry.scoreHash) throw new Error(`stale score hash for ${entry.scoreId}`);
      if (resolved.decision !== entry.decision) throw new Error(`conflicting correction decision for ${entry.scoreId}`);
      continue;
    }
    if (!unit.scoreHash || unit.scoreHash !== entry.scoreHash) throw new Error(`stale score hash for ${entry.scoreId}`);
    if (entry.eventIds !== undefined && (!unit.eventIds.length || entry.eventIds.some((eventId) => !unit.eventIds.includes(eventId)))) throw new Error(`correction ledger event IDs do not match ${unit.id}`);
    const key = `${unit.scoreId}\u0000${unit.id}`;
    const prior = updated.get(key);
    if (prior && prior !== entry.decision) throw new Error(`conflicting correction decision for ${unit.id}`);
    if (unit.decision !== "pending" && unit.decision !== entry.decision) throw new Error(`conflicting correction decision for ${unit.id}`);
    updated.set(key, entry.decision);
  }
  const clone = JSON.parse(JSON.stringify(pack)) as MelodyReviewPack;
  for (const list of [clone.bootstrap.decisions, clone.deferred]) for (const unit of list) {
    const next = updated.get(`${unit.scoreId}\u0000${unit.id}`);
    if (next) unit.decision = next;
  }
  const applied = [...clone.bootstrap.decisions, ...clone.deferred];
  clone.bootstrap.decisions = applied.filter((unit) => unit.decision === "pending").slice(0, clone.bootstrap.maximum);
  const selected = new Set(clone.bootstrap.decisions.map((unit) => `${unit.scoreId}\u0000${unit.id}`));
  clone.deferred = applied.filter((unit) => unit.decision === "pending" && !selected.has(`${unit.scoreId}\u0000${unit.id}`));
  clone.resolved = [...clone.resolved, ...applied.filter((unit) => unit.decision !== "pending").map((unit) => ({ scoreId: unit.scoreId, unitId: unit.id, groupId: unit.groupId, decision: unit.decision as Exclude<MelodyReviewDecision, "pending"> }))]
    .filter((item, index, all) => all.findIndex((candidate) => candidate.scoreId === item.scoreId && candidate.unitId === item.unitId) === index)
    .sort((left, right) => compare(`${left.scoreId}\u0000${left.unitId}`, `${right.scoreId}\u0000${right.unitId}`));
  clone.summary.bootstrapUnits = clone.bootstrap.decisions.length;
  clone.summary.deferredUnits = clone.deferred.length;
  clone.summary.resolvedUnits = clone.resolved.length;
  clone.summary.humanDecisions = clone.resolved.length;
  clone.status = clone.summary.bootstrapUnits + clone.summary.deferredUnits ? (clone.summary.bootstrapUnits + clone.summary.deferredUnits < 10 ? "PARTIAL" : "READY") : "UNAVAILABLE";
  return JSON.parse(JSON.stringify(stable(clone))) as MelodyReviewPack;
}

// Short aliases for local callers that use the generic ledger terminology.
export const validateCorrectionLedger = validateMelodyCorrectionLedger;
export const applyCorrectionLedger = applyMelodyCorrectionLedger;
export const planMelodyReview = buildMelodyReviewPack;
export const melodyReviewMarkdown = melodyReviewPackMarkdown;
export const melodyReviewHtml = melodyReviewPackHtml;
