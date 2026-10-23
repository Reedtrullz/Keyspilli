/** Input, implementation and runtime identities for the bounded preparation host.
 * This module deliberately has no catalog/SQLite imports or filesystem writes.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { assertSourceWorkload, canonicalPhrasePlan, compilePhrasePlan, parseMidi, type PhrasePlanV1 } from "@keyspilli/midi";

export const KIND = "keyspilli-deterministic-preparation" as const;
export const CONFIG = Object.freeze({
  requestBytes: 64 * 1024, sourceBytes: 16 * 1024 * 1024, phrasePlanBytes: 2 * 1024 * 1024,
  instructionBytes: 1024 * 1024, instructionFiles: 8, maxPreparationAttempts: 3,
  preparationTimeoutMs: 10 * 60 * 1000, logBytes: 1024 * 1024,
  payloadFiles: 4096, payloadBytes: 1024 * 1024 * 1024,
  implementationFiles: 4096, implementationFileBytes: 16 * 1024 * 1024, implementationBytes: 128 * 1024 * 1024,
  sourceProfile: "source", repairChords: true, levels: ["vb", "b", "ve", "e", "m", "a"],
  environmentPolicy: "minimal-preparation-v1",
});

// Keep the independent canonical Python discovery checker in agreement with this
// inventory and compact [[path, sha256], ...] JSON recipe. Output is out of scope.
export const WORKFLOW_SCOPES = [
  "packages/midi/src", "packages/catalog/src", "packages/catalog/scripts", "packages/player-core/src",
  "apps/web/scripts", "apps/web/src/lib", "apps/web/src/components/player", "pnpm-lock.yaml",
  "catalog", "package.json", "tsconfig.base.json", "apps/web/package.json", "apps/web/tsconfig.json",
  "apps/web/tsconfig.song-tools.json", "packages/midi/package.json", "packages/midi/tsconfig.json",
  "packages/catalog/package.json", "packages/catalog/tsconfig.json", "packages/player-core/package.json",
  "packages/player-core/tsconfig.json",
] as const;
export const REQUIRED_IMPLEMENTATION_FILES = [
  "apps/web/scripts/prepare-workflow.mts", "apps/web/scripts/prepare-song.mts", "apps/web/scripts/prepare-catalog-chords.mts", "apps/web/scripts/song-bundle.mts",
  "apps/web/src/lib/prepare-workflow.ts", "apps/web/src/lib/prepare-workflow-pins.ts", "apps/web/src/lib/prepare-workflow-process.ts", "apps/web/src/lib/prepare-workflow-group.ts",
  "package.json", "pnpm-lock.yaml", "catalog/chord-sources.json",
] as const;

export class IntegrityError extends Error { override name = "IntegrityError"; }
export function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new IntegrityError(message);
}
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const compact = (value: unknown) => JSON.stringify(value);
export function equal(actual: unknown, expected: unknown, message: string): void {
  try { assert.deepEqual(actual, expected); } catch { throw new IntegrityError(message); }
}
export function object(value: unknown, keys: readonly string[], label: string, optional: readonly string[] = []): Record<string, unknown> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const result = value as Record<string, unknown>;
  requireThat(Object.keys(result).every(key => keys.includes(key)), `${label} has an unknown property`);
  requireThat(keys.every(key => optional.includes(key) || Object.hasOwn(result, key)), `${label} is missing a required property`);
  return result;
}
export function validHash(value: unknown, label: string): asserts value is string {
  requireThat(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), `${label} must be an explicit lowercase SHA-256`);
}
export function absolutePath(value: unknown, label: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are matched on purpose, to strip or reject them in untrusted text
  requireThat(typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f\\]/.test(value), `${label} is not a valid path`);
  requireThat(isAbsolute(value) && value === resolve(value) && !value.split(sep).some(part => part === "." || part === ".."), `${label} must be absolute and contain no traversal`);
  return value;
}
export function pathInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !!rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
}
/** Check every existing component, including ancestors of the checkout/inputs. */
export function noSymlinks(path: string, allowMissing = false): void {
  absolutePath(path, "path");
  const root = parse(path).root;
  let cursor = root;
  for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    let info;
    try { info = lstatSync(cursor); }
    catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new IntegrityError(`missing or unreadable path: ${cursor}`);
    }
    requireThat(!info.isSymbolicLink(), `symlink refused: ${cursor}`);
    requireThat(cursor === path || info.isDirectory(), `non-directory ancestor refused: ${cursor}`);
  }
}

