import { expect, it } from "vitest";
import { scoreFixture } from "./score-review-test-fixture.js";
import { loadSymbolicReviewInput, validateScoreReviewInput } from "./symbolic-review-input.js";
import { buildSymbolicReviewReceipt } from "./symbolic-review.js";
it("opens the actual scoped source receipt and refuses a changed mode", async () => {
    const f = await scoreFixture();
    try {
        const receipt = await f.pin("reviewer.json", { schemaVersion: 1, kind: "keyspilli-source-validation", sourceSha256: f.delivery.sha256, selected: { phraseId: "phrase", occurrenceId: "occ-1", role: "melody", onsetSeconds: 0 }, reviewer: { id: "fixture-reviewer", role: "source-reviewer", assertion: "validated" }, scope: { mode: "original", difficulty: "medium" }, timingKnown: true });
        const anchors = await f.pin("anchors.json", { sha256: f.delivery.sha256, authority: "human-validated", timingKnown: true, validationReceiptSha256: receipt.sha256, anchors: [{ id: "landmark", phraseId: "phrase", occurrenceId: "occ-1", role: "melody", midi: 60, onsetSeconds: 0, durationSeconds: 0.5, required: true }] });
        const roles = await f.pin("roles.json", { ...f.scope, kind: "keyspilli-score-roles", assignments: { "delivery-0": { value: "melody", origin: "authored" } } });
        const raw = { ...f.input, source: { authority: "human-validated", relationship: "independent-reference", anchors, validationReceipt: receipt }, modes: { original: { ...f.input.modes.original, roles } } };
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(raw));
        expect(buildSymbolicReviewReceipt(n).modes.original?.sourceFidelity.status).toBe("passed");
        n.modes.original!.expected[0]!.midi = 61;
        expect(buildSymbolicReviewReceipt(n).findings.some(f => f.check === "sourceFidelity" && f.startSeconds === 0)).toBe(true);
        (n.source.validationReceiptValue as {
            scope: {
                mode: string;
            };
        }).scope.mode = "chords";
        expect(buildSymbolicReviewReceipt(n).modes.original?.sourceFidelity.status).toBe("authority-unknown");
    }
    finally {
        await f.cleanup();
    }
});
it("detects multiplicity, wrong pitch and wrong release independently", async () => {
    const f = await scoreFixture([{ midi: 60, start: 0, dur: 1, vel: 90 }, { midi: 62, start: 1, dur: 1, vel: 90 }, { midi: 65, start: 2, dur: 1, vel: 90 }, { midi: 65, start: 2, dur: 1, vel: 80 }], [{ midi: 61, start: 0, dur: 1, vel: 90 }, { midi: 62, start: 1, dur: 0.5, vel: 90 }, { midi: 65, start: 2, dur: 1, vel: 90 }, { midi: 70, start: 3, dur: 0.5, vel: 90 }]);
    try {
        const r = buildSymbolicReviewReceipt(await loadSymbolicReviewInput(validateScoreReviewInput(f.input)));
        expect(r.modes.original?.scoreConformance.status).toBe("failed");
        expect(r.findings.map(f => f.kind).sort()).toEqual(["extra", "missing", "wrong-pitch", "wrong-release"]);
        expect(r.modes.original?.sourceFidelity.status).toBe("authority-unknown");
        expect(r.productionAdmission).toBe(false);
    }
    finally {
        await f.cleanup();
    }
});
it("cannot promote self-roundtrip or empty/partial inventory into song fidelity", async () => {
    const f = await scoreFixture();
    try {
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        n.source.authority = "self-authored";
        n.source.relationship = "derived-from-candidate";
        n.modes.original!.coverage = "partial";
        const r = buildSymbolicReviewReceipt(n);
        expect(r.modes.original?.scoreConformance.status).toBe("not-run");
        expect(r.modes.original?.sourceFidelity.status).not.toBe("passed");
    }
    finally {
        await f.cleanup();
    }
});
it("comparison is order independent and does not merge identical repeated notes", async () => {
    const notes = [{ midi: 60, start: 0, dur: 1, vel: 90 }, { midi: 60, start: 0, dur: 1, vel: 80 }];
    const f = await scoreFixture(notes);
    try {
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        const before = buildSymbolicReviewReceipt(n);
        n.modes.original!.replayed.reverse();
        const after = buildSymbolicReviewReceipt(n);
        expect(before).toEqual(after);
        expect(after.modes.original?.scoreConformance.status).toBe("passed");
        expect(after.modes.original?.coverage.checkedAttacks).toBe(2);
    }
    finally {
        await f.cleanup();
    }
});
it("treats timing tolerance as a pinned diagnostic policy and locates shifted attacks", async () => {
    const f = await scoreFixture();
    try {
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        const mode = n.modes.original!;
        mode.replayed[0]!.onsetSeconds += 0.005;
        mode.replayed[0]!.keyReleaseSeconds += 0.005;
        expect(buildSymbolicReviewReceipt(n).modes.original?.scoreConformance.status).toBe("passed");
        mode.replayed[0]!.onsetSeconds += 0.0001;
        expect(buildSymbolicReviewReceipt(n).findings.map(f => f.kind)).toContain("shifted");
        mode.clockVerified = false;
        expect(buildSymbolicReviewReceipt(n).modes.original?.scoreConformance.status).toBe("not-run");
    }
    finally {
        await f.cleanup();
    }
});
it("detects premature release even when the expected release crosses the phrase end", async () => {
    const f = await scoreFixture([{ midi: 60, start: 0, dur: 5, vel: 90 }], [{ midi: 60, start: 0, dur: 3, vel: 90 }]);
    try {
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        const r = buildSymbolicReviewReceipt(n);
        expect(r.modes.original?.coverage.unresolvedReleases).toBe(1);
        expect(r.findings.map(f => f.kind)).toContain("wrong-release");
        expect(r.modes.original?.scoreConformance.status).toBe("failed");
        n.modes.original!.replayed = n.modes.original!.expected.map(e => ({ ...e, id: "replay-0" }));
        expect(buildSymbolicReviewReceipt(n).modes.original?.scoreConformance.status).toBe("not-run");
    }
    finally {
        await f.cleanup();
    }
});
it("refuses dense ambiguous matching and keeps empty silence unresolved", async () => {
    const f = await scoreFixture();
    try {
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        const m = n.modes.original!;
        m.expected = Array.from({ length: 450 }, (_, i) => ({ ...m.expected[0]!, id: `e-${i}` }));
        m.replayed = Array.from({ length: 450 }, (_, i) => ({ ...m.replayed[0]!, id: `a-${i}` }));
        const r = buildSymbolicReviewReceipt(n);
        expect(r.modes.original?.scoreConformance.status).toBe("not-run");
        expect(r.modes.original?.scoreConformance.reason).toContain("bounded");
        m.expected = [];
        m.replayed = [];
        expect(buildSymbolicReviewReceipt(n).modes.original?.scoreConformance.status).toBe("not-run");
    }
    finally {
        await f.cleanup();
    }
});
