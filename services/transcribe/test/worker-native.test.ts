import { afterAll, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMidi } from "@keyspilli/midi";
import { sha256Hex } from "@keyspilli/catalog/src/fixture-evidence.js";

// Only the remote byte transport is substituted; resolver, parser, builder,
// queue, worker, publication and database are the production implementations.
const transport = vi.hoisted(() => ({ bytes: new Uint8Array(), beforeResponse: undefined as (() => void) | undefined }));
vi.mock("@keyspilli/catalog/src/external-retrieval.js", async (original) => {
  const actual = await original<typeof import("@keyspilli/catalog/src/external-retrieval.js")>();
  return { ...actual, retrieveExternalSource: (input: Parameters<typeof actual.retrieveExternalSource>[0], options: Parameters<typeof actual.retrieveExternalSource>[1]) => actual.retrieveExternalSource(input, { ...options, fetch: async () => { transport.beforeResponse?.(); return new Response(transport.bytes, { headers: { "content-type": "audio/midi" } }); } }) };
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
