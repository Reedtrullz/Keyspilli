import type { OmrConsensusReport, OmrDisagreementKind, OmrRole } from "./omr-consensus.js";

export const OMR_REVIEW_QUEUE_SCHEMA_VERSION = 1 as const;
export const OMR_REVIEW_QUEUE_NON_CLAIM = "This queue is not automatic musical pitch correction.";
export type OmrQueueRole = OmrRole | "unknown";
export type OmrQueueState = "AUTO_ACCEPT" | "LIKELY_OK" | "REVIEW" | "BROKEN";

export interface OmrReviewQueueItem {
  id: string;
  scoreId: string;
  page: number | null;
  system: number | null;
  measureId: string;
  measureNumber: string;
  role: OmrQueueRole;
  reasonCategory: string;
  state: OmrQueueState;
  priorityClass: "high" | "medium" | "low";
  backendValues: Record<string, string[]>;
  backendInterpretations: Record<string, string[]>;
  context: { keySignature: number | null; timeSignature: [number, number] | null; startBeat: number; durationBeats: number; structural: { agreement: number | null; evidence: string[] } };
  evidence: string[];
  recommendedAction: string;
}

export interface OmrReviewQueue {
  schemaVersion: typeof OMR_REVIEW_QUEUE_SCHEMA_VERSION;
  scoreId: string;
  items: OmrReviewQueueItem[];
  unresolvedRegions: string[];
  nonClaims: string[];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function string(value: unknown, fallback = ""): string { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/** Remove URLs and absolute filesystem paths before values become identifiers or evidence. */
function safeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/https?:\/\/[^\s,;]+/gi, "[redacted-url]")
    .replace(/file:\/\/[^\s,;]+/gi, "[redacted-path]")
    .replace(/(^|[\s"'= (])(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/))[^\s,;]*/g, "$1[redacted-path]")
    .slice(0, 500);
}
function identifier(value: unknown, fallback = "unknown"): string {
  const safe = safeText(value);
  return safe.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 120) || fallback;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as UnknownRecord).sort(compare).map((key) => [key, stable((value as UnknownRecord)[key])]));
}
function scoreId(input: UnknownRecord): string {
  const metadata = record(input.metadata);
  return identifier(string(input.scoreId) || string(metadata.scoreId) || "omr-score", "omr-score");
}
function role(value: unknown): OmrQueueRole { return value === "melody" || value === "harmony" || value === "rhythm" ? value : "unknown"; }
function state(value: unknown): OmrQueueState {
  if (value === "BROKEN" || value === "FAILED") return "BROKEN";
  if (value === "REVIEW" || value === "REVIEW_REQUIRED") return "REVIEW";
  if (value === "LIKELY_OK") return "LIKELY_OK";
  if (value === "AUTO_ACCEPT" || value === "TRUSTED_NATIVE" || value === "TRUSTED_CONSENSUS" || value === "TRUSTED_SINGLE_ENGINE") return "AUTO_ACCEPT";
  return "BROKEN";
}
function worseState(left: OmrQueueState, right: OmrQueueState): OmrQueueState {
  const rank: Record<OmrQueueState, number> = { AUTO_ACCEPT: 0, LIKELY_OK: 1, REVIEW: 2, BROKEN: 3 };
  return rank[left] >= rank[right] ? left : right;
}
function category(kind: unknown, detail: string): string {
  const text = `${String(kind ?? "")} ${detail}`.toLowerCase();
  if (text.includes("structure") || text.includes("unmatched") || text.includes("underfull") || text.includes("overfull") || text.includes("missing-measure")) return "structure";
  if (text.includes("clef")) return "clef";
  if (text.includes("chord") || text.includes("root")) return "chord-root";
  if (text.includes("impossible-leap") || text.includes("pitch") || text.includes("melody") || text.includes("harmony")) return "pitch";
  if (text.includes("timing") || text.includes("onset") || text.includes("duration") || text.includes("rhythm") || text.includes("density")) return "timing";
  if (text.includes("articulation") || text.includes("tie") || text.includes("continuity")) return "articulation";
  return "unknown";
}
function priority(itemRole: OmrQueueRole, reason: string): "high" | "medium" | "low" {
  if (itemRole === "melody" && ["pitch", "timing", "clef", "chord-root"].includes(reason)) return "high";
  if (itemRole === "harmony") return "medium";
  if (itemRole === "rhythm") return "low";
  return reason === "structure" ? "high" : "medium";
}
function action(itemRole: OmrQueueRole, reason: string): string {
  if (reason === "structure") return "Inspect the measure layout and reconcile structural disagreement across backends.";
  if (itemRole === "melody") return "Human-review melody notation and compare backend readings before editing.";
  if (itemRole === "harmony") return "Human-review harmony/chord interpretation against the source notation.";
  if (itemRole === "rhythm") return "Human-review rhythm and articulation against the source notation.";
  return "Human-review this unresolved region; role assignment is intentionally unknown.";
}
function timeSignature(value: unknown): [number, number] | null {
  return Array.isArray(value) && value.length === 2 && value.every(finite) ? [value[0]!, value[1]!] : null;
}
function textValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(safeText).filter(Boolean);
  const text = safeText(value);
  return text ? [text] : [];
}
function addValues(target: Record<string, string[]>, backend: unknown, values: unknown): void {
  const safeValues = textValues(values);
  if (!safeValues.length) return;
  const key = identifier(backend);
  target[key] = [...(target[key] ?? []), ...safeValues];
}
function addRecordValues(target: Record<string, string[]>, value: unknown): void {
  for (const [backend, values] of Object.entries(record(value))) addValues(target, backend, values);
}
function detailOf(row: UnknownRecord): string { return safeText(row.detail ?? row.reason ?? row.diagnostic ?? ""); }
function issueRows(measure: UnknownRecord): UnknownRecord[] {
  const agreement = record(measure.agreement);
  const disagreements = Array.isArray(agreement.disagreements) ? agreement.disagreements.map(record).filter((entry) => Object.keys(entry).length > 0) : [];
  if (disagreements.length) return disagreements;
  const reasons = Array.isArray(measure.reviewReasons) ? measure.reviewReasons.map((detail) => ({ kind: "unknown", detail })) : [];
  if (reasons.length) return reasons;
  const diagnostics = Array.isArray(measure.diagnostics) ? measure.diagnostics.map((detail) => ({ kind: detail, detail })) : [];
  if (diagnostics.length) return diagnostics;
  const flags: UnknownRecord[] = [];
  for (const [name, value] of Object.entries(record(measure.categories))) {
    for (const flag of textValues(record(value).flags)) flags.push({ kind: name, detail: flag });
  }
  return flags;
}
function backendData(row: UnknownRecord, measure: UnknownRecord): { values: Record<string, string[]>; interpretations: Record<string, string[]> } {
  const values: Record<string, string[]> = {};
  const interpretations: Record<string, string[]> = {};
  addRecordValues(values, row.backendValues);
  addRecordValues(interpretations, row.backendInterpretations);
  const backendA = row.backendA ?? row.sourceA ?? row.engineA;
  const backendB = row.backendB ?? row.sourceB ?? row.engineB;
  addValues(values, backendA, row.valueA ?? row.notesA ?? row.readingA);
  addValues(values, backendB, row.valueB ?? row.notesB ?? row.readingB);
  addValues(interpretations, backendA, row.interpretationA);
  addValues(interpretations, backendB, row.interpretationB);
  const backend = row.backend ?? row.source ?? measure.source ?? measure.sourceLabel ?? measure.backendId ?? "unknown";
  if (!Object.keys(values).length) addValues(values, backend, detailOf(row));
  if (!Object.keys(interpretations).length) addValues(interpretations, backend, row.interpretation);
  return { values, interpretations };
}

