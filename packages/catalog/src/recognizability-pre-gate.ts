/**
 * Conservative, melody-only readiness check used before human listening.
 * This deliberately does not judge accompaniment or change arrangement data.
 */

export interface RecognizabilityMelodyEvent {
  midi: number;
  start: number;
  dur: number;
  vel?: number;
}

export interface RecognizabilityWindow {
  id: string;
  candidate: [number, number];
  reference: [number, number];
  alignmentUncertaintyBeats?: number;
}

export interface RecognizabilityPreGateInput {
  candidateMelody?: RecognizabilityMelodyEvent[] | null;
  referenceMelody?: RecognizabilityMelodyEvent[] | null;
  alignment?: { status?: "aligned"; confidence?: number } | null;
  windows?: RecognizabilityWindow[] | null;
  thresholds?: Partial<RecognizabilityPreGateThresholds>;
}

export interface RecognizabilityPreGateThresholds {
  minMatchedOnsetRatio: number;
  minPitchClassF1: number;
  minContourAgreement: number;
  maxAlignmentUncertaintyBeats: number;
  minimumWindows: number;
}

export interface RecognizabilityPreGateResult {
  status: "READY_FOR_HUMAN_LISTENING" | "NOT_READY_FOR_HUMAN_LISTENING";
  failures: string[];
  metrics: {
    matchedOnsetRatio: number | null;
    pitchClass: { precision: number | null; recall: number | null; f1: number | null };
    contour: { agreement: number | null };
    windowsEvaluated: number;
  };
  thresholds: RecognizabilityPreGateThresholds;
}

const DEFAULT_THRESHOLDS: RecognizabilityPreGateThresholds = {
  minMatchedOnsetRatio: 0.7,
  minPitchClassF1: 0.6,
  minContourAgreement: 0.5,
  maxAlignmentUncertaintyBeats: 0.25,
  minimumWindows: 3,
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function cleanEvents(input: unknown): RecognizabilityMelodyEvent[] | null {
  if (!Array.isArray(input)) return null;
  const events = input.filter((event): event is RecognizabilityMelodyEvent => {
    if (!event || typeof event !== "object") return false;
    const value = event as Partial<RecognizabilityMelodyEvent>;
    return Number.isInteger(value.midi) && value.midi !== undefined && value.midi >= 0 && value.midi <= 127
      && finite(value.start) && value.start >= 0
      && finite(value.dur) && value.dur > 0
      && (value.vel === undefined || (finite(value.vel) && value.vel >= 0));
  });
  if (events.length !== input.length) return null;
  return [...events].sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur);
}

function f1(precision: number, recall: number): number {
  return precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
}

function windowMetrics(candidate: RecognizabilityMelodyEvent[], reference: RecognizabilityMelodyEvent[], window: RecognizabilityWindow) {
  const [cs, ce] = window.candidate;
  const [rs, re] = window.reference;
  const c = candidate.filter((n) => n.start >= cs && n.start < ce);
  const r = reference.filter((n) => n.start >= rs && n.start < re);
  const used = new Set<number>();
  const pairs: Array<[RecognizabilityMelodyEvent, RecognizabilityMelodyEvent]> = [];
  for (const cn of c) {
    let best = -1;
    let distance = Infinity;
    for (let index = 0; index < r.length; index++) {
      if (used.has(index)) continue;
      const d = Math.abs((cn.start - cs) - (r[index]!.start - rs));
      if (d <= 0.125 + 1e-9 && d < distance) { best = index; distance = d; }
    }
    if (best >= 0) { used.add(best); pairs.push([cn, r[best]!]); }
  }
  let pitchMatches = 0;
  for (const [cn, rn] of pairs) if (((cn.midi - rn.midi) % 12 + 12) % 12 === 0) pitchMatches++;
  const precision = c.length ? pitchMatches / c.length : null;
  const recall = r.length ? pitchMatches / r.length : null;
  const cPitches = pairs.map(([cn]) => cn.midi);
  const rPitches = pairs.map(([, rn]) => rn.midi);
  let directionMatches = 0;
  let directionCount = 0;
  for (let i = 1; i < pairs.length; i++) {
    const cd = Math.sign(cPitches[i]! - cPitches[i - 1]!);
    const rd = Math.sign(rPitches[i]! - rPitches[i - 1]!);
    directionCount++;
    if (cd === rd) directionMatches++;
  }
  return {
    matched: pairs.length,
    candidate: c.length,
    reference: r.length,
    precision,
    recall,
    f1: precision === null || recall === null ? null : f1(precision, recall),
    contour: directionCount ? directionMatches / directionCount : null,
  };
}

