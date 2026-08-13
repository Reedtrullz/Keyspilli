import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Repo root, resolved from cwd so it works under npm workspaces
 * (cwd = apps/web), CLI scripts (cwd = repo root) and the Docker worker
 * (cwd = /app, which has no apps/ directory but does have services/).
 */
export const ROOT = resolve(
  process.cwd(),
  ["apps", "services", "packages"].some((p) => existsSync(resolve(process.cwd(), p))) ? "." : "../..",
);

export function dataDir(): string {
  return process.env.KEYSPILLI_DATA_DIR ?? resolve(ROOT, "data");
}

export function dbPath(): string {
  return resolve(dataDir(), "db.sqlite");
}

export function artifactsDir(baseId: string, level: string): string {
  return resolve(dataDir(), "artifacts", baseId, level);
}

export function seedMidiDir(): string {
  return resolve(dataDir(), "seed-midi");
}

export function transcribedDir(): string {
  return resolve(dataDir(), "transcribed");
}

export function uploadsDir(): string {
  return resolve(dataDir(), "uploads");
}
