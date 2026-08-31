#!/usr/bin/env node
/**
 * Local-only A/B/C route funnel.
 *
 * The manifest and all MIDI inputs are explicit local paths.  Inputs that
 * resolve into this checkout are rejected, and the report contains hashes and
 * oracle summaries only.  This script is experimental evidence tooling; it
 * never imports or publishes a candidate.
 *
 *   pnpm exec tsx packages/catalog/scripts/route-funnel.ts \
 *     --manifest /private/tmp/routes/manifest.json \
 *     --out /private/tmp/routes/report.json
 */
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRouteFunnel, type RouteFunnelInput, type RouteFunnelReferenceInput, type RouteFunnelRouteInput, type RouteId } from "../src/route-funnel.js";
import { parseMidi } from "@keyspilli/midi";
import { canonicalRouteFunnelJson } from "../src/route-funnel.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PRIVATE_TMP = "/private/tmp";
const SHA256 = /^[0-9a-f]{64}$/i;
const ROUTE_ID_SET = new Set<RouteId>(["A", "B", "C"]);

interface ManifestRoute {
  id: RouteId;
  label?: string;
  path?: string;
  sha256?: string;
}

interface Manifest {
  schemaVersion: 1;
  fixture: { id: string; label?: string };
  mode?: "structural" | "reference";
  reference?: { path?: string; sha256?: string };
  windows?: Array<{ id: string; candidate: [number, number]; reference: [number, number] }>;
  routes: ManifestRoute[];
}

function usage(): string {
  return "Usage: route-funnel.ts --manifest FILE --out /private/tmp/REPORT.json";
}

function argValue(args: readonly string[], name: string, required = true): string | undefined {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (required && (!value || value.startsWith("--"))) throw new Error(`${name} requires a value\n${usage()}`);
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function localPath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || /[\r\n]/.test(value)) throw new Error(`${label} must be a local path`);
  if (/^(?:file|https?):/i.test(value.trim())) throw new Error(`${label} must be a local path`);
  return value;
}

function hash(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !SHA256.test(value.trim())) throw new Error(`${label} must be a SHA-256 hash`);
  return value.trim().toLowerCase();
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number`);
  return value;
}

function bounds(value: unknown, label: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label} must be [start,end]`);
  const result: [number, number] = [number(value[0], `${label}[0]`), number(value[1], `${label}[1]`)];
  if (result[1] <= result[0]) throw new Error(`${label} end must be greater than start`);
  return result;
}

function parseManifest(value: unknown): Manifest {
  const root = record(value, "manifest");
  if (root.schemaVersion !== 1) throw new Error("manifest schemaVersion must be 1");
  const fixture = record(root.fixture, "manifest.fixture");
  if (typeof fixture.id !== "string" || !fixture.id.trim()) throw new Error("manifest.fixture.id is required");
  if (!Array.isArray(root.routes)) throw new Error("manifest.routes must be an array");
  const routes = root.routes.map((raw, index) => {
    const row = record(raw, `manifest.routes[${index}]`);
    if (!ROUTE_ID_SET.has(row.id as RouteId)) throw new Error(`manifest.routes[${index}].id must be A, B, or C`);
    const route: ManifestRoute = { id: row.id as RouteId };
    if (row.label !== undefined) {
      if (typeof row.label !== "string" || !row.label.trim()) throw new Error(`manifest.routes[${index}].label must be a string`);
      route.label = row.label.trim();
    }
    if (row.path !== undefined) route.path = localPath(row.path, `manifest.routes[${index}].path`);
    route.sha256 = hash(row.sha256, `manifest.routes[${index}].sha256`);
    if (route.path === undefined && route.sha256 === undefined) throw new Error(`manifest.routes[${index}] needs path`);
    return route;
  });
  if (new Set(routes.map((route) => route.id)).size !== routes.length) throw new Error("manifest route IDs must be unique");
  let reference: Manifest["reference"];
  if (root.reference !== undefined) {
    const row = record(root.reference, "manifest.reference");
    if (row.path !== undefined) reference = { path: localPath(row.path, "manifest.reference.path"), sha256: hash(row.sha256, "manifest.reference.sha256") };
    else throw new Error("manifest.reference.path is required");
  }
  let mode: Manifest["mode"];
  if (root.mode !== undefined) {
    if (root.mode !== "structural" && root.mode !== "reference") throw new Error("manifest.mode must be structural or reference");
    mode = root.mode;
  }
  const windows = root.windows === undefined ? undefined : (() => {
    if (!Array.isArray(root.windows)) throw new Error("manifest.windows must be an array");
    return root.windows.map((raw, index) => {
      const row = record(raw, `manifest.windows[${index}]`);
      if (typeof row.id !== "string" || !row.id.trim()) throw new Error(`manifest.windows[${index}].id is required`);
      return { id: row.id.trim(), candidate: bounds(row.candidate, `manifest.windows[${index}].candidate`), reference: bounds(row.reference, `manifest.windows[${index}].reference`) };
    });
  })();
  if (mode === "reference" && !reference) throw new Error("reference mode requires manifest.reference");
  return { schemaVersion: 1, fixture: { id: fixture.id.trim(), ...(typeof fixture.label === "string" && fixture.label.trim() ? { label: fixture.label.trim() } : {}) }, ...(mode ? { mode } : {}), ...(reference ? { reference } : {}), ...(windows ? { windows } : {}), routes };
}

