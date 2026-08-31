import { createHash } from "node:crypto";
import {
  evaluateArrangement,
  type ArrangementEvaluationReference,
  type ArrangementEvaluationReport,
  type EvaluationWindow,
} from "./arrangement-evaluation.js";
import {
  evaluatePianoCandidates,
  type PianoCandidateEvaluation,
  type PianoEvaluationReport,
} from "./piano-evaluation.js";
import type { Note, ParsedMidi } from "@keyspilli/midi";

/**
 * Local route-comparison contract.  This is intentionally an experiment
 * harness rather than a production import policy.  A/B/C are stable labels so
 * that a rerun can be compared even when their local source filenames differ.
 */
export const ROUTE_FUNNEL_SCHEMA_VERSION = 1 as const;
export const ROUTE_IDS = ["A", "B", "C"] as const;
export type RouteId = (typeof ROUTE_IDS)[number];
export type RouteFunnelMode = "structural" | "reference";

export interface RouteFunnelRouteInput {
  id: RouteId;
  label?: string;
  selector?: string;
  bytes?: Uint8Array;
  parsed?: ParsedMidi;
  notes?: Note[];
  mediaAvailable?: boolean;
  backendAvailable?: boolean;
  unavailableReason?: string;
  expectedSha256?: string;
}

export interface RouteFunnelReferenceInput {
  selector?: string;
  bytes?: Uint8Array;
  parsed?: ParsedMidi;
  notes?: Note[];
  unavailableReason?: string;
}

export interface RouteFunnelInput {
  fixture: { id: string; label?: string };
  routes: readonly RouteFunnelRouteInput[];
  reference?: RouteFunnelReferenceInput;
  windows?: readonly EvaluationWindow[];
  mode?: RouteFunnelMode;
}

export interface RouteFunnelReferenceSummary {
  status: NonNullable<ArrangementEvaluationReport["reference"]>["status"];
  alignmentCoverageBars: number;
  matchedOnsets: number;
  exactPitch: NonNullable<ArrangementEvaluationReport["reference"]>["exactPitch"];
  pitchClass: NonNullable<ArrangementEvaluationReport["reference"]>["pitchClass"];
  diagnostics: string[];
}

export interface RouteFunnelRouteResult {
  id: RouteId;
  label: string;
  inputSha256: string | null;
  status: "available" | "unavailable";
  funnel: {
    input: "pass" | "fail";
    structural: "pass" | "fail";
    reference: "pass" | "review" | "not-requested" | "unavailable";
    disposition: "eligible" | "review-required" | "blocked" | "unavailable";
  };
  structural: {
    gate: ArrangementEvaluationReport["gate"];
    parser: ArrangementEvaluationReport["candidate"]["parser"];
    global: ArrangementEvaluationReport["metrics"]["global"];
    rightHand: ArrangementEvaluationReport["metrics"]["rightHand"];
    leftHand: ArrangementEvaluationReport["metrics"]["leftHand"];
  } | null;
  reference: RouteFunnelReferenceSummary | null;
  piano: {
    status: PianoCandidateEvaluation["status"];
    purity: PianoCandidateEvaluation["purity"];
    metrics: PianoCandidateEvaluation["metrics"];
    rankScore: number | null;
    reference: PianoCandidateEvaluation["reference"];
    diagnostics: string[];
  };
}

export interface RouteFunnelRankingEntry {
  id: RouteId;
  rank: number;
  score: number | null;
  reasons: string[];
}

export interface RouteFunnelReport {
  schemaVersion: typeof ROUTE_FUNNEL_SCHEMA_VERSION;
  kind: "route-funnel-report";
  fixture: { id: string; label?: string };
  mode: RouteFunnelMode;
  referenceStatus: "not-requested" | "available" | "unavailable";
  routes: RouteFunnelRouteResult[];
  ranking: RouteFunnelRankingEntry[];
  coverage: {
    routeCount: number;
    availableCount: number;
    structuralPassCount: number;
    referenceAlignedCount: number;
    eligibleCount: number;
    requiredRouteIds: readonly RouteId[];
    missingRouteIds: RouteId[];
  };
  disclaimer: string;
  determinism: { canonicalSha256: string };
}

function hashBytes(bytes: Uint8Array | undefined): string | null {
  return bytes ? createHash("sha256").update(bytes).digest("hex") : null;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, stable(nested)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(stable(value), null, 2) + "\n";
}

function noPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "unavailable";
  return value.trim()
    .replace(/(?:file:\/\/)?\/(?:Users|private|tmp|var|home|root|opt|mnt|workspace|etc|srv|data|app)(?:\/[^\s"'<>;,)]*)?/gi, "[redacted-path]")
    .replace(/(^|[\s("'=,;\[])(?:\.\.?\/|[^\s/]+\/)[^\s"'<>;,)]*\.(?:mid|midi|json|wav|mp3|xml|mxl)(?=$|[\s"'<>;,\)])/gi, "$1[redacted-path]");
}

function routeIds(routes: readonly RouteFunnelRouteInput[]): { ordered: RouteFunnelRouteInput[]; missing: RouteId[] } {
  const byId = new Map<RouteId, RouteFunnelRouteInput>();
  for (const route of routes) {
    if (!ROUTE_IDS.includes(route.id)) throw new Error(`unsupported route id: ${String(route.id)}`);
    if (byId.has(route.id)) throw new Error(`duplicate route id: ${route.id}`);
    byId.set(route.id, route);
  }
  const missing = ROUTE_IDS.filter((id) => !byId.has(id));
  return { ordered: ROUTE_IDS.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []), missing };
}

function referenceSummary(report: ArrangementEvaluationReport): RouteFunnelReferenceSummary | null {
  const reference = report.reference;
  if (!reference) return null;
  return {
    status: reference.status,
    alignmentCoverageBars: reference.alignmentCoverageBars,
    matchedOnsets: reference.matchedOnsets,
    exactPitch: reference.exactPitch,
    pitchClass: reference.pitchClass,
    diagnostics: [...reference.diagnostics],
  };
}

function routeDisposition(
  status: RouteFunnelRouteResult["status"],
  gate: ArrangementEvaluationReport["gate"] | null,
  referenceStatus: RouteFunnelReferenceSummary["status"] | null,
  hasReference: boolean,
): RouteFunnelRouteResult["funnel"] {
  if (status === "unavailable") return { input: "fail", structural: "fail", reference: hasReference ? "unavailable" : "not-requested", disposition: "unavailable" };
  // In reference mode the shared arrangement oracle reports `null` when
  // alignment coverage is insufficient.  That is a reference-stage review,
  // not a structural failure, provided no structural failures were emitted.
  const structural = gate && (gate.status === "pass" || (gate.status === "null" && gate.failures.length === 0)) ? "pass" : "fail";
  const reference = !hasReference ? "not-requested"
    : referenceStatus === "aligned" ? "pass"
      : referenceStatus === "alignment-required" || referenceStatus === "insufficient-coverage" ? "review"
        : "unavailable";
  const disposition = structural === "fail" ? "blocked"
    : reference === "pass" || reference === "not-requested" ? "eligible" : "review-required";
  return { input: "pass", structural, reference, disposition };
}

function pianoSummary(report: PianoEvaluationReport, id: RouteId): RouteFunnelRouteResult["piano"] {
  const candidate = report.candidates.find((entry) => entry.id === id);
  if (!candidate) {
    return {
      status: "unavailable",
      purity: { classification: "unknown", overlayRisk: "unavailable", pianoNoteRatio: null, nonPianoNoteRatio: null, signals: ["route missing from piano evaluation"] },
      metrics: null,
      rankScore: null,
      reference: null,
      diagnostics: ["route missing from piano evaluation"],
    };
  }
  return {
    status: candidate.status,
    purity: candidate.purity,
    metrics: candidate.metrics,
    rankScore: candidate.rankScore,
    reference: candidate.reference,
    diagnostics: [...candidate.diagnostics],
  };
}

/** Evaluate A/B/C with the existing arrangement and piano oracle formulas. */
export function evaluateRouteFunnel(input: RouteFunnelInput): RouteFunnelReport {
  const { ordered, missing } = routeIds(input.routes);
  const mode = input.mode ?? (input.reference ? "reference" : "structural");
  if (mode === "reference" && !input.reference) throw new Error("reference mode requires a reference input");
  const fixture = {
    id: noPath(input.fixture.id),
    ...(input.fixture.label ? { label: noPath(input.fixture.label) } : {}),
  };
  const hasReference = Boolean(input.reference);
  const referenceAvailable = Boolean(input.reference && !input.reference.unavailableReason
    && (input.reference.bytes || input.reference.parsed || input.reference.notes));
  const referenceCandidate = input.reference ? {
    selector: input.reference.selector ?? "reference",
    ...(input.reference.bytes ? { bytes: input.reference.bytes } : {}),
    ...(input.reference.parsed ? { parsed: input.reference.parsed } : {}),
    ...(input.reference.notes ? { notes: input.reference.notes } : {}),
    ...(input.reference.unavailableReason || !referenceAvailable ? { unavailableReason: input.reference.unavailableReason ?? "reference symbolic input unavailable", mediaAvailable: false } : {}),
  } : undefined;
  const pianoReport = evaluatePianoCandidates({
    candidates: ordered.map((route) => ({
      id: route.id,
      label: route.label,
      selector: route.selector ?? route.id,
      ...(route.bytes ? { bytes: route.bytes } : {}),
      ...(route.parsed ? { parsed: route.parsed } : {}),
      ...(route.notes ? { notes: route.notes } : {}),
      ...(route.mediaAvailable !== undefined ? { mediaAvailable: route.mediaAvailable } : {}),
      ...(route.backendAvailable !== undefined ? { backendAvailable: route.backendAvailable } : {}),
      ...(route.unavailableReason ? { unavailableReason: route.unavailableReason } : {}),
      metadata: { routeId: route.id },
    })),
    ...(referenceAvailable && referenceCandidate && input.windows?.length ? {
      reference: referenceCandidate,
      alignment: {
        windows: input.windows.filter((window): window is EvaluationWindow & { reference: [number, number] } => Boolean(window.reference)).map((window) => ({ id: window.id, candidate: window.candidate, reference: window.reference })),
        allowOffset: false,
        allowTranspose: false,
        allowTempoStretch: false,
      },
    } : {}),
  });

  const results = ordered.map((route): RouteFunnelRouteResult => {
    const arrangement = evaluateArrangement({
      fixture,
      candidate: {
        selector: route.selector ?? route.id,
        ...(route.bytes ? { bytes: route.bytes } : {}),
        ...(route.parsed ? { parsed: route.parsed } : {}),
        ...(route.notes ? { notes: route.notes } : {}),
        ...(route.mediaAvailable !== undefined ? { mediaAvailable: route.mediaAvailable } : {}),
        ...(route.backendAvailable !== undefined ? { backendAvailable: route.backendAvailable } : {}),
        ...(route.unavailableReason ? { notes: [] } : {}),
      },
      ...(referenceAvailable && referenceCandidate ? {
        reference: referenceCandidate as ArrangementEvaluationReference,
        windows: input.windows ? [...input.windows] : undefined,
      } : {}),
      mode,
    });
    const inputSha256 = hashBytes(route.bytes);
    const hasInput = Boolean(route.bytes || route.parsed || route.notes);
    const piano = pianoSummary(pianoReport, route.id);
    const status: RouteFunnelRouteResult["status"] = route.mediaAvailable === false || route.backendAvailable === false
      || route.unavailableReason || !hasInput || piano.status !== "available" ? "unavailable" : "available";
    const reference = referenceSummary(arrangement);
    return {
      id: route.id,
      label: noPath(route.label ?? route.id),
      inputSha256,
      status,
      funnel: routeDisposition(status, status === "available" ? arrangement.gate : null, reference?.status ?? null, hasReference),
      structural: status === "available" ? {
        gate: arrangement.gate,
        parser: arrangement.candidate.parser,
        global: arrangement.metrics.global,
        rightHand: arrangement.metrics.rightHand,
        leftHand: arrangement.metrics.leftHand,
      } : null,
      reference,
      piano,
    };
  });
  const ranking: RouteFunnelRankingEntry[] = [...pianoReport.ranking]
    .filter((entry): entry is typeof entry & { id: RouteId } => ROUTE_IDS.includes(entry.id as RouteId))
    .map((entry) => ({ id: entry.id as RouteId, rank: 0, score: entry.score, reasons: [...entry.reasons] }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.id.localeCompare(b.id))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  const coverage = {
    routeCount: results.length,
    availableCount: results.filter((route) => route.status === "available").length,
    structuralPassCount: results.filter((route) => route.funnel.structural === "pass").length,
    referenceAlignedCount: results.filter((route) => route.reference?.status === "aligned").length,
    eligibleCount: results.filter((route) => route.funnel.disposition === "eligible").length,
    requiredRouteIds: ROUTE_IDS,
    missingRouteIds: missing,
  };
  const withoutDeterminism = {
    schemaVersion: ROUTE_FUNNEL_SCHEMA_VERSION,
    kind: "route-funnel-report" as const,
    fixture,
    mode,
    referenceStatus: !input.reference ? "not-requested" as const : referenceAvailable ? "available" as const : "unavailable" as const,
    routes: results,
    ranking,
    coverage,
    disclaimer: "Route ranking reuses symbolic and structural oracle formulas; it does not establish recognizability, source fidelity, or human musical acceptance.",
  };
  const canonical = canonicalJson(withoutDeterminism);
  return { ...withoutDeterminism, determinism: { canonicalSha256: createHash("sha256").update(canonical).digest("hex") } };
}

/** Deterministic path-free JSON for the local report. */
export function canonicalRouteFunnelJson(report: RouteFunnelReport | object): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/path$|filename$|file$/i.test(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, canonical(nested)]));
    return value;
  };
  return JSON.stringify(canonical(report));
}