/** Bounded descriptor reads also refuse a final-component swap to a symlink. */
function consumeFile(path: string, limit: number, consume: (chunk: Buffer) => void): number {
  noSymlinks(path);
  const prior = lstatSync(path);
  requireThat(prior.isFile(), `not a regular file: ${path}`);
  requireThat(prior.size <= limit, `file exceeds ${limit} byte limit: ${path}`);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    requireThat(before.isFile() && before.ino === prior.ino && before.dev === prior.dev && before.size <= limit, `file changed while opening: ${path}`);
    const buffer = Buffer.alloc(Math.min(1024 * 1024, limit + 1));
    let size = 0, count;
    while ((count = readSync(fd, buffer, 0, Math.min(buffer.length, limit + 1 - size), null)) > 0) {
      size += count;
      requireThat(size <= limit, `file exceeds ${limit} byte limit: ${path}`);
      consume(buffer.subarray(0, count));
    }
    const after = fstatSync(fd), current = lstatSync(path);
    requireThat(size === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs
      && current.isFile() && current.ino === before.ino && current.dev === before.dev, `file changed during read: ${path}`);
    return size;
  } finally { closeSync(fd); }
}
export function readRegular(path: string, limit: number): Buffer {
  const chunks: Buffer[] = [];
  consumeFile(path, limit, chunk => chunks.push(Buffer.from(chunk)));
  return Buffer.concat(chunks);
}
export interface FileDigest { path: string; size: number; sha256: string }
export function digestFile(path: string, limit: number): { size: number; sha256: string } {
  const digest = createHash("sha256");
  const size = consumeFile(path, limit, chunk => digest.update(chunk));
  return { size, sha256: digest.digest("hex") };
}
export function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const stack: Array<{ keys: Set<string> | null; key: boolean }> = [];
    // Bound nesting before JSON.parse/semantic validators, and refuse duplicate
    // object keys instead of silently accepting the last conflicting assertion.
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === "\"") {
        const start = i++;
        while (i < text.length && text[i] !== "\"") { if (text[i] === "\\") i++; i++; }
        const frame = stack.at(-1);
        if (frame?.keys && frame.key) {
          const key = JSON.parse(text.slice(start, i + 1)) as string;
          requireThat(!frame.keys.has(key), `${label} has a duplicate JSON key`);
          frame.keys.add(key); frame.key = false;
        }
      } else if (char === "{" || char === "[") {
        stack.push({ keys: char === "{" ? new Set() : null, key: char === "{" });
        requireThat(stack.length <= 64, `${label} exceeds JSON nesting limit`);
      } else if (char === "}" || char === "]") stack.pop();
      else if (char === "," && stack.at(-1)?.keys) stack.at(-1)!.key = true;
    }
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof IntegrityError) throw error;
    throw new IntegrityError(`${label} is not valid UTF-8 JSON`);
  }
}
export function readJson(path: string, limit: number): unknown { return parseJson(readRegular(path, limit), path); }

export interface PayloadInventory { files: FileDigest[]; directories: string[]; sha256: string }
/** Full inventory, including empty directories; never follows links or opens a DB. */
export function capturePayload(root: string, prefix = "attempts"): PayloadInventory {
  const files: FileDigest[] = [], directories: string[] = [];
  let total = 0;
  const visit = (path: string) => {
    requireThat(path.length <= 2048 && /^[\x20-\x7e]+$/.test(path) && !path.includes("\\") && !isAbsolute(path)
      && !path.split("/").some(part => !part || part === "." || part === ".."), "invalid payload inventory path");
    const absolute = join(root, path); noSymlinks(absolute);
    const info = lstatSync(absolute);
    if (info.isDirectory()) {
      directories.push(path); requireThat(directories.length <= CONFIG.payloadFiles, "payload directory limit exceeded");
      const directory = opendirSync(absolute);
      try { let entry; while ((entry = directory.readSync()) !== null) visit(`${path}/${entry.name}`); }
      finally { directory.closeSync(); }
    } else {
      requireThat(info.isFile(), `nonregular payload file refused: ${path}`);
      requireThat(files.length < CONFIG.payloadFiles && total + info.size <= CONFIG.payloadBytes, "payload file or total byte limit exceeded");
      const pin = digestFile(absolute, CONFIG.payloadBytes - total); total += pin.size;
      files.push({ path, ...pin });
    }
  };
  visit(prefix); files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0); directories.sort();
  return { files, directories, sha256: sha256(compact({ files, directories })) };
}

