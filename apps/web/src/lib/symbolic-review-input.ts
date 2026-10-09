import { constants } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMidi, parseMusicXmlNotes, midiBeatToNativeSeconds, type ParsedMidi } from "@keyspilli/midi";
import { adaptNativeSymbolicBytes } from "@keyspilli/catalog/src/native-score-adapter.js";
import { assertMusic } from "@keyspilli/catalog/src/acoustic-receipt.js";
import { stableJson, sha256Text, validateReviewManifest, type ReviewManifest, type ReviewMode } from "./audio-review.js";
import { createHash } from "node:crypto";
import type { ArrangementIntent, SourceAnchors } from "./music-correspondence.js";
import { resolveReviewPlayback } from "./music-event-comparison.js";
import type { SongData } from "@keyspilli/player-core";
import { validatePlaybackData } from "@keyspilli/player-core";
export type FilePin = {
    path: string;
    sha256: string;
};
export type CheckStatus = "passed" | "failed" | "not-run" | "authority-unknown";
export type SourceAuthority = SourceAnchors["authority"];
export type EvidenceBasis = "supplied-symbolic-files" | "resolved-player-events";
export interface ScoreReviewModeInput {
    deliveredScore: FilePin & {
        format: "midi" | "musicxml" | "mxl";
    };
    replayEventFormat: "midi" | "resolved-events-v1";
    replayBasis: EvidenceBasis;
    intent: ArrangementIntent;
    occurrenceId: string;
    coverage: "full-phrase" | "partial";
    clock: {
        sourceStartBeat: number;
        sourceStartSeconds: number;
        candidateStartSeconds: number;
        speed: number;
        transpose: number;
        timingKnown: boolean;
        evidence: FilePin | null;
    };
    roles: FilePin | null;
    hands: FilePin | null;
    playerEvidence: FilePin | null;
}
export interface ScoreReviewInputV1 {
    schemaVersion: 1;
    kind: "keyspilli-score-review-input";
    manifest: FilePin;
    source: {
        authority: SourceAuthority;
        relationship: "independent-reference" | "derived-from-candidate" | "unknown";
        anchors: FilePin | null;
        validationReceipt: FilePin | null;
    };
    modes: Partial<Record<ReviewMode, ScoreReviewModeInput>>;
}
export interface NormalizedScoreEvent {
    id: string;
    occurrenceId: string;
    midi: number;
    onsetSeconds: number;
    keyReleaseSeconds: number;
    originalBeat: number;
    role: "melody" | "bass" | "harmony" | null;
    hand: "L" | "R" | null;
    provenance: {
        role: string;
        hand: string;
    };
    scope: "attack" | "context";
    releaseCovered: boolean;
}
export interface NormalizedScoreReviewMode {
    mode: ReviewMode;
    phraseId: string;
    occurrenceId: string;
    expected: NormalizedScoreEvent[];
    replayed: NormalizedScoreEvent[];
    pins: {
        source: string;
        delivery: string;
        replay: string;
        clock: string | null;
        roles: string | null;
        hands: string | null;
        player: string | null;
    };
    intent: ArrangementIntent;
    basis: EvidenceBasis;
    coverage: "full-phrase" | "partial";
    clock: ScoreReviewModeInput["clock"];
    clockVerified: boolean;
    tempoKnown: boolean;
    tempoEvents: NonNullable<ParsedMidi["tempoEvents"]>;
    tempoDivision: number;
    nativeTempoBpm: number;
    phraseStartSeconds: number;
    phraseEndSeconds: number;
    unavailableReasons: string[];
}
export interface NormalizedScoreReviewInput {
    input: ScoreReviewInputV1;
    inputSha256: string;
    manifest: ReviewManifest;
    manifestSha256: string;
    source: ScoreReviewInputV1["source"] & {
        anchorsValue: SourceAnchors | null;
        validationReceiptValue: unknown | null;
    };
    modes: Partial<Record<ReviewMode, NormalizedScoreReviewMode>>;
}
export const SCORE_INPUT_LIMITS = { bytes: 16 * 1024 * 1024, events: 20000 } as const;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export const isFilePin = (v: unknown): v is FilePin => record(v) && typeof v.path === "string" && isAbsolute(v.path) && !/[\0\r\n]/.test(v.path) && typeof v.sha256 === "string" && /^[a-f0-9]{64}$/.test(v.sha256);
const nullablePin = (v: unknown) => v === null || isFilePin(v);
export function validateScoreReviewInput(value: unknown): ScoreReviewInputV1 {
    assertMusic(record(value) && value.schemaVersion === 1 && value.kind === "keyspilli-score-review-input" && isFilePin(value.manifest), "unsupported score review input/manifest pin");
    const source = value.source;
    assertMusic(record(source) && ["unknown", "model-estimate", "self-authored", "human-validated"].includes(String(source.authority)) && ["independent-reference", "derived-from-candidate", "unknown"].includes(String(source.relationship)) && nullablePin(source.anchors) && nullablePin(source.validationReceipt), "invalid source authority/pins");
    assertMusic(record(value.modes) && Object.keys(value.modes).length > 0 && Object.keys(value.modes).every(k => k === "original" || k === "chords"), "nonempty supported modes required");
    for (const [mode, entry] of Object.entries(value.modes)) {
        assertMusic(record(entry) && record(entry.deliveredScore) && ["midi", "musicxml", "mxl"].includes(String(entry.deliveredScore.format)) && isFilePin(entry.deliveredScore), "invalid delivery pin/format");
        assertMusic(["midi", "resolved-events-v1"].includes(String(entry.replayEventFormat)) && ["supplied-symbolic-files", "resolved-player-events"].includes(String(entry.replayBasis)), "invalid replay format/basis");
        assertMusic(typeof entry.occurrenceId === "string" && /^[\w.-]{1,120}$/.test(entry.occurrenceId) && ["full-phrase", "partial"].includes(String(entry.coverage)), "invalid occurrence/coverage");
        const intent = entry.intent, clock = entry.clock;
        assertMusic(record(intent) && intent.mode === mode && ["beginner", "medium", "advanced"].includes(String(intent.difficulty)) && Number.isInteger(intent.maximumHandSpan) && Number(intent.maximumHandSpan) > 0 && Number(intent.maximumHandSpan) <= 24 && Array.isArray(intent.approvedTransformations) && intent.approvedTransformations.every(t => ["octave-displacement", "alternate-voicing", "density-reduction"].includes(String(t))), "invalid arrangement intent");
        assertMusic(record(clock) && [clock.sourceStartBeat, clock.sourceStartSeconds, clock.candidateStartSeconds].every(v => finite(v) && v >= 0) && finite(clock.speed) && clock.speed > 0 && clock.speed <= 4 && Number.isInteger(clock.transpose) && Math.abs(Number(clock.transpose)) <= 48 && typeof clock.timingKnown === "boolean" && nullablePin(clock.evidence), "invalid score clock");
        assertMusic(nullablePin(entry.roles) && nullablePin(entry.hands) && nullablePin(entry.playerEvidence), "explicit nullable sidecar pins required");
        assertMusic(entry.replayEventFormat !== "midi" || entry.replayBasis === "supplied-symbolic-files", "MIDI export cannot establish Player realization");
    }
    return JSON.parse(JSON.stringify(value)) as ScoreReviewInputV1;
}
export async function readBoundedScoreFile(path: string): Promise<Buffer> {
    assertMusic(isAbsolute(path), "absolute score input path required");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const info = await handle.stat();
        assertMusic(info.isFile() && info.size > 0 && info.size <= SCORE_INPUT_LIMITS.bytes, "score input exceeds bounded file limit or is empty");
        const buffer = Buffer.alloc(info.size + 1);
        let offset = 0;
        while (offset < buffer.length) {
            const result = await handle.read(buffer, offset, buffer.length - offset, offset);
            if (!result.bytesRead)
                break;
            offset += result.bytesRead;
        }
        assertMusic(offset === info.size, "file bytes changed during read");
        return buffer.subarray(0, offset);
    }
    finally {
        await handle.close();
    }
}
export async function readScorePin(pin: FilePin): Promise<Buffer> {
    assertMusic(isFilePin(pin), "invalid file pin");
    const bytes = await readBoundedScoreFile(pin.path);
    assertMusic(hash(bytes) === pin.sha256, "file bytes/hash changed");
    return bytes;
}
export async function readScoreJson(pin: FilePin): Promise<unknown> { return JSON.parse((await readScorePin(pin)).toString("utf8")); }
export function parseSymbolicScore(bytes: Uint8Array, format: "midi" | "musicxml" | "mxl"): ParsedMidi {
    assertMusic(bytes.length <= SCORE_INPUT_LIMITS.bytes, "oversized symbolic score");
    const adapted = adaptNativeSymbolicBytes(bytes, format, { maxBytes: SCORE_INPUT_LIMITS.bytes });
    assertMusic(adapted.status === "parsed", `native score parse failed: ${adapted.status}`);
    let parsed: ParsedMidi;
    if (format === "midi")
        parsed = parseMidi(bytes);
    else if (format === "musicxml") {
        try {
            parsed = parseMusicXmlNotes(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        }
        catch (error) {
            assertMusic(error instanceof Error && error.message.startsWith("Unsupported"), "invalid MusicXML timing/events");
            const notes = adapted.score.parts.flatMap(part => part.measures.flatMap(m => (m.events ?? []).map(e => ({ midi: e.pitch, start: (m.startBeat ?? 0) + e.onset, dur: e.duration, vel: 90 }))));
            parsed = { notes, format: 1, division: 480, tempoBpm: adapted.score.tempoBpm ?? 120, tempoMetaPresent: false, keySig: 0, keyMode: 0, timeSig: [4, 4], trackNames: [], durationBeats: Math.max(0, ...notes.map(n => n.start + n.dur)), unsupportedControls: [error.message] };
        }
    }
    else {
        // The bounded notation adapter extracts MXL. Its single-tempo view cannot certify a playback clock.
        const notes = adapted.score.parts.flatMap(part => part.measures.flatMap(measure => {
            const events = [...(measure.events ?? []), ...(measure.voices ?? []).flatMap(v => v.events ?? []), ...(measure.staves ?? []).flatMap(s => [...(s.events ?? []), ...(s.voices ?? []).flatMap(v => v.events ?? [])])];
            return events.map(e => ({ midi: e.pitch, start: (measure.startBeat ?? 0) + e.onset, dur: e.duration, vel: 90 }));
        }));
        parsed = { notes, format: 1, division: 480, tempoBpm: adapted.score.tempoBpm ?? 120, tempoMetaPresent: false, keySig: 0, keyMode: 0, timeSig: [4, 4], trackNames: [], durationBeats: Math.max(0, ...notes.map(n => n.start + n.dur)), unsupportedControls: ["MXL repeat/tempo clock requires an unfolded native timing export"] };
    }
    assertMusic(parsed.notes.length <= SCORE_INPUT_LIMITS.events, "symbolic event budget exceeded");
    for (const n of parsed.notes)
        assertMusic(Number.isInteger(n.midi) && n.midi >= 0 && n.midi <= 127 && finite(n.start) && n.start >= 0 && finite(n.dur) && n.dur > 0, "invalid symbolic note");
    if (adapted.warnings.length)
        parsed.unsupportedControls = [...(parsed.unsupportedControls ?? []), ...adapted.warnings];
    return parsed;
}
function nativeEvents(parsed: ParsedMidi, prefix: string, input: ScoreReviewModeInput, start: number, end: number): NormalizedScoreEvent[] {
    const origin = prefix === "delivery" ? input.clock.sourceStartSeconds : input.clock.candidateStartSeconds;
    const sorted = [...parsed.notes].sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur);
    return sorted.map((n, i) => ({ id: `${prefix}-${i}`, occurrenceId: input.occurrenceId, midi: n.midi + (prefix === "delivery" ? input.clock.transpose : 0), onsetSeconds: (midiBeatToNativeSeconds(parsed, n.start) - origin) / input.clock.speed, keyReleaseSeconds: (midiBeatToNativeSeconds(parsed, n.start + n.dur) - origin) / input.clock.speed, originalBeat: n.start, role: null, hand: null, provenance: { role: "unknown", hand: "unknown" }, scope: "attack" as const, releaseCovered: true })).filter(e => e.onsetSeconds < end && e.keyReleaseSeconds > start).map(e => ({ ...e, scope: e.onsetSeconds < start ? "context" : "attack", releaseCovered: e.keyReleaseSeconds <= end + 1e-9 }));
}
function validateScope(value: unknown, kind: string, mode: ReviewMode, entry: ScoreReviewModeInput, pins: NormalizedScoreReviewMode["pins"]): asserts value is Record<string, unknown> {
    // Event bytes are hashed by their external pin, never by a self-referential field.
    assertMusic(record(value) && value.schemaVersion === 1 && value.kind === kind && value.mode === mode && value.occurrenceId === entry.occurrenceId && value.sourceSha256 === pins.source && value.deliverySha256 === pins.delivery && (kind === "keyspilli-resolved-events" ? !("replaySha256" in value) : value.replaySha256 === pins.replay), "stale or wrong-scope sidecar");
}
async function assignments(pin: FilePin | null, field: "role" | "hand", events: NormalizedScoreEvent[], mode: ReviewMode, entry: ScoreReviewModeInput, pins: NormalizedScoreReviewMode["pins"]) {
    if (!pin)
        return;
    const value = await readScoreJson(pin);
    validateScope(value, field === "role" ? "keyspilli-score-roles" : "keyspilli-score-hands", mode, entry, pins);
    assertMusic(record(value.assignments) && Object.keys(value.assignments).length <= SCORE_INPUT_LIMITS.events * 2, "invalid sidecar assignments");
    const byId = new Map(events.map(e => [e.id, e]));
    for (const [id, assignment] of Object.entries(value.assignments)) {
        const event = byId.get(id);
        assertMusic(event && record(assignment) && ["authored", "declared", "model-estimate", "unknown"].includes(String(assignment.origin)), "assignment event/provenance missing");
        const allowed = field === "role" ? ["melody", "bass", "harmony"] : ["L", "R"];
        assertMusic(assignment.value === null || allowed.includes(String(assignment.value)), "invalid role/hand assignment");
        if (assignment.origin === "authored" || assignment.origin === "declared") {
            if (field === "role")
                event.role = assignment.value as NormalizedScoreEvent["role"];
            else
                event.hand = assignment.value as NormalizedScoreEvent["hand"];
        }
        event.provenance[field] = String(assignment.origin);
    }
}
export async function loadSymbolicReviewInput(input: ScoreReviewInputV1): Promise<NormalizedScoreReviewInput> {
    input = validateScoreReviewInput(input);
    const manifest = validateReviewManifest(await readScoreJson(input.manifest));
    const sourceParsed = parseSymbolicScore(await readScorePin(manifest.source), manifest.source.format);
    const anchorsValue = input.source.anchors ? await readScoreJson(input.source.anchors) as SourceAnchors : null;
    if (anchorsValue)
        assertMusic(anchorsValue.sha256 === manifest.source.sha256 && anchorsValue.authority === input.source.authority && Array.isArray(anchorsValue.anchors) && anchorsValue.anchors.length <= SCORE_INPUT_LIMITS.events, "source anchor identity mismatch");
    const validationReceiptValue = input.source.validationReceipt ? await readScoreJson(input.source.validationReceipt) : null;
    const result: NormalizedScoreReviewInput = { input, inputSha256: sha256Text(stableJson(input)), manifest, manifestSha256: input.manifest.sha256, source: { ...input.source, anchorsValue, validationReceiptValue }, modes: {} };
    for (const [key, entry] of Object.entries(input.modes)) {
        const mode = key as ReviewMode;
        assertMusic(entry, "missing mode");
        const jobs = manifest.jobs.filter(j => j.mode === mode);
        assertMusic(jobs.length === 1 && entry.intent.difficulty === manifest.replays[mode].difficulty, "one phrase per mode and matching difficulty required");
        const phrase = manifest.phraseInventory.find(p => p.id === jobs[0]!.phraseId)!;
        const delivered = parseSymbolicScore(await readScorePin(entry.deliveredScore), entry.deliveredScore.format);
        const replayPin = manifest.replays[mode].noteEvents;
        const replayBytes = await readScorePin(replayPin);
        const pins = { source: manifest.source.sha256, delivery: entry.deliveredScore.sha256, replay: replayPin.sha256, clock: entry.clock.evidence?.sha256 ?? null, roles: entry.roles?.sha256 ?? null, hands: entry.hands?.sha256 ?? null, player: entry.playerEvidence?.sha256 ?? null };
        const unavailableReasons: string[] = [];
        if (!entry.clock.timingKnown || !entry.clock.evidence)
            unavailableReasons.push("No verified common clock; cross-clock conformance unavailable");
        const start = (midiBeatToNativeSeconds(sourceParsed, phrase.startBeat) - entry.clock.sourceStartSeconds) / entry.clock.speed;
        const end = (midiBeatToNativeSeconds(sourceParsed, phrase.endBeat) - entry.clock.sourceStartSeconds) / entry.clock.speed;
        let replayParsed: ParsedMidi | null = null, replayed: NormalizedScoreEvent[];
        if (entry.replayEventFormat === "midi") {
            replayParsed = parseSymbolicScore(replayBytes, "midi");
            replayed = nativeEvents(replayParsed, "replay", entry, -Infinity, Infinity);
        }
        else {
            const events = JSON.parse(replayBytes.toString("utf8"));
            validateScope(events, "keyspilli-resolved-events", mode, entry, pins);
            assertMusic(entry.playerEvidence && entry.replayBasis === "resolved-player-events" && Array.isArray(events.events) && events.events.length <= SCORE_INPUT_LIMITS.events, "resolved events require pinned Player input evidence");
            const evidence = await readScoreJson(entry.playerEvidence);
            assertMusic(record(evidence) && evidence.kind === "keyspilli-resolver-input" && evidence.schemaVersion === 1 && evidence.deliverySha256 === pins.delivery && evidence.sourceSha256 === pins.source && record(evidence.song), "invalid Player resolver input");
            const song = evidence.song as unknown as SongData;
            assertMusic(Array.isArray(song.notes) && song.notes.length <= SCORE_INPUT_LIMITS.events && Array.isArray(song.measures) && validatePlaybackData(song).length === 0 && finite(song.tempoBpm) && song.tempoBpm > 0 && Array.isArray(song.timeSig) && song.timeSig.length === 2 && song.timeSig.every(n => finite(n) && n > 0), "invalid Player input timing");
            const resolverInput = [...song.notes].sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur);
            assertMusic(stableJson(resolverInput.map(n => [n.midi, n.start, n.dur])) === stableJson([...delivered.notes].sort((a, b) => a.start - b.start || a.midi - b.midi || a.dur - b.dur).map(n => [n.midi, n.start, n.dur])), "Player input differs from pinned delivery");
            assertMusic(events.speed === entry.clock.speed && events.transpose === entry.clock.transpose && events.tempoMapSha256 === manifest.replays[mode].tempoMapSha256 && events.sustainSha256 === manifest.replays[mode].sustainSha256 && events.playbackSettingsSha256 === manifest.replays[mode].playbackSettingsSha256, "stale resolved settings");
            const resolved = resolveReviewPlayback(song, entry.clock.speed, entry.clock.transpose, entry.occurrenceId);
            assertMusic(stableJson(events.events) === stableJson(resolved), "resolved events differ from current Player resolver");
            replayed = resolved.map((e, i) => ({ ...e, originalBeat: delivered.notes[i]?.start ?? 0, role: null, hand: null, provenance: { role: "unknown", hand: "unknown" }, scope: "attack" as const, releaseCovered: true }));
        }
        for (const parsed of [sourceParsed, delivered, replayParsed].filter((p): p is ParsedMidi => !!p)) {
            if (parsed.tempoMetaPresent !== true)
                unavailableReasons.push("Native explicit tempo unavailable; parser default tempo is not verified timing");
            if (parsed.repeatPlayback === "declared")
                unavailableReasons.push("Repeat clock is self-declared, not verified unfolded timing");
            const controls = (parsed.unsupportedControls ?? []).filter(c => c !== "program changes");
            if (controls.length)
                unavailableReasons.push(`Unsupported score clock/control: ${controls.join(", ")}`);
        }
        if (entry.clock.evidence) {
            const clock = await readScoreJson(entry.clock.evidence);
            validateScope(clock, "keyspilli-score-clock", mode, entry, pins);
            for (const field of ["sourceStartBeat", "sourceStartSeconds", "candidateStartSeconds", "speed", "transpose"] as const)
                assertMusic(clock[field] === entry.clock[field], "clock origin/settings changed");
            assertMusic(Math.abs(midiBeatToNativeSeconds(sourceParsed, entry.clock.sourceStartBeat) - entry.clock.sourceStartSeconds) <= 1e-6, "source origin differs from native tempo mapping");
            assertMusic(stableJson(clock.tempoEvents) === stableJson({ source: sourceParsed.tempoEvents ?? [], delivery: delivered.tempoEvents ?? [], replay: replayParsed?.tempoEvents ?? [] }), "native tempo map differs from pinned clock");
        }
        const expected = nativeEvents(delivered, "delivery", entry, -Infinity, Infinity);
        await assignments(entry.roles, "role", [...expected, ...replayed], mode, entry, pins);
        await assignments(entry.hands, "hand", [...expected, ...replayed], mode, entry, pins);
        const select = (events: NormalizedScoreEvent[]): NormalizedScoreEvent[] => events.filter(e => e.onsetSeconds < end && e.keyReleaseSeconds > start).map(e => ({ ...e, scope: e.onsetSeconds < start ? "context" : "attack", releaseCovered: e.keyReleaseSeconds <= end + 1e-9 }));
        result.modes[mode] = { mode, phraseId: phrase.id, occurrenceId: entry.occurrenceId, expected: select(expected), replayed: select(replayed), pins, intent: entry.intent, basis: entry.replayBasis, coverage: entry.coverage, clock: entry.clock, clockVerified: unavailableReasons.length === 0, tempoKnown: delivered.tempoMetaPresent === true, tempoEvents: delivered.tempoEvents ?? [], tempoDivision: delivered.division, nativeTempoBpm: delivered.tempoBpm, phraseStartSeconds: start, phraseEndSeconds: end, unavailableReasons };
    }
    return result;
}
export async function scoreReviewCodeIdentity() {
    const paths = ["symbolic-review-input.ts", "symbolic-review.ts", "symbolic-playability.ts", "score-review.ts", "score-review-repair.ts", "audio-review.ts", "music-correspondence.ts", "music-source-validation.ts", "music-event-comparison.ts"].map(p => new URL(p, import.meta.url));
    const shared = ["package-lock.json", "packages/midi/src/parse.ts", "packages/midi/src/parseXml.ts", "packages/midi/src/playability-audit.ts", "packages/midi/src/validate.ts", "packages/catalog/src/native-score-adapter.ts", "packages/catalog/src/omr-musicxml.ts", "packages/catalog/src/acoustic-receipt.ts", "packages/catalog/src/music-benchmark.ts", "packages/player-core/src/index.ts", "packages/player-core/src/timeline.ts", "packages/player-core/src/articulation.ts", "apps/web/src/lib/music-repair-preview.ts", "apps/web/scripts/review-score.mts", "apps/web/scripts/review-song-audio.mts", "apps/web/schemas/audio-review-evidence-v2.json"].map(p => new URL(`../../../../${p}`, import.meta.url));
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const inventory = await Promise.all([...paths, ...shared].map(async (url) => ({ path: relative(root, fileURLToPath(url)), sha256: hash(await readFile(url)) })));
    inventory.sort((a, b) => a.path.localeCompare(b.path));
    return { sha256: sha256Text(stableJson(inventory)), inventory };
}
