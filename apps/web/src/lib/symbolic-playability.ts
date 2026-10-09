import { measurePlayability, assessPlayability, midiBeatToNativeSeconds, PLAYABILITY_AUDIT_CONFIG, PLAYABILITY_LIMITS, type Note, type ParsedMidi } from "@keyspilli/midi";
import { assertMusic } from "@keyspilli/catalog/src/acoustic-receipt.js";
import { stableJson, sha256Text } from "./audio-review.js";
import type { CheckStatus, NormalizedScoreReviewMode } from "./symbolic-review-input.js";
export interface StructuralComponent {
    status: CheckStatus;
    reason: string;
}
export interface StructuralPlayabilityReceiptV1 {
    schemaVersion: 1;
    kind: "keyspilli-structural-playability";
    mode: NormalizedScoreReviewMode["mode"];
    occurrenceId: string;
    status: CheckStatus;
    pins: NormalizedScoreReviewMode["pins"];
    policySha256: string;
    difficulty: string;
    components: {
        range: StructuralComponent;
        density: StructuralComponent;
        handSpan: StructuralComponent;
        crossTempoBoundary: StructuralComponent;
    };
    metrics: {
        timeBasis: "native-elapsed-seconds";
        noteCount: number;
        durationSeconds: number;
        global: ReturnType<typeof measurePlayability>["global"];
        hands: ReturnType<typeof measurePlayability>["hands"] | null;
        rapidRegions: Array<{
            startSeconds: number;
            endSeconds: number;
            rapidIoiCount: number;
        }>;
    } | null;
    assessment: ReturnType<typeof assessPlayability> | null;
    tempoSegments: Array<{
        startSeconds: number;
        endSeconds: number;
        noteCount: number;
        global: ReturnType<typeof measurePlayability>["global"];
        assessment: ReturnType<typeof assessPlayability>;
    }>;
    failures: Array<{
        eventId: string | null;
        startSeconds: number;
        reason: string;
    }>;
    fingering: "not-assessed";
    keyboardAcceptance: "not-established";
    limitations: string[];
}
export function buildStructuralPlayability(mode: NormalizedScoreReviewMode): StructuralPlayabilityReceiptV1 {
    const events = mode.expected;
    for (const e of events)
        assertMusic(Number.isInteger(e.midi) && e.midi >= 0 && e.midi <= 127 && Number.isFinite(e.onsetSeconds) && Number.isFinite(e.keyReleaseSeconds) && e.keyReleaseSeconds > e.onsetSeconds, "invalid note cannot be filtered out of structural metrics");
    const failures: StructuralPlayabilityReceiptV1["failures"] = events.filter(e => e.midi < 21 || e.midi > 108).map(e => ({ eventId: e.id, startSeconds: e.onsetSeconds, reason: `Pitch ${e.midi} is outside piano range 21-108` }));
    const completeHands = events.length > 0 && events.every(e => e.hand !== null);
    const timing = mode.tempoKnown && mode.clockVerified;
    // A second is a beat at 60 BPM: this is a unit conversion, never an average source tempo.
    const interval = (start: number, end: number) => {
        const selected = events.filter(e => e.onsetSeconds < end && e.keyReleaseSeconds > start);
        const note = (e: typeof events[number]): Note => ({ midi: e.midi, start: Math.max(0, e.onsetSeconds - start), dur: Math.min(e.keyReleaseSeconds, end) - Math.max(e.onsetSeconds, start), vel: 90, ...(e.hand ? { hand: e.hand } : {}) });
        const all = measurePlayability(selected.map(note), 60, end - start);
        const attacks = measurePlayability(selected.filter(e => e.onsetSeconds >= start).map(note), 60, end - start);
        // Carried notes contribute sounding load, not a new attack at every boundary.
        all.global = { ...all.global, attacksPerSecond: attacks.global.attacksPerSecond, medianIoiSeconds: attacks.global.medianIoiSeconds, maxSimultaneous: attacks.global.maxSimultaneous };
        return all;
    };
    const metrics = timing && events.length ? interval(mode.phraseStartSeconds, mode.phraseEndSeconds) : null;
    const assessment = metrics ? assessPlayability(metrics, mode.intent.difficulty) : null;
    const nativeClock = { division: mode.tempoDivision, tempoBpm: mode.nativeTempoBpm, tempoEvents: mode.tempoEvents } as ParsedMidi;
    const boundaries = [mode.phraseStartSeconds, ...mode.tempoEvents.map(t => (midiBeatToNativeSeconds(nativeClock, t.beat) - mode.clock.sourceStartSeconds) / mode.clock.speed).filter(t => t > mode.phraseStartSeconds && t < mode.phraseEndSeconds), mode.phraseEndSeconds].sort((a, b) => a - b);
    const unique = [...new Set(boundaries)];
    const tempoSegments: StructuralPlayabilityReceiptV1["tempoSegments"] = timing && events.length ? unique.slice(0, -1).map((start, i) => { const end = unique[i + 1]!, m = interval(start, end); return { startSeconds: start, endSeconds: end, noteCount: m.noteCount, global: m.global, assessment: assessPlayability(m, mode.intent.difficulty) }; }) : [];
    if (assessment?.status === "fail")
        for (const reason of assessment.failures)
            failures.push({ eventId: null, startSeconds: mode.phraseStartSeconds + (metrics?.global.worstAttackWindow?.startSeconds ?? 0), reason });
    for (const segment of tempoSegments)
        for (const reason of segment.assessment.failures)
            failures.push({ eventId: null, startSeconds: segment.startSeconds, reason: `Tempo interval ${segment.startSeconds.toFixed(3)}-${segment.endSeconds.toFixed(3)}s: ${reason}` });
    const spanFailed = !!metrics && completeHands && [metrics.hands.L, metrics.hands.R].some(h => Math.max(h.maxChordSpanSemitones, h.maxSoundingSpanSemitones) > mode.intent.maximumHandSpan);
    if (spanFailed)
        failures.push({ eventId: null, startSeconds: mode.phraseStartSeconds, reason: `Declared hand span exceeds ${mode.intent.maximumHandSpan} semitones` });
    const component = (status: CheckStatus, reason: string) => ({ status, reason });
    const components: StructuralPlayabilityReceiptV1["components"] = {
        range: component(!events.length ? "not-run" : failures.some(f => f.eventId !== null) ? "failed" : "passed", events.length ? "Pinned delivery pitches screened against 21-108" : "No selected notes; silence is not itself a musical defect"),
        density: component(!assessment ? "not-run" : assessment.status === "fail" || tempoSegments.some(s => s.assessment.status === "fail") ? "failed" : "passed", assessment ? [...assessment.failures, ...tempoSegments.flatMap(s => s.assessment.failures)].join("; ") || "Elapsed-time whole-phrase and constant-tempo interval checks within current limits" : "Explicit tempo/common clock unavailable"),
        handSpan: component(!completeHands || !metrics ? "not-run" : spanFailed ? "failed" : "passed", completeHands && metrics ? "Authored/declared hand mappings; no fingering inference" : "No complete trusted hand map or verified timing"),
        crossTempoBoundary: component(timing && events.length ? "passed" : "not-run", "Native elapsed-time attacks and held intervals span every tempo boundary; no average BPM used"),
    };
    const incomplete = mode.coverage !== "full-phrase" || events.some(e => !e.releaseCovered) || Object.values(components).some(c => c.status === "not-run");
    const retainedMetrics = metrics ? { timeBasis: "native-elapsed-seconds" as const, noteCount: metrics.noteCount, durationSeconds: metrics.durationSeconds, global: metrics.global, hands: completeHands ? metrics.hands : null, rapidRegions: metrics.bursts.rapidRegions.map(r => ({ startSeconds: r.startBeat + mode.phraseStartSeconds, endSeconds: r.endBeat + mode.phraseStartSeconds, rapidIoiCount: r.rapidIoiCount })) } : null;
    return { schemaVersion: 1, kind: "keyspilli-structural-playability", mode: mode.mode, occurrenceId: mode.occurrenceId, status: failures.length ? "failed" : incomplete ? "not-run" : "passed", pins: mode.pins, policySha256: sha256Text(stableJson({ version: "structural-playability-v1", audit: PLAYABILITY_AUDIT_CONFIG, limits: PLAYABILITY_LIMITS, pianoRange: [21, 108], maximumHandSpan: mode.intent.maximumHandSpan, timeBasis: "native-elapsed-seconds-at-60-unit-conversion", segmentPolicy: "native-constant-tempo-intervals-with-held-load-not-new-attacks" })), difficulty: mode.intent.difficulty, components, metrics: retainedMetrics, assessment, tempoSegments, failures, fingering: "not-assessed", keyboardAcceptance: "not-established", limitations: ["Structural screen only; no fingering, hand-size suitability or pianist approval.", "Rapid regions and top-voice leaps are diagnostic metrics, not independently calibrated difficulty gates.", ...(!completeHands ? ["Unknown/inferred hand assignments are not used for hand-specific approval."] : [])] };
}