export interface SuppliedFile { path: string; sha256: string }
export interface PreparationRequest {
  schemaVersion: 1; kind: typeof KIND; sourceMidi: SuppliedFile; phrasePlan?: SuppliedFile;
  instructions: SuppliedFile[]; title: string; artist: string;
}
function supplied(value: unknown, label: string): SuppliedFile {
  const v = object(value, ["path", "sha256"], label);
  const path = absolutePath(v.path, `${label}.path`); validHash(v.sha256, `${label}.sha256`);
  return { path, sha256: v.sha256 };
}
export function parseRequest(value: unknown): PreparationRequest {
  const v = object(value, ["schemaVersion", "kind", "sourceMidi", "phrasePlan", "instructions", "title", "artist"], "request", ["phrasePlan"]);
  requireThat(v.schemaVersion === 1 && v.kind === KIND, "unsupported deterministic preparation request contract");
  // eslint-disable-next-line no-control-regex -- control characters are matched on purpose, to strip or reject them in untrusted text
  for (const key of ["title", "artist"] as const) requireThat(typeof v[key] === "string" && v[key].trim().length > 0 && v[key].length <= 256 && !/[\x00-\x1f\x7f]/.test(v[key]), `${key} must be a nonempty string of at most 256 characters without controls`);
  requireThat(Array.isArray(v.instructions) && v.instructions.length >= 1 && v.instructions.length <= CONFIG.instructionFiles, "instructions must contain 1 to 8 explicitly pinned files");
  const sourceMidi = supplied(v.sourceMidi, "sourceMidi"), phrasePlan = v.phrasePlan === undefined ? undefined : supplied(v.phrasePlan, "phrasePlan");
  const instructions = v.instructions.map((entry, index) => supplied(entry, `instructions[${index}]`));
  const paths = [sourceMidi.path, ...(phrasePlan ? [phrasePlan.path] : []), ...instructions.map(file => file.path)];
  requireThat(new Set(paths).size === paths.length, "input paths must be distinct");
  return { schemaVersion: 1, kind: KIND, sourceMidi, ...(phrasePlan ? { phrasePlan } : {}), instructions, title: v.title as string, artist: v.artist as string };
}
export interface InputPin { original: string; snapshot: string; size: number; sha256: string }
export interface AdmittedInput {
  request: PreparationRequest; files: Array<InputPin & { bytes: Buffer }>;
  sourceSha256: string; canonicalPhrasePlanSha256: string | null;
}
export function admitRequest(root: string, requestPath: string): AdmittedInput {
  absolutePath(requestPath, "request path");
  const requestBytes = readRegular(requestPath, CONFIG.requestBytes), request = parseRequest(parseJson(requestBytes, "request"));
  const files: AdmittedInput["files"] = [{ original: requestPath, snapshot: "inputs/request.json", size: requestBytes.length, sha256: sha256(requestBytes), bytes: requestBytes }];
  const take = (input: SuppliedFile, snapshot: string, limit: number) => {
    const bytes = readRegular(input.path, limit);
    requireThat(sha256(bytes) === input.sha256, `supplied SHA-256 mismatch: ${input.path}`);
    files.push({ original: input.path, snapshot, size: bytes.length, sha256: input.sha256, bytes });
    return bytes;
  };
  const sourceBytes = take(request.sourceMidi, "inputs/source.mid", CONFIG.sourceBytes);
  requireThat(sourceBytes.subarray(0, 4).toString("ascii") === "MThd", "sourceMidi must contain actual MIDI bytes");
  const parsed = parseMidi(sourceBytes); assertSourceWorkload(parsed);
  let canonicalPhrasePlanSha256: string | null = null;
  if (request.phrasePlan) {
    const bytes = take(request.phrasePlan, "inputs/phrase-plan.json", CONFIG.phrasePlanBytes);
    const plan = parseJson(bytes, "phrase plan") as PhrasePlanV1;
    compilePhrasePlan(parsed, plan, request.sourceMidi.sha256);
    const canonical = canonicalPhrasePlan(plan);
    requireThat(Buffer.byteLength(canonical) <= CONFIG.phrasePlanBytes, "canonical phrase plan exceeds 2 MiB");
    canonicalPhrasePlanSha256 = sha256(canonical);
  }
  request.instructions.forEach((file, index) => take(file, `inputs/instructions/${String(index + 1).padStart(3, "0")}.txt`, CONFIG.instructionBytes));
  const map = readJson(join(root, "catalog/chord-sources.json"), CONFIG.implementationFileBytes) as { schemaVersion?: unknown; entries?: unknown };
  requireThat(map?.schemaVersion === 1 && Array.isArray(map.entries) && map.entries.every(entry => entry && typeof entry === "object" && typeof entry.baseId === "string"), "repository chord-source map is invalid");
  requireThat(!map.entries.some(entry => entry.baseId === `upload-${request.sourceMidi.sha256}`), "source base is already mapped in repository catalog/chord-sources.json; reconcile in a new request first");
  return { request, files, sourceSha256: request.sourceMidi.sha256, canonicalPhrasePlanSha256 };
}

