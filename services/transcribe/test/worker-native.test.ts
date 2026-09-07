import { afterAll, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMidi } from "@keyspilli/midi";
import { sha256Hex } from "@keyspilli/catalog/src/fixture-evidence.js";

// Only the remote byte transport is substituted; resolver, parser, builder,
// queue, worker, publication and database are the production implementations.
const transport = vi.hoisted(() => ({ bytes: new Uint8Array(), status: 200, lowDisk: false, failure: undefined as Error | undefined, beforeResponse: undefined as (() => void) | undefined }));
vi.mock("@keyspilli/catalog/src/external-retrieval.js", async (original) => {
  const actual = await original<typeof import("@keyspilli/catalog/src/external-retrieval.js")>();
  return { ...actual, retrieveExternalSource: (input: Parameters<typeof actual.retrieveExternalSource>[0], options: Parameters<typeof actual.retrieveExternalSource>[1]) => actual.retrieveExternalSource(input, { ...options, fetch: async () => { transport.beforeResponse?.(); if (transport.failure) throw transport.failure; return new Response(transport.bytes, { status: transport.status, headers: { "content-type": "audio/midi" } }); } }) };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, statfs: async (path: string) => {
    const value = await actual.statfs(path);
    return transport.lowDisk ? { ...value, bavail: 0 } : value;
  } };
});
vi.mock("../src/stem-pipeline.js", async (original) => ({
  ...await original<typeof import("../src/stem-pipeline.js")>(),
  transcribePitchedStems: async () => { throw new Error("separator unavailable fixture"); },
}));
vi.mock("node:child_process", () => ({ execFile: (...args: unknown[]) => {
  const callback = args.at(-1) as (error: Error) => void;
  callback(new Error("unexpected external command in worker fixture"));
} }));
vi.stubEnv("KEYSPILLI_TEMPO_OVERRIDE", "120");
const dir = mkdtempSync(join(tmpdir(), "keyspilli-worker-native-"));
vi.stubEnv("KEYSPILLI_DATA_DIR", dir);
vi.stubEnv("KEYSPILLI_SOURCE_ASSISTED_BETA", "1");
vi.stubEnv("KEYSPILLI_VERIFIED_SOURCE_INDEX", join(dir, "index.json"));
afterAll(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

it("runs a queued requested recording through native resolution and publishes all five public levels", async () => {
  const { insertJob, getJob, getSongsByBase } = await import("@keyspilli/catalog");
  const { processJob } = await import("../src/worker.js");
  transport.bytes = writeMidi(Array.from({ length: 64 }, (_, i) => ({ midi: 60 + i % 5, start: i, dur: .75, vel: 90, hand: "R" as const })), { tempoBpm: 90 });
  const hash = sha256Hex(transport.bytes);
  writeFileSync(join(dir, "index.json"), JSON.stringify([{ id: "worker-fixture", recordingIds: ["abcdefghijk"], artist: "Synthetic", title: "Worker Fixture", arrangementTitle: "Worker Fixture Piano", sourceUrl: "https://scores.example/fixture.mid", sourceSha256: hash, license: "CC0-1.0", licenseEvidenceUrl: "https://scores.example/license", verificationEvidenceUrl: "https://scores.example/fixture", containsMelody: true, completeArrangement: true }]));
  insertJob({ id: "native-test", youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk", status: "queued", songId: null, error: null, createdAt: new Date().toISOString(), finishedAt: null });
  await processJob("native-test");
  expect(getJob("native-test")?.status, getJob("native-test")?.error ?? "").toBe("done");
  const base = `beta-native-${hash.slice(0, 24)}`;
  expect(getSongsByBase(base).length).toBeGreaterThanOrEqual(5);
  for (const level of ["vb", "b", "e", "m", "a"]) {
    const notes = JSON.parse(readFileSync(join(dir, "artifacts", base, level, "notes.json"), "utf8"));
    expect(notes.provenance.sourceArrangement.sourceSha256).toBe(hash);
    expect(notes.notes.length).toBeGreaterThan(0);
  }
  const manifestPath = join(dir, "artifacts", base, "manifest.json");
  const original = readFileSync(manifestPath, "utf8");
  for (const id of ["duplicate-native", "corrupt-prior"]) {
    if (id === "corrupt-prior") writeFileSync(manifestPath, "{}");
    insertJob({ id, youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk", status: "queued", songId: null, error: null, createdAt: new Date().toISOString(), finishedAt: null });
    await processJob(id);
    expect(getJob(id)?.status).toBe(id === "corrupt-prior" ? "error" : "done");
    expect(readFileSync(manifestPath, "utf8")).toBe(id === "corrupt-prior" ? "{}" : original);
  }
  writeFileSync(manifestPath, original);
});

it("does not publish or finalize when another worker owns the reclaimed job", async () => {
  const { insertJob, getJob, getSongsByBase, updateJob, claimJob, ownsJobLease } = await import("@keyspilli/catalog");
  const { processJob } = await import("../src/worker.js");
  transport.bytes = writeMidi(Array.from({ length: 64 }, (_, i) => ({ midi: 65 + i % 5, start: i, dur: .75, vel: 90, hand: "R" as const })), { tempoBpm: 90 });
  const hash = sha256Hex(transport.bytes);
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  index[0].sourceSha256 = hash;
  writeFileSync(join(dir, "index.json"), JSON.stringify(index));
  insertJob({ id: "stale-native", youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk", status: "queued", songId: null, error: null, createdAt: new Date().toISOString(), finishedAt: null });
  let newOwner: string | undefined;
  transport.beforeResponse = () => {
    updateJob("stale-native", { status: "queued" });
    newOwner = claimJob("stale-native");
  };
  try { await processJob("stale-native"); } finally { transport.beforeResponse = undefined; }
  expect(getJob("stale-native")?.status).toBe("processing");
  expect(ownsJobLease("stale-native", newOwner!)).toBe(true);
  expect(getSongsByBase(`beta-native-${hash.slice(0, 24)}`)).toHaveLength(0);
});

it("returns review after separator failure without deleting diagnostics or using full-mix fallback", async () => {
  const { insertJob, getJob } = await import("@keyspilli/catalog");
  const { processJob } = await import("../src/worker.js");
  vi.stubEnv("KEYSPILLI_SOURCE_ASSISTED_BETA", "0");
  const jobDir = join(dir, "transcribed", "failed-separator");
  mkdirSync(join(jobDir, "stem-midi"), { recursive: true });
  writeFileSync(join(jobDir, "audio.mp3"), new Uint8Array(2048));
  writeFileSync(join(jobDir, "meta.json"), JSON.stringify({ title: "Synthetic", uploader: "Fixture", durationSec: 30 }));
  writeFileSync(join(jobDir, "stem-midi", "diagnostic.json"), "retained");
  insertJob({ id: "failed-separator", youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk", status: "queued", songId: null, error: null, createdAt: new Date().toISOString(), finishedAt: null });
  try { await processJob("failed-separator"); } finally { vi.stubEnv("KEYSPILLI_SOURCE_ASSISTED_BETA", "1"); }
  expect(getJob("failed-separator")?.status).toBe("error");
  expect(getJob("failed-separator")?.error).toMatch(/SOURCE_REVIEW_REQUIRED.*separator unavailable/);
  expect(getJob("failed-separator")?.songId).toBeNull();
  expect(readFileSync(join(jobDir, "stem-midi", "diagnostic.json"), "utf8")).toBe("retained");
});

it.each(["404", "timeout", "corrupt-midi", "invalid-duration", "no-melody", "wrong-song", "unsupported-tutorial", "missing-backend", "low-disk"])("preserves prior catalog on %s", async (failure) => {
  const { insertJob, getJob, getDb } = await import("@keyspilli/catalog");
  const { processJob } = await import("../src/worker.js");
  const before = getDb().prepare("SELECT * FROM songs ORDER BY id").all();
  const originalIndex = readFileSync(join(dir, "index.json"), "utf8");
  const originalBytes = transport.bytes;
  const index = JSON.parse(originalIndex);
  if (failure === "low-disk") transport.lowDisk = true;
  if (failure === "404") transport.status = 404;
  if (failure === "timeout") transport.failure = new DOMException("fixture timeout", "TimeoutError");
  if (failure === "corrupt-midi") transport.bytes = new Uint8Array([77,84,104,100,0,0,0,6]);
  if (failure === "unsupported-tutorial") transport.bytes = new TextEncoder().encode("<html>uncalibrated tutorial</html>");
  if (failure === "invalid-duration") transport.bytes = writeMidi([{ midi: 60, start: 0, dur: 1400, vel: 90, hand: "R" }], { tempoBpm: 120 });
  if (failure === "no-melody") index[0].containsMelody = false;
  if (failure === "wrong-song") index[0].recordingIds = ["lmnopqrstuv"];
  index[0].sourceSha256 = sha256Hex(transport.bytes);
  writeFileSync(join(dir, "index.json"), JSON.stringify(index));
  if (failure === "missing-backend") vi.stubEnv("KEYSPILLI_VERIFIED_SOURCE_INDEX", "");
  const id = `failure-${failure}`;
  insertJob({ id, youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk", status: "queued", songId: null, error: null, createdAt: new Date().toISOString(), finishedAt: null });
  try {
    await processJob(id);
    expect(getJob(id)?.status).toBe("error");
    expect(getJob(id)?.error).toContain("SOURCE_REVIEW_REQUIRED");
    expect(getJob(id)?.songId).toBeNull();
    expect(getDb().prepare("SELECT * FROM songs ORDER BY id").all()).toEqual(before);
  } finally {
    transport.lowDisk = false;
    transport.status = 200;
    transport.failure = undefined;
    transport.bytes = originalBytes;
    writeFileSync(join(dir, "index.json"), originalIndex);
    vi.stubEnv("KEYSPILLI_VERIFIED_SOURCE_INDEX", join(dir, "index.json"));
  }
});

it("preserves prior versions through cancellation, a changed source and retry after success", async () => {
  const { insertJob, getJob, getDb, updateJob, getSongsByBase } = await import("@keyspilli/catalog");
  const { processJob } = await import("../src/worker.js");
  const prior = getDb().prepare("SELECT * FROM songs ORDER BY id").all();
  const priorFiles = getDb().prepare("SELECT base_id, level FROM songs ORDER BY id").all() as { base_id: string; level: string }[];
  const digests = () => priorFiles.flatMap((row) => ["notes.json", "variant.mid", "variant.xml"].map((file) => sha256Hex(readFileSync(join(dir, "artifacts", row.base_id, row.level, file)))));
  const originalDigests = digests();
  transport.bytes = writeMidi(Array.from({ length: 64 }, (_, i) => ({ midi: 67 + i % 5, start: i, dur: .75, vel: 90, hand: "R" as const })), { tempoBpm: 100 });
  const hash = sha256Hex(transport.bytes);
  const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
  index[0].sourceSha256 = hash;
  writeFileSync(join(dir, "index.json"), JSON.stringify(index));
  const enqueue = (id: string) => insertJob({ id, youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk", status: "queued", songId: null, error: null, createdAt: new Date().toISOString(), finishedAt: null });
  enqueue("cancelled-native");
  transport.beforeResponse = () => { getDb().prepare("DELETE FROM conversion_jobs WHERE id = ?").run("cancelled-native"); };
  try { await processJob("cancelled-native"); } finally { transport.beforeResponse = undefined; }
  expect(getJob("cancelled-native")).toBeUndefined();
  expect(getSongsByBase(`beta-native-${hash.slice(0, 24)}`)).toHaveLength(0);
  enqueue("new-source-version");
  await processJob("new-source-version");
  expect(getJob("new-source-version")?.status).toBe("done");
  const rowsAfterNewVersion = getDb().prepare("SELECT * FROM songs ORDER BY id").all();
  expect(rowsAfterNewVersion).toEqual(expect.arrayContaining(prior));
  expect(digests()).toEqual(originalDigests);
  updateJob("new-source-version", { status: "queued" });
  await processJob("new-source-version");
  expect(getJob("new-source-version")?.status).toBe("error");
  expect(getJob("new-source-version")?.error).toContain("cannot replace an existing song");
  expect(getDb().prepare("SELECT * FROM songs ORDER BY id").all()).toEqual(rowsAfterNewVersion);
  expect(digests()).toEqual(originalDigests);
});
