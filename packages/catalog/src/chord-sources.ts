import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { ROOT } from "./paths.js";

/** Versioned, catalog-owned metadata for external chord charts. */
export const CHORD_SOURCE_SCHEMA_VERSION = 1 as const;

export type ChordSourceKind = "chart" | "midi-derived";

export interface ChordSourceRef {
  /** Stable id used in provenance; it must not contain source payload. */
  id: string;
  /** Provider or internal pipeline that produced the source. */
  provider: string;
  kind: ChordSourceKind;
  /** Human-readable, non-secret locator such as an external source slug. */
  sourceRef: string;
  sourceUrl?: string | null;
  /** Path to a checked-in normalized timeline, relative to the repository root. */
  artifactPath?: string;
  retrievedAt?: string;
  /** A short editorial confidence label, not a score pretending to be truth. */
  confidence?: "high" | "medium" | "low" | "fallback" | "curated";
  priority?: number;
}

export interface ChordSourceEntry {
  /** Existing catalog base id, not a new song id or a display slug. */
  baseId: string;
  canonicalTitle: string;
  canonicalArtist: string;
  sources: ChordSourceRef[];
  /** Optional source to use after all artifact-backed sources fail. */
  fallbackSourceId?: string;
}

export interface ChordSourceMap {
  schemaVersion: typeof CHORD_SOURCE_SCHEMA_VERSION;
  entries: ChordSourceEntry[];
}

const BASE_ID_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "lyrics",
  "lyric",
  "tab",
  "tabs",
  "tablature",
  "raw",
  "rawtext",
  "charttext",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pathIsInside(root: string, path: string): boolean {
  const rootPath = resolve(root);
  const pathRelative = relative(rootPath, resolve(rootPath, path));
  return pathRelative === "" || (!pathRelative.startsWith("..") && !isAbsolute(pathRelative));
}

function repositoryRelativePath(path: string): boolean {
  return nonEmptyString(path) && !isAbsolute(path) && !path.split(/[\\/]+/).includes("..");
}

/**
 * Keep source metadata deliberately narrow. A chart mapping is provenance,
 * not a place to check in copied lyrics, tab text, or provider page bodies.
 */
