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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, dataDir } from "./paths.js";

export interface ManifestEntry {
  id: string;
  sourceFile?: string;
  [key: string]: unknown;
}

let disabledPath: string | undefined;
let disabledIds = new Set<string>();

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
  if (!path) return new Set<string>();
  if (path === disabledPath) return disabledIds;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { songs?: Array<{ id?: string; disabled?: boolean }> };
    disabledPath = path;
    disabledIds = new Set(
      (parsed.songs ?? [])
        .filter((entry) => entry.disabled === true && typeof entry.id === "string")
        .map((entry) => entry.id as string),
    );
    return disabledIds;
  } catch {
    return new Set<string>();
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
    if (entry.sourceFile && availableSourceFiles.has(entry.sourceFile)) {
      byId.set(entry.id, entry);
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
