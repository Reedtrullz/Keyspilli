import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {rm} from "node:fs/promises";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {getDb, upsertSong, replaceSongsByBase} from "@keyspilli/catalog/src/db.js";

const previousDataRoot=process.env.KEYSPILLI_DATA_DIR;
const dataRoot=mkdtempSync(join(tmpdir(),"keyspilli-export-cache-"));
process.env.KEYSPILLI_DATA_DIR=dataRoot;
afterAll(async()=>{
  getDb().close();
  if(previousDataRoot===undefined)delete process.env.KEYSPILLI_DATA_DIR;
  else process.env.KEYSPILLI_DATA_DIR=previousDataRoot;
  await rm(dataRoot,{recursive:true,force:true});
});

/**
 * Vitest resolves React's client build, where cache is a no-op outside an RSC
 * dispatcher. Model the server cache contract here so this regression test
 * proves that the exported loader is request-memoized without requiring a
 * Next server render in the unit-test process.
 */
const cacheCalls = vi.hoisted(() => ({
  wrappedInvocations: 0,
  cacheWrappers: 0,
  underlyingInvocations: 0,
}));

vi.mock("react", () => ({
  cache: (fn: (...args: unknown[]) => unknown) => {
    cacheCalls.cacheWrappers += 1;
    const values = new Map<string, unknown>();
    return (...args: unknown[]) => {
      cacheCalls.wrappedInvocations += 1;
      const key = JSON.stringify(args);
      if (!values.has(key)) {
        cacheCalls.underlyingInvocations += 1;
        values.set(key, fn(...args));
      }
      return values.get(key);
    };
  },
}));

let getSongDetail: typeof import("./catalog-api").getSongDetail;
let getSongDetailForExport: typeof import("./catalog-api").getSongDetailForExport;

beforeAll(async () => {
  ({ getSongDetail, getSongDetailForExport } = await import("./catalog-api"));
});

describe("catalog detail request memoization", () => {
  it("deduplicates repeated ids within one request cache", async () => {
    const missingId = "__cache-regression-missing-song__";
    await expect(getSongDetail(missingId)).resolves.toBeNull();
    await expect(getSongDetail(missingId)).resolves.toBeNull();
    await expect(getSongDetail(`${missingId}-other`)).resolves.toBeNull();

    // The wrapper is entered twice, but the underlying detail loader runs
    // once for the same id. A different id remains an independent key.
    // The metadata-only shell has its own request-local cache boundary; the
    // complete detail loader remains independently memoized.
    expect(cacheCalls.cacheWrappers).toBe(2);
    expect(cacheCalls.wrappedInvocations).toBe(3);
    expect(cacheCalls.underlyingInvocations).toBe(2);
  });

  it("rereads export visibility and metadata despite an existing React request snapshot", async () => {
    const id = "legacy-export-cache-a";
      expect(await getSongDetail(id, null)).toBeNull();
      const row = {id, baseId: "legacy-export-cache", level: "a", title: "First title", artist: "Control", category: "Test", difficulty: "advanced",
        difficultyScore: 1, key: "C", tempo: 120, style: "test", mood: "neutral", bassPattern: "block", duration: 2, contentType: "standard",
        acquiredVia: null, sourceYoutubeUrl: null, hasSheetXml: 0, sections: null, plays: 0, createdAt: "2026-10-17T00:00:00Z"};
      upsertSong(row);
      expect((await getSongDetailForExport(id, null))?.song.title).toBe("First title");
      replaceSongsByBase(row.baseId, [{...row, title: "Second title"}]);
      expect((await getSongDetailForExport(id, null))?.song.title).toBe("Second title");
      expect(await getSongDetail(id, null)).toBeNull();
  });
});
