import { createHash } from "node:crypto";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_FINGERPRINT_HASH_MAX_BYTES, fileFingerprint } from "../src/file-fingerprint.js";

describe("fileFingerprint", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "keyspilli-fingerprint-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("marks a missing file and keeps the path in the signature", () => {
    const path = join(root, "absent.json");
    expect(fileFingerprint(path)).toBe(`${path}:missing`);
  });

  it("detects a same-size in-place rewrite that keeps the original mtime", async () => {
    const path = join(root, "notes.json");
    await writeFile(path, '{"chord":"C"}');
    const original = await stat(path);
    const first = fileFingerprint(path);
    await writeFile(path, '{"chord":"D"}');
    await utimes(path, original.atime, original.mtime);
    expect(fileFingerprint(path)).not.toBe(first);
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
    expect(signature.split(":")).toHaveLength(6);
    expect(signature.startsWith(`${large}:`)).toBe(true);
  });
});