export function evaluateRecognizabilityPreGate(input: RecognizabilityPreGateInput): RecognizabilityPreGateResult {
  const requested = input.thresholds ?? {};
  const thresholds: RecognizabilityPreGateThresholds = {
    minMatchedOnsetRatio: finite(requested.minMatchedOnsetRatio) ? requested.minMatchedOnsetRatio : DEFAULT_THRESHOLDS.minMatchedOnsetRatio,
    minPitchClassF1: finite(requested.minPitchClassF1) ? requested.minPitchClassF1 : DEFAULT_THRESHOLDS.minPitchClassF1,
    minContourAgreement: finite(requested.minContourAgreement) ? requested.minContourAgreement : DEFAULT_THRESHOLDS.minContourAgreement,
    maxAlignmentUncertaintyBeats: finite(requested.maxAlignmentUncertaintyBeats) ? requested.maxAlignmentUncertaintyBeats : DEFAULT_THRESHOLDS.maxAlignmentUncertaintyBeats,
    minimumWindows: finite(requested.minimumWindows) && Number.isInteger(requested.minimumWindows) && requested.minimumWindows > 0 ? requested.minimumWindows : DEFAULT_THRESHOLDS.minimumWindows,
  };
  const failures: string[] = [];
  const candidate = cleanEvents(input.candidateMelody);
  const reference = cleanEvents(input.referenceMelody);
  if (!candidate || !reference) failures.push("melody inputs must be finite event arrays");
  if (!input.alignment || input.alignment.status !== "aligned" || !finite(input.alignment.confidence) || input.alignment.confidence < 0.8) {
    failures.push("alignment evidence is missing");
  }
  const windows = Array.isArray(input.windows) ? [...input.windows] : null;
  if (!windows || windows.length === 0) failures.push("explicit alignment windows are required");
  const validWindows = windows?.filter((window): window is RecognizabilityWindow => {
    if (!window || typeof window !== "object" || typeof window.id !== "string" || !window.id) return false;
    const bounds = [window.candidate, window.reference];
    return bounds.every((pair) => Array.isArray(pair) && pair.length === 2 && finite(pair[0]) && finite(pair[1]) && pair[0] >= 0 && pair[1] > pair[0])
      && (window.alignmentUncertaintyBeats === undefined || (finite(window.alignmentUncertaintyBeats) && window.alignmentUncertaintyBeats >= 0));
  }) ?? [];
  if (windows && validWindows.length !== windows.length) failures.push("alignment windows are malformed");
  if (validWindows.length < thresholds.minimumWindows) failures.push(`at least ${thresholds.minimumWindows} alignment windows are required`);
  if (new Set(validWindows.map((window) => window.id)).size !== validWindows.length) failures.push("alignment window IDs must be unique");
  const ordered = [...validWindows].sort((a, b) => a.candidate[0] - b.candidate[0] || a.reference[0] - b.reference[0] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (current.candidate[0] < previous.candidate[1] || current.reference[0] < previous.reference[1]) failures.push("alignment windows must not overlap");
  }
  for (const window of validWindows) if ((window.alignmentUncertaintyBeats ?? 0) > thresholds.maxAlignmentUncertaintyBeats) failures.push(`alignment uncertainty exceeds threshold in ${window.id}`);
  const metrics = { matchedOnsetRatio: null as number | null, pitchClass: { precision: null as number | null, recall: null as number | null, f1: null as number | null }, contour: { agreement: null as number | null }, windowsEvaluated: 0 };
  if (candidate && reference && !failures.some((failure) => /window/i.test(failure))) {
    const results = validWindows.map((window) => windowMetrics(candidate, reference, window));
    metrics.windowsEvaluated = results.length;
    const totals = results.reduce((sum, result) => ({ matched: sum.matched + result.matched, candidate: sum.candidate + result.candidate, reference: sum.reference + result.reference, pitch: sum.pitch + (result.precision === null ? 0 : result.precision * result.candidate), contourSum: sum.contourSum + (result.contour ?? 0), contourCount: sum.contourCount + (result.contour === null ? 0 : 1) }), { matched: 0, candidate: 0, reference: 0, pitch: 0, contourSum: 0, contourCount: 0 });
    metrics.matchedOnsetRatio = totals.reference ? totals.matched / totals.reference : null;
    metrics.pitchClass.precision = totals.candidate ? totals.pitch / totals.candidate : null;
    metrics.pitchClass.recall = totals.reference ? totals.pitch / totals.reference : null;
    metrics.pitchClass.f1 = metrics.pitchClass.precision === null || metrics.pitchClass.recall === null ? null : f1(metrics.pitchClass.precision, metrics.pitchClass.recall);
    metrics.contour.agreement = totals.contourCount ? totals.contourSum / totals.contourCount : null;
  }
  if (metrics.matchedOnsetRatio === null || metrics.matchedOnsetRatio < thresholds.minMatchedOnsetRatio) failures.push("melody onset coverage is below threshold");
  if (metrics.pitchClass.f1 === null || metrics.pitchClass.f1 < thresholds.minPitchClassF1) failures.push("melody pitch agreement is below threshold");
  if (metrics.contour.agreement === null || metrics.contour.agreement < thresholds.minContourAgreement) failures.push("melody contour agreement is below threshold");
  return { status: failures.length === 0 ? "READY_FOR_HUMAN_LISTENING" : "NOT_READY_FOR_HUMAN_LISTENING", failures: [...new Set(failures)].sort(), metrics, thresholds };
}