const gitEnvironment: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", LC_ALL: "C", NODE_ENV: "production", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, env: gitEnvironment, encoding: "utf8", timeout: 10_000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}
export interface ImplementationPin { sha256: string; files: FileDigest[] }
export function captureImplementation(root: string): ImplementationPin {
  noSymlinks(root);
  requireThat(git(root, ["rev-parse", "--show-toplevel"]).trim() === root, "host requires the selected checkout root");
  const names = [...new Set(git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...WORKFLOW_SCOPES]).split("\0").filter(Boolean))].sort();
  requireThat(names.length > 0 && names.length <= CONFIG.implementationFiles, "implementation inventory exceeds file limit or is empty");
  for (const required of REQUIRED_IMPLEMENTATION_FILES) requireThat(names.includes(required), `implementation inventory is missing ${required}`);
  let total = 0;
  const files = names.map(path => {
    requireThat(/^[\x20-\x7e]+$/.test(path) && !path.includes("\\") && !isAbsolute(path) && !path.split("/").some(part => !part || part === "." || part === ".."), `invalid implementation inventory path: ${path}`);
    const pin = digestFile(join(root, path), CONFIG.implementationFileBytes); total += pin.size;
    requireThat(total <= CONFIG.implementationBytes, "implementation inventory exceeds total byte limit");
    return { path, ...pin };
  });
  return { sha256: sha256(compact(files.map(file => [file.path, file.sha256]))), files };
}
export function gitProvenance(root: string): { head: string; tree: string } {
  return { head: git(root, ["rev-parse", "HEAD"]).trim(), tree: git(root, ["rev-parse", "HEAD^{tree}"]).trim() };
}
export interface RuntimePin {
  nodePath: string; nodeSha256: string; version: string; abi: string; platform: string; arch: string;
  tsxPath: string; tsxRealPath: string; tsxSha256: string; lockfileSha256: string;
}
export function captureRuntime(root: string): RuntimePin {
  const version = /^v(\d+)\.(\d+)\.(\d+)$/.exec(process.version);
  requireThat(version && Number(version[1]) === 22 && (Number(version[2]) > 22 || Number(version[2]) === 22 && Number(version[3]) >= 3), "preparation host requires Node >=22.22.3 <23");
  requireThat(process.platform === "linux" || process.platform === "darwin", "preparation host requires POSIX process groups");
  const nodePath = realpathSync(process.execPath), tsxPath = createRequire(join(root, "package.json")).resolve("tsx"), tsxRealPath = realpathSync(tsxPath);
  return { nodePath, nodeSha256: digestFile(nodePath, 256 * 1024 * 1024).sha256, version: process.version, abi: process.versions.modules,
    platform: process.platform, arch: process.arch, tsxPath, tsxRealPath, tsxSha256: digestFile(tsxRealPath, CONFIG.implementationFileBytes).sha256,
    lockfileSha256: digestFile(join(root, "pnpm-lock.yaml"), CONFIG.implementationFileBytes).sha256 };
}
