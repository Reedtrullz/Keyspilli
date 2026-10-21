import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireBearer, verifyBearer } from "./api-auth";
import { checkMutationAuth } from "./mutation-auth";

const request = (headers: Record<string, string> = {}) => new Request("http://127.0.0.1/api/test", { method: "POST", headers });

function mutationHandlers(source: string): { method: string; body: string }[] {
  const tree = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const methods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  const handlers: { method: string; body: string }[] = [];
  for (const statement of tree.statements) {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      if (!statement.exportClause) throw new Error("Wildcard route exports require explicit handler coverage");
      if (ts.isNamedExports(statement.exportClause)) {
        for (const entry of statement.exportClause.elements) {
          if (entry.isTypeOnly || !methods.has(entry.name.text)) continue;
          const local = entry.propertyName?.text ?? entry.name.text;
          const declaration = tree.statements.find(node =>
            ts.isFunctionDeclaration(node) ? node.name?.text === local :
            ts.isVariableStatement(node) && node.declarationList.declarations.some(value => ts.isIdentifier(value.name) && value.name.text === local));
          if (statement.moduleSpecifier || !declaration) throw new Error("Re-exported mutator requires its module's handler coverage");
          handlers.push({ method: entry.name.text, body: declaration.getText(tree) + "\n" + statement.getText(tree) });
        }
      }
      continue;
    }
    if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name && methods.has(statement.name.text)) {
      handlers.push({ method: statement.name.text, body: statement.getText(tree) });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) throw new Error("Destructured route exports require explicit handler coverage");
        if (methods.has(declaration.name.text)) handlers.push({ method: declaration.name.text, body: `export const ${declaration.getText(tree)};` });
      }
    }
  }
  return handlers;
}

describe("mutator export discovery", () => {
  it.each([
    'export function POST(req: Request) { return new Response("ok"); }',
    'export const POST = (req: Request) => new Response("ok");',
    'export let POST = (req: Request) => new Response("ok");',
    'function handler(req: Request) { return new Response("ok"); } export { handler as POST };',
  ])("includes and rejects an unauthenticated mutator export", async source => {
    const handlers = mutationHandlers(source);
    expect(handlers.map(handler => handler.method)).toEqual(["POST"]);
    await expect(guardsMutation(handlers[0]!.body)).resolves.toBe(false);
  });

  it("does not invent handlers from comments or strings", () => {
    expect(mutationHandlers('// export async function POST() {}\nconst text = "export const DELETE = fn";')).toEqual([]);
  });

  it("refuses indirect exports it cannot safely isolate", () => {
    expect(() => mutationHandlers('export { POST } from "./other";')).toThrow(/coverage/);
    expect(() => mutationHandlers('export * from "./other";')).toThrow(/coverage/);
    expect(() => mutationHandlers('export const { POST } = factory();')).toThrow(/coverage/);
  });

  it("accepts a synchronous handler with an effective shared guard regardless of local helper name", async () => {
    const previous = process.env.KEYSPILLI_API_TOKEN;
    process.env.KEYSPILLI_API_TOKEN = "guard-fixture";
    try {
      const [handler] = mutationHandlers('export function POST(req: Request) { function checkAuth(value: Request) { return requireBearer(value); } const denied = checkAuth(req); if (denied) return denied; return new Response("ok"); }');
      expect(handler).toBeDefined();
      await expect(guardsMutation(handler!.body)).resolves.toBe(true);
    } finally {
      if (previous === undefined) delete process.env.KEYSPILLI_API_TOKEN;
      else process.env.KEYSPILLI_API_TOKEN = previous;
    }
  });
});

