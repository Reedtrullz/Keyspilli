/**
 * Keep subprocess failures useful to operators without persisting the full
 * execFile message. Node includes the complete command line in that message,
 * which would expose a proxy URL (and any embedded credentials) through the
 * public conversion-job status endpoint.
 */
export function sanitizeProcessError(error: unknown, fallback = "command failed"): Error {
  const record = error && typeof error === "object" ? error as {
    stderr?: unknown;
    stdout?: unknown;
    code?: unknown;
  } : {};
  const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
  const stdout = typeof record.stdout === "string" ? record.stdout.trim() : "";
  const code = typeof record.code === "string" ? record.code : "";
  const detail = stderr || stdout || (code === "ETIMEDOUT" ? "command timed out" : fallback);
  return new Error(redactSensitiveText(detail));
}

/** Redact URL credentials and worker-controlled sensitive flags from errors. */
export function redactSensitiveText(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, "$1[redacted]@")
    .replace(/(--(?:proxy|cookies(?:-from-browser)?))(?:=|\s+)([^\s]+)/gi, "$1 [redacted]");
}

const YOUTUBE_BOT_PATTERNS = [
  /sign in to confirm/i,
  /confirm you(?:'|’)re not a bot/i,
  /login_required/i,
  /bot.?check/i,
];

/** YouTube blocks should fail once; retrying every client hammers the IP. */
export function isYoutubeBotChallenge(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return YOUTUBE_BOT_PATTERNS.some((pattern) => pattern.test(message));
}

export const YOUTUBE_BOT_BLOCK_MESSAGE =
  "YouTube blocked server-side extraction (bot check); configure a trusted proxy or cookie session, or pre-seed the audio file.";