function pathInside(candidate: string, root: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

async function nearestExisting(value: string): Promise<string> {
  let current = value;
  while (true) {
    try { return await realpath(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = resolve(current, "..");
      if (parent === current) return current;
      current = parent;
    }
  }
}

/** Reject inputs and output destinations that resolve into the checkout. */
export async function assertOutsideRepository(value: string, label: string): Promise<string> {
  const candidate = resolve(value);
  const repository = await realpath(REPO_ROOT);
  const existing = await nearestExisting(candidate);
  if (pathInside(candidate, repository) || pathInside(existing, repository)) throw new Error(`${label} resolves inside repository`);
  return candidate;
}

async function regularFile(value: string, label: string): Promise<string> {
  const resolved = await assertOutsideRepository(value, label);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`${label} is not a regular file`);
  return resolved;
}

async function routeInput(route: ManifestRoute): Promise<RouteFunnelRouteInput> {
  if (!route.path) return { id: route.id, label: route.label, unavailableReason: "route path unavailable" };
  try {
    const path = await regularFile(route.path, `${route.id} route`);
    const bytes = new Uint8Array(await readFile(path));
    const actual = hashBytes(bytes);
    if (route.sha256 && actual !== route.sha256) return { id: route.id, label: route.label, unavailableReason: "route sha256 does not match manifest" };
    return { id: route.id, label: route.label, selector: route.id, bytes, parsed: parseMidi(bytes), expectedSha256: route.sha256 };
  } catch (error) {
    if (error instanceof Error && /inside repository/i.test(error.message)) throw error;
    return { id: route.id, label: route.label, unavailableReason: error instanceof Error ? error.message : "route unavailable" };
  }
}

async function referenceInput(reference: Manifest["reference"]): Promise<RouteFunnelReferenceInput | undefined> {
  if (!reference?.path) return undefined;
  try {
    const path = await regularFile(reference.path, "reference");
    const bytes = new Uint8Array(await readFile(path));
    if (reference.sha256 && hashBytes(bytes) !== reference.sha256) return { unavailableReason: "reference sha256 does not match manifest" };
    return { selector: "reference", bytes, parsed: parseMidi(bytes) };
  } catch (error) {
    if (error instanceof Error && /inside repository/i.test(error.message)) throw error;
    return { unavailableReason: error instanceof Error ? error.message : "reference unavailable" };
  }
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function runRouteFunnelCli(argv: readonly string[]): Promise<{ path: string; json: string }> {
  const manifestPath = await regularFile(argValue(argv, "--manifest")!, "manifest");
  const out = resolve(argValue(argv, "--out")!);
  if (!pathInside(out, PRIVATE_TMP)) throw new Error("--out must be under /private/tmp");
  await assertOutsideRepository(out, "--out");
  const manifest = parseManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  const routes = await Promise.all(manifest.routes.map(routeInput));
  const reference = await referenceInput(manifest.reference);
  const input: RouteFunnelInput = { fixture: manifest.fixture, routes, ...(reference ? { reference } : {}), ...(manifest.windows ? { windows: manifest.windows } : {}), ...(manifest.mode ? { mode: manifest.mode } : {}) };
  const report = evaluateRouteFunnel(input);
  const json = canonicalRouteFunnelJson(report) + "\n";
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, json, "utf8");
  return { path: out, json };
}

if (process.argv[1]?.endsWith("route-funnel.ts") || process.argv[1]?.endsWith("route-funnel.js")) {
  runRouteFunnelCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${result.path}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`route-funnel: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
