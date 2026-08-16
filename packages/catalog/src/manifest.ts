/**
 * Merge freshly fetched seed metadata with entries already present in the
 * manifest without losing locally supplied sources.
 *
 * The fetcher runs on clean CI workers as well as on a developer checkout.
 * A clean worker only has files tracked in git, so an existing entry is safe
 * to carry forward only when its source file is available in the seed
 * directory. Freshly fetched entries win on id collisions because they carry
 * the current upstream metadata.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, dataDir } from "./paths.js";

export interface ManifestEntry {
  id: string;
  sourceFile?: string;
  [key: string]: unknown;
}

let disabledPath: string | undefined;
let disabledSignature: string | undefined;
let disabledIds = new Set<string>();
let disabledError: Error | undefined;

function manifestSignature(path: string): string {
  const stat = statSync(path);
  // Include inode and mtime so an atomic replacement at the same pathname
  // invalidates the in-process cache immediately.
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
}

/**
 * Return manifest entries explicitly disabled from the learner catalogue.
 *
 * Production keeps the manifest in the mounted data volume during rebuilds;
 * the checked-in copy is the deterministic local/CI fallback. Keeping this
 * policy in one loader lets the API and rebuild gates agree even when an old
 * SQLite snapshot still contains rows for a disabled source.
 */
export function disabledManifestBases(): ReadonlySet<string> {
  const candidates = [join(dataDir(), "manifest.json"), join(ROOT, "catalog", "manifest.json")];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    disabledPath = undefined;
    disabledSignature = undefined;
    disabledError = undefined;
    disabledIds = new Set<string>();
    return disabledIds;
  }
  const signature = manifestSignature(path);
  if (path === disabledPath && signature === disabledSignature) {
    if (disabledError) throw disabledError;
    return disabledIds;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { songs?: Array<{ id?: string; disabled?: boolean }> };
    if (!parsed || !Array.isArray(parsed.songs)) {
      throw new Error("catalog manifest must contain a songs array");
    }
    disabledPath = path;
    disabledSignature = signature;
    disabledError = undefined;
    disabledIds = new Set(
      (parsed.songs ?? [])
        .filter((entry) => entry.disabled === true && typeof entry.id === "string")
        .map((entry) => entry.id as string),
    );
    return disabledIds;
  } catch (error) {
    // A malformed policy file must not silently make previously disabled
    // catalogue rows public. Throwing fails the request/rebuild closed; an
    // atomic publisher can then replace the file and the signature above
    // causes the next call to re-read it.
    const cause = error instanceof Error ? error.message : String(error);
    const failure = new Error(`unable to load catalog manifest ${path}: ${cause}`);
    disabledPath = path;
    disabledSignature = signature;
    disabledError = failure;
    throw failure;
  }
}

export function mergeSeedEntries(
  fetched: ManifestEntry[],
  existing: ManifestEntry[],
  availableSourceFiles: ReadonlySet<string>,
): ManifestEntry[] {
  const byId = new Map<string, ManifestEntry>();
  for (const entry of fetched) {
    if (entry.id) byId.set(entry.id, entry);
  }

  for (const entry of existing) {
    if (!entry.id || byId.has(entry.id)) continue;
    // Disabled entries are policy, not sources to ingest. Preserve them even
    // when their original file is unavailable on a clean CI runner; otherwise
    // a fetch-seed pass silently removes the visibility gate from the
    // published manifest and stale production rows become public again.
    if (entry.disabled === true || (entry.sourceFile && availableSourceFiles.has(entry.sourceFile))) {
      byId.set(entry.id, entry);
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
