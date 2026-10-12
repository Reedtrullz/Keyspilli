import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseFullOutputReviewRequest } from "../src/full-output-review.js";
import { createFullOutputFixture } from "./helpers/full-output-fixture.js";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const sha = (s: Uint8Array | string) => createHash("sha256").update(s).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "keyspilli-full-review-")); dirs.push(root);
  return createFullOutputFixture(root);
}

async function rawAsset(f: Awaited<ReturnType<typeof fixture>>, id: string, bytes: Uint8Array | string) {
  await writeFile(join(f.root, id), bytes);
  const asset = f.registry.assets.find(a => a.id === id)!;
  asset.sha256 = sha(bytes); asset.bytes = Buffer.byteLength(bytes);
}
async function snapshot(f: Awaited<ReturnType<typeof fixture>>, prefix: string, change: (value: Record<string, unknown>) => Record<string, unknown>) {
  await f.replace(`${prefix}-snapshot`, change);
  const value = JSON.parse(await readFile(join(f.root, `${prefix}-snapshot`), "utf8"));
  f.request.pieces[0]!.modes.find(m => m.mode.toLowerCase() === prefix)!.identity!.playbackSha256 = sha(JSON.stringify(value));
  await f.replace(`${prefix}-clock`, clock => ({ ...clock, snapshotSha256: f.registry.assets.find(a => a.id === `${prefix}-snapshot`)!.sha256 }));
}

it("prepares a complete synthetic package using existing blank review receipts without approving music", async () => {
  const f = await fixture(), pack = await f.prepare();
  expect(pack.pieces[0]!.modes.map((m: { evidenceCompleteness: string }) => m.evidenceCompleteness)).toEqual(["complete", "complete"]);
  expect(pack.pieces[0]!.status).toBe("synthetic-only");
  expect(pack.musicalAcceptance).toBe("not-established"); expect(pack.providerCalls).toBe(0);
  expect(pack.pieces[0]!.modes[0]!.receiptTemplate).toMatchObject({ kind: "musical-review-receipt", decision: "pending", reviewer: { id: null }, checks: { source: { result: "pending" }, listening: { result: "pending" }, keyboard: { result: "pending" } } });
  expect(pack.pieces[0]!.modes[0]!.sourceCompleteness).toBe("not-established");
});

it("accepts the maintained Original shape and a Chords snapshot whose sound is in its chord stream", async () => {
  const f = await fixture();
  await snapshot(f, "original", ({ chords: _chords, ...s }) => ({ ...s, timeSigEvents: [{ tick: 0, beat: 0, timeSig: [4, 4] }], sourcePedal: [] }));
  await snapshot(f, "chords", s => ({ ...s, notes: [], chords: [{ beat: 0, durationBeats: 4, notes: [48], suggestedHands: ["L"], name: "C" }] }));
  expect((await f.prepare()).pieces[0]!.modes.map(m => m.evidenceCompleteness)).toEqual(["complete", "complete"]);
});

it("returns individual blockers for unavailable real inputs instead of inventing hashes or accepted outputs", async () => {
  const f = await fixture(); f.request.pieces[0]!.classification = "real"; f.request.pieces[0]!.performanceId = null;
  f.request.pieces[0]!.modes[0]!.artifacts.midi = null;
  await rm(join(f.root, "chords-audio"));
  const pack = await f.prepare();
  expect(pack.status).toBe("blocked");
  expect(pack.pieces[0]!.modes[0]!.blockers).toContain("missing-performance-identity");
  expect(pack.pieces[0]!.modes[0]!.blockers).toContain("missing-midi");
  expect(pack.pieces[0]!.modes[1]!.blockers).toContain("chords-audio:unavailable");
});

it("requires exact transformation inputs as well as the delivered bytes", async () => {
  const f = await fixture();
  await f.add("upstream", "Additional authorized upstream input", "source");
  f.registry.assets.find(a => a.id === "source")!.transformation = { inputs: ["upstream"], code: "code", config: "config", renderer: "renderer" };
  await rm(join(f.root, "upstream"));
  const pack = await f.prepare();
  expect(pack.pieces[0]!.modes[0]!.blockers).toContain("upstream:unavailable");
  expect(pack.status).toBe("blocked");
});