export function validateChordSourceMap(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["map must be an object"];
  if (value.schemaVersion !== CHORD_SOURCE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CHORD_SOURCE_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(value.entries)) {
    errors.push("entries must be an array");
    return errors;
  }

  const baseIds = new Set<string>();
  for (const [entryIndex, rawEntry] of value.entries.entries()) {
    const path = `entries[${entryIndex}]`;
    if (!isRecord(rawEntry)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    const baseId = rawEntry.baseId;
    if (typeof baseId !== "string" || !BASE_ID_RE.test(baseId)) {
      errors.push(`${path}.baseId must be a valid catalog base id`);
    } else if (baseIds.has(baseId)) {
      errors.push(`${path}.baseId duplicates ${baseId}`);
    } else {
      baseIds.add(baseId);
    }
    if (!nonEmptyString(rawEntry.canonicalTitle)) errors.push(`${path}.canonicalTitle must be non-empty`);
    if (!nonEmptyString(rawEntry.canonicalArtist)) errors.push(`${path}.canonicalArtist must be non-empty`);
    if (!Array.isArray(rawEntry.sources) || rawEntry.sources.length === 0) {
      errors.push(`${path}.sources must contain at least one source`);
      continue;
    }

    const sourceIds = new Set<string>();
    for (const [sourceIndex, rawSource] of rawEntry.sources.entries()) {
      const sourcePath = `${path}.sources[${sourceIndex}]`;
      if (!isRecord(rawSource)) {
        errors.push(`${sourcePath} must be an object`);
        continue;
      }
      if (!nonEmptyString(rawSource.id)) {
        errors.push(`${sourcePath}.id must be non-empty`);
      } else if (sourceIds.has(rawSource.id)) {
        errors.push(`${sourcePath}.id duplicates ${rawSource.id}`);
      } else {
        sourceIds.add(rawSource.id);
      }
      if (!nonEmptyString(rawSource.provider)) errors.push(`${sourcePath}.provider must be non-empty`);
      if (rawSource.kind !== "chart" && rawSource.kind !== "midi-derived") {
        errors.push(`${sourcePath}.kind must be chart or midi-derived`);
      }
      if (!nonEmptyString(rawSource.sourceRef)) errors.push(`${sourcePath}.sourceRef must be non-empty`);
      if (rawSource.sourceUrl !== undefined && rawSource.sourceUrl !== null && !nonEmptyString(rawSource.sourceUrl)) {
        errors.push(`${sourcePath}.sourceUrl must be a URL string or null`);
      }
      if (rawSource.artifactPath !== undefined) {
        if (typeof rawSource.artifactPath !== "string" || !repositoryRelativePath(rawSource.artifactPath)) {
          errors.push(`${sourcePath}.artifactPath must be a repository-relative path`);
        }
      }
      if (rawSource.priority !== undefined && (typeof rawSource.priority !== "number" || !Number.isInteger(rawSource.priority) || rawSource.priority < 0)) {
        errors.push(`${sourcePath}.priority must be a non-negative integer`);
      }
      if (rawSource.confidence !== undefined && !["high", "medium", "low", "fallback", "curated"].includes(String(rawSource.confidence))) {
        errors.push(`${sourcePath}.confidence is not recognized`);
      }
      for (const key of Object.keys(rawSource)) {
        if (FORBIDDEN_PAYLOAD_KEYS.has(key.toLowerCase())) errors.push(`${sourcePath} must not contain ${key}`);
      }
    }

    if (rawEntry.fallbackSourceId !== undefined) {
      if (!nonEmptyString(rawEntry.fallbackSourceId)) errors.push(`${path}.fallbackSourceId must be non-empty`);
      else if (!sourceIds.has(rawEntry.fallbackSourceId)) errors.push(`${path}.fallbackSourceId is not present in sources`);
    }
    for (const key of Object.keys(rawEntry)) {
      if (FORBIDDEN_PAYLOAD_KEYS.has(key.toLowerCase())) errors.push(`${path} must not contain ${key}`);
    }
  }
  return errors;
}

export function parseChordSourceMap(value: unknown): ChordSourceMap {
  const errors = validateChordSourceMap(value);
  if (errors.length) throw new Error(`invalid chord source map: ${errors.join("; ")}`);
  return value as ChordSourceMap;
}

export async function loadChordSourceMap(filePath = process.env.KEYSPILLI_CHORD_SOURCE_MAP ?? resolve(ROOT, "catalog/chord-sources.json")): Promise<ChordSourceMap> {
  const path = resolve(filePath);
  const signature = sourceMapFileSignature(path);
  const cached = sourceMapCache.get(path);
  if (cached?.signature === signature) {
    rememberSourceMap(path, cached);
    return cached.map;
  }
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  const map = parseChordSourceMap(raw);
  rememberSourceMap(path, { signature, map });
  return map;
}

/** Resolve a checked-in source artifact while rejecting path traversal. */
export function resolveChordSourceArtifact(source: ChordSourceRef, catalogRoot = ROOT): string | null {
  if (!source.artifactPath || isAbsolute(source.artifactPath) || !pathIsInside(catalogRoot, source.artifactPath)) return null;
  return resolve(catalogRoot, source.artifactPath);
}

export function sourcePriority(source: ChordSourceRef, index: number): number {
  return source.priority ?? index;
}

interface SourceMapCacheEntry {
  signature: string;
  map: ChordSourceMap;
}

const SOURCE_MAP_CACHE_LIMIT = 8;
const sourceMapCache = new Map<string, SourceMapCacheEntry>();

function sourceMapFileSignature(path: string): string {
  try {
    const stat = statSync(path, { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}`;
  } catch {
    return "missing";
  }
}

function rememberSourceMap(path: string, entry: SourceMapCacheEntry): void {
  sourceMapCache.delete(path);
  sourceMapCache.set(path, entry);
  while (sourceMapCache.size > SOURCE_MAP_CACHE_LIMIT) {
    const oldest = sourceMapCache.keys().next().value;
    if (oldest === undefined) break;
    sourceMapCache.delete(oldest);
  }
}
