#!/usr/bin/env node
/**
 * Metadata-first seven-song retrieval inventory.
 *
 * The default mode is local and network-free. It accepts response metadata
 * supplied in a JSON sidecar and never accepts benchmark files or binary
 * payloads from that sidecar. `--network` is an explicit opt-in for public URL
 * retrieval; authentication is never bypassed and response bodies are bounded.
 * Reports contain classifications and hashes/diagnostics only.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXTERNAL_RETRIEVAL_SCHEMA_VERSION,
  classifyExternalRetrieval,
  retrieveExternalSource,
  type ExternalRetrievalClassification,
  type ExternalRetrievalInput,
} from "../src/external-retrieval.js";

export interface SevenSongEvidenceSong {
  id: string;
  title: string;
  artist: string;
  sources?: readonly ExternalRetrievalInput[];
}

export interface SevenSongEvidenceInput {
  songs?: readonly SevenSongEvidenceSong[];
}

export interface SevenSongEvidenceSongReport extends Omit<SevenSongEvidenceSong, "sources"> {
  statuses: string[];
  sources: ExternalRetrievalClassification[];
}

export interface SevenSongEvidenceReport {
  schemaVersion: typeof EXTERNAL_RETRIEVAL_SCHEMA_VERSION;
  network: boolean;
  songs: SevenSongEvidenceSongReport[];
  summary: Record<string, number>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const DEFAULT_SONGS: readonly SevenSongEvidenceSong[] = [
  { id: "sabaton-the-red-baron", title: "The Red Baron", artist: "Sabaton" },
  { id: "sabaton-the-final-solution", title: "The Final Solution", artist: "Sabaton" },
  { id: "sabaton-christmas-truce", title: "Christmas Truce", artist: "Sabaton" },
  { id: "lynyrd-skynyrd-free-bird", title: "Free Bird", artist: "Lynyrd Skynyrd" },
  { id: "sabaton-1916", title: "1916", artist: "Sabaton" },
  { id: "sabaton-gott-mit-uns", title: "Gott Mit Uns", artist: "Sabaton" },
  { id: "sabaton-the-caroleans-prayer", title: "The Carolean's Prayer", artist: "Sabaton" },
];

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function cleanText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240) : fallback;
}

function safeSongId(value: unknown): string {
  const id = cleanText(value, "unknown-song").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return id || "unknown-song";
}

function normalizeSong(value: unknown): SevenSongEvidenceSong {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("each seven-song entry must be an object");
  const row = value as Record<string, unknown>;
  const id = safeSongId(row.id);
  const sources = Array.isArray(row.sources) ? row.sources.map((source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error(`${id}: source must be an object`);
    const candidate = { ...(source as Record<string, unknown>) } as ExternalRetrievalInput;
    // JSON sidecars cannot safely carry a binary Uint8Array. Keeping this
    // rejection explicit prevents a benchmark file from being smuggled into a
    // retrieval report under a generic `bytes` array.
    if (Object.hasOwn(candidate, "bytes") || Object.hasOwn(candidate, "payload") || Object.hasOwn(candidate, "content")
      || (Object.hasOwn(candidate, "body") && typeof candidate.body !== "string" && candidate.body !== null && candidate.body !== undefined)) {
      throw new Error(`${id}: binary retrieval payloads must be supplied through an explicit local API, not the JSON sidecar`);
    }
    return candidate;
  }) : [];
  return {
    id,
    title: cleanText(row.title, id.replace(/-/g, " ")),
    artist: cleanText(row.artist, "Unknown artist"),
    sources,
  };
}

function parseInput(value: unknown): SevenSongEvidenceSong[] {
  if (value === null || value === undefined) return [...DEFAULT_SONGS];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("seven-song input must be an object with a songs array");
  if (!Object.hasOwn(value, "songs") && Object.keys(value).length === 0) return [...DEFAULT_SONGS];
  const rows = (value as SevenSongEvidenceInput).songs;
  if (!Array.isArray(rows)) throw new Error("seven-song input requires a songs array");
  const songs = rows.map(normalizeSong).sort((left, right) => compareText(left.id, right.id));
  const ids = new Set<string>();
  for (const song of songs) {
    if (ids.has(song.id)) throw new Error(`duplicate seven-song id: ${song.id}`);
    ids.add(song.id);
  }
  return songs;
}

export async function runSevenSongEvidence(
  input: SevenSongEvidenceInput | ReadonlyArray<SevenSongEvidenceSong> = {},
  options: { network?: boolean; maxBytes?: number; maxRedirects?: number } = {},
): Promise<SevenSongEvidenceReport> {
  const songs = Array.isArray(input) ? input.map(normalizeSong).sort((left, right) => compareText(left.id, right.id)) : parseInput(input);
  const network = options.network === true;
  const output: SevenSongEvidenceSongReport[] = [];
  const summary: Record<string, number> = {};
  for (const song of songs) {
    const sources = [...(song.sources ?? [])].sort((left, right) => compareText(String(left.id ?? left.sourceRef ?? left.initialUrl ?? left.url ?? ""), String(right.id ?? right.sourceRef ?? right.initialUrl ?? right.url ?? "")));
    const classified: ExternalRetrievalClassification[] = [];
    for (const source of sources) {
      const result = network
        ? await retrieveExternalSource({ ...source, title: source.title ?? song.title, artist: source.artist ?? song.artist }, { allowNetwork: true, maxBytes: options.maxBytes, maxRedirects: options.maxRedirects })
        : classifyExternalRetrieval({ ...source, title: source.title ?? song.title, artist: source.artist ?? song.artist });
      classified.push(result);
      summary[result.status] = (summary[result.status] ?? 0) + 1;
    }
    const statuses = classified.length
      ? [...new Set(classified.map((result) => result.status))].sort()
      : ["NO_EXTERNAL_SOURCE"];
    if (!classified.length) summary.NO_EXTERNAL_SOURCE = (summary.NO_EXTERNAL_SOURCE ?? 0) + 1;
    output.push({ id: song.id, title: song.title, artist: song.artist, statuses, sources: classified });
  }
  return { schemaVersion: EXTERNAL_RETRIEVAL_SCHEMA_VERSION, network, songs: output, summary: Object.fromEntries(Object.entries(summary).sort(([left], [right]) => compareText(left, right))) };
}

export function serializeSevenSongEvidence(report: SevenSongEvidenceReport): string {
  return `${JSON.stringify(stable(report), null, 2)}\n`;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (index >= 0 && (!value || value.startsWith("--"))) throw new Error(`${flag} requires a value`);
  return value;
}

function outsideRepository(path: string, label: string): void {
  const relativePath = relative(REPO_ROOT, path);
  if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))) {
    throw new Error(`${label} must be outside the repository`);
  }
}

function usage(): string {
  return [
    "Usage: research-seven-song-evidence.ts [--input FILE] [--out FILE] [--network]",
    "  --input FILE       metadata-only JSON sidecar with { songs: [...] }",
    "  --out FILE         write a new report outside the repository",
    "  --network          explicitly opt in to public URL retrieval",
    "  --max-bytes N      bound opt-in response bodies (default 16777216)",
    "  --max-redirects N  bound opt-in redirects (default 5)",
  ].join("\n");
}

export async function runSevenSongEvidenceCli(args: readonly string[]): Promise<{ report: SevenSongEvidenceReport; json: string }> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return { report: await runSevenSongEvidence(), json: "" };
  }
  const inputPath = valueAfter(args, "--input");
  const outputPath = valueAfter(args, "--out");
  const network = args.includes("--network");
  const maxBytesRaw = valueAfter(args, "--max-bytes");
  const maxRedirectsRaw = valueAfter(args, "--max-redirects");
  const maxBytes = maxBytesRaw === undefined ? undefined : Number(maxBytesRaw);
  const maxRedirects = maxRedirectsRaw === undefined ? undefined : Number(maxRedirectsRaw);
  if (maxBytes !== undefined && (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 128 * 1024 * 1024)) throw new Error("--max-bytes must be an integer between 1 and 134217728");
  if (maxRedirects !== undefined && (!Number.isInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > 10)) throw new Error("--max-redirects must be an integer between 0 and 10");
  let input: SevenSongEvidenceInput = {};
  if (inputPath) {
    const resolved = resolve(inputPath);
    const parsed = JSON.parse(await readFile(resolved, "utf8")) as unknown;
    input = parsed as SevenSongEvidenceInput;
  }
  const report = await runSevenSongEvidence(input, { network, maxBytes, maxRedirects });
  const json = serializeSevenSongEvidence(report);
  if (outputPath) {
    const resolved = resolve(outputPath);
    outsideRepository(resolved, "report output");
    await writeFile(resolved, json, { encoding: "utf8", flag: "wx" });
  } else {
    process.stdout.write(json);
  }
  return { report, json };
}

if (process.argv[1]?.endsWith("research-seven-song-evidence.ts") || process.argv[1]?.endsWith("research-seven-song-evidence.js")) {
  runSevenSongEvidenceCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
