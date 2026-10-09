import {
  assertMusic,
  parseAcousticReceipt,
  type AcousticReceipt,
  type AcousticNote,
} from "./acoustic-receipt.js";
export interface MatchPolicy {
  onsetSeconds: 0.05 | 0.1;
  attackGroupWindowSeconds: 0.02;
}
export const DEFAULT_MATCH_POLICY: MatchPolicy = {
  onsetSeconds: 0.05,
  attackGroupWindowSeconds: 0.02,
};
export interface CaseTruth {
  id: string;
  split: "development" | "heldout";
  category: "clean" | "fault" | "valid";
  critical: boolean;
  audioSha256: string;
  expectedRefusal?: boolean;
  notes: AcousticNote[];
}
export interface NoteMatch {
  expectedId: string;
  observedId: string;
  residualSeconds: number;
}
export interface MatchView {
  counts: { tp: number; fp: number; fn: number };
  precision: number | null;
  recall: number | null;
  matches: NoteMatch[];
  missingIds: string[];
  extraIds: string[];
}
export interface CaseGrade {
  caseId: string;
  split: CaseTruth["split"];
  category: CaseTruth["category"];
  critical: boolean;
  status: AcousticReceipt["status"];
  expectedRefusal: boolean;
  onset50: MatchView;
  onset100: MatchView;
  octaveErrors: number;
  expectedAttackGroups: number;
  observedAttackGroups: number;
  offsetStatus: "unqualified";
  audioDurationSeconds: number;
  elapsedSeconds: number;
  peakRssBytes: number | null;
  cleanFalseAlarms: number;
}
export interface CandidateSummary {
  cases: number;
  ok: number;
  failed: number;
  unavailable: number;
  expectedRefusals: number;
  counts: MatchView["counts"];
  precision: number | null;
  recall: number | null;
  p95Seconds: number | null;
  thirtySecondProfile: {
    samples: number;
    p95Seconds: number | null;
    status: "qualified" | "unqualified";
  };
  peakRssBytes: number | null;
  criticalFailures: string[];
  cleanFalseAlarms: number;
  qualification: "provisional" | "diagnostic-only";
  musicalAcceptance: "not-established";
}
export function groupAttacks(
  times: readonly number[],
  window = 0.02,
): number[] {
  assertMusic(
    window === 0.02,
    "attack grouping must use frozen 20ms first-onset window",
  );
  const sorted = [...times].sort((a, b) => a - b);
  assertMusic(
    sorted.every((t) => Number.isFinite(t) && t >= 0),
    "invalid attack times",
  );
  const result: number[] = [];
  for (const t of sorted)
    if (!result.length || t - result.at(-1)! > window + 1e-10) result.push(t);
  return result;
}
/** Maximum one-to-one assignment. Candidate order is fixed by timing residual then ID. */
export function matchNotes(
  expected: readonly AcousticNote[],
  observed: readonly AcousticNote[],
  tolerance: number,
): MatchView {
  assertMusic(
    Number.isFinite(tolerance) && tolerance >= 0 && tolerance <= 0.5,
    "invalid onset tolerance",
  );
  const index = new Map<number, number[]>();
  observed.forEach((n, i) =>
    index.set(n.midi, [...(index.get(n.midi) ?? []), i]),
  );
  const candidates = expected.map((n) =>
    (index.get(n.midi) ?? [])
      .filter(
        (i) =>
          Math.abs(observed[i]!.onsetSeconds - n.onsetSeconds) <=
          tolerance + 1e-10,
      )
      .sort(
        (a, b) =>
          Math.abs(observed[a]!.onsetSeconds - n.onsetSeconds) -
            Math.abs(observed[b]!.onsetSeconds - n.onsetSeconds) ||
          observed[a]!.id.localeCompare(observed[b]!.id),
      ),
  );
  const owner = new Map<number, number>();
  const augment = (e: number, seen: Set<number>): boolean => {
    for (const o of candidates[e]!) {
      if (seen.has(o)) continue;
      seen.add(o);
      const prior = owner.get(o);
      if (prior === undefined || augment(prior, seen)) {
        owner.set(o, e);
        return true;
      }
    }
    return false;
  };
  expected
    .map((_, i) => i)
    .sort(
      (a, b) =>
        candidates[a]!.length - candidates[b]!.length ||
        expected[a]!.onsetSeconds - expected[b]!.onsetSeconds ||
        expected[a]!.id.localeCompare(expected[b]!.id),
    )
    .forEach((i) => augment(i, new Set()));
  const matchedExpected = new Set(owner.values());
  const matches = [...owner]
    .map(([o, e]) => ({
      expectedId: expected[e]!.id,
      observedId: observed[o]!.id,
      residualSeconds: observed[o]!.onsetSeconds - expected[e]!.onsetSeconds,
    }))
    .sort((a, b) => a.expectedId.localeCompare(b.expectedId));
  const counts = {
    tp: matches.length,
    fp: observed.length - matches.length,
    fn: expected.length - matches.length,
  };
  return {
    counts,
    precision: observed.length ? counts.tp / observed.length : null,
    recall: expected.length ? counts.tp / expected.length : null,
    matches,
    missingIds: expected
      .filter((n) => !matchedExpected.has(expected.indexOf(n)))
      .map((n) => n.id),
    extraIds: observed.filter((_, i) => !owner.has(i)).map((n) => n.id),
  };
}
export function gradeAcousticCase(
  truth: CaseTruth,
  value: AcousticReceipt,
  policy: MatchPolicy,
): CaseGrade {
  const receipt = parseAcousticReceipt(value);
  assertMusic(
    receipt.audio.sha256 === truth.audioSha256,
    "stale audio receipt",
  );
  assertMusic(
    policy.attackGroupWindowSeconds === 0.02 &&
      [0.05, 0.1].includes(policy.onsetSeconds),
    "unfrozen match policy",
  );
  // Validate truth with the same raw-note constraints; source labels cannot bypass validation.
  parseAcousticReceipt({ ...receipt, status: "ok", notes: truth.notes });
  const onset50 = matchNotes(truth.notes, receipt.notes, 0.05),
    onset100 = matchNotes(truth.notes, receipt.notes, 0.1);
  const missing = truth.notes.filter((n) => onset100.missingIds.includes(n.id));
  const extra = receipt.notes.filter((n) => onset100.extraIds.includes(n.id));
  const consumed = new Set<string>();
  let octaveErrors = 0;
  for (const n of missing) {
    const found = extra.find(
      (o) =>
        !consumed.has(o.id) &&
        Math.abs(o.onsetSeconds - n.onsetSeconds) <= 0.1 &&
        Math.abs(o.midi - n.midi) > 0 &&
        (o.midi - n.midi) % 12 === 0,
    );
    if (found) {
      consumed.add(found.id);
      octaveErrors++;
    }
  }
  return {
    caseId: truth.id,
    split: truth.split,
    category: truth.category,
    critical: truth.critical,
    status: receipt.status,
    expectedRefusal: truth.expectedRefusal === true,
    onset50,
    onset100,
    octaveErrors,
    expectedAttackGroups: groupAttacks(truth.notes.map((n) => n.onsetSeconds))
      .length,
    observedAttackGroups: groupAttacks(receipt.notes.map((n) => n.onsetSeconds))
      .length,
    offsetStatus: "unqualified",
    audioDurationSeconds: receipt.audio.durationSeconds,
    elapsedSeconds: receipt.resources.elapsedSeconds,
    peakRssBytes: receipt.resources.peakRssBytes,
    cleanFalseAlarms: truth.category === "clean" ? onset50.counts.fp : 0,
  };
}
export function summarizeCandidate(
  grades: readonly CaseGrade[],
): CandidateSummary {
  const counts = grades.reduce(
    (a, g) => ({
      tp: a.tp + g.onset50.counts.tp,
      fp: a.fp + g.onset50.counts.fp,
      fn: a.fn + g.onset50.counts.fn,
    }),
    { tp: 0, fp: 0, fn: 0 },
  );
  const precision =
      counts.tp + counts.fp ? counts.tp / (counts.tp + counts.fp) : null,
    recall = counts.tp + counts.fn ? counts.tp / (counts.tp + counts.fn) : null;
  const times = grades
    .filter((g) => g.status === "ok" && !g.expectedRefusal)
    .map((g) => g.elapsedSeconds)
    .sort((a, b) => a - b);
  const p95Seconds = times.length
    ? times[Math.ceil(times.length * 0.95) - 1]!
    : null;
  const stressTimes = grades
    .filter(
      (g) =>
        g.status === "ok" &&
        !g.expectedRefusal &&
        g.audioDurationSeconds >= 29.9 &&
        g.audioDurationSeconds <= 30,
    )
    .map((g) => g.elapsedSeconds)
    .sort((a, b) => a - b);
  const stressP95 =
    stressTimes.length >= 20
      ? stressTimes[Math.ceil(stressTimes.length * 0.95) - 1]!
      : null;
  const rss = grades
    .filter((g) => !g.expectedRefusal)
    .flatMap((g) => (g.peakRssBytes === null ? [] : [g.peakRssBytes]));
  const criticalFailures = grades
    .filter(
      (g) =>
        g.critical &&
        (g.expectedRefusal
          ? g.status !== "unavailable"
          : g.status !== "ok" ||
            g.onset50.counts.fp > 0 ||
            g.onset50.counts.fn > 0 ||
            g.expectedAttackGroups !== g.observedAttackGroups),
    )
    .map((g) => g.caseId);
  const failed = grades.filter(
      (g) => g.status === "failed" && !g.expectedRefusal,
    ).length,
    unavailable = grades.filter(
      (g) => g.status === "unavailable" && !g.expectedRefusal,
    ).length;
  return {
    cases: grades.length,
    ok: grades.filter((g) => g.status === "ok" && !g.expectedRefusal).length,
    failed,
    unavailable,
    expectedRefusals: grades.filter(
      (g) => g.expectedRefusal && g.status === "unavailable",
    ).length,
    counts,
    precision,
    recall,
    p95Seconds,
    thirtySecondProfile: {
      samples: stressTimes.length,
      p95Seconds: stressP95,
      status:
        stressP95 !== null && stressP95 <= 60 ? "qualified" : "unqualified",
    },
    peakRssBytes: rss.length ? Math.max(...rss) : null,
    criticalFailures,
    cleanFalseAlarms: grades.reduce((s, g) => s + g.cleanFalseAlarms, 0),
    qualification:
      grades.length > 0 &&
      grades.every((g) => g.split === "heldout") &&
      precision !== null &&
      precision >= 0.95 &&
      recall !== null &&
      recall >= 0.9 &&
      !failed &&
      !unavailable &&
      !criticalFailures.length &&
      stressP95 !== null &&
      stressP95 <= 60 &&
      rss.length === grades.filter((g) => !g.expectedRefusal).length &&
      Math.max(...rss) < 8 * 1024 ** 3
        ? "provisional"
        : "diagnostic-only",
    musicalAcceptance: "not-established",
  };
}
