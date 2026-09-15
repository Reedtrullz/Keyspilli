import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, dataDir } from "./paths.js";

interface ReviewEntry { blocked?: boolean; [key: string]: unknown }
interface ReviewFile { verdicts?: Record<string, ReviewEntry>; [key: string]: unknown }

let cachedPath: string | undefined;
let cachedSignature: string | undefined;
let cachedBlocked: ReadonlySet<string> | null = null;

function fileSignature(path: string): string {
  try {
    const stat = statSync(path, { bigint: true });
    return `${path}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch {
    return `${path}:missing`;
  }
}

/**
 * Validate and parse a learner-review JSON file.
 *
 * Throws a stable error on any structural problem so the catalogue read
 * path fails closed: no policy file means an empty block set (deploy
 * cannot accidentally hide the whole catalogue), but a present malformed
 * file throws and blocks all reads until fixed.
 */
function parseReviewFile(raw: string): ReadonlySet<string> {
  let parsed: ReviewFile;
  try {
    parsed = JSON.parse(raw) as ReviewFile;
  } catch {
    throw new Error("LEARNER_REVIEW_MALFORMED: invalid JSON in learner-review.json");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LEARNER_REVIEW_MALFORMED: learner-review.json root must be an object");
  }
  const verdicts = parsed.verdicts;
  if (verdicts === undefined || verdicts === null || typeof verdicts !== "object" || Array.isArray(verdicts)) {
    throw new Error("LEARNER_REVIEW_MALFORMED: verdicts must be an object");
  }
  const blocked = new Set<string>();
  for (const [baseId, entry] of Object.entries(verdicts)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`LEARNER_REVIEW_MALFORMED: verdict for "${baseId}" must be an object`);
    }
    if (entry.blocked !== undefined && typeof entry.blocked !== "boolean") {
      throw new Error(`LEARNER_REVIEW_MALFORMED: blocked field for "${baseId}" must be boolean`);
    }
    if (entry.blocked === true) blocked.add(baseId);
  }
  return blocked;
}

/**
 * Return the owner-reviewed bases that must not be exposed as learner songs.
 *
 * Uses file-signature-aware caching so an atomic replacement is detected.
 * Throws on malformed JSON or invalid schema so the catalogue read path
 * fails closed — a broken policy must not silently re-expose blocked
 * lessons.  Missing file returns an empty set (cannot hide the catalogue
 * by deleting the policy).
 */
export function blockedLearnerBases(): ReadonlySet<string> {
  const candidates = [
    join(dataDir(), "learner-review.json"),
    join(ROOT, "catalog", "learner-review.json"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    cachedPath = undefined;
    cachedSignature = undefined;
    cachedBlocked = null;
    return new Set<string>();
  }
  const sig = fileSignature(path);
  if (path === cachedPath && sig === cachedSignature && cachedBlocked !== null) {
    return cachedBlocked;
  }
  const blocked = parseReviewFile(readFileSync(path, "utf8"));
  cachedPath = path;
  cachedSignature = sig;
  cachedBlocked = blocked;
  return blocked;
}

export function isLearnerBlocked(baseId: string): boolean {
  return blockedLearnerBases().has(baseId);
}
