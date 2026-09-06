#!/usr/bin/env node
/**
 * Build a local, provenance-first symbolic reference from explicitly supplied
 * files.
 *
 * This command is deliberately an orchestration boundary.  It does not use
 * the catalog database, call a network service, invoke a downloader, or copy
 * a source PDF/MIDI into the output.  Native files and OMR MusicXML are read
 * only from paths supplied by the caller; all derived artifacts are written
 * below --out, which must be outside the repository and the input roots.
 *
 * Examples:
 *   pnpm --filter @keyspilli/catalog exec tsx scripts/build-local-reference.ts \
 *     --out /private/tmp/keyspilli-reference-run \
 *     --pdf /Users/me/score.pdf \
 *     --native /Users/me/score.mid
 *
 *   pnpm --filter @keyspilli/catalog exec tsx scripts/build-local-reference.ts \
 *     --out /private/tmp/keyspilli-reference-run \
 *     --omr audiveris=/Users/me/audiveris.musicxml
 */
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOmrMusicXmlBytes } from "../src/omr-musicxml.js";
import {
  buildLocalReference,
  localReferenceBuilderJson,
  type LocalReferenceBuildInput,
  type LocalReferenceBuildOptions,
} from "../src/local-reference-builder.js";
import type { NativeScoreArtifactInput } from "../src/native-score-discovery.js";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const LOCAL_REFERENCE_SCHEMA_VERSION = 1 as const;
const MAX_ID_LENGTH = 120;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const NATIVE_EXTENSIONS: Readonly<Record<string, string>> = {
  ".mid": "midi",
  ".midi": "midi",
  ".musicxml": "musicxml",
  ".xml": "musicxml",
  ".mxl": "mxl",
  ".mscz": "mscz",
};

