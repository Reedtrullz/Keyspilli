import { afterAll, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeMidi } from "@keyspilli/midi";
import { sha256Hex } from "@keyspilli/catalog/src/fixture-evidence.js";

// Only the remote byte transport is substituted; resolver, parser, builder,
// queue, worker, publication and database are the production implementations.
const transport = vi.hoisted(() => ({ bytes: new Uint8Array() }));
vi.mock("@keyspilli/catalog/src/external-retrieval.js", async (original) => {
  const actual = await original<typeof import("@keyspilli/catalog/src/external-retrieval.js")>();
  return { ...actual, retrieveExternalSource: (input: Parameters<typeof actual.retrieveExternalSource>[0], options: Parameters<typeof actual.retrieveExternalSource>[1]) => actual.retrieveExternalSource(input, { ...options, fetch: async () => new Response(transport.bytes, { headers: { "content-type": "audio/midi" } }) }) };
});
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
