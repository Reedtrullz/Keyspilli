import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Validated operator-supplied metadata for a pre-seeded conversion job. */
export interface YoutubeMetaFile {
  title: string;
  uploader: string;
  durationSec: number;
}

/**
 * Read and validate the optional meta.json sidecar in a job directory.
 * Returns undefined when absent or incomplete so callers can fall back to
 * live yt-dlp metadata. Kept here (not only in the worker) so the catalog
 * package owns the sidecar contract and tests can exercise it without
 * spawning the worker loop.
 */
export function parseYoutubeMetaFile(dir: string): YoutubeMetaFile | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as {
      title?: unknown;
      uploader?: unknown;
      durationSec?: unknown;
    };
    if (typeof parsed.title !== "string" || parsed.title.trim() === "") return undefined;
    if (typeof parsed.uploader !== "string" || parsed.uploader.trim() === "") return undefined;
    if (typeof parsed.durationSec !== "number" || !Number.isFinite(parsed.durationSec) || parsed.durationSec <= 0) {
      return undefined;
    }
    return {
      title: parsed.title.trim(),
      uploader: parsed.uploader.trim(),
      durationSec: Math.round(parsed.durationSec),
    };
  } catch {
    return undefined;
  }
}
