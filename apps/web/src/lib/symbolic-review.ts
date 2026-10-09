import { assertMusic, identityHash } from "@keyspilli/catalog/src/acoustic-receipt.js";
import { stableJson, sha256Text, type ReviewMode } from "./audio-review.js";
import { compareMusicalIntent, type MusicalEvent, type SourceAnchors } from "./music-correspondence.js";
import { validateSourceValidationReceipt } from "./music-source-validation.js";
import { buildStructuralPlayability, type StructuralPlayabilityReceiptV1 } from "./symbolic-playability.js";
import type { CheckStatus, NormalizedScoreEvent, NormalizedScoreReviewInput, NormalizedScoreReviewMode } from "./symbolic-review-input.js";
export const SCORE_CONFORMANCE_POLICY = { version: "score-conformance-v1", onsetSeconds: 0.005, releaseSeconds: 0.005, maxMatchingEdges: 200000, keyReleaseNotSustain: true } as const;
export interface ScoreCheck {
    status: CheckStatus;
    basis: string;
    evidenceHashes: string[];
    reason: string;
}
export interface ScoreFinding {
    id: string;
    mode: ReviewMode;
    phraseId: string;
    occurrenceId: string;
    kind: "missing" | "extra" | "wrong-pitch" | "wrong-release" | "shifted" | "structural" | "source-landmark";
    severity: "high" | "moderate";
    check: "scoreConformance" | "structuralPlayability" | "sourceFidelity";
    basis: string;
    expected: NormalizedScoreEvent | null;
    actual: NormalizedScoreEvent | null;
    startSeconds: number;
    reason: string;
    nextAction: string;
}
export interface SymbolicReviewReceiptV1 {
    schemaVersion: 1;
    kind: "keyspilli-symbolic-review";
    inputSha256: string;
    manifestSha256: string;
    code: {
        sha256: string;
        inventory: Array<{
            path: string;
            sha256: string;
        }>;
    } | null;
    policySha256: string;
    modes: Partial<Record<ReviewMode, {
        scoreConformance: ScoreCheck;
        sourceFidelity: ScoreCheck;
        structuralPlayability: StructuralPlayabilityReceiptV1;
        coverage: {
            declared: string;
            checkedAttacks: number;
            checkedContext: number;
            unresolvedReleases: number;
            sourceLandmarks: number;
        };
        approvedTransformations: string[];
    }>>;
    findings: ScoreFinding[];
    limitations: string[];
    musicalAcceptance: "not-established";
    productionAdmission: false;
}
const ordered = (events: NormalizedScoreEvent[]) => [...events].sort((a, b) => a.onsetSeconds - b.onsetSeconds || a.midi - b.midi || a.keyReleaseSeconds - b.keyReleaseSeconds || a.id.localeCompare(b.id));
function compareEvents(mode: NormalizedScoreReviewMode) {
    const expected = ordered(mode.expected), actual = ordered(mode.replayed);
    const remainingExpected = new Set(expected.map((_, i) => i)), remainingActual = new Set(actual.map((_, i) => i));
    const pairs: Array<{
        left: number;
        right: number;
        kind: ScoreFinding["kind"] | null;
    }> = [];
    const tolerance = SCORE_CONFORMANCE_POLICY.onsetSeconds + 1e-9;
    const onset = (a: NormalizedScoreEvent, b: NormalizedScoreEvent) => Math.abs(a.onsetSeconds - b.onsetSeconds) <= tolerance;
    const release = (a: NormalizedScoreEvent, b: NormalizedScoreEvent) => Math.abs(Math.min(a.keyReleaseSeconds, mode.phraseEndSeconds) - Math.min(b.keyReleaseSeconds, mode.phraseEndSeconds)) <= SCORE_CONFORMANCE_POLICY.releaseSeconds + 1e-9;
    // Maximum one-to-one matching prevents greedy pairing from losing duplicate notes at tolerance boundaries.
    const match = (predicate: (a: NormalizedScoreEvent, b: NormalizedScoreEvent) => boolean, kind: ScoreFinding["kind"] | null, broad = false) => {
        const buckets = new Map<number, number[]>();
        for (const i of remainingActual) {
            const key = Math.floor(actual[i]!.onsetSeconds / tolerance);
            const bucket = buckets.get(key) ?? [];
            bucket.push(i);
            buckets.set(key, bucket);
        }
        const edges = new Map<number, number[]>();
        let edgeCount = 0;
        for (const i of remainingExpected) {
            const key = Math.floor(expected[i]!.onsetSeconds / tolerance);
            const candidates = broad ? [...remainingActual] : [-1, 0, 1].flatMap(offset => buckets.get(key + offset) ?? []);
            const eligible = candidates.filter(j => predicate(expected[i]!, actual[j]!));
            edgeCount += eligible.length;
            assertMusic(edgeCount <= SCORE_CONFORMANCE_POLICY.maxMatchingEdges, "ambiguous dense pairing exceeds bounded matching policy");
            edges.set(i, eligible);
        }
        const owner = new Map<number, number>();
        const visit = (i: number, seen: Set<number>): boolean => {
            for (const j of edges.get(i) ?? []) {
                if (seen.has(j))
                    continue;
                seen.add(j);
                const previous = owner.get(j);
                if (previous === undefined || visit(previous, seen)) {
                    owner.set(j, i);
                    return true;
                }
            }
            return false;
        };
        for (const i of remainingExpected)
            visit(i, new Set());
        for (const [right, left] of owner) {
            pairs.push({ left, right, kind });
            remainingExpected.delete(left);
            remainingActual.delete(right);
        }
    };
    match((a, b) => a.midi === b.midi && onset(a, b) && release(a, b), null);
    match((a, b) => a.midi === b.midi && onset(a, b), "wrong-release");
    match((a, b) => onset(a, b) && release(a, b), "wrong-pitch");
    if (remainingExpected.size * remainingActual.size <= SCORE_CONFORMANCE_POLICY.maxMatchingEdges)
        match((a, b) => a.midi === b.midi && Math.abs(a.onsetSeconds - b.onsetSeconds) <= 2, "shifted", true);
    const differences = pairs.filter(p => p.kind !== null).map(p => ({ kind: p.kind!, expected: expected[p.left]!, actual: actual[p.right]! }));
    for (const i of remainingExpected)
        differences.push({ kind: "missing", expected: expected[i]!, actual: null as unknown as NormalizedScoreEvent });
    for (const i of remainingActual)
        differences.push({ kind: "extra", expected: null as unknown as NormalizedScoreEvent, actual: actual[i]! });
    return differences.sort((a, b) => (a.expected ?? a.actual).onsetSeconds - (b.expected ?? b.actual).onsetSeconds || a.kind.localeCompare(b.kind));
}
function sourceFidelity(input: NormalizedScoreReviewInput, mode: NormalizedScoreReviewMode): {
    check: ScoreCheck;
    landmarks: number;
    failures: Array<{
        startSeconds: number;
        reason: string;
    }>;
} {
    const source = input.source;
    const check = (status: CheckStatus, reason: string, landmarks = 0, failures: Array<{
        startSeconds: number;
        reason: string;
    }> = []) => ({ check: { status, basis: "scoped independent source landmarks; not full-song correctness", evidenceHashes: [mode.pins.source, ...(source.anchors ? [source.anchors.sha256] : []), ...(source.validationReceipt ? [source.validationReceipt.sha256] : [])], reason }, landmarks, failures });
    if (source.relationship !== "independent-reference")
        return check("authority-unknown", "Unknown/candidate-derived reference cannot certify source fidelity");
    if (!source.anchorsValue || !["self-authored", "human-validated"].includes(source.authority))
        return check("authority-unknown", "No independent authoritative source anchors");
    if (!mode.clockVerified || source.anchorsValue.timingKnown !== true)
        return check("not-run", "Source timing/common clock unresolved");
    let anchors = source.anchorsValue.anchors.filter(a => a.phraseId === mode.phraseId && a.occurrenceId === mode.occurrenceId);
    if (source.authority === "human-validated") {
        if (!source.validationReceipt || source.anchorsValue.validationReceiptSha256 !== source.validationReceipt.sha256)
            return check("authority-unknown", "Actual matching reviewer receipt unavailable");
        let receipt;
        try {
            receipt = validateSourceValidationReceipt(source.validationReceiptValue, source.anchorsValue);
        }
        catch {
            return check("authority-unknown", "Reviewer receipt failed scope/identity validation");
        }
        if (receipt.scope.mode !== mode.mode || receipt.scope.difficulty !== mode.intent.difficulty || receipt.selected.phraseId !== mode.phraseId || receipt.selected.occurrenceId !== mode.occurrenceId)
            return check("authority-unknown", "Reviewer receipt is for a different mode/difficulty/occurrence");
        anchors = anchors.filter(a => a.role === receipt.selected.role && a.onsetSeconds === receipt.selected.onsetSeconds);
    }
    if (!anchors.length)
        return check("not-run", "No selected source landmarks; empty anchors never pass");
    const trustedEvents = mode.expected.filter((e): e is NormalizedScoreEvent & {
        role: MusicalEvent["role"];
    } => e.role !== null).map(e => ({ id: e.id, phraseId: mode.phraseId, occurrenceId: e.occurrenceId, role: e.role, ...(e.hand ? { hand: e.hand } : {}), midi: e.midi, onsetSeconds: e.onsetSeconds, durationSeconds: e.keyReleaseSeconds - e.onsetSeconds }));
    const normalizedAnchors: SourceAnchors = { ...source.anchorsValue, anchors: anchors.map(a => ({ ...a, onsetSeconds: (a.onsetSeconds - mode.clock.sourceStartSeconds) / mode.clock.speed, durationSeconds: a.durationSeconds / mode.clock.speed })) };
    const comparison = compareMusicalIntent(normalizedAnchors, { schemaVersion: 1, sourceSha256: identityHash(trustedEvents), events: trustedEvents }, mode.intent);
    const violated = comparison.landmarks.some(l => l.status === "violated");
    const incomplete = mode.coverage !== "full-phrase" || mode.expected.some(e => e.role === null) || comparison.landmarks.some(l => l.status === "unknown") || !comparison.landmarks.length;
    return check(violated ? "failed" : incomplete ? "not-run" : "passed", comparison.landmarks.map(l => `${l.id}: ${l.reason}`).join("; "), comparison.landmarks.length, comparison.landmarks.filter(l => l.status === "violated").map(l => ({ startSeconds: l.startSeconds, reason: `Source landmark ${l.id}: ${l.reason}` })));
}
export function buildSymbolicReviewReceipt(input: NormalizedScoreReviewInput, code: SymbolicReviewReceiptV1["code"] = null): SymbolicReviewReceiptV1 {
    const result: SymbolicReviewReceiptV1 = { schemaVersion: 1, kind: "keyspilli-symbolic-review", inputSha256: input.inputSha256, manifestSha256: input.manifestSha256, code, policySha256: sha256Text(stableJson(SCORE_CONFORMANCE_POLICY)), modes: {}, findings: [], limitations: ["Supplied symbolic equality is not audible realization or recognizable song correctness.", "No musical acceptance or production admission is granted."], musicalAcceptance: "not-established", productionAdmission: false };
    for (const key of Object.keys(input.modes).sort()) {
        const mode = input.modes[key as ReviewMode]!;
        const add = (kind: ScoreFinding["kind"], expected: NormalizedScoreEvent | null, actual: NormalizedScoreEvent | null, reason: string, check: ScoreFinding["check"] = "scoreConformance", startSeconds?: number) => {
            result.findings.push({ id: sha256Text(stableJson({ input: input.inputSha256, mode: mode.mode, occurrence: mode.occurrenceId, check, kind, expected: expected?.id ?? null, actual: actual?.id ?? null, reason })), mode: mode.mode, phraseId: mode.phraseId, occurrenceId: mode.occurrenceId, kind, severity: kind === "wrong-pitch" || kind === "missing" ? "high" : "moderate", check, basis: check === "sourceFidelity" ? "scoped independent source landmarks" : mode.basis, expected, actual, startSeconds: startSeconds ?? expected?.onsetSeconds ?? actual?.onsetSeconds ?? mode.phraseStartSeconds, reason, nextAction: check === "scoreConformance" ? "Reproduce the pinned score/export or scheduling discrepancy locally; preserve source notes until authority is established" : "Inspect the located source/structural constraint and prepare a bounded preview only with trusted source support" });
        };
        let status: CheckStatus = "not-run", reason = "No verified common clock";
        if (mode.clockVerified) {
            try {
                const differences = compareEvents(mode);
                for (const d of differences)
                    add(d.kind, d.expected, d.actual, `Literal ${d.kind}: independently parsed delivery versus ${mode.basis}`);
                const incomplete = mode.coverage !== "full-phrase" || !mode.expected.length || mode.expected.some(e => !e.releaseCovered) || mode.replayed.some(e => !e.releaseCovered);
                status = differences.length ? "failed" : incomplete ? "not-run" : "passed";
                reason = differences.length ? `${differences.length} located discrepancies` : incomplete ? "Checked subset agrees; empty/partial/censored scope remains unresolved" : "All selected attacks, pitches, multiplicities and covered key releases agree";
            }
            catch (error) {
                reason = error instanceof Error ? error.message : String(error);
            }
        }
        const fidelity = sourceFidelity(input, mode), structural = buildStructuralPlayability(mode);
        for (const f of fidelity.failures)
            add("source-landmark", null, null, f.reason, "sourceFidelity", f.startSeconds);
        for (const f of structural.failures)
            add("structural", mode.expected.find(e => e.id === f.eventId) ?? null, null, f.reason, "structuralPlayability", f.startSeconds);
        result.modes[mode.mode] = { scoreConformance: { status, basis: mode.basis, evidenceHashes: [mode.pins.delivery, mode.pins.replay, ...(mode.pins.clock ? [mode.pins.clock] : [])], reason }, sourceFidelity: fidelity.check, structuralPlayability: structural, coverage: { declared: mode.coverage, checkedAttacks: mode.expected.filter(e => e.scope === "attack").length, checkedContext: mode.expected.filter(e => e.scope === "context").length, unresolvedReleases: mode.expected.filter(e => !e.releaseCovered).length + mode.replayed.filter(e => !e.releaseCovered).length, sourceLandmarks: fidelity.landmarks }, approvedTransformations: mode.intent.approvedTransformations };
        result.limitations.push(...mode.unavailableReasons);
    }
    return result;
}