it("cannot reuse the source asset as code provenance", async () => {
  const f = await fixture(); f.request.pieces[0]!.provenance!.code = "source";
  expect((await f.prepare()).pieces[0]!.modes[0]!.blockers).toContain("source:wrong-code-role");
});

it("preserves the existing playback digest while separately pinning serialized snapshot bytes", async () => {
  const f = await fixture(), path = join(f.root, "chords-snapshot");
  const bytes = JSON.stringify(JSON.parse(await readFile(path, "utf8")), null, 2) + "\n";
  await writeFile(path, bytes);
  const asset = f.registry.assets.find(a => a.id === "chords-snapshot")!; asset.sha256 = sha(bytes); asset.bytes = Buffer.byteLength(bytes);
  await f.replace("chords-clock", clock => ({ ...clock, snapshotSha256: asset.sha256 }));
  expect((await f.prepare()).pieces[0]!.modes[1]!.evidenceCompleteness).toBe("complete");
});

it("rejects more than three pieces, related performances of one composition and duplicate modes", async () => {
  const f = await fixture(), p = f.request.pieces[0]!;
  expect(() => parseFullOutputReviewRequest({ ...f.request, pieces: [p, { ...p, id: "cover", performanceId: "cover" }] })).toThrow(/composition/);
  expect(() => parseFullOutputReviewRequest({ ...f.request, pieces: Array.from({ length: 4 }, (_, i) => ({ ...p, id: `p-${i}`, compositionId: `c-${i}` })) })).toThrow(/three|bounded/);
  expect(() => parseFullOutputReviewRequest({ ...f.request, pieces: [{ ...p, modes: [p.modes[0]!, p.modes[0]!] }] })).toThrow(/mode|Original/);
});

it("blocks a Chords capture plan mislabeled as Original even with exact file hashes", async () => {
  const f = await fixture();
  await f.replace("chords-plan", plan => ({ ...plan, mode: "original" }));
  const pack = await f.prepare();
  expect(pack.pieces[0]!.modes[1]!.blockers).toContain("capture-plan-mode-or-variant-mismatch");
});

it("rejects an excerpt capture as full output and refuses changed audio without repinning it", async () => {
  const f = await fixture();
  f.request.pieces[0]!.modes[0]!.outputClock!.endSeconds = 20;
  await writeFile(join(f.root, "chords-audio"), "changed audio");
  const pack = await f.prepare();
  expect(pack.pieces[0]!.modes[0]!.evidenceCompleteness).toBe("incomplete");
  expect(pack.pieces[0]!.modes[1]!.blockers).toContain("chords-audio:mismatch");
});

it("derives full capture coverage from the actual snapshot clock even when every declared second is repinned", async () => {
  const f = await fixture(), old = await readFile(join(f.root, "original-audio"));
  const shortened = Buffer.from(old.subarray(0, 8044));
  shortened.writeUInt32LE(shortened.length - 8, 4); shortened.writeUInt32LE(shortened.length - 44, 40);
  await rawAsset(f, "original-audio", shortened);
  const audioSha = sha(shortened);
  await f.replace("original-capture", c => ({ ...c, audio: { ...(c.audio as object), sha256: audioSha, durationSeconds: 0.5, frames: 4000 },
    capture: { ...(c.capture as object), sha256: audioSha, durationSeconds: 0.5 } }));
  await f.replace("original-clock", clock => ({ ...clock, endSeconds: 0.5, audioSha256: audioSha }));
  await f.replace("original-plan", plan => ({ ...plan, durationMs: 500 }));
  f.request.pieces[0]!.modes[0]!.outputClock!.endSeconds = 0.5;
  const pack = await f.prepare();
  expect(pack.pieces[0]!.modes[0]!.evidenceCompleteness).toBe("incomplete");
  expect(pack.pieces[0]!.modes[0]!.blockers.join(" ")).toMatch(/snapshot.*clock|capture coverage/);
  expect(pack.status).toBe("blocked");
});

