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

it("prepares a complete synthetic package using existing blank review receipts without approving music", async () => {
  const f = await fixture(), pack = await f.prepare();
  expect(pack.pieces[0]!.modes.map((m: { evidenceCompleteness: string }) => m.evidenceCompleteness)).toEqual(["complete", "complete"]);
  expect(pack.pieces[0]!.status).toBe("synthetic-only");
  expect(pack.musicalAcceptance).toBe("not-established"); expect(pack.providerCalls).toBe(0);
  expect(pack.pieces[0]!.modes[0]!.receiptTemplate).toMatchObject({ kind: "musical-review-receipt", decision: "pending", reviewer: { id: null }, checks: { source: { result: "pending" }, listening: { result: "pending" }, keyboard: { result: "pending" } } });
  expect(pack.pieces[0]!.modes[0]!.sourceCompleteness).toBe("not-established");
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
