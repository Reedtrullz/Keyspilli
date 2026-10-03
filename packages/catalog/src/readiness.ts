import Database from "better-sqlite3";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { dataDir } from "./paths.js";
import { CATALOG_SCHEMA_VERSION } from "./catalog-schema.js";

export function validateRuntimeConfiguration(env: Record<string, string | undefined> = process.env): void {
  const directory = env.KEYSPILLI_DATA_DIR;
  if (directory !== undefined && (!isAbsolute(directory) || directory.trim() !== directory)) throw new Error("KEYSPILLI_DATA_DIR must be an absolute path without surrounding whitespace");
  for (const field of ["KEYSPILLI_TUTORIAL_BETA", "KEYSPILLI_TUTORIAL_PREVIEW"]) {
    const value = env[field];
    if (value !== undefined && !["", "0", "1"].includes(value)) throw new Error(`${field} must be 0 or 1`);
  }
  if (env.KEYSPILLI_ORIGIN !== undefined) {
    try {
      const origin = new URL(env.KEYSPILLI_ORIGIN);
      if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password
          || origin.pathname !== "/" || origin.search || origin.hash) throw new Error();
    } catch { throw new Error("KEYSPILLI_ORIGIN must be an HTTP(S) origin without credentials"); }
  }
  if (env.KEYSPILLI_SOURCE_SEARCH_PROVIDER !== undefined
      && !["", "brave"].includes(env.KEYSPILLI_SOURCE_SEARCH_PROVIDER)) {
    throw new Error("KEYSPILLI_SOURCE_SEARCH_PROVIDER is unsupported");
  }
}

export type CatalogReadiness = {
  state: "ready" | "unavailable";
  code?: "CATALOG_UNAVAILABLE" | "UNSUPPORTED_SCHEMA";
  schemaEpoch?: number;
  songs?: number;
  writable?: boolean;
};

/** Read-only preflight: never mkdir, migrate or create a missing database. */
export function inspectCatalogReadiness(directory = dataDir()): CatalogReadiness {
  let db: Database.Database | undefined;
  try {
    db = new Database(join(directory, "db.sqlite"), { readonly: true, fileMustExist: true, timeout: 250 });
    const schemaEpoch = db.pragma("user_version", { simple: true }) as number;
    if (schemaEpoch < 0 || schemaEpoch > CATALOG_SCHEMA_VERSION) return { state: "unavailable", code: "UNSUPPORTED_SCHEMA", schemaEpoch };
    // ponytail: exact health counts through 10,000 rows; omit the count above that ceiling rather than scan an unbounded catalog.
    const count = (db.prepare("SELECT COUNT(*) AS n FROM (SELECT 1 FROM songs LIMIT 10001)").get() as { n: number }).n;
    let writable = false;
    try {
      accessSync(directory, constants.W_OK | constants.X_OK);
      accessSync(join(directory, "db.sqlite"), constants.W_OK);
      for (const name of ["artifacts", "uploads", "transcribed"]) {
        const path = join(directory, name);
        if (existsSync(path)) {
          if (!statSync(path).isDirectory()) throw new Error("owned path is not a directory");
          accessSync(path, constants.W_OK | constants.X_OK);
        }
      }
      writable = true;
    } catch { /* read-only catalogs still support browsing */ }
    return { state: "ready", schemaEpoch, writable, ...(count <= 10_000 ? { songs: count } : {}) };
  } catch {
    return { state: "unavailable", code: "CATALOG_UNAVAILABLE" };
  } finally { db?.close(); }
}
