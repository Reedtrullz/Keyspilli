import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, dataDir } from "./paths.js";

interface ReviewEntry { blocked?: boolean }
interface ReviewFile { verdicts?: Record<string, ReviewEntry> }

let cachedPath: string | undefined;
let cachedBlocked = new Set<string>();

/**
 * Return the owner-reviewed bases that must not be exposed as learner songs.
 * The data-volume copy is used in containers; the repository copy keeps local
 * development and read-only audits deterministic. Missing review data fails
 * open so a deploy cannot accidentally hide the whole catalogue.
 */
export function blockedLearnerBases(): ReadonlySet<string> {
  const candidates = [
    join(dataDir(), "learner-review.json"),
    join(ROOT, "catalog", "learner-review.json"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) return new Set<string>();
  if (path === cachedPath) return cachedBlocked;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ReviewFile;
    cachedPath = path;
    cachedBlocked = new Set(
      Object.entries(parsed.verdicts ?? {})
        .filter(([, entry]) => entry?.blocked === true)
        .map(([baseId]) => baseId),
    );
    return cachedBlocked;
  } catch {
    return new Set<string>();
  }
}

export function isLearnerBlocked(baseId: string): boolean {
  return blockedLearnerBases().has(baseId);
}
