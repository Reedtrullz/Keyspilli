import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectLocalAudioEvidence as collect } from "./local-audio-evidence.js";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function wav(regions: Array<[number, number]> = [[0.1, 0.3], [0.5, 0.7]]) {
  const rate = 32_000, buffer = Buffer.alloc(44 + rate * 2);
  buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(rate * 2, 40);
  for (let i = 0; i < rate; i++) if (regions.some(([start, end]) => i / rate >= start && i / rate < end)) buffer.writeInt16LE(4_000, 44 + 2 * i);
  return buffer;
}

async function fixture(run: (f: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>) {
  const f = await makeFixture();
  try { await run(f); } finally { await rm(f.root, { recursive: true, force: true }); }
}
async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), "keyspilli-local-evidence-"));
  const pin = async (name: string, bytes: Uint8Array) => { const path = join(root, name); await writeFile(path, bytes); return { path, sha256: hash(bytes) }; };
  const bytes = wav();
  const audio = { ...await pin("clip.wav", bytes), bytes: bytes.length, sampleRate: 32_000, channels: 1, bitsPerSample: 16, durationSeconds: 1, assetStartSeconds: 10 };
  const events = { schemaVersion: 1, kind: "keyspilli-render-events", clock: "asset-seconds", clipSha256: audio.sha256, assetStartSeconds: 10,
    events: [{ midi: 64, startSeconds: 9.9, durationSeconds: 0.4 }, { midi: 64, startSeconds: 10.1, durationSeconds: 0.2 }, { midi: 64, startSeconds: 10.5, durationSeconds: 0.2 }] };
  const envelope = { schemaVersion: 1, runStatus: "success", mode: "listen", model: "fixture-model",
    metadata: { requested_model: "fixture-model", actual_model: "fixture-model", fallback_used: false, result_quality: "complete",
      media_coverage: { kind: "audio", captured_count: 1, gateway_attempts: 1, status: "attempted", provider_audio_acceptance: "unverified", listening_verification: "not_run", audio: [{ index: 1, sha256: audio.sha256, bytes: audio.bytes }] } },
    output_text: JSON.stringify({ attachmentStatus: "received", clips: [{ id: "A", content: "music", words: "", pitchDirection: "unknown", attacks: 3 }] }) };
  const sourceEvents = await pin("events.json", Buffer.from(JSON.stringify(events)));
  const antiObservation = await pin("anti.json", Buffer.from(JSON.stringify(envelope)));
  const clip = { id: "phrase", mode: "original", audio, sourceEvents, antiObservation };
  const manifest = { schemaVersion: 1, kind: "keyspilli-local-audio-evidence-manifest", clips: [clip] };
  const repin = async (field: "sourceEvents" | "antiObservation", value: unknown) => { const bytes = Buffer.from(JSON.stringify(value)); await writeFile(clip[field].path, bytes); clip[field].sha256 = hash(bytes); };
  return { root, pin, audio, events, envelope, clip, manifest, repin };
}

