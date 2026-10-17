import { createHash } from "node:crypto";
import filesystem from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FINGERPRINT_HASH_MAX_BYTES, fileFingerprint } from "../src/file-fingerprint.js";

describe("fileFingerprint", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "keyspilli-fingerprint-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("marks a missing file and keeps the path in the signature", () => {
    const path = join(root, "absent.json");
    expect(fileFingerprint(path)).toBe(`${path}:missing`);
  });

  it("detects a same-size in-place rewrite with unchanged filesystem metadata", async () => {
    const path = join(root, "notes.json");
    await writeFile(path, '{"chord":"C"}');
    const frozen = filesystem.statSync(path, { bigint: true });
    const metadata = vi.spyOn(filesystem, "statSync").mockReturnValue(frozen);
    syncBuiltinESMExports();
    try {
      const first = fileFingerprint(path);
      await writeFile(path, '{"chord":"D"}');
      expect(fileFingerprint(path)).not.toBe(first);
    } finally {
      metadata.mockRestore();
      syncBuiltinESMExports();
    }
  });

  it("is stable when nothing changes", async () => {
    const path = join(root, "stable.json");
    await writeFile(path, "stable");
    expect(fileFingerprint(path)).toBe(fileFingerprint(path));
  });

  it("hashes small files and skips hashing above the limit or when disabled", async () => {
    const small = join(root, "small.bin");
    await writeFile(small, "abc");
    const digest = createHash("sha256").update("abc").digest("hex");
    expect(fileFingerprint(small).endsWith(`:${digest}`)).toBe(true);
    expect(fileFingerprint(small, { contentHashMaxBytes: 0 }).endsWith(`:${digest}`)).toBe(false);

    const large = join(root, "large.bin");
    await writeFile(large, Buffer.alloc(DEFAULT_FINGERPRINT_HASH_MAX_BYTES + 1, 1));
    const signature = fileFingerprint(large);
    expect(signature.startsWith(`${large}:`)).toBe(true);
  });

  it.each([
    { bytes: 65_536, limit: 65_536, requiresRead: true },
    { bytes: 65_537, limit: 65_536, requiresRead: false },
    { bytes: 0, limit: 0, requiresRead: false },
  ])("honors the content-read budget for $bytes bytes and a $limit byte limit", async ({ bytes, limit, requiresRead }) => {
    const path = join(root, "budget.bin");
    await writeFile(path, Buffer.alloc(bytes, 1));
    const original = filesystem.readFileSync;
    const reads = vi.spyOn(filesystem, "readFileSync").mockImplementation((source, options) => {
      if (String(source) === path) throw Object.assign(new Error("EACCES: content read refused"), { code: "EACCES" });
      return original(source, options);
    });
    syncBuiltinESMExports();
    try {
      const fingerprint = () => fileFingerprint(path, { contentHashMaxBytes: limit });
      if (requiresRead) expect(fingerprint).toThrow(/EACCES/);
      else expect(fingerprint()).not.toBe(`${path}:missing`);
    } finally {
      reads.mockRestore();
      syncBuiltinESMExports();
    }
  });

  it("propagates stat permission failures instead of marking an existing file missing", async () => {
    const path = join(root, "protected.bin");
    await writeFile(path, "present");
    const metadata = vi.spyOn(filesystem, "statSync").mockImplementation(() => {
      throw Object.assign(new Error("EACCES: metadata read refused"), { code: "EACCES" });
    });
    syncBuiltinESMExports();
    try { expect(() => fileFingerprint(path)).toThrow(/EACCES/); }
    finally { metadata.mockRestore(); syncBuiltinESMExports(); }
  });
});
