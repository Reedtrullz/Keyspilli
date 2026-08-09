import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (packages/catalog/src -> repo root). */
export const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

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
