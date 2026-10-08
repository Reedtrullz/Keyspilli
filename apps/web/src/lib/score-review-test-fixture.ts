import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMidi, parseMidi, type Note } from "@keyspilli/midi";
export const fixtureHash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export async function scoreFixture(expected: Note[] = [{ midi: 60, start: 0, dur: 1, vel: 90 }], actual = expected, fixtureRoot?: string) {
    const root = fixtureRoot ?? await mkdtemp(join(tmpdir(), "score-review-"));
    if (fixtureRoot)
        await mkdir(root, { recursive: false, mode: 0o700 });
    const pin = async (name: string, data: Uint8Array | string | object) => {
        const bytes = typeof data === "object" && !(data instanceof Uint8Array) ? JSON.stringify(data) : data as Uint8Array | string;
        const path = join(root, name);
        await writeFile(path, bytes);
        return { path, sha256: fixtureHash(bytes) };
    };
    const delivery = await pin("delivery.mid", writeMidi(expected, { tempoBpm: 120 }));
    const replay = await pin("replay.mid", writeMidi(actual, { tempoBpm: 120 }));
    const asset = await pin("unused.wav", "offline review never reads audio");
    const artifact = await pin("legacy.json", {});
    const symbolic = { status: "not-run", reason: "Fixture" };
    const replayMode = { difficulty: "medium", resolvedVariantId: "fixture-v1", asset: { ...asset, durationSeconds: 2 }, replaySnapshot: artifact, noteEvents: replay, tempoMapSha256: "1".repeat(64), sustainSha256: "2".repeat(64), playbackSettingsSha256: "3".repeat(64), renderer: { backend: "fixture", version: "1", sampleRate: 44100, channels: 1, gain: 1, settingsSha256: "4".repeat(64), instrument: { name: "offline fixture", bankPath: asset.path, bankSha256: asset.sha256 }, evidenceClass: "synthetic-control" }, symbolicChecks: { exactNotes: symbolic, playability: symbolic } };
    const clip = { ...asset, bytes: 44, sampleRate: 44100, channels: 1, bitsPerSample: 16, durationSeconds: 2, assetStartSeconds: 0 };
    const timeAnchors = [{ assetSeconds: 0, sourceBeat: 0 }, { assetSeconds: 2, sourceBeat: 4 }];
    const manifestValue = { schemaVersion: 2, kind: "keyspilli-audio-review-manifest", source: { ...delivery, format: "midi" }, reference: { asset: { ...asset, durationSeconds: 2 }, identity: { title: "Self-authored software control", evidence: "Not a song recording" } }, phraseInventory: [{ id: "phrase", kind: "opening", startBeat: 0, endBeat: 4 }], replays: { original: replayMode, chords: replayMode }, jobs: [{ id: "control-original", mode: "original", phraseId: "phrase", referenceClip: clip, candidateClip: clip, alignment: { status: "unverified", method: "fixture", evidence: artifact, referenceAnchors: timeAnchors, candidateAnchors: timeAnchors } }] };
    const manifest = await pin("manifest.json", manifestValue);
    const clockFields = { sourceStartBeat: 0, sourceStartSeconds: 0, candidateStartSeconds: 0, speed: 1, transpose: 0 };
    const scope = { schemaVersion: 1, mode: "original", occurrenceId: "occ-1", sourceSha256: delivery.sha256, deliverySha256: delivery.sha256, replaySha256: replay.sha256 };
    const clock = await pin("clock.json", { ...scope, kind: "keyspilli-score-clock", ...clockFields, tempoEvents: { source: parseMidi(await import("node:fs/promises").then(fs => fs.readFile(delivery.path))).tempoEvents, delivery: parseMidi(await import("node:fs/promises").then(fs => fs.readFile(delivery.path))).tempoEvents, replay: parseMidi(await import("node:fs/promises").then(fs => fs.readFile(replay.path))).tempoEvents } });
    const input = { schemaVersion: 1, kind: "keyspilli-score-review-input", manifest, source: { authority: "unknown", relationship: "unknown", anchors: null, validationReceipt: null }, modes: { original: { deliveredScore: { ...delivery, format: "midi" }, replayEventFormat: "midi", replayBasis: "supplied-symbolic-files", intent: { mode: "original", difficulty: "medium", approvedTransformations: [], maximumHandSpan: 12 }, occurrenceId: "occ-1", coverage: "full-phrase", clock: { ...clockFields, timingKnown: true, evidence: clock }, roles: null, hands: null, playerEvidence: null } } };
    return { root, pin, input, delivery, replay, scope, manifestValue, cleanup: () => rm(root, { recursive: true, force: true }) };
}
