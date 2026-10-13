import { afterAll, beforeAll, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEVEL_ORDER, canonicalPhrasePlan, parseMidi, sourcePhraseClock, writeMidi, type PhrasePlanV1 } from "@keyspilli/midi";
import { ingestSource, type IngestInput } from "../src/ingest.js";
import { getSongsByBase } from "../src/db.js";

const root = mkdtempSync(join(tmpdir(), "keyspilli-phrase-ingest-"));
const old = process.env.KEYSPILLI_DATA_DIR;
beforeAll(() => { process.env.KEYSPILLI_DATA_DIR = root; });
afterAll(() => { if (old === undefined) delete process.env.KEYSPILLI_DATA_DIR; else process.env.KEYSPILLI_DATA_DIR = old; rmSync(root, { recursive: true, force: true }); });
function fixture(baseId: string) {
  const buf = writeMidi(Array.from({ length: 16 }, (_, i) => ({ midi: 60 + i % 5, start: i * 2 + 1 / 3,
    dur: 1 / 3, vel: 80, hand: "R" as const })), { tempoBpm: 120 });
  const source = parseMidi(buf);
  const plan: PhrasePlanV1 = { schemaVersion: 1, kind: "keyspilli-phrase-plan", levels: [...LEVEL_ORDER],
    source: { sha256: createHash("sha256").update(buf).digest("hex"), compositionId: "original-synthetic-triplets",
      performanceId: "authored-v1", clock: sourcePhraseClock(source) },
    phrases: [{ id: "whole", occurrenceId: "first", startBeat: 0, endBeat: source.durationBeats,
      evidence: { authority: "self-authored", confidence: 1, basis: "authored test fixture" }, rests: [],
      events: source.notes.map((n, i) => ({ id: `event-${i}`, sourceOriginId: n.sourceOrigins![0]!.id,
        role: "melody", priority: 100, required: true, allowedTransformations: [],
        expected: { midi: n.midi, startBeat: n.start, durationBeats: n.dur, hand: n.hand } })) }] };
  const input = { buf, baseId, title: "Synthetic protected triplets", artist: "Test", contentType: "upload",
    arrangementProfile: "source", maxDurBeats: null, phrasePlan: plan } as IngestInput;
  return { input, plan };
}
const manifest = (id: string) => JSON.parse(readFileSync(join(root, "artifacts", id, "manifest.json"), "utf8"));

it("persists a source-bound plan and protection report in all six real artifacts", async () => {
  const { input, plan } = fixture("phrase-intake");
  const result = await ingestSource(input);
  expect(result.error).toBeUndefined();
  expect(result.songIds).toHaveLength(6);
  for (const code of ["vb", "b", "ve", "e", "m", "a"]) {
    const artifact = JSON.parse(readFileSync(join(root, "artifacts", input.baseId!, code, "notes.json"), "utf8"));
    expect(artifact.phraseProtection).toMatchObject({ status: "preserved", protectedEvents: 16, plan: JSON.parse(JSON.stringify(plan)) });
    expect(artifact.sourcePreparation).toBeDefined();
    expect(artifact.artifactFidelity).toBeDefined();
    expect(artifact.notes[0].start).toBeCloseTo(1 / 3, 9);
  }
  expect(manifest(input.baseId!).phrasePlan).toMatchObject({ sourceSha256: plan.source.sha256 });
  expect(new Uint8Array(readFileSync(join(root, "uploads", `${input.baseId}.mid`)))).toEqual(input.buf);
});

it("changes the configuration fingerprint when declared role evidence changes", async () => {
  const { input, plan } = fixture("phrase-fingerprint");
  expect((await ingestSource(input)).error).toBeUndefined();
  const first = manifest(input.baseId!);
  plan.phrases[0]!.evidence.confidence = 0.8;
  expect((await ingestSource(input)).error).toBeUndefined();
  const second = manifest(input.baseId!);
  expect(second.configFingerprint).not.toBe(first.configFingerprint);
  expect(second.phrasePlan.sha256).not.toBe(first.phrasePlan.sha256);
});

