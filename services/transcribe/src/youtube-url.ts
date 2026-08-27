import { extractYoutubeVideoId } from "@keyspilli/catalog";

const YOUTUBE_HOSTS = new Set(["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com"]);

/**
 * Validate and canonicalize a worker job's URL before it reaches yt-dlp.
 *
 * The web route performs its own request validation, but queued jobs can also
 * be inserted by operators or older clients. Keeping this check at the worker
 * boundary prevents malformed/playlist URLs from expanding unexpectedly and
 * gives callers a stable URL for provenance.
 */
export function normalizeYoutubeImportUrl(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("conversion job has no YouTube URL");
  }
  const input = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("conversion job has an invalid YouTube URL");
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (parsed.protocol !== "https:" || !YOUTUBE_HOSTS.has(host)) {
    throw new Error("conversion job requires an HTTPS YouTube URL");
  }
  const videoId = extractYoutubeVideoId(input);
  if (!videoId) {
    throw new Error("conversion job URL does not contain a valid YouTube video id");
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}
