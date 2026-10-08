import { assertMusic } from "@keyspilli/catalog/src/acoustic-receipt.js";
import { previewMusicRepair, type RepairPreview, type RepairProposal } from "./music-repair-preview.js";
import type { ReplaySnapshot } from "./music-correspondence.js";
import type { ScoreReviewReportV1 } from "./score-review.js";
import type { SourceAuthority } from "./symbolic-review-input.js";
import { stableJson, sha256Text } from "./audio-review.js";
export interface ScoreReviewRepairAction {
    id: string;
    findingId: string;
    inputSha256: string;
    evidenceHashes: string[];
    kind: "software-reproducer" | "bounded-preview" | "advisory-only" | "data-recovery";
    reason: string;
    mode: "original" | "chords";
    phraseId: string;
    occurrenceId: string;
    targetEventId: string | null;
    expectedPitch: number | null;
    targetPitch: number | null;
    startSeconds: number;
    sourceAuthority: SourceAuthority;
    validationReceiptSha256: string | null;
}
export function buildScoreReviewRepairActions(report: ScoreReviewReportV1): ScoreReviewRepairAction[] {
    const actions: ScoreReviewRepairAction[] = report.findings.map(f => {
        const trusted = report.sourceRelationship === "independent-reference" && report.symbolic.modes[f.mode]?.sourceFidelity.status === "passed" && ["self-authored", "human-validated"].includes(report.sourceAuthority);
        const editable = trusted && f.kind === "wrong-pitch" && f.expected !== null && f.actual !== null && f.basis === "supplied-symbolic-files";
        const kind: ScoreReviewRepairAction["kind"] = f.basis === "resolved-player-events" ? "software-reproducer" : editable ? "bounded-preview" : f.check === "scoreConformance" ? "software-reproducer" : "advisory-only";
        return { id: f.id, findingId: f.id, inputSha256: report.inputSha256, evidenceHashes: [report.symbolic.policySha256, ...(f.check === "sourceFidelity" ? report.symbolic.modes[f.mode]!.sourceFidelity : report.symbolic.modes[f.mode]!.scoreConformance).evidenceHashes], kind, reason: kind === "bounded-preview" ? "Trusted independent source supports a bounded pitch preview; fresh rechecks required" : kind === "software-reproducer" ? "Reproduce delivery/export/scheduling discrepancy locally; do not edit unknown source notes" : "Source/structural advice only; no automatic score change", mode: f.mode, phraseId: f.phraseId, occurrenceId: f.occurrenceId, targetEventId: f.actual?.id ?? null, expectedPitch: f.expected?.midi ?? null, targetPitch: f.actual?.midi ?? null, startSeconds: f.startSeconds, sourceAuthority: report.sourceAuthority, validationReceiptSha256: report.input.source.validationReceipt?.sha256 ?? null };
    });
    for (const [mode, r] of Object.entries(report.symbolic.modes))
        if (r.sourceFidelity.status === "authority-unknown" || r.scoreConformance.status === "not-run")
            actions.push({ id: `recover-${mode}`, findingId: `recover-${mode}`, inputSha256: report.inputSha256, evidenceHashes: [report.manifestSha256], kind: "data-recovery", reason: "Agent action: recover an existing authoritative score/clock receipt if available; no owner listening assignment", mode: mode as "original" | "chords", phraseId: "unresolved", occurrenceId: report.input.modes[mode as "original" | "chords"]!.occurrenceId, targetEventId: null, expectedPitch: null, targetPitch: null, startSeconds: 0, sourceAuthority: report.sourceAuthority, validationReceiptSha256: null });
    if (report.lanes.audio.status !== "not-run")
        for (const f of report.lanes.audio.findings) {
            const id = sha256Text(stableJson({ input: report.inputSha256, audio: report.lanes.audio.reportSha256, f }));
            actions.push({ id, findingId: id, inputSha256: report.inputSha256, evidenceHashes: report.lanes.audio.reportSha256 ? [report.lanes.audio.reportSha256] : [], kind: "advisory-only", reason: `Unverified provider observation; no automatic score change: ${f.reason}`, mode: f.mode, phraseId: f.phraseId, occurrenceId: report.input.modes[f.mode]?.occurrenceId ?? "unresolved", targetEventId: null, expectedPitch: null, targetPitch: null, startSeconds: f.startSeconds, sourceAuthority: report.sourceAuthority, validationReceiptSha256: null });
        }
    return actions;
}
export function createScoreReviewRepairPreview(input: {
    snapshot: ReplaySnapshot;
    proposal: RepairProposal;
}, action: ScoreReviewRepairAction): RepairPreview {
    assertMusic(action.kind === "bounded-preview", "advisory action is not eligible for note edits");
    const { snapshot, proposal } = input;
    assertMusic(proposal.findingId === action.findingId && proposal.sourceAuthority === action.sourceAuthority && proposal.phrase.id === action.phraseId && proposal.evidenceRefs.every(h => action.evidenceHashes.includes(h)) && proposal.evidenceRefs.length > 0, "stale repair action/evidence binding");
    assertMusic(action.sourceAuthority !== "human-validated" || proposal.validationReceiptSha256 === action.validationReceiptSha256, "stale validation receipt");
    const target = snapshot.events.find(e => e.id === action.targetEventId);
    assertMusic(target && target.occurrenceId === action.occurrenceId && target.midi === action.targetPitch && Math.abs(target.onsetSeconds - action.startSeconds) < 1e-9, "stale target snapshot");
    assertMusic(proposal.operations.length === 1 && proposal.operations[0]?.kind === "replace-pitch" && proposal.operations[0].eventId === action.targetEventId && proposal.operations[0].midi === action.expectedPitch, "operation differs from confirmed finding");
    const preview = previewMusicRepair(snapshot, proposal);
    return { ...preview, requiredRechecks: preview.requiredRechecks.filter(r => r !== "human-listening-and-keyboard-review").concat("automatic-structural-screen", "expert-judgment-not-established") };
}