export interface LocalReferenceCliIo {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

export interface LocalReferenceOmrArgument {
  id: string;
  path: string;
}

export interface LocalReferenceCliOptions {
  out: string;
  id?: string;
  title?: string;
  artist?: string;
  pdf?: string;
  native: string[];
  nativeSidecars: string[];
  omr: LocalReferenceOmrArgument[];
  audiveris?: string;
  timeoutMs: number;
  help: boolean;
}

interface ResolvedCliInputs {
  options: LocalReferenceCliOptions;
  outputRoot: string;
  pdfPath?: string;
  nativePaths: string[];
  nativeSidecarPaths: string[];
  nativeSidecarArtifacts: Array<{ metadata: Record<string, unknown>; sidecarPath: string }>;
  omr: Array<{ id: string; path: string; bytes: Uint8Array }>;
  audiveris?: { path: string; bytes: Uint8Array };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function usage(): string {
  return [
    "Usage: build-local-reference.ts --out DIR [source options]",
    "",
    "Sources (at least one is required):",
    "  --pdf FILE              local PDF for forensics/identity hints (never copied)",
    "  --native FILE           permitted local native MIDI/MusicXML/MXL/MSCZ (repeatable)",
    "  --native-sidecar FILE  local native provenance JSON sidecar (repeatable)",
    "  --omr ID=FILE           local OMR MusicXML/MXL for one backend (repeatable)",
    "  --audiveris FILE        local Audiveris MusicXML/MXL output (alias for --omr audiveris=...)",
    "",
    "Metadata/options:",
    "  --id ID                 logical score id (default derived from title/artist)",
    "  --title TEXT            logical score title",
    "  --artist TEXT           logical artist/composer label",
    "  --timeout-ms N          bounded adapter timeout metadata (default 600000; no backend is invoked)",
    "  --out DIR               fresh local output root (must be outside repository and inputs)",
    "  --help                  show this help",
    "",
    "The command is local-only: it performs no downloads, network calls, catalog writes, or production actions.",
  ].join("\n");
}

function nextValue(argv: readonly string[], index: number, flag: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function cleanLogicalText(value: string, field: string): string {
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) throw new Error(`${field} must not be empty`);
  if (text.includes("/") || text.includes("\\") || /^file:/i.test(text)) {
    throw new Error(`${field} must be a logical label, not a path`);
  }
  return text.slice(0, 240);
}

function logicalId(value: string): string {
  const text = cleanLogicalText(value, "--id");
  const id = text
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID_LENGTH);
  if (!id) throw new Error("--id must contain at least one letter or number");
  if (id === ".") throw new Error("--id must not be '.'");
  if (id === "..") throw new Error("--id must not be '..'");
  return id;
}

function positiveTimeout(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_TIMEOUT_MS) {
    throw new Error(`--timeout-ms must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
  }
  return parsed;
}

function parseAssignment(value: string, flag: string): { id: string; path: string } {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`${flag} must use ID=FILE syntax`);
  }
  const id = logicalId(value.slice(0, separator));
  const path = value.slice(separator + 1);
  if (!path.trim()) throw new Error(`${flag} requires a file path`);
  return { id, path };
}

/** Parse CLI arguments without reading the filesystem. */
export function parseLocalReferenceArgs(argv: readonly string[]): LocalReferenceCliOptions {
  const result: LocalReferenceCliOptions = {
    out: "",
    native: [],
    nativeSidecars: [],
    omr: [],
    timeoutMs: 600_000,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equals = arg.indexOf("=");
    const flag = equals >= 0 ? arg.slice(0, equals) : arg;
    const inline = equals >= 0 ? arg.slice(equals + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const pair = nextValue(argv, index, flag);
      index = pair[1];
      return pair[0];
    };
    switch (flag) {
      case "--out": result.out = value(); break;
      case "--id": result.id = logicalId(value()); break;
      case "--title": result.title = cleanLogicalText(value(), "--title"); break;
      case "--artist": result.artist = cleanLogicalText(value(), "--artist"); break;
      case "--pdf": result.pdf = value(); break;
      case "--native": result.native.push(value()); break;
      case "--native-sidecar": result.nativeSidecars.push(value()); break;
      case "--omr": result.omr.push(parseAssignment(value(), "--omr")); break;
      case "--audiveris": result.audiveris = value(); break;
      case "--timeout-ms": result.timeoutMs = positiveTimeout(value()); break;
      case "--help": case "-h": result.help = true; break;
      default: throw new Error(`unknown option: ${arg}`);
    }
  }
  if (result.help) return result;
  if (!result.out.trim()) throw new Error(`--out is required\n\n${usage()}`);
  if (!result.native.length && !result.nativeSidecars.length && !result.omr.length && !result.audiveris) {
    throw new Error(`at least one symbolic source is required (--native, --native-sidecar, --omr, or --audiveris)\n\n${usage()}`);
  }
  const ids = new Set<string>();
  for (const backend of result.omr) {
    if (ids.has(backend.id)) throw new Error(`duplicate OMR backend id: ${backend.id}`);
    ids.add(backend.id);
  }
  if (result.audiveris && ids.has("audiveris")) throw new Error("--audiveris conflicts with --omr audiveris=FILE");
  return result;
}

function pathInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
}

async function resolvedExistingPath(value: string, label: string): Promise<string> {
  if (!value || value.includes("\u0000") || /[\r\n]/.test(value)) throw new Error(`${label} contains an unsafe path value`);
  if (!isAbsolute(value)) throw new Error(`${label} must be an absolute local path`);
  let resolved: string;
  try {
    resolved = await realpath(value);
  } catch {
    throw new Error(`${label} does not exist or could not be resolved`);
  }
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`${label} is not a regular file`);
  if (pathInside(REPOSITORY_ROOT, resolved)) throw new Error(`${label} must be outside the repository`);
  return resolved;
}

async function existingRealpath(value: string): Promise<string> {
  try {
    return await realpath(value);
  } catch {
    const parent = dirname(value);
    if (parent === value) return resolve(value);
    return existingRealpath(parent).then((resolved) => join(resolved, basename(value)));
  }
}

async function validateOutputRoot(value: string, sourcePaths: readonly string[]): Promise<string> {
  if (!value || value.includes("\u0000") || /[\r\n]/.test(value)) throw new Error("--out contains an unsafe path value");
  if (!isAbsolute(value)) throw new Error("--out must be an absolute local path");
  const requested = resolve(value);
  const existing = await existingRealpath(requested);
  if (pathInside(REPOSITORY_ROOT, existing)) throw new Error("--out must be outside the repository");
  for (const source of sourcePaths) {
    // Inputs are files, not directory arguments.  A sibling output beside a
    // source in /private/tmp is safe; reject only an output that would replace
    // or contain an input file (which would mix derived artifacts with source
    // material and make reruns ambiguous).
    if (existing === source || pathInside(existing, source)) throw new Error("--out must not contain an input file");
  }
  try {
    const info = await lstat(requested);
    if (info.isSymbolicLink()) throw new Error("--out must not be a symbolic link");
    if (!info.isDirectory()) throw new Error("--out must be a directory");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
    if (code !== "ENOENT") throw error;
  }
  await mkdir(requested, { recursive: true });
  return requested;
}

function nativeType(path: string): string {
  const type = NATIVE_EXTENSIONS[extname(path).toLowerCase()];
  if (!type) throw new Error(`unsupported native symbolic extension: ${extname(path) || "(none)"}`);
  if (type === "mscz") throw new Error("MSCZ native inputs are discoverable but not supported by this local verifier; provide MIDI, MusicXML, or MXL");
  return type;
}

function titleFromPath(path: string): string {
  return basename(path).replace(/\.(?:mid|midi|musicxml|xml|mxl|mscz|pdf)$/i, "") || "Local score";
}

function derivedId(title: string, artist: string): string {
  return logicalId(`${artist}-${title}`);
}

async function readResolved(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path));
}

function sidecarRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.candidates)) return object.candidates.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  if (object.metadata && typeof object.metadata === "object" && !Array.isArray(object.metadata)) return [object.metadata as Record<string, unknown>];
  return [object];
}

/**
 * Read sidecar metadata without trusting it as an authority.  A sidecar may
 * describe a candidate, but a path is still resolved and checked like every
 * other explicit local input.  Unmarked candidates remain unpermitted and
 * therefore fail closed in native discovery.
 */
async function readNativeSidecars(paths: readonly string[]): Promise<{ artifacts: Array<{ metadata: Record<string, unknown>; sidecarPath: string }>; referencedPaths: string[] }> {
  const artifacts: Array<{ metadata: Record<string, unknown>; sidecarPath: string }> = [];
  const referencedPaths: string[] = [];
  for (const sidecarPath of paths) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(sidecarPath, "utf8"));
    } catch {
      throw new Error(`--native-sidecar is not valid JSON: ${basename(sidecarPath)}`);
    }
    for (const row of sidecarRows(raw)) {
      const artifact = { ...row };
      const candidatePath = typeof artifact.path === "string"
        ? artifact.path
        : typeof artifact.localPath === "string" ? artifact.localPath : undefined;
      if (candidatePath) {
        const absoluteCandidatePath = isAbsolute(candidatePath) ? candidatePath : resolve(dirname(sidecarPath), candidatePath);
        const resolvedCandidatePath = await resolvedExistingPath(absoluteCandidatePath, `native sidecar ${basename(sidecarPath)} candidate`);
        artifact.path = resolvedCandidatePath;
        referencedPaths.push(resolvedCandidatePath);
      }
      if (artifact.permitted === undefined) artifact.permitted = false;
      artifacts.push({ metadata: artifact, sidecarPath });
    }
  }
  return { artifacts, referencedPaths };
}

async function resolveInputs(options: LocalReferenceCliOptions): Promise<ResolvedCliInputs> {
  const pdfPath = options.pdf ? await resolvedExistingPath(options.pdf, "--pdf") : undefined;
  const nativePaths = [...new Set(await Promise.all(options.native.map((path) => resolvedExistingPath(path, "--native"))))].sort(compareText);
  const nativeSidecarPaths = [...new Set(await Promise.all(options.nativeSidecars.map((path) => resolvedExistingPath(path, "--native-sidecar"))))].sort(compareText);
  const sidecars = await readNativeSidecars(nativeSidecarPaths);
  const omrPaths = await Promise.all(options.omr.map(async (entry) => ({ ...entry, path: await resolvedExistingPath(entry.path, `--omr ${entry.id}`) })));
  const omr = await Promise.all(omrPaths.map(async (entry) => ({ ...entry, bytes: await readResolved(entry.path) })));
  const audiverisPath = options.audiveris ? await resolvedExistingPath(options.audiveris, "--audiveris") : undefined;
  const audiveris = audiverisPath ? { path: audiverisPath, bytes: await readResolved(audiverisPath) } : undefined;
  const sourcePaths = [
    ...(pdfPath ? [pdfPath] : []),
    ...nativePaths,
    ...nativeSidecarPaths,
    ...sidecars.referencedPaths,
    ...omr.map((entry) => entry.path),
    ...(audiveris ? [audiveris.path] : []),
  ];
  const outputRoot = await validateOutputRoot(options.out, sourcePaths);
  return { options, outputRoot, pdfPath, nativePaths, nativeSidecarPaths, nativeSidecarArtifacts: sidecars.artifacts, omr, audiveris };
}

function safeInputId(value: string | undefined, title: string, artist: string): string {
  return value ? logicalId(value) : derivedId(title, artist);
}

function buildInput(resolved: ResolvedCliInputs): LocalReferenceBuildInput {
  const title = resolved.options.title ?? titleFromPath(resolved.pdfPath ?? resolved.nativePaths[0] ?? resolved.omr[0]?.path ?? "local-score");
  const artist = resolved.options.artist ?? "Unknown artist";
  const id = safeInputId(resolved.options.id, title, artist);
  const nativeArtifacts: NativeScoreArtifactInput[] = resolved.nativePaths.map((path, index) => ({
    id: `${id}-native-${index + 1}`,
    path,
    artifactType: nativeType(path),
    permitted: true,
    provenance: "explicit local CLI input",
    version: "local-cli",
    accessMethod: "local-file",
  }));
  for (const [index, entry] of resolved.nativeSidecarArtifacts.entries()) {
    const metadata = entry.metadata;
    const metadataPath = typeof metadata.path === "string" ? metadata.path : undefined;
    const metadataId = typeof metadata.id === "string" && metadata.id.trim() ? metadata.id : undefined;
    const sidecarStem = basename(entry.sidecarPath).replace(/\.json$/i, "");
    const target = nativeArtifacts.find((candidate) => {
      if (metadataPath && candidate.path && resolve(metadataPath) === resolve(candidate.path)) return true;
      if (metadataId && candidate.id === metadataId) return true;
      return basename(candidate.path ?? "").toLowerCase() === sidecarStem.toLowerCase();
    }) ?? (nativeArtifacts.length === 1 && !metadataPath && !metadataId ? nativeArtifacts[0] : undefined);
    if (target) {
      const candidatePath = target.path;
      const candidateId = target.id;
      Object.assign(target, metadata);
      if (candidatePath) target.path = candidatePath;
      if (candidateId) target.id = candidateId;
      continue;
    }
    nativeArtifacts.push({
      ...metadata,
      id: metadataId ?? `${id}-sidecar-${index + 1}`,
    } as NativeScoreArtifactInput);
  }
  const backends = [
    ...resolved.omr.map((entry) => {
      const parsed = parseOmrMusicXmlBytes(entry.bytes);
      return { id: entry.id, version: "local-cli", status: "available" as const, score: parsed.score, sourceLabel: entry.id };
    }),
    ...(resolved.audiveris ? [{
      id: "audiveris",
      version: "local-cli",
      status: "available" as const,
      score: parseOmrMusicXmlBytes(resolved.audiveris.bytes).score,
      sourceLabel: "audiveris",
    }] : []),
  ];
  // Keep this object intentionally additive.  The builder consumes the typed
  // fields; sidecar aliases let callers use either the discovery vocabulary or
  // the CLI vocabulary without making sidecars a public runtime dependency.
  return {
    id,
    title,
    artist,
    ...(resolved.pdfPath ? { pdfPath: resolved.pdfPath } : {}),
    nativeArtifacts,
    backends,
  } as LocalReferenceBuildInput;
}

/**
 * Read bytes for the already-validated native candidates. The builder's native
 * byte map is an intentionally explicit local-input seam: passing it here
 * applies the same parser, provenance, and identity checks as path-backed
 * candidates. A permitted CLI file without independent PDF identity remains
 * review-required; it is never promoted to a trusted reference by this seam.
 * Sidecar candidates are included as well; their `permitted` flag is enforced
 * by the builder.
 */
async function nativeBytesById(input: LocalReferenceBuildInput): Promise<Record<string, Uint8Array>> {
  const result: Record<string, Uint8Array> = {};
  for (const candidate of input.nativeArtifacts ?? []) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.id !== "string" || typeof candidate.path !== "string") continue;
    // A sidecar can mention a local artifact without authorizing it.  Do not
    // read those paths merely to populate the builder seam; the builder will
    // report them as rejected based on their metadata.
    if (candidate.permitted !== true) continue;
    try {
      result[candidate.id] = await readResolved(candidate.path);
    } catch {
      // Every path was validated before this point.  Keep the builder's
      // normal fail-closed candidate handling if a file disappears during the
      // build rather than turning a race into an unhandled read failure.
    }
  }
  return result;
}

function stableCompareValue(left: string, right: string): number {
  return compareText(left, right);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => stableCompareValue(left, right))
    .map(([key, item]) => [key, stableValue(item)]));
}

function redactText(value: string): string {
  return value
    .replace(/file:\/\/(?:[^\s/]+\/)*[^\s"']+/gi, "[redacted-path]")
    .replace(/(?:^|[\s(=,:])\/(?:[^\s"'<>;,)]*\/)?(?:Users|private|tmp|var|home|root|opt|mnt|workspace|data|srv|etc)\/[^\s"'<>;,)]*/gi, "$1[redacted-path]")
    .replace(/(?:^|[\s(=,:])[A-Za-z]:[\\/][^\s"'<>;,)]*/g, "$1[redacted-path]");
}

function redactPaths(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactPaths);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/^(?:pdfPath|nativePath|sourcePath|absolutePath|path|filePath|executable|soundfont)$/i.test(key))
    .map(([key, item]) => [key, redactPaths(item)]));
}

function reportJson(report: unknown): string {
  let value: unknown = report;
  try {
    // The builder is the canonical serializer for its report.  Parse it back
    // before applying the CLI's stricter path scrub so both layers remain
    // deterministic and no physical source path can escape through a future
    // builder field.
    value = JSON.parse(localReferenceBuilderJson(report as never));
  } catch {
    // Keep the CLI fail-closed with a usable diagnostic if a future builder
    // returns a shape its serializer cannot handle.
  }
  return `${JSON.stringify(stableValue(redactPaths(value)), null, 2)}\n`;
}

function reportMarkdown(report: any, input: ResolvedCliInputs): string {
  const rows = Array.isArray(report?.scores) ? report.scores : [];
  const status = typeof report?.status === "string"
    ? report.status
    : rows.length === 0
      ? "FAILED"
      : rows.some((row: any) => row?.state === "FAILED")
        ? "FAILED"
        : rows.every((row: any) => row?.state === "MELODY_READY")
          ? "MELODY_READY"
          : "REVIEW_REQUIRED";
  const lines = [
    "# Local symbolic reference",
    "",
    `- Schema: ${LOCAL_REFERENCE_SCHEMA_VERSION}`,
    `- Status: ${status}`,
    `- Score count: ${rows.length}`,
    `- Native inputs: ${input.nativePaths.length}`,
    `- Native sidecars: ${input.nativeSidecarPaths.length}`,
    `- OMR inputs: ${input.omr.length + (input.audiveris ? 1 : 0)}`,
    "",
    "This bundle was built from explicitly supplied local files. No source PDF, MIDI, MusicXML, audio, network result, or catalog row is copied into the repository.",
    "",
    "## Scores",
    "",
  ];
  if (!rows.length) lines.push("No score result was produced.");
  for (const row of rows) {
    lines.push(`### ${String(row.id ?? row.scoreId ?? "score")}`);
    lines.push(`- State: ${String(row.state ?? "unknown")}`);
    if (row.selected) lines.push(`- Selected source: ${String(row.selected.kind ?? row.selected.backend ?? "unknown")}`);
    if (row.reviewQueue && typeof row.reviewQueue.totalItems === "number") lines.push(`- Review items: ${row.reviewQueue.totalItems}`);
    if (row.outputs && typeof row.outputs === "object") {
      lines.push(`- Derived artifacts: ${Object.values(row.outputs as Record<string, unknown>).filter((value): value is string => typeof value === "string").sort(compareText).join(", ") || "none"}`);
    }
    lines.push("");
  }
  lines.push("## Non-claims", "", "- A parseable symbolic file is not proof of arrangement identity, copyright permission, musical correctness, or human playability.", "- Human melody/harmony review remains separate from this deterministic local build.", "");
  return lines.join("\n");
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await writeFile(temporary, value, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function writeBundleIndexes(outputRoot: string, report: unknown): Promise<void> {
  const scores = Array.isArray((report as { scores?: unknown })?.scores)
    ? (report as { scores: Array<Record<string, unknown>> }).scores
    : [];
  // These indexes intentionally contain summaries and logical artifact paths,
  // not source notes or physical input paths.  They make a run easy to review
  // without requiring consumers to know the builder's per-score layout.
  await writeText(join(outputRoot, "native", "discovery.json"), reportJson({
    schemaVersion: LOCAL_REFERENCE_SCHEMA_VERSION,
    scores: scores.map((score) => ({ id: score.id, nativeDiscovery: score.nativeDiscovery ?? null, nativeVerification: score.nativeVerification ?? null })),
  }));
  await writeText(join(outputRoot, "consensus", "report.json"), reportJson({
    schemaVersion: LOCAL_REFERENCE_SCHEMA_VERSION,
    consensusClaim: false,
    scores: scores.map((score) => ({ id: score.id, quality: score.quality ?? null, qualitySelection: score.qualitySelection ?? null })),
  }));
  await writeText(join(outputRoot, "reference", "partial.json"), reportJson({
    schemaVersion: LOCAL_REFERENCE_SCHEMA_VERSION,
    scores: scores.map((score) => ({ id: score.id, state: score.state, selected: score.selected ?? null, outputs: score.outputs ?? null })),
  }));
  await writeText(join(outputRoot, "reference", "events.json"), reportJson({
    schemaVersion: LOCAL_REFERENCE_SCHEMA_VERSION,
    status: "not-materialized",
    reason: "Event arrays remain in per-score derived reference files; this index intentionally contains no raw source arrays.",
    scores: scores.map((score) => ({ id: score.id, state: score.state, selected: score.selected ?? null })),
  }));
  await writeText(join(outputRoot, "reference", "score.json"), reportJson({
    schemaVersion: LOCAL_REFERENCE_SCHEMA_VERSION,
    scores: scores.map((score) => ({ id: score.id, artist: score.artist, title: score.title, state: score.state, selected: score.selected ?? null, outputs: score.outputs ?? null })),
  }));
}

/** Execute the local builder without calling process.exit, for tests/embedding. */
export async function runLocalReferenceCli(
  argv: readonly string[],
  io: LocalReferenceCliIo = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  let options: LocalReferenceCliOptions;
  try {
    options = parseLocalReferenceArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === usage()) io.stdout(`${message}\n`);
    else io.stderr(`build-local-reference: ${message}\n`);
    return message === usage() ? 0 : 2;
  }
  if (options.help) {
    io.stdout(`${usage()}\n`);
    return 0;
  }
  let resolved: ResolvedCliInputs;
  try {
    resolved = await resolveInputs(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`build-local-reference: ${redactText(message)}\n`);
    return 2;
  }
  try {
    const input = buildInput(resolved);
    const artifactBytesById = await nativeBytesById(input);
    const buildOptions: LocalReferenceBuildOptions = {
      outputRoot: resolved.outputRoot,
      repositoryRoot: REPOSITORY_ROOT,
      timeoutMs: resolved.options.timeoutMs,
      ...(Object.keys(artifactBytesById).length ? { native: { artifactBytesById } } : {}),
    };
    const report = await buildLocalReference(input, buildOptions);
    const json = reportJson(report);
    await writeText(join(resolved.outputRoot, "report.json"), json);
    await writeText(join(resolved.outputRoot, "report.md"), reportMarkdown(report, resolved));
    await writeBundleIndexes(resolved.outputRoot, report);
    io.stdout(json);
    const states = Array.isArray((report as { scores?: unknown }).scores) ? (report as { scores: Array<{ state?: string }> }).scores.map((row) => row.state) : [];
    // A review-required or draft result is useful output, but it is not a
    // trusted reference.  Reserve success for the builder's explicit
    // melody-ready state; callers can then use exit 1 to keep review in CI.
    return states.length > 0 && states.every((state) => state === "MELODY_READY") ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`build-local-reference: ${redactText(message)}\n`);
    return 1;
  }
}

if (process.argv[1] && (process.argv[1].endsWith("build-local-reference.ts") || process.argv[1].endsWith("build-local-reference.js"))) {
  void runLocalReferenceCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
