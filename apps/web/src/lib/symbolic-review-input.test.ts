import { expect, it } from "vitest";
import { readFile, symlink } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import { parseMidi } from "@keyspilli/midi";
import { resolveReviewPlayback } from "./music-event-comparison.js";
import type { SongData } from "@keyspilli/player-core";
import { loadSymbolicReviewInput, validateScoreReviewInput, parseSymbolicScore } from "./symbolic-review-input.js";
import { scoreFixture } from "./score-review-test-fixture.js";
it("parses pinned MIDI without import and preserves duplicate attacks and releases", async () => {
    const f = await scoreFixture([{ midi: 60, start: 0, dur: 1, vel: 90 }, { midi: 60, start: 0, dur: 2, vel: 80 }]);
    try {
        const result = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        expect(result.modes.original?.expected).toHaveLength(2);
        expect(result.modes.original?.expected.map(e => e.keyReleaseSeconds)).toEqual([0.5, 1]);
        expect(result.modes.original?.clockVerified).toBe(true);
    }
    finally {
        await f.cleanup();
    }
});
it("refuses drift and a MIDI mislabeled as XML", async () => {
    const f = await scoreFixture();
    try {
        f.input.manifest.sha256 = "0".repeat(64);
        await expect(loadSymbolicReviewInput(validateScoreReviewInput(f.input))).rejects.toThrow(/hash/);
        expect(() => parseSymbolicScore(new Uint8Array([77, 84, 104, 100]), "musicxml")).toThrow();
    }
    finally {
        await f.cleanup();
    }
});
it("parses genuine XML and keeps unresolved clocks explicit", async () => {
    const xml = '<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>';
    const parsed = parseSymbolicScore(Buffer.from(xml), "musicxml");
    expect(parsed.notes[0]?.midi).toBe(60);
    expect(parsed.tempoBpm).toBe(120);
});
it("requires modes and explicit nullable sidecars", () => {
    expect(() => validateScoreReviewInput({ schemaVersion: 1, kind: "keyspilli-score-review-input", modes: {} })).toThrow();
});
it("retains notes crossing the left boundary as context", async () => {
    const f = await scoreFixture([{ midi: 60, start: 0, dur: 3, vel: 90 }]);
    try {
        f.manifestValue.phraseInventory[0]!.startBeat = 1;
        f.input.manifest = await f.pin("manifest-boundary.json", f.manifestValue);
        const r = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        expect(r.modes.original?.expected[0]?.scope).toBe("context");
    }
    finally {
        await f.cleanup();
    }
});
it("accepts actual pinned Player events without requiring a self-referential replay hash", async () => {
    const f = await scoreFixture();
    try {
        const song: SongData = { notes: [{ midi: 60, start: 0, dur: 1, vel: 90 }], chords: [], key: "C", tempoBpm: 120, timeSig: [4, 4], measures: [{ index: 0, startBeat: 0, endBeat: 4 }] };
        const { replaySha256: _unused, ...scope } = f.scope;
        const events = await f.pin("resolved.json", { ...scope, kind: "keyspilli-resolved-events", speed: 1, transpose: 0, tempoMapSha256: "1".repeat(64), sustainSha256: "2".repeat(64), playbackSettingsSha256: "3".repeat(64), events: resolveReviewPlayback(song, 1, 0, "occ-1") });
        f.manifestValue.replays.original.noteEvents = events;
        f.input.manifest = await f.pin("manifest-resolved.json", f.manifestValue);
        f.input.modes.original.replayEventFormat = "resolved-events-v1";
        f.input.modes.original.replayBasis = "resolved-player-events";
        f.input.modes.original.playerEvidence = await f.pin("player.json", { ...scope, kind: "keyspilli-resolver-input", song }) as never;
        const clock = JSON.parse(await readFile(f.input.modes.original.clock.evidence.path, "utf8"));
        f.input.modes.original.clock.evidence = await f.pin("resolved-clock.json", { ...clock, replaySha256: events.sha256, tempoEvents: { ...clock.tempoEvents, replay: [] } });
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        expect(n.modes.original?.basis).toBe("resolved-player-events");
        expect(n.modes.original?.replayed[0]?.keyReleaseSeconds).toBe(0.5);
        song.measures[0]!.endBeat = 0;
        f.input.modes.original.playerEvidence = await f.pin("invalid-player.json", { ...scope, kind: "keyspilli-resolver-input", song }) as never;
        await expect(loadSymbolicReviewInput(validateScoreReviewInput(f.input))).rejects.toThrow(/Player input/);
    }
    finally {
        await f.cleanup();
    }
});
it("parses genuine compressed notation but refuses to certify its unfolded clock", () => {
    const xml = '<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>';
    const bytes = zipSync({ "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>'), "score.xml": strToU8(xml) });
    const p = parseSymbolicScore(bytes, "mxl");
    expect(p.notes.map(n => n.midi)).toEqual([60]);
    expect(p.tempoMetaPresent).toBe(false);
    expect(p.unsupportedControls?.join(" ")).toContain("unfolded");
    const repeat = parseSymbolicScore(Buffer.from(xml.replace("</measure>", '<barline><repeat direction="backward"/></barline></measure>')), "musicxml");
    expect(repeat.unsupportedControls?.join(" ")).toMatch(/repeat/i);
    expect(() => parseSymbolicScore(new Uint8Array(16 * 1024 * 1024 + 1), "midi")).toThrow(/oversized/);
});
it("rejects stale sidecars, unknown event IDs and symlinked pinned inputs", async () => {
    const f = await scoreFixture();
    try {
        f.input.modes.original.roles = await f.pin("stale-roles.json", { ...f.scope, kind: "keyspilli-score-roles", occurrenceId: "wrong", assignments: {} }) as never;
        await expect(loadSymbolicReviewInput(validateScoreReviewInput(f.input))).rejects.toThrow(/scope/);
        f.input.modes.original.roles = await f.pin("unknown-roles.json", { ...f.scope, kind: "keyspilli-score-roles", assignments: { "delivery-999": { value: "melody", origin: "authored" } } }) as never;
        await expect(loadSymbolicReviewInput(validateScoreReviewInput(f.input))).rejects.toThrow(/assignment/);
        f.input.modes.original.roles = null;
        await symlink(f.input.manifest.path, `${f.root}/link.json`);
        f.input.manifest.path = `${f.root}/link.json`;
        await expect(loadSymbolicReviewInput(validateScoreReviewInput(f.input))).rejects.toThrow();
    }
    finally {
        await f.cleanup();
    }
});
it("does not promote inferred roles or hand defaults", async () => {
    const f = await scoreFixture();
    try {
        f.input.modes.original.roles = await f.pin("roles.json", { ...f.scope, kind: "keyspilli-score-roles", assignments: { "delivery-0": { value: "melody", origin: "model-estimate" } } }) as never;
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        expect(n.modes.original?.expected[0]?.role).toBeNull();
        expect(n.modes.original?.expected[0]?.hand).toBeNull();
        f.input.modes.original.clock.timingKnown = false;
        expect((await loadSymbolicReviewInput(validateScoreReviewInput(f.input))).modes.original?.clockVerified).toBe(false);
    }
    finally {
        await f.cleanup();
    }
});
it("integrates native tempo boundaries and applies origin speed and transpose once", async () => {
    const f = await scoreFixture();
    try {
        // Format-0 MIDI: hold C4 for two beats, with 120 -> 60 BPM at beat one.
        const track = [0, 255, 81, 3, 7, 161, 32, 0, 144, 60, 90, 4, 255, 81, 3, 15, 66, 64, 4, 128, 60, 0, 0, 255, 47, 0];
        const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 4, 77, 84, 114, 107, 0, 0, 0, track.length, ...track]);
        const pin = await f.pin("tempo.mid", bytes);
        f.input.modes.original.deliveredScore = { ...pin, format: "midi" };
        f.manifestValue.source = { ...pin, format: "midi" };
        f.manifestValue.replays.original.noteEvents = pin;
        f.input.manifest = await f.pin("tempo-manifest.json", f.manifestValue);
        const tempos = parseMidi(bytes).tempoEvents;
        f.input.modes.original.clock.speed = 2;
        f.input.modes.original.clock.evidence = await f.pin("tempo-clock.json", { ...f.scope, sourceSha256: pin.sha256, deliverySha256: pin.sha256, replaySha256: pin.sha256, kind: "keyspilli-score-clock", sourceStartBeat: 0, sourceStartSeconds: 0, candidateStartSeconds: 0, speed: 2, transpose: 0, tempoEvents: { source: tempos, delivery: tempos, replay: tempos } });
        const n = await loadSymbolicReviewInput(validateScoreReviewInput(f.input));
        expect(n.modes.original?.expected[0]?.keyReleaseSeconds).toBe(0.75);
        expect(n.modes.original?.replayed[0]?.keyReleaseSeconds).toBe(0.75);
        f.input.modes.original.clock.sourceStartSeconds = 1;
        await expect(loadSymbolicReviewInput(validateScoreReviewInput(f.input))).rejects.toThrow(/clock/);
    }
    finally {
        await f.cleanup();
    }
});
