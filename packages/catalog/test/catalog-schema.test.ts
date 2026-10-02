import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { CATALOG_SCHEMA_VERSION, initializeCatalogSchema } from "../src/catalog-schema.js";

it("upgrades atomically, preserves legacy rows, and rejects newer catalogs without mutation", () => {
  const db = new Database(":memory:");
  try {
    initializeCatalogSchema(db);
    expect(db.pragma("user_version", { simple: true })).toBe(CATALOG_SCHEMA_VERSION);
    db.exec("INSERT INTO conversion_jobs (id,youtube_url,status,created_at) VALUES ('old','https://youtu.be/abc','queued','now'); PRAGMA user_version = 0");
    initializeCatalogSchema(db);
    expect(db.prepare("SELECT id FROM conversion_jobs").all()).toEqual([{ id: "old" }]);
    db.pragma(`user_version = ${CATALOG_SCHEMA_VERSION + 1}`);
    const before = db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all();
    expect(() => initializeCatalogSchema(db)).toThrow(/newer.*catalog/i);
    expect(db.prepare("SELECT sql FROM sqlite_master ORDER BY name").all()).toEqual(before);
    expect(db.pragma("user_version", { simple: true })).toBe(CATALOG_SCHEMA_VERSION + 1);
  } finally { db.close(); }
  const interrupted = new Database(":memory:");
  try {
    interrupted.exec("CREATE VIEW conversion_jobs AS SELECT 1 AS id");
    expect(() => initializeCatalogSchema(interrupted)).toThrow();
    expect(interrupted.pragma("user_version", { simple: true })).toBe(0);
    expect(interrupted.prepare("SELECT name FROM sqlite_master WHERE name = 'songs'").all()).toEqual([]);
  } finally { interrupted.close(); }
});
