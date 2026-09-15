import { afterAll, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockedLearnerBases } from "../src/learner-review.js";
import { getDb, getSong, listSongs, listSongsGrouped, listSongsGroupedWithTotal, upsertSong } from "../src/db.js";
const root = mkdtempSync(join(tmpdir(), "keyspilli-policy-"));
const previous = process.env.KEYSPILLI_DATA_DIR;
process.env.KEYSPILLI_DATA_DIR = root;
const policy = join(root, "learner-review.json");
afterAll(() => {
  getDb().close(); rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.KEYSPILLI_DATA_DIR;
  else process.env.KEYSPILLI_DATA_DIR = previous;
});
it("fails closed from cold start, refreshes atomic policy replacements, and validates every read path", () => {
  writeFileSync(policy, "{broken");
  expect(() => blockedLearnerBases()).toThrow(/LEARNER_REVIEW_MALFORMED/);
  for (const baseId of ["test-a", "test-b"]) upsertSong({ id: `${baseId}-e`, baseId, title: baseId,
    artist: "Test", category: "Test", difficulty: "easy", difficultyScore: 1, key: "C", tempo: 120,
    style: "", mood: "", bassPattern: "block", duration: 10, contentType: "standard", acquiredVia: null,
    sourceYoutubeUrl: null, hasSheetXml: 1, sections: null, plays: 0, level: "e", createdAt: "2026-09-16" });
  writeFileSync(policy, JSON.stringify({ verdicts: { "test-a": { blocked: true } } }));
  expect(getSong("test-a-e")).toBeUndefined();
  expect(listSongsGroupedWithTotal().total).toBe(1);
  writeFileSync(`${policy}.new`, JSON.stringify({ verdicts: { "test-b": { blocked: true } } }));
  renameSync(`${policy}.new`, policy);
  expect(getSong("test-a-e")?.baseId).toBe("test-a");
  expect(getSong("test-b-e")).toBeUndefined();
  expect(listSongsGroupedWithTotal().songs[0]?.representative.baseId).toBe("test-a");
  for (const malformed of ["{", "{}", '{"verdicts":[]}', '{"verdicts":{"test-a":{"blocked":"true"}}}']) {
    writeFileSync(policy, malformed);
    for (const read of [blockedLearnerBases, () => getSong("test-a-e"), listSongs, listSongsGroupedWithTotal]) {
      expect(read).toThrow(/LEARNER_REVIEW_MALFORMED/);
    }
  }
  writeFileSync(policy, '{"verdicts":{}}');
  expect(listSongsGroupedWithTotal().total).toBe(2);
});
it("normalizes invalid bounds for both SQL and grouped callers", () => {
  writeFileSync(policy, '{"verdicts":{}}');
  for (const limit of [NaN, Infinity, -1, 0, 1.5]) {
    for (const read of [listSongs, listSongsGrouped, (f: Parameters<typeof listSongs>[0]) => listSongsGroupedWithTotal(f).songs]) {
      expect(read({ limit, offset: NaN })).toHaveLength(2);
    }
  }
  expect(listSongs({ limit: 1, offset: 1 })).toHaveLength(1);
});
