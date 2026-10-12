/** Entirely self-authored distributable software fixture. Captures are simulated, never actual Player evidence. */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { writeMidi } from "@keyspilli/midi";
import { identityHash } from "../../src/acoustic-receipt.js";
import type { ExactInputRegistry, ExactAssetRole } from "../../src/exact-input-evidence.js";
import { prepareFullOutputReview, type FullOutputReviewRequest, type FullReviewMode } from "../../src/full-output-review.js";
const sha = (s: Uint8Array | string) => createHash("sha256").update(s).digest("hex");
function wav() {
  const b = Buffer.alloc(32044); b.write("RIFF"); b.writeUInt32LE(b.length - 8, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(32000, 40);
  for (let i = 0; i < 16000; i++) b.writeInt16LE(Math.round(500 * Math.sin(i * 2 * Math.PI * 220 / 8000)), 44 + i * 2);
  return b;
}
export async function createFullOutputFixture(root: string) {
  const registry: ExactInputRegistry = { schemaVersion: 1, kind: "keyspilli-exact-input-registry", assets: [], snapshots: [] };
  async function add(id: string, value: Uint8Array | string | object, role: ExactAssetRole = "output") {
    const bytes = typeof value === "string" || value instanceof Uint8Array ? value : JSON.stringify(value);
    await writeFile(join(root, id), bytes, { flag: "wx", mode: 0o600 });
    registry.assets.push({ id, sha256: sha(bytes), bytes: Buffer.byteLength(bytes), role,
      permission: { basis: "self-authored", scopes: ["audit", "review"], evidence: "Authored distributable software fixture, not a real Player capture." },
      locations: [{ rootId: "local", path: id }], snapshots: [], transformation: null });
    return sha(bytes);
  }
  const sourceSha = await add("source", "Authored one-note composition", "source");
  await add("source-clock", { basis: "source-native-seconds", startSeconds: 0, endSeconds: 2 }, "clock");
  await add("code", "authored test code", "code"); await add("config", { speed: 1, transpose: 0 }, "config"); await add("renderer", { name: "authored-fixture-no-real-player" }, "renderer");
  const modes: FullReviewMode[] = [];
  for (const mode of ["Original", "Chords"] as const) {
    const prefix = mode.toLowerCase(), pitch = mode === "Original" ? 60 : 48;
    const notes = [{ midi: pitch, start: 0, dur: 4, vel: 80 }];
    await add(`${prefix}-midi`, writeMidi(notes, { tempoBpm: 120 }));
    await add(`${prefix}-xml`, `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="120"/></direction><note><pitch><step>C</step><octave>${mode === "Original" ? 4 : 3}</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`);
    const snapshotSha = await add(`${prefix}-snapshot`, { schemaVersion: 1, tempoBpm: 120, timeSig: [4, 4], endBeatExclusive: 4, notes, chords: [] });
    const audioSha = await add(`${prefix}-audio`, wav());
    await add(`${prefix}-plan`, { songId: "fixture-a", mode: prefix, durationMs: 2000, expectedAttackSeconds: [0] });
    await add(`${prefix}-capture`, { schemaVersion: 1, kind: "keyspilli-player-capture", id: prefix,
      audio: { sha256: audioSha, durationSeconds: 2, sampleRate: 8000, channels: 1, frames: 16000, derivativeSha256: null },
      capture: { sha256: audioSha, durationSeconds: 2, sampleRate: 8000, recorderClock: "audio-worklet-frame", firstSampleContextSeconds: 0, sourceClockOffsetSeconds: 0,
        sampleAssets: [{ url: "https://fixture.invalid/authored", sha256: sha("test sample"), bytes: 12 }], rms: 0.01, peak: 0.02 } }, "receipt");
    await add(`${prefix}-clock`, { basis: "resolved-playback-seconds", endBeat: 4, endSeconds: 2, captureOffsetSeconds: 0, speed: 1, transpose: 0, audioSha256: audioSha, snapshotSha256: snapshotSha }, "clock");
    modes.push({ mode, identity: { baseId: "fixture", variantId: "fixture-a", mode, publicationRevision: "candidate1", sourceArtifactSha256: sourceSha, sourceFingerprint: "fixture-source-v1", playbackSha256: snapshotSha },
      outputClock: { assetId: `${prefix}-clock`, endBeat: 4, endSeconds: 2, captureOffsetSeconds: 0 },
      artifacts: { midi: `${prefix}-midi`, musicxml: `${prefix}-xml`, playerSnapshot: `${prefix}-snapshot`, playerCapture: `${prefix}-capture`, playerAudio: `${prefix}-audio`, capturePlan: `${prefix}-plan` }, receiptAssetIds: [] });
  }
  const request: FullOutputReviewRequest = { schemaVersion: 1, kind: "keyspilli-full-output-review-request", registrySha256: identityHash(registry),
    pieces: [{ id: "fixture", compositionId: "authored-one-note", performanceId: "authored-performance", classification: "synthetic", sourceAssetId: "source",
      sourceClock: { assetId: "source-clock", startSeconds: 0, endSeconds: 2 }, provenance: { code: "code", config: "config", renderer: "renderer" }, modes }] };
  const prepare = () => { request.registrySha256 = identityHash(registry); return prepareFullOutputReview(request, registry, { local: root }); };
  const replace = async (id: string, change: (value: Record<string, unknown>) => Record<string, unknown>) => {
    const value = change(JSON.parse(await readFile(join(root, id), "utf8"))), bytes = JSON.stringify(value);
    await writeFile(join(root, id), bytes); const a = registry.assets.find(a => a.id === id)!; a.sha256 = sha(bytes); a.bytes = Buffer.byteLength(bytes);
  };
  return { root, registry, request, add, prepare, replace };
}