interface MeasureGroup {
  id: string; page: number | null; system: number | null; number: string; state: OmrQueueState;
  keySignature: number | null; timeSignature: [number, number] | null; startBeat: number; durationBeats: number;
  structuralAgreement: number | null; structuralEvidence: string[]; issues: UnknownRecord[];
  source: string;
}
function normalizedMeasure(raw: unknown): MeasureGroup | null {
  const measure = record(raw);
  const rawId = string(measure.id) || string(measure.measureId);
  if (!rawId) return null;
  const categories = record(measure.categories);
  const structuralValidity = record(categories.structuralValidity);
  const agreement = record(measure.agreement);
  const issues = issueRows(measure);
  const structuralAgreement = finite(agreement.structural) ? agreement.structural : finite(structuralValidity.score) ? structuralValidity.score : null;
  const structuralEvidence = [...textValues(structuralValidity.flags), ...issues.filter((issue) => category(issue.kind, detailOf(issue)) === "structure").map(detailOf)].filter(Boolean).sort(compare);
  return {
    id: identifier(rawId), page: finite(measure.page) ? measure.page : null, system: finite(measure.system) ? measure.system : null,
    number: string(measure.number) || string(measure.measureNumber, "unknown"), state: state(measure.state),
    keySignature: finite(measure.keySignature) ? measure.keySignature : null, timeSignature: timeSignature(measure.timeSignature),
    startBeat: finite(measure.startBeat) ? measure.startBeat : 0, durationBeats: finite(measure.durationBeats) ? measure.durationBeats : 0,
    structuralAgreement, structuralEvidence, issues, source: string(measure.source) || string(measure.sourceLabel) || string(measure.backendId) || "unknown",
  };
}

