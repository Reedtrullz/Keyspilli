import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireBearer, verifyBearer } from "./api-auth";

const request = (headers: Record<string, string> = {}) => new Request("http://127.0.0.1/api/test", { method: "POST", headers });

describe("verifyBearer", () => {
  it("accepts the exact bearer value from Authorization or the transport alias", () => {
    expect(verifyBearer(request({ authorization: "Bearer secret" }), "secret")).toBe(true);
    expect(verifyBearer(request({ "x-keyspilli-api-token": "Bearer secret" }), "secret")).toBe(true);
  });

  it("rejects wrong, prefixed, differently sized or missing values", () => {
    for (const value of ["Bearer secreT", "bearer secret", "secret", "Bearer s", "Bearer secretsecret"]) {
      expect(verifyBearer(request({ authorization: value }), "secret")).toBe(false);
    }
    expect(verifyBearer(request(), "secret")).toBe(false);
  });

  it("never matches when no token is configured", () => {
    expect(verifyBearer(request({ authorization: "Bearer " }), "")).toBe(false);
    expect(verifyBearer(request({ authorization: "Bearer undefined" }), undefined)).toBe(false);
  });
});

describe("requireBearer", () => {
  const previous = process.env.KEYSPILLI_API_TOKEN;
  beforeEach(() => { process.env.KEYSPILLI_API_TOKEN = "secret"; });
  afterEach(() => {
    if (previous === undefined) delete process.env.KEYSPILLI_API_TOKEN;
    else process.env.KEYSPILLI_API_TOKEN = previous;
  });

  it("allows the configured token, rejects others with 401 and fails closed with 503", () => {
    expect(requireBearer(request({ authorization: "Bearer secret" }))).toBeNull();
    expect(requireBearer(request({ authorization: "Bearer nope" }))?.status).toBe(401);
    delete process.env.KEYSPILLI_API_TOKEN;
    expect(requireBearer(request({ authorization: "Bearer secret" }))?.status).toBe(503);
  });
});

/**
 * Every mutating API handler must pass through the shared constant-time
 * boundary: `requireBearer` (maintainer token only) or `checkMutationAuth`
 * (token or same-origin browser), which itself uses `verifyBearer`.
 */
describe("API route auth coverage", () => {
  const apiRoot = join(__dirname, "..", "app", "api");
  // Handlers that intentionally rely on the private edge alone. Each entry
  // needs a reason; a new mutating handler must not be added here casually.
  const EDGE_ONLY: Record<string, string> = {
    "songs/route.ts POST": "read-only song selection query (same contract as GET); no catalog mutation",
  };

  const routeFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === "route.ts" ? [path] : [];
  });

  const handlers = routeFiles(apiRoot).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const file = relative(apiRoot, path).split("\\").join("/");
    const matches = [...source.matchAll(/export\s+(?:async\s+function|const)\s+(POST|PUT|PATCH|DELETE)\b/g)];
    return matches.map((match, index) => {
      const end = source.slice(match.index! + match[0].length).search(/\nexport\s/);
      const body = end < 0 ? source.slice(match.index!) : source.slice(match.index!, match.index! + match[0].length + end);
      return { id: `${file} ${match[1]}`, source, body };
    });
  });

  it("finds the mutating handlers", () => {
    expect(handlers.length).toBeGreaterThan(10);
  });

  it.each(handlers.map((handler) => [handler.id, handler] as const))("%s uses the shared auth boundary", (id, handler) => {
    if (EDGE_ONLY[id]) return;
    expect(handler.body).toMatch(/\b(requireBearer|checkMutationAuth)\(/);
  });

  it("has no route-local bearer comparisons", () => {
    for (const handler of handlers) {
      expect(handler.source, handler.id).not.toMatch(/function checkAuth\b/);
      expect(handler.source, handler.id).not.toMatch(/[!=]==?\s*`Bearer \$\{/);
    }
  });

  it("keeps the edge-only allowlist accurate", () => {
    for (const id of Object.keys(EDGE_ONLY)) expect(handlers.map((handler) => handler.id)).toContain(id);
  });
});
