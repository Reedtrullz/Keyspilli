import Database from "better-sqlite3";
import { mkdtempSync, existsSync, rmSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { inspectCatalogReadiness, validateRuntimeConfiguration } from "../src/readiness.js";
import { initializeCatalogSchema, CATALOG_SCHEMA_VERSION } from "../src/catalog-schema.js";

it("reports missing/newer catalogs without initializing or upgrading them", () => {
  const directory = mkdtempSync(join(tmpdir(), "keyspilli-readiness-"));
  try {
    const missing = join(directory, "missing");
    expect(inspectCatalogReadiness(missing).state).toBe("unavailable");
    expect(existsSync(missing)).toBe(false);
    const preflight = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../../../apps/web/scripts/runtime-preflight.ts", import.meta.url))], {
      env: { PATH: "", KEYSPILLI_DATA_DIR: missing, KEYSPILLI_TUTORIAL_BETA: "1" }, encoding: "utf8", timeout: 10_000,
    });
    expect(preflight.status).toBe(1);
    const readiness = JSON.parse(preflight.stdout);
    expect(readiness).toMatchObject({ catalog: { state: "unavailable" }, binaries: { ffmpeg: false, downloader: false, tutorialPython: false }, tutorialImport: { state: "unavailable", configured: true } });
    expect(preflight.stdout).not.toContain(missing);
    expect(existsSync(missing)).toBe(false);
    const db = new Database(join(directory, "db.sqlite"));
    initializeCatalogSchema(db);
    db.close();
    expect(inspectCatalogReadiness(directory)).toMatchObject({ state: "ready", schemaEpoch: CATALOG_SCHEMA_VERSION, songs: 0 });
    const artifacts = join(directory, "artifacts");
    mkdirSync(artifacts);
    if (process.getuid?.() !== 0) {
      chmodSync(artifacts, 0o500);
      expect(inspectCatalogReadiness(directory)).toMatchObject({ state: "ready", writable: false });
      chmodSync(artifacts, 0o700);
    }
    const newer = new Database(join(directory, "db.sqlite"));
    newer.pragma(`user_version = ${CATALOG_SCHEMA_VERSION + 1}`); newer.close();
    expect(inspectCatalogReadiness(directory)).toMatchObject({ state: "unavailable", code: "UNSUPPORTED_SCHEMA" });
    const check = new Database(join(directory, "db.sqlite"), { readonly: true });
    expect(check.pragma("user_version", { simple: true })).toBe(CATALOG_SCHEMA_VERSION + 1); check.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
  for (const value of ["", "relative", " /data"]) expect(() => validateRuntimeConfiguration({ KEYSPILLI_DATA_DIR: value })).toThrow(/KEYSPILLI_DATA_DIR/);
  for (const value of ["NaN", "true", "2"]) expect(() => validateRuntimeConfiguration({ KEYSPILLI_TUTORIAL_BETA: value })).toThrow(/KEYSPILLI_TUTORIAL_BETA/);
  expect(() => validateRuntimeConfiguration({ KEYSPILLI_DATA_DIR: "/data", KEYSPILLI_TUTORIAL_BETA: "1" })).not.toThrow();
  for (const origin of ["file:///data", "https://user:private@example.com", "https://example.com/path", "bad"]) {
    expect(() => validateRuntimeConfiguration({ KEYSPILLI_ORIGIN: origin })).toThrow(/KEYSPILLI_ORIGIN/);
  }
  expect(() => validateRuntimeConfiguration({ KEYSPILLI_SOURCE_SEARCH_PROVIDER: "invalid" })).toThrow(/PROVIDER/);
});