it("refuses stale selected events before creating any six-row catalog publication", async () => {
  const { input, plan } = fixture("phrase-stale");
  plan.phrases[0]!.events[0]!.expected.midi += 1;
  expect((await ingestSource(input)).error).toMatch(/phrase/i);
  expect(getSongsByBase(input.baseId!)).toEqual([]);
  expect(existsSync(join(root, "artifacts", input.baseId!))).toBe(false);
});

it("binds actual supplied bytes even when the caller supplies a different logical source hash", async () => {
  const { input, plan } = fixture("phrase-logical-hash");
  input.sourceArtifactHash = "b".repeat(64); plan.source.sha256 = input.sourceArtifactHash;
  expect((await ingestSource(input)).error).toMatch(/phrase.*(hash|bytes)/i);
  expect(getSongsByBase(input.baseId!)).toEqual([]);
});

it("does not silently drop an existing phrase policy during an ordinary rebuild", async () => {
  const { input } = fixture("phrase-rebuild");
  expect((await ingestSource(input)).error).toBeUndefined();
  const before = manifest(input.baseId!);
  const { phrasePlan: _plan, ...without } = input as IngestInput & { phrasePlan: PhrasePlanV1 };
  expect((await ingestSource(without)).error).toMatch(/phrase.*required/i);
  expect(manifest(input.baseId!)).toEqual(before);
});

it("keeps the raw native source clock when intake overrides only playback tempo", async () => {
  const { input, plan } = fixture("phrase-native-clock-override");
  input.tempo = 60;
  expect((await ingestSource(input)).error).toBeUndefined();
  const data = JSON.parse(readFileSync(join(root, "artifacts", input.baseId!, "a", "notes.json"), "utf8"));
  expect(data.phraseProtection.plan.source.clock).toEqual(JSON.parse(JSON.stringify(plan.source.clock)));
  expect(data.phraseProtection.outputClock).toMatchObject({ sourceTempoBpm: 120, playbackTempoBpm: 60 });
  expect(data.notes[0].start).toBeCloseTo(1 / 3, 10);
  expect(data.notes[0].dur).toBeCloseTo(1 / 3, 10);
});

it("refuses a rewritten source-clock claim despite matching bytes and a playback override", async () => {
  const { input, plan } = fixture("phrase-forged-native-clock");
  input.tempo = 60; plan.source.clock.tempoBpm = 60;
  expect((await ingestSource(input)).error).toMatch(/phrase.*clock/i);
  expect(getSongsByBase(input.baseId!)).toEqual([]);
});

it.each([false, true])("refuses native tempo-map erasure under a phrase policy (rewritten claim: %s)", rewritten => {
  const { input, plan } = fixture(`phrase-erased-clock-${rewritten}`);
  input.preserveSourceBeats = true;
  if (rewritten) plan.source.clock.tempoEvents = [];
  return expect(ingestSource(input)).resolves.toMatchObject({ songIds: [], error: expect.stringMatching(/phrase.*(clock|preserveSourceBeats)/i) });
});

it("snapshots the canonical policy before an asynchronous caller can change its evidence", async () => {
  const { input, plan } = fixture("phrase-policy-alias");
  const expectedPlan = canonicalPhrasePlan(plan);
  const pending = ingestSource(input);
  plan.phrases[0]!.evidence.basis = "changed after invocation";
  expect((await pending).error).toBeUndefined();
  const data = JSON.parse(readFileSync(join(root, "artifacts", input.baseId!, "a", "notes.json"), "utf8"));
  expect(canonicalPhrasePlan(data.phraseProtection.plan)).toBe(expectedPlan);
  expect(manifest(input.baseId!).phrasePlan.sha256).toBe(createHash("sha256").update(expectedPlan).digest("hex"));
});

it("snapshots exact source bytes before asynchronous publication", async () => {
  const { input } = fixture("phrase-source-alias");
  const expectedBytes = Uint8Array.from(input.buf);
  const pending = ingestSource(input);
  input.buf[0] = 0;
  expect((await pending).error).toBeUndefined();
  expect(new Uint8Array(readFileSync(join(root, "uploads", `${input.baseId}.mid`)))).toEqual(expectedBytes);
  expect(manifest(input.baseId!).sourceArtifactHash).toBe(createHash("sha256").update(expectedBytes).digest("hex"));
});
