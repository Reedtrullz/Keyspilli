import filesystem, { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { blockedLearnerBases } from "../src/learner-review.js";
import { disabledManifestBases } from "../src/manifest.js";

const padding = " ".repeat(64 * 1024);
const cases = [
  {
    file: "manifest.json",
    load: disabledManifestBases,
    bytes: (id: string) => JSON.stringify({ songs: [{ id, disabled: true }], padding }),
  },
  {
    file: "learner-review.json",
    load: blockedLearnerBases,
    bytes: (id: string) => JSON.stringify({ verdicts: { [id]: { blocked: true } }, padding }),
  },
];

describe("policy cache fingerprints", () => {
  it.each(cases)("fails closed for unreadable $file after a transient fingerprint failure", ({ file, load, bytes }) => {
    const root = mkdtempSync(join(tmpdir(), "keyspilli-policy-read-error-"));
    const previous = process.env.KEYSPILLI_DATA_DIR;
    process.env.KEYSPILLI_DATA_DIR = root;
    const path = join(root, file);
    writeFileSync(path, bytes("first-policy"));
    const original = filesystem.readFileSync;
    let unreadable = false;
    const reads = vi.spyOn(filesystem, "readFileSync").mockImplementation((source, options) => {
      if (String(source) === path && (options === undefined || unreadable)) {
        throw Object.assign(new Error("EACCES: policy read refused"), { code: "EACCES" });
      }
      return original(source, options);
    });
    syncBuiltinESMExports();
    try {
      try { load(); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EACCES")) throw error;
      }
      writeFileSync(path, bytes("other-policy"));
      unreadable = true;
      expect(() => load()).toThrow(/EACCES/);
    } finally {
      reads.mockRestore();
      syncBuiltinESMExports();
      if (previous === undefined) delete process.env.KEYSPILLI_DATA_DIR;
      else process.env.KEYSPILLI_DATA_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(cases)("revalidates a large $file rewrite within one filesystem tick", ({ file, load, bytes }) => {
    const root = mkdtempSync(join(tmpdir(), "keyspilli-large-policy-"));
    const previous = process.env.KEYSPILLI_DATA_DIR;
    process.env.KEYSPILLI_DATA_DIR = root;
    const path = join(root, file);
    const first = bytes("first-policy");
    const second = bytes("other-policy");
    writeFileSync(path, first);
    const original = filesystem.statSync;
    const frozen = original(path, { bigint: true });
    const metadata = vi.spyOn(filesystem, "statSync").mockImplementation((source, options) => {
      if (String(source) === path) return frozen;
      return original(source, options);
    });
    syncBuiltinESMExports();
    try {
      expect(Buffer.byteLength(first)).toBeGreaterThan(64 * 1024);
      expect(Buffer.byteLength(second)).toBe(Buffer.byteLength(first));
      expect(load()).toEqual(new Set(["first-policy"]));
      writeFileSync(path, second);
      expect(load()).toEqual(new Set(["other-policy"]));
    } finally {
      metadata.mockRestore();
      syncBuiltinESMExports();
      if (previous === undefined) delete process.env.KEYSPILLI_DATA_DIR;
      else process.env.KEYSPILLI_DATA_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