describe("local audio evidence", () => {
  it("keeps the submitted manifest identity stable while asynchronous file reads run", async () => fixture(async f => {
    const pending = collect(f.manifest);
    f.clip.id = "changed-after-start";
    expect(await pending).toMatchObject({ clips: [{ id: "phrase" }] });
  }));

  it("shows the three-vs-two advisory disagreement while preserving held notes and unknown acoustic pitch", async () => fixture(async f => {
    expect(await collect(f.manifest)).toMatchObject({ providerCalls: 0, musicalAcceptance: "not-established", calibrated: false, clips: [{
      sourceIntent: { noteOnEventCount: 2, distinctStartTimeCount: 2, overlappingEvents: [{ midi: 64, clipStartSeconds: expect.closeTo(-0.1) }, { midi: 64, clipStartSeconds: expect.closeTo(0.1) }, { midi: 64, clipStartSeconds: 0.5 }] },
      pcm: { digitalSilence: false, onsetEstimateSeconds: [expect.any(Number), expect.any(Number)] },
      acousticPitch: { status: "unavailable", pitches: null },
      advisory: { status: "observed", observation: { attacks: 3 }, listeningAttestation: "unverified" },
      disagreements: [{ kind: "advisory-source-start-count", sourceCount: 2, advisoryCount: 3 }, { kind: "advisory-pcm-onset-count", estimateCount: 2, advisoryCount: 3 }]
    }] });
  }));

  it("does not treat simultaneous chord notes as separate start times", async () => fixture(async f => {
    f.events.events = [60, 64, 67].map(midi => ({ midi, startSeconds: 10.1, durationSeconds: 0.2 }));
    await f.repin("sourceEvents", f.events);
    f.envelope.output_text = JSON.stringify({ attachmentStatus: "received", clips: [{ id: "A", content: "music", words: "", pitchDirection: "mixed", attacks: 1 }] });
    await f.repin("antiObservation", f.envelope);
    const bytes = wav([[0.1, 0.3]]); await writeFile(f.audio.path, bytes); f.audio.sha256 = hash(bytes);
    f.events.clipSha256 = f.audio.sha256; await f.repin("sourceEvents", f.events);
    f.envelope.metadata.media_coverage.audio[0]!.sha256 = f.audio.sha256; await f.repin("antiObservation", f.envelope);
    expect(await collect(f.manifest)).toMatchObject({ calibrated: false, clips: [{ sourceIntent: { noteOnEventCount: 3, distinctStartTimeCount: 1 }, disagreements: [] }] });
  }));

  it("excludes a note starting exactly at the excerpt end from its attack count", async () => fixture(async f => {
    f.events.events.push({ midi: 72, startSeconds: 11, durationSeconds: 0.5 }); await f.repin("sourceEvents", f.events);
    expect(await collect(f.manifest)).toMatchObject({ clips: [{ sourceIntent: { noteOnEventCount: 2, distinctStartTimeCount: 2, overlappingEvents: expect.arrayContaining([{ midi: 64, assetStartSeconds: 9.9, clipStartSeconds: expect.closeTo(-0.1), durationSeconds: 0.4 }]) } }] });
  }));

  for (const [declaredDuration, eventStart, expectedCount] of [[1.001, 11.0005, 2], [0.999, 10.9995, 3]]) {
    it(`uses measured duration for event boundaries when the declared duration is ${declaredDuration}`, async () => fixture(async f => {
      f.audio.durationSeconds = declaredDuration!;
      f.events.events.push({ midi: 72, startSeconds: eventStart!, durationSeconds: 0.2 });
      await f.repin("sourceEvents", f.events);
      expect(await collect(f.manifest)).toMatchObject({ clips: [{ pcm: { durationSeconds: 1 }, sourceIntent: { noteOnEventCount: expectedCount, distinctStartTimeCount: expectedCount } }] });
    }));
  }

  it("keeps null attack evidence unavailable and never approves agreement", async () => fixture(async f => {
    f.envelope.output_text = '```json\n'+JSON.stringify({ attachmentStatus: "received", clips: [{ id: "A", content: "unknown", words: "", pitchDirection: "unknown", attacks: null }] })+'\n```';
    await f.repin("antiObservation", f.envelope);
    expect(await collect(f.manifest)).toMatchObject({ musicalAcceptance: "not-established", calibrated: false, clips: [{ advisory: { observation: { attacks: null, content: "unknown" } }, disagreements: [] }] });
  }));

  it("keeps unsupplied source and advisory evidence unavailable instead of inventing zero notes", async () => fixture(async f => {
    const { sourceEvents: _s, antiObservation: _a, ...clip } = f.clip;
    expect(await collect({ ...f.manifest, clips: [clip] })).toMatchObject({ clips: [{ sourceIntent: { status: "unavailable", noteOnEventCount: null }, advisory: { status: "not-provided" }, acousticPitch: { pitches: null } }] });
  }));

  for (const field of ["audio", "sourceEvents", "antiObservation"] as const) it(`refuses changed ${field} bytes`, async () => fixture(async f => {
    await writeFile(f.clip[field].path, "changed");
    await expect(collect(f.manifest)).rejects.toThrow(/changed|hash|byte|pin/i);
  }));

  for (const field of ["clipSha256", "assetStartSeconds"] as const) it(`refuses a source event ${field} binding mismatch`, async () => fixture(async f => {
    if (field === "clipSha256") f.events.clipSha256 = "0".repeat(64); else f.events.assetStartSeconds = 0;
    await f.repin("sourceEvents", f.events);
    await expect(collect(f.manifest)).rejects.toThrow(/binding|clock|clip/i);
  }));

  it("refuses a saved response with different media even if the model output looks plausible", async () => fixture(async f => {
    f.envelope.metadata.media_coverage.audio[0]!.sha256 = "0".repeat(64); await f.repin("antiObservation", f.envelope);
    await expect(collect(f.manifest)).rejects.toThrow(/media|SHA|clip/i);
  }));

  for (const [location, field] of [["top", "scopeStatus"], ["metadata", "status"], ["metadata", "runStatus"], ["metadata", "scopeStatus"], ["metadata", "scope_status"]]) {
    it(`refuses contradictory incomplete evidence in ${location}.${field}`, async () => fixture(async f => {
      const target = (location === "top" ? f.envelope : f.envelope.metadata) as Record<string, unknown>;
      target[field!] = "PARTIAL";
      await f.repin("antiObservation", f.envelope);
      await expect(collect(f.manifest)).rejects.toThrow(/incomplete|partial/i);
    }));
  }

  for (const field of ["fallback_used", "fallbackUsed", "fallback_attempted", "fallbackAttempted"]) {
    it(`refuses contradictory ${field} evidence`, async () => fixture(async f => {
      (f.envelope.metadata as Record<string, unknown>)[field] = true;
      await f.repin("antiObservation", f.envelope);
      await expect(collect(f.manifest)).rejects.toThrow(/fallback|model/i);
    }));
  }

  for (const field of ["fallback_chain", "fallbackChain"]) for (const chain of [["other-model"], ["fixture-model", "fixture-model"]]) {
    it(`refuses contradictory ${field}=${JSON.stringify(chain)} evidence`, async () => fixture(async f => {
      (f.envelope.metadata as Record<string, unknown>)[field] = chain;
      await f.repin("antiObservation", f.envelope);
      await expect(collect(f.manifest)).rejects.toThrow(/fallback|chain/i);
    }));
  }

  it("preserves a missing-attachment model claim as a disagreement with local captured bytes", async () => fixture(async f => {
    f.envelope.output_text = JSON.stringify({ attachmentStatus: "missing", clips: [] }); await f.repin("antiObservation", f.envelope);
    expect(await collect(f.manifest)).toMatchObject({ clips: [{ advisory: { status: "missing-claim", observation: null }, disagreements: [{ kind: "advisory-attachment-claim", reported: "missing", localMedia: "available" }] }] });
  }));

  it("reports exact digital silence without turning an authored rest into a musical defect", async () => fixture(async f => {
    const bytes = wav([]); await writeFile(f.audio.path, bytes); f.audio.sha256 = hash(bytes);
    f.events.clipSha256 = f.audio.sha256; f.events.events = []; await f.repin("sourceEvents", f.events);
    const { antiObservation: _a, ...clip } = f.clip;
    expect(await collect({ ...f.manifest, clips: [clip] })).toMatchObject({ musicalAcceptance: "not-established", clips: [{ localInputStatus: "digital-silence", sourceIntent: { noteOnEventCount: 0 }, disagreements: [] }] });
  }));

  it("reports silence with authored starts as an input disagreement, not a repair decision", async () => fixture(async f => {
    const bytes = wav([]); await writeFile(f.audio.path, bytes); f.audio.sha256 = hash(bytes);
    f.events.clipSha256 = f.audio.sha256; await f.repin("sourceEvents", f.events);
    const { antiObservation: _a, ...clip } = f.clip;
    expect(await collect({ ...f.manifest, clips: [clip] })).toMatchObject({ clips: [{ disagreements: [{ kind: "digital-silence-with-authored-starts", sourceCount: 2 }] }] });
  }));

  for (const bad of [-1, 128, 1.5]) it(`refuses invalid MIDI pitch ${bad}`, async () => fixture(async f => {
    f.events.events[0]!.midi = bad; await f.repin("sourceEvents", f.events);
    await expect(collect(f.manifest)).rejects.toThrow(/event|MIDI|pitch/i);
  }));

  it("refuses malformed duration instead of manufacturing source facts", async () => fixture(async f => {
    f.events.events[0]!.durationSeconds = -1; await f.repin("sourceEvents", f.events);
    await expect(collect(f.manifest)).rejects.toThrow(/duration|event/i);
  }));

  it("refuses duplicate clip IDs", async () => fixture(async f => {
    await expect(collect({ ...f.manifest, clips: [f.clip, f.clip] })).rejects.toThrow(/duplicate/i);
  }));

  it("refuses corrupt PCM despite a freshly matching byte hash", async () => fixture(async f => {
    const bytes = Buffer.from("not a WAV"); await writeFile(f.audio.path, bytes); f.audio.sha256 = hash(bytes); f.audio.bytes = bytes.length;
    await expect(collect(f.manifest)).rejects.toThrow(/WAV|WAVE|PCM/i);
  }));
});
