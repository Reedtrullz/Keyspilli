import { beforeAll, describe, expect, it, vi } from "vitest";

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

beforeAll(async () => {
  ({ getSongDetail } = await import("./catalog-api"));
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
});
