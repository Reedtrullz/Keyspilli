/**
 * Conversion status is intentionally public so the no-login learner page can
 * poll its own job. Never return raw subprocess errors here: they can contain
 * command arguments, local paths, or proxy credentials.
 */
export function publicJobError(error: unknown): string | null {
  if (typeof error !== "string" || !error.trim()) return null;
  const message = error.trim();
  if (/sign in to confirm|confirm you(?:'|’)re not a bot|login_required|bot.?check/i.test(message)) {
    return "YouTube blocked server-side extraction (bot check); configure a trusted proxy or cookie session, or pre-seed the audio file.";
  }
  const withoutAttempt = message.replace(/^attempt\s+\d+:\s*/i, "");
  if (/^video longer than \d+(?:\.\d+)?s \(/i.test(withoutAttempt)) return withoutAttempt;
  if (/^audio file too small \(/i.test(withoutAttempt)) return "the downloaded audio was invalid or incomplete";
  if (/^no audio file produced$/i.test(withoutAttempt)) return "no playable audio was produced";
  return "conversion failed; retry the import or check the worker logs";
}
