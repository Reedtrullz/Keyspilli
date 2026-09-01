#!/usr/bin/env node
/**
 * Local-only Guitar-TECHS route evaluator.
 *
 * The manifest and route MIDI files are deliberately external to the
 * repository. This command only parses those files and delegates scoring to
 * the pure upstream-attribution module; it never runs the production worker,
 * arranger, catalog, network, or upload paths.
 */
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parseMidi } from "@keyspilli/midi";
import {
  canonicalUpstreamManifest,
  upstreamManifestSha256,
  type UpstreamAttributionManifest,
} from "../src/upstream-attribution-manifest.js";
import {
  canonicalUpstreamReport,
  compareUpstreamRoutes,
  normalizeUpstreamTruth,
  type UpstreamAttributionReport,
  type UpstreamCandidateNoteInput,
  type UpstreamRouteCandidate,
  type UpstreamTruth,
} from "../src/upstream-attribution.js";
import { createHash } from "node:crypto";

interface LocalItem {
  id: string;
  performanceId?: string;
  techniques?: string[];
  local: { truth: string; di: string; ampMic: string };
  truthMetadata?: { durationBeats?: number; tempoBpm?: number };
  files?: {
    truth?: { sha256?: string };
    di?: { sha256?: string };
    ampMic?: { sha256?: string };
  };
}

interface LocalManifest {
  schemaVersion: number;
  dataset: Record<string, unknown>;
  selection?: { itemIds?: string[] };
  items: LocalItem[];
  acquisition?: Record<string, unknown>;
  routeConfig?: Record<string, unknown>;
}

interface CliOptions { manifest: string; routesRoot: string; out?: string; help: boolean }

function usage(): string {
  return [
    "Usage: evaluate-upstream-guitar.ts --manifest /private/tmp/.../guitar-techs-manifest.json --routes-root /private/tmp/.../routes [--out /private/tmp/.../report.json]",
    "",
    "The manifest and raw route MIDIs are local inputs. Output is deterministic",
    "and path-redacted. No production transcription, arranger, catalog, network,",
    "or upload path is invoked.",
  ].join("\n");
}

function localPath(value: string, flag: string): string {
  if (!value || !isAbsolute(value) || /^(?:https?|ftp):\/\//i.test(value) || /[\0\r\n]/.test(value)) {
    throw new Error(`${flag} must be an absolute local path`);
  }
  return resolve(value);
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { manifest: "", routesRoot: "", help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const equals = arg.indexOf("=");
    const flag = equals >= 0 ? arg.slice(0, equals) : arg;
    const inline = equals >= 0 ? arg.slice(equals + 1) : undefined;
    const value = (): string => {
      const next = inline ?? argv[++i];
      if (!next || next.startsWith("--")) throw new Error(`${flag} requires a value`);
      return next;
    };
    if (flag === "--manifest") options.manifest = localPath(value(), "--manifest");
    else if (flag === "--routes-root") options.routesRoot = localPath(value(), "--routes-root");
    else if (flag === "--out") options.out = localPath(value(), "--out");
    else if (flag === "--help" || flag === "-h") options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (!options.help && (!options.manifest || !options.routesRoot)) throw new Error(`--manifest and --routes-root are required\n\n${usage()}`);
  return options;
}

async function regularFile(path: string, label: string): Promise<string> {
  const resolved = await realpath(path).catch(() => { throw new Error(`${label} does not exist`); });
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`${label} must be a regular file`);
  return resolved;
}

function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

async function readLocalManifest(path: string): Promise<LocalManifest> {
  const manifestPath = await regularFile(path, "manifest");
  const value: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("manifest must be an object");
  const manifest = value as Partial<LocalManifest>;
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.items) || manifest.items.length === 0) throw new Error("manifest schema/items are invalid");
  const ids = manifest.items.map((item) => item?.id);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) throw new Error("manifest item IDs must be unique strings");
  return manifest as LocalManifest;
}

function metadataManifest(manifest: LocalManifest): UpstreamAttributionManifest {
  const modality = (kind: "midi" | "di" | "amp", sha256: unknown) => {
    if (typeof sha256 === "string" && /^[0-9a-f]{64}$/i.test(sha256)) {
      return { kind, status: "available" as const, sha256: sha256.toLowerCase() };
    }
    return { kind, status: "unavailable" as const, reason: "missing verified file hash" };
  };
  const items = manifest.items.map((item) => ({
    id: item.id,
    performance: [item.performanceId ?? item.id],
    modalities: [
      modality("midi", item.files?.truth?.sha256),
      modality("di", item.files?.di?.sha256),
      modality("amp", item.files?.ampMic?.sha256),
    ],
  }));
  return {
    schemaVersion: 1,
    dataset: {
      name: "Guitar-TECHS",
      version: String(manifest.dataset.version ?? "unknown"),
      license: { spdx: "CC-BY-4.0", url: String((manifest.dataset.license as { url?: unknown } | undefined)?.url ?? "https://creativecommons.org/licenses/by/4.0/") },
    },
    items,
  };
}

function truthFor(item: LocalItem, notes: ReturnType<typeof parseMidi>["notes"]): UpstreamTruth {
  const meta = item.truthMetadata ?? {};
  return normalizeUpstreamTruth(notes.map((note) => ({ midi: note.midi, start: note.start, dur: note.dur })), {
    performanceId: item.performanceId ?? item.id,
    technique: item.techniques?.join("+") ?? "unknown",
    durationBeats: meta.durationBeats,
    tempoBpm: meta.tempoBpm,
    sourceHash: item.files?.truth?.sha256,
  });
}

