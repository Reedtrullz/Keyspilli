import { expect, it } from "vitest";
import { scoreFixture } from "./score-review-test-fixture.js";
import { loadSymbolicReviewInput, validateScoreReviewInput } from "./symbolic-review-input.js";
import { buildStructuralPlayability } from "./symbolic-playability.js";
it("screens each constant-tempo interval and held notes across its boundary", async () => {
    const f = await scoreFixture([{ midi: 60, start: 0, dur: 3, vel: 90 }, { midi: 64, start: 2, dur: 1, vel: 90 }]);
    try {
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        const m = n.modes.original!;
        m.tempoEvents = [{ tick: 0, beat: 0, bpm: 120, microsecondsPerQuarter: 500000 }, { tick: 960, beat: 2, bpm: 60, microsecondsPerQuarter: 1000000 }];
        m.phraseEndSeconds = 3;
        m.expected[0]!.keyReleaseSeconds = 2;
        m.expected[1]!.onsetSeconds = 1;
        m.expected[1]!.keyReleaseSeconds = 2;
        const r = buildStructuralPlayability(m);
        expect(r.tempoSegments.map(s => [s.startSeconds, s.endSeconds])).toEqual([[0, 1], [1, 3]]);
        expect(r.tempoSegments[1]?.noteCount).toBe(2);
        expect(r.components.crossTempoBoundary.status).toBe("passed");
    }
    finally {
        await f.cleanup();
    }
});
it("screens range while unknown hands block only hand metrics", async () => {
    const f = await scoreFixture([{ midi: 15, start: 0, dur: 1, vel: 90 }]);
    try {
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        const r = buildStructuralPlayability(n.modes.original!);
        expect(r.status).toBe("failed");
        expect(r.components.range.status).toBe("failed");
        expect(r.components.handSpan.status).toBe("not-run");
        expect(r.fingering).toBe("not-assessed");
    }
    finally {
        await f.cleanup();
    }
});
it("does not pass a complete screen with missing hands or tempo", async () => {
    const f = await scoreFixture();
    try {
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        n.modes.original!.tempoKnown = false;
        const r = buildStructuralPlayability(n.modes.original!);
        expect(r.status).toBe("not-run");
        expect(r.components.density.status).toBe("not-run");
        expect(r.components.range.status).toBe("passed");
    }
    finally {
        await f.cleanup();
    }
});
it("checks authored hand spans and does not retain implicit right-hand metrics", async () => {
    const f = await scoreFixture([{ midi: 60, start: 0, dur: 1, vel: 90 }, { midi: 77, start: 0, dur: 1, vel: 90 }]);
    try {
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        expect(buildStructuralPlayability(n.modes.original!).metrics?.hands).toBeNull();
        for (const e of n.modes.original!.expected)
            e.hand = "R";
        const r = buildStructuralPlayability(n.modes.original!);
        expect(r.components.handSpan.status).toBe("failed");
        expect(r.status).toBe("failed");
        expect(r.failures.some(f => f.reason.includes("span"))).toBe(true);
        n.modes.original!.expected[0]!.midi = NaN;
        expect(() => buildStructuralPlayability(n.modes.original!)).toThrow(/invalid/);
    }
    finally {
        await f.cleanup();
    }
});
it("screens rapid attacks but never calls empty inventory a playable approval", async () => {
    const f = await scoreFixture(Array.from({ length: 20 }, (_, i) => ({ midi: 60 + i % 5, start: i * 0.05, dur: 0.04, vel: 90 })));
    try {
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        const r = buildStructuralPlayability(n.modes.original!);
        expect(r.components.density.status).toBe("failed");
        expect(r.metrics?.rapidRegions.length).toBeGreaterThan(0);
        n.modes.original!.expected = [];
        const empty = buildStructuralPlayability(n.modes.original!);
        expect(empty.status).toBe("not-run");
        expect(empty.components.range.reason).toContain("silence");
    }
    finally {
        await f.cleanup();
    }
});