it.each([
  ["missing native clock", "original", () => ({ schemaVersion: 1, endBeatExclusive: 4, notes: [{ garbage: true }] })],
  ["malformed note", "original", (s: Record<string, unknown>) => ({ ...s, notes: [{ garbage: true }] })],
  ["out-of-range pitch", "original", (s: Record<string, unknown>) => ({ ...s, notes: [{ midi: 999, start: 0, dur: 4, vel: 80 }] })],
  ["note beyond end", "original", (s: Record<string, unknown>) => ({ ...s, notes: [{ midi: 60, start: 100, dur: 4, vel: 80 }] })],
  ["chord beyond end", "chords", (s: Record<string, unknown>) => ({ ...s, chords: [{ beat: 0, durationBeats: 100, notes: [48, 52, 55], suggestedHands: ["L", "L", "L"], name: "C" }] })],
  ["absent sounding events", "original", (s: Record<string, unknown>) => ({ ...s, notes: [], chords: [] })],
  ["unsupported tempo map", "original", (s: Record<string, unknown>) => ({ ...s, tempoEvents: [{ tick: 0, beat: 0, microsecondsPerQuarter: 250000, bpm: 240 }] })],
] as const)("blocks %s despite self-consistent repinned snapshot identities", async (_name, prefix, change) => {
  const f = await fixture(); await snapshot(f, prefix, change);
  const mode = (await f.prepare()).pieces[0]!.modes.find(m => m.mode.toLowerCase() === prefix)!;
  expect(mode.evidenceCompleteness).toBe("incomplete");
  expect(mode.blockers.join(" ")).toMatch(/snapshot/);
});

it.each([{ durationSeconds: 900 }, { sampleRate: 192000 }])("checks recorder fields against actual audio frames: %j", async fields => {
  const f = await fixture();
  await f.replace("original-capture", c => ({ ...c, capture: { ...(c.capture as object), ...fields } }));
  const mode = (await f.prepare()).pieces[0]!.modes[0]!;
  expect(mode.evidenceCompleteness).toBe("incomplete");
  expect(mode.blockers.join(" ")).toMatch(/recorder.*clock|capture\/audio clock/);
});

it("refuses plan settings that the current sampled recorder never applies", async () => {
  const f = await fixture();
  await f.replace("original-plan", plan => ({ ...plan, speed: 4, playbackSpeed: 4, transpose: 12 }));
  expect((await f.prepare()).pieces[0]!.modes[0]!.evidenceCompleteness).toBe("incomplete");
});

it.each(["midi", "xml"])("refuses sounding %s material beyond the complete captured output", async format => {
  const f = await fixture();
  if (format === "midi") {
    const { writeMidi } = await import("@keyspilli/midi");
    await rawAsset(f, "original-midi", writeMidi([{ midi: 60, start: 0, dur: 8, vel: 80 }], { tempoBpm: 120 }));
  } else {
    await rawAsset(f, "original-xml", (await readFile(join(f.root, "original-xml"), "utf8")).replace("<duration>4</duration>", "<duration>8</duration>"));
  }
  const mode = (await f.prepare()).pieces[0]!.modes[0]!;
  expect(mode.evidenceCompleteness).toBe("incomplete");
  expect(mode.blockers.join(" ")).toMatch(/export/);
});

it("binds Original and Chords to one publication family while keeping their playback identities separate", async () => {
  const f = await fixture();
  Object.assign(f.request.pieces[0]!.modes[1]!.identity!, { baseId: "unrelated", variantId: "unrelated-a", sourceFingerprint: "different" });
  await f.replace("chords-plan", plan => ({ ...plan, songId: "unrelated-a" }));
  const pack = await f.prepare();
  expect(pack.status).toBe("blocked");
  expect(pack.pieces[0]!.modes.every(m => m.blockers.includes("cross-mode-publication-identity-mismatch"))).toBe(true);
});

it("permits a separately pinned Original tier of the same publication", async () => {
  const f = await fixture();
  Object.assign(f.request.pieces[0]!.modes[0]!.identity!, { variantId: "fixture-b", sourceFingerprint: "different-beginner-fingerprint" });
  await f.replace("original-plan", plan => ({ ...plan, songId: "fixture-b" }));
  expect((await f.prepare()).pieces[0]!.modes.map(m => m.evidenceCompleteness)).toEqual(["complete", "complete"]);
});