function candidateFor(route: string, notes: ReturnType<typeof parseMidi>["notes"]): UpstreamRouteCandidate {
  const values: UpstreamCandidateNoteInput[] = notes.map((note) => ({ midi: note.midi, start: note.start, dur: note.dur }));
  return { route, notes: values };
}

async function routeCandidate(path: string, route: string): Promise<UpstreamRouteCandidate> {
  try {
    const resolved = await regularFile(path, `${route} MIDI`);
    const bytes = new Uint8Array(await readFile(resolved));
    const parsed = parseMidi(bytes);
    return { ...candidateFor(route, parsed.notes), durationBeats: Math.max(...parsed.notes.map((n) => n.start + n.dur), 0), durationSeconds: parsed.notes.length ? Math.max(...parsed.notes.map((n) => n.start + n.dur), 0) * 60 / parsed.tempoBpm : 0, tempoBpm: parsed.tempoBpm, sourceHash: sha256(bytes) };
  } catch (error) {
    return { route, status: "unavailable", notes: [], reason: error instanceof Error ? error.message : String(error) };
  }
}

function offsetNotes<T extends { start?: unknown }>(notes: readonly T[], offset: number): T[] {
  return notes.flatMap((note) => typeof note.start === "number" && Number.isFinite(note.start)
    ? [{ ...note, start: note.start + offset } as T]
    : []);
}

async function buildReport(manifest: LocalManifest, routesRoot: string): Promise<Record<string, unknown>> {
  const sortedItems = [...manifest.items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const perItem: Array<Record<string, unknown>> = [];
  const allTruth: UpstreamCandidateNoteInput[] = [];
  const allRoutes: Record<string, UpstreamCandidateNoteInput[]> = { "di-basic-pitch": [], "amp-mic-basic-pitch": [] };
  let offset = 0;
  for (const item of sortedItems) {
    const truthPath = await regularFile(item.local.truth, `${item.id} truth`);
    const truthParsed = parseMidi(new Uint8Array(await readFile(truthPath)));
    const truth = truthFor(item, truthParsed.notes);
    const routeValues: Record<string, UpstreamRouteCandidate> = {};
    for (const [key, file] of [["di-basic-pitch", "di"], ["amp-mic-basic-pitch", "ampMic"]] as const) {
      routeValues[key] = await routeCandidate(join(routesRoot, item.id, file, "candidate.mid"), key);
    }
    const itemReport = compareUpstreamRoutes(truth, routeValues);
    perItem.push({ id: item.id, techniques: item.techniques ?? ["unknown"], truthNoteCount: truth.notes.length, routes: itemReport.routes, loss: itemReport.loss, decisions: itemReport.decisions });
    allTruth.push(...offsetNotes(truth.notes, offset));
    for (const key of Object.keys(allRoutes)) {
      const notes = routeValues[key]?.notes ?? [];
      allRoutes[key]!.push(...offsetNotes(notes, offset));
    }
    offset += Math.max(truth.durationBeats, 1) + 8;
  }
  const aggregateTruth = normalizeUpstreamTruth(allTruth, { performanceId: "guitar-techs-slice", durationBeats: offset });
  const aggregate: UpstreamAttributionReport = compareUpstreamRoutes(aggregateTruth, {
    "di-basic-pitch": { route: "di-basic-pitch", notes: allRoutes["di-basic-pitch"] },
    "amp-mic-basic-pitch": { route: "amp-mic-basic-pitch", notes: allRoutes["amp-mic-basic-pitch"] },
    "mixture-basic-pitch": { route: "mixture-basic-pitch", status: "unavailable", notes: [] },
    "mixture-demucs-basic-pitch": { route: "mixture-demucs-basic-pitch", status: "unavailable", notes: [] },
    "mixture-bs-roformer-basic-pitch": { route: "mixture-bs-roformer-basic-pitch", status: "unavailable", notes: [] },
  });
  const metadata = metadataManifest(manifest);
  return {
    schemaVersion: 1,
    kind: "guitar-techs-upstream-attribution",
    dataset: manifest.dataset,
    manifestSha256: upstreamManifestSha256(metadata),
    manifestCanonicalSha256: sha256(new TextEncoder().encode(canonicalUpstreamManifest(metadata))),
    routeConfig: manifest.routeConfig ?? null,
    acquisition: manifest.acquisition ?? null,
    items: perItem,
    aggregate,
  };
}

export async function runEvaluateUpstreamGuitar(argv: readonly string[], io = { stdout: (v: string) => process.stdout.write(v), stderr: (v: string) => process.stderr.write(v) }): Promise<number> {
  let options: CliOptions;
  try { options = parseArgs(argv); } catch (error) { io.stderr(`${error instanceof Error ? error.message : String(error)}\n`); return 2; }
  if (options.help) { io.stdout(`${usage()}\n`); return 0; }
  try {
    const manifest = await readLocalManifest(options.manifest);
    const report = await buildReport(manifest, options.routesRoot);
    const output = `${JSON.stringify(JSON.parse(canonicalUpstreamReport(report)), null, 2)}\n`;
    if (options.out) {
      const parent = dirname(options.out);
      if (!(await stat(parent).catch(() => null))?.isDirectory()) throw new Error("--out parent does not exist");
      await writeFile(options.out, output, "utf8");
    }
    io.stdout(output);
    return 0;
  } catch (error) { io.stderr(`${error instanceof Error ? error.message : String(error)}\n`); return 2; }
}

if (process.argv[1] && import.meta.url.endsWith(`/${basename(process.argv[1])}`)) {
  runEvaluateUpstreamGuitar(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