/** Build a compact, deterministic human-review queue from consensus or quality-diagnostic input. */
export function buildOmrReviewQueue(input: unknown): OmrReviewQueue {
  const source = record(input);
  const id = scoreId(source);
  const groups = new Map<string, MeasureGroup>();
  for (const raw of Array.isArray(source.measures) ? source.measures : []) {
    const normalized = normalizedMeasure(raw);
    if (!normalized) continue;
    const key = `${normalized.id}\u0000${normalized.page ?? "null"}\u0000${normalized.system ?? "null"}`;
    const existing = groups.get(key);
    if (!existing) groups.set(key, normalized);
    else {
      existing.state = worseState(existing.state, normalized.state); existing.issues.push(...normalized.issues); existing.structuralEvidence.push(...normalized.structuralEvidence);
      if (existing.keySignature === null) existing.keySignature = normalized.keySignature;
      if (existing.timeSignature === null) existing.timeSignature = normalized.timeSignature;
      if (existing.number === "unknown") existing.number = normalized.number;
      if (existing.startBeat === 0) existing.startBeat = normalized.startBeat;
      if (existing.durationBeats === 0) existing.durationBeats = normalized.durationBeats;
      if (existing.structuralAgreement === null) existing.structuralAgreement = normalized.structuralAgreement;
    }
  }
  const items: OmrReviewQueueItem[] = [];
  for (const measure of groups.values()) {
    if (measure.state === "AUTO_ACCEPT" || measure.state === "LIKELY_OK") continue;
    const issueGroups = new Map<string, { role: OmrQueueRole; reason: string; rows: UnknownRecord[] }>();
    for (const issue of measure.issues) {
      const issueRole = role(issue.role); const reason = category(issue.kind, detailOf(issue)); const key = `${issueRole}\u0000${reason}`;
      const group = issueGroups.get(key) ?? { role: issueRole, reason, rows: [] }; group.rows.push(issue); issueGroups.set(key, group);
    }
    if (!issueGroups.size) issueGroups.set("unknown\u0000unknown", { role: "unknown", reason: "unknown", rows: [] });
    for (const group of issueGroups.values()) {
      const backendValues: Record<string, string[]> = {}; const backendInterpretations: Record<string, string[]> = {};
      for (const row of group.rows) {
        const data = backendData(row, measure as unknown as UnknownRecord);
        for (const [backend, values] of Object.entries(data.values)) backendValues[backend] = [...(backendValues[backend] ?? []), ...values];
        for (const [backend, values] of Object.entries(data.interpretations)) backendInterpretations[backend] = [...(backendInterpretations[backend] ?? []), ...values];
      }
      for (const values of Object.values(backendValues)) values.sort(compare);
      for (const values of Object.values(backendInterpretations)) values.sort(compare);
      const evidence = group.rows.map(detailOf).filter(Boolean).sort(compare);
      items.push({
        id: `${id}:${measure.id}:${group.role}:${group.reason}`, scoreId: id, page: measure.page, system: measure.system, measureId: measure.id, measureNumber: measure.number,
        role: group.role, reasonCategory: group.reason, state: measure.state, priorityClass: priority(group.role, group.reason), backendValues, backendInterpretations,
        context: { keySignature: measure.keySignature, timeSignature: measure.timeSignature, startBeat: measure.startBeat, durationBeats: measure.durationBeats, structural: { agreement: measure.structuralAgreement, evidence: [...new Set([...measure.structuralEvidence, ...evidence.filter((entry) => group.reason === "structure")])].sort(compare) } },
        evidence, recommendedAction: action(group.role, group.reason),
      });
    }
  }
  const classRank = { high: 0, medium: 1, low: 2 } as const;
  items.sort((a, b) => classRank[a.priorityClass] - classRank[b.priorityClass] || (a.page ?? -1) - (b.page ?? -1) || (a.system ?? -1) - (b.system ?? -1) || compare(a.measureId, b.measureId) || compare(a.role, b.role) || compare(a.reasonCategory, b.reasonCategory) || compare(JSON.stringify(stable(a)), JSON.stringify(stable(b))));
  return { schemaVersion: OMR_REVIEW_QUEUE_SCHEMA_VERSION, scoreId: id, items, unresolvedRegions: [...new Set(items.map((item) => item.measureId))].sort(compare), nonClaims: [OMR_REVIEW_QUEUE_NON_CLAIM, "Unresolved regions are preserved for human review."] };
}

export function omrReviewQueueJson(queue: OmrReviewQueue): string { return JSON.stringify(stable(queue), null, 2); }
export type { OmrConsensusReport, OmrDisagreementKind };
