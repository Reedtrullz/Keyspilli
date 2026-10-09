import { expect, it } from "vitest";
import { identityHash } from "@keyspilli/catalog/src/acoustic-receipt.js";
import { createScoreReviewRepairPreview } from "./score-review-repair.js";
import type { ReplaySnapshot } from "./music-correspondence.js";
it("refuses advisory edits and stale target bindings", () => {
    const snapshot: ReplaySnapshot = { schemaVersion: 1, sourceSha256: "", events: [{ id: "bad", phraseId: "p", occurrenceId: "o", role: "melody", midi: 61, onsetSeconds: 0, durationSeconds: 0.5 }] };
    snapshot.sourceSha256 = identityHash(snapshot.events);
    const proposal = { sourceSha256: snapshot.sourceSha256, findingId: "f", findingKind: "authored-discrepancy" as const, phrase: { id: "p", startSeconds: 0, endSeconds: 1 }, targetEventIds: ["bad"], operations: [{ kind: "replace-pitch" as const, eventId: "bad", midi: 60 }], evidenceRefs: ["a".repeat(64)], sourceAuthority: "self-authored" as const, preservePhraseIds: [] };
    const action = { id: "f", findingId: "f", inputSha256: "a".repeat(64), evidenceHashes: ["a".repeat(64)], kind: "advisory-only" as const, reason: "unknown source", mode: "original" as const, phraseId: "p", occurrenceId: "o", targetEventId: "bad", expectedPitch: 60, targetPitch: 61, startSeconds: 0, sourceAuthority: "unknown" as const, validationReceiptSha256: null };
    expect(() => createScoreReviewRepairPreview({ snapshot, proposal }, action)).toThrow(/advisory|eligible/);
    const eligible = { ...action, kind: "bounded-preview" as const, sourceAuthority: "self-authored" as const };
    const r = createScoreReviewRepairPreview({ snapshot, proposal }, eligible);
    expect(r.snapshot.events[0]?.midi).toBe(60);
    expect(r.catalogMutations).toBe(0);
    expect(r.requiredRechecks).not.toContain("human-listening-and-keyboard-review");
    expect(() => createScoreReviewRepairPreview({ snapshot, proposal: { ...proposal, sourceSha256: "b".repeat(64) } }, eligible)).toThrow(/stale/);
});