async function guardsMutation(body: string, method = "POST"): Promise<boolean> {
  const exports: Record<string, unknown> = {};
  let guardCalls = 0;
  const bearerBoundary = (req: Request) => { guardCalls += 1; return requireBearer(req); };
  const mutationBoundary = (req: Request) => { guardCalls += 1; return checkMutationAuth(req); };
  const code = ts.transpileModule(body, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  runInNewContext(code, {
    exports, requireBearer: bearerBoundary, checkMutationAuth: mutationBoundary, Response,
    tutorialImportsEnabled: () => true,
    require: (specifier: string) => {
      if (specifier.endsWith("/mutation-auth")) return { checkMutationAuth: mutationBoundary };
      throw new Error(`Unauthorized handler reached dependency: ${specifier}`);
    },
  }, { timeout: 1000 });
  const handlers = Object.values(exports).filter(value => typeof value === "function");
  if (handlers.length !== 1) throw new Error("Expected exactly one isolated API handler");
  const handler = handlers[0];
  if (typeof handler !== "function") throw new Error("API handler is missing");
  const result: unknown = await handler(new Request("http://127.0.0.1/api/test", {
    method, headers: { authorization: "Bearer invalid" },
  }), {
    params: Promise.resolve({ id: "unauthorized-test" }),
  });
  return guardCalls > 0 && result instanceof Response && result.status === 401 &&
    (await result.json()).error === "unauthorized";
}

describe("route auth coverage rejects ineffective guards", () => {
  const previousToken = process.env.KEYSPILLI_API_TOKEN;
  beforeEach(() => { process.env.KEYSPILLI_API_TOKEN = "guard-fixture"; });
  afterEach(() => {
    if (previousToken === undefined) delete process.env.KEYSPILLI_API_TOKEN;
    else process.env.KEYSPILLI_API_TOKEN = previousToken;
  });
  it("exercises the exported HTTP method instead of a different guarded branch", async () => {
    const body = 'export function DELETE(req: Request) { if (req.method === "POST") { const denied = requireBearer(req); if (denied) return denied; } return new Response("ok"); }';
    await expect(guardsMutation(body, "DELETE")).resolves.toBe(false);
  });
  it.each([
    "export async function POST(req: Request) { /* requireBearer(req) */ return new Response('ok'); }",
    "export async function POST(req: Request) { if (false) requireBearer(req); return new Response('ok'); }",
    "export async function POST(req: Request) { requireBearer(req); return new Response('ok'); }",
    "export async function POST(req: Request) { return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }); }",
  ])("rejects a handler that can return success without authorization", async body => {
    await expect(guardsMutation(body)).resolves.toBe(false);
  });
});

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

  it("keeps Authorization authoritative when the transport alias conflicts", () => {
    expect(verifyBearer(request({ authorization: "Bearer wrong", "x-keyspilli-api-token": "Bearer secret" }), "secret")).toBe(false);
    expect(verifyBearer(request({ authorization: "Bearer secret", "x-keyspilli-api-token": "Bearer wrong" }), "secret")).toBe(true);
  });

  it("rejects oversized and non-ASCII lookalike values without throwing", () => {
    expect(verifyBearer(request({ authorization: "Bearer " + "x".repeat(65536) }), "secret")).toBe(false);
    expect(verifyBearer(request({ authorization: "Bearer sécret" }), "secret")).toBe(false);
  });
});

describe("requireBearer", () => {
  const previous = process.env.KEYSPILLI_API_TOKEN;
  beforeEach(() => { process.env.KEYSPILLI_API_TOKEN = "secret"; });
  afterEach(() => {
    if (previous === undefined) delete process.env.KEYSPILLI_API_TOKEN;
    else process.env.KEYSPILLI_API_TOKEN = previous;
  });

  it("allows the configured token, rejects others with 401 and fails closed with 503", async () => {
    expect(requireBearer(request({ authorization: "Bearer secret" }))).toBeNull();
    const unauthorized = requireBearer(request({ authorization: "Bearer nope" }));
    expect(unauthorized?.status).toBe(401);
    expect(await unauthorized?.json()).toEqual({ error: "unauthorized" });
    delete process.env.KEYSPILLI_API_TOKEN;
    const unavailable = requireBearer(request({ authorization: "Bearer secret" }));
    expect(unavailable?.status).toBe(503);
    expect(await unavailable?.json()).toEqual({ error: "server authentication is not configured" });
  });
});

/**
 * Every mutating API handler must pass through the shared constant-time
 * boundary: `requireBearer` (maintainer token only) or `checkMutationAuth`
 * (token or same-origin browser), which itself uses `verifyBearer`.
 */
describe("API route auth coverage", () => {
  const previousToken = process.env.KEYSPILLI_API_TOKEN;
  beforeEach(() => { process.env.KEYSPILLI_API_TOKEN = "route-test-token"; });
  afterEach(() => {
    if (previousToken === undefined) delete process.env.KEYSPILLI_API_TOKEN;
    else process.env.KEYSPILLI_API_TOKEN = previousToken;
  });
  const apiRoot = join(__dirname, "..", "app", "api");
  // Handlers that intentionally rely on the private edge alone. Each entry
  // needs a reason; a new mutating handler must not be added here casually.
  const EDGE_ONLY: Record<string, string> = {
    "songs/route.ts POST": "read-only song selection query (same contract as GET); no catalog mutation",
    "auth/[...nextauth]/route.ts POST": "Auth.js sign-in/sign-out endpoint: anonymous by design, protected by Auth.js CSRF tokens",
  };

  const routeFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === "route.ts" ? [path] : [];
  });

  const handlers = routeFiles(apiRoot).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const file = relative(apiRoot, path).split("\\").join("/");
    return mutationHandlers(source).map(({ method, body }) => ({ id: `${file} ${method}`, method, source, body }));
  });

  it("finds the mutating handlers", () => {
    expect(handlers.length).toBeGreaterThan(10);
  });

  it.each(handlers.map((handler) => [handler.id, handler] as const))("%s uses the shared auth boundary", async (id, handler) => {
    if (EDGE_ONLY[id]) return;
    await expect(guardsMutation(handler.body, handler.method)).resolves.toBe(true);
  });

  it("has no route-local bearer comparisons", () => {
    for (const handler of handlers) {
      expect(handler.source, handler.id).not.toMatch(/[!=]==?\s*`Bearer \$\{/);
    }
  });

  it("keeps the edge-only allowlist accurate", () => {
    for (const id of Object.keys(EDGE_ONLY)) expect(handlers.map((handler) => handler.id)).toContain(id);
  });
});
