import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

/**
 * Files at or below this size also contribute a SHA-256 of their bytes.
 *
 * Stat metadata alone cannot see an in-place rewrite that keeps the inode and
 * size and lands within the filesystem's timestamp granularity (overlayfs and
 * many kernels tick in milliseconds or coarser). Hashing small policy and
 * artifact files closes that gap for a negligible read cost; larger files
 * keep the stat-only signature and rely on atomic publication (rename), which
 * always changes the inode.
 */
export const DEFAULT_FINGERPRINT_HASH_MAX_BYTES = 64 * 1024;

export interface FileFingerprintOptions {
  /**
   * Hash file contents when the file is at most this many bytes. Use 0 for
   * files whose bytes change constantly or are covered by another signal
   * (for example SQLite WAL/SHM files, which `data_version` already tracks).
   */
  contentHashMaxBytes?: number;
}

/**
 * Cache-invalidation fingerprint for one path.
 *
 * Combines device, inode, size, mtime and ctime (nanosecond precision where
 * the platform provides it) and, for small files, a content hash. A missing
 * file yields a stable `missing` marker so creating or removing the file
 * changes the fingerprint too. The path is always part of the result.
 */
export function fileFingerprint(path: string, options: FileFingerprintOptions = {}): string {
  const hashLimit = options.contentHashMaxBytes ?? DEFAULT_FINGERPRINT_HASH_MAX_BYTES;
  let meta: string;
  let hashable: boolean;
  try {
    const stat = statSync(path, { bigint: true });
    meta = `${path}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    hashable = hashLimit > 0 && stat.isFile() && stat.size <= BigInt(hashLimit);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return `${path}:missing`;
    }
    throw error;
  }
  if (!hashable) return meta;
  return `${meta}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}
