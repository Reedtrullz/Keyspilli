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
export interface ManifestEntry {
  id: string;
  sourceFile?: string;
  [key: string]: unknown;
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