it("keeps silent export container padding separate from the declared sounding extent", async () => {
  const f = await fixture();
  const { writeMidi } = await import("@keyspilli/midi");
  await rawAsset(f, "original-midi", writeMidi([{ midi: 60, start: 0, dur: 4, vel: 80 }], { tempoBpm: 120, measures: [{ index: 0, startBeat: 0, endBeat: 8 }] }));
  const xml = await readFile(join(f.root, "original-xml"), "utf8");
  await rawAsset(f, "original-xml", xml.replace("</part></score-partwise>", '<measure number="2"><note><rest/><duration>4</duration><type>whole</type></note></measure></part></score-partwise>'));
  expect((await f.prepare()).pieces[0]!.modes[0]!.evidenceCompleteness).toBe("complete");
});

it("keeps source-only and partial independent reviews separate from full backing acceptance", async () => {
  const f = await fixture(); f.request.pieces[0]!.classification = "real";
  let pack = await f.prepare();
  const binding = pack.pieces[0]!.modes[1]!.binding;
  const evidence = [{ id: binding.id, sha256: binding.sha256 }];
  const receipt = { schemaVersion: 1, kind: "musical-review-receipt", ...f.request.pieces[0]!.modes[1]!.identity,
    reviewer: { id: "independent-test-reviewer", role: "pianist", independent: true }, reviewedAt: "2026-10-12T00:00:00Z", coverage: [{ startBeat: 0, endBeat: 2 }], decision: "accepted", rationale: "Software fixture receipt only.",
    checks: { source: { result: "passed", evidence }, listening: { result: "pending", evidence: [] }, keyboard: { result: "pending", evidence: [] } } };
  await f.add("review", receipt, "receipt"); f.request.pieces[0]!.modes[1]!.receiptAssetIds.push("review");
  pack = await f.prepare();
  expect(pack.pieces[0]!.modes[1]!).toMatchObject({ sourceCorrectness: "partial", listening: "pending", keyboard: "pending", declaredReviewStatus: "partial" });
  expect(pack.pieces[0]!.modes[0]!.sourceCorrectness).toBe("pending");
  expect(pack.musicalAcceptance).toBe("not-established");
  await f.replace("review", review => ({ ...review, coverage: [{ startBeat: 0, endBeat: 5 }] }));
  expect((await f.prepare()).pieces[0]!.modes[1]!.receiptIssues).toContain("review:coverage-exceeds-output");
  await writeFile(join(f.root, "review"), JSON.stringify({ ...receipt, rationale: "Changed receipt bytes." }));
  expect((await f.prepare()).pieces[0]!.modes[1]!.sourceCorrectness).toBe("pending");
});

it("does not reuse a passed receipt after MusicXML, renderer or clock identities change", async () => {
  const f = await fixture(); const before = await f.prepare();
  const mode = before.pieces[0]!.modes[1]!, evidence = [{ id: mode.binding.id, sha256: mode.binding.sha256 }];
  await f.add("review", { schemaVersion: 1, kind: "musical-review-receipt", ...f.request.pieces[0]!.modes[1]!.identity,
    reviewer: { id: "independent-test-reviewer", role: "pianist", independent: true }, reviewedAt: "2026-10-12T00:00:00Z", coverage: [{ startBeat: 0, endBeat: 4 }], decision: "accepted", rationale: "Synthetic software test.",
    checks: { source: { result: "passed", evidence }, listening: { result: "passed", evidence }, keyboard: { result: "passed", evidence } } }, "receipt");
  f.request.pieces[0]!.modes[1]!.receiptAssetIds.push("review");
  expect((await f.prepare()).pieces[0]!.modes[1]!.declaredReviewStatus).toBe("accepted");
  await f.replace("renderer", renderer => ({ ...renderer, version: "changed" }));
  const after = await f.prepare();
  expect(after.pieces[0]!.modes[1]!.declaredReviewStatus).toBe("pending");
  expect(after.pieces[0]!.modes[1]!.receiptIssues).toContain("review:stale-package-binding");
  expect(after.musicalAcceptance).toBe("not-established");
});
