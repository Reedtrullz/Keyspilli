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
  if (withoutAttempt.startsWith("SOURCE_REVIEW_REQUIRED:")) {
    if (withoutAttempt.includes("insufficient free disk space")) return "Import paused because server storage is low. Retry after storage is available.";
    if (withoutAttempt.includes("unresolved song identity")) return "The song could not be identified from this video's title. Try its official recording or a tutorial titled Artist - Song.";
    if (withoutAttempt.includes("no matching tutorial found")) return "No matching piano tutorial was found for this song. No arrangement was published.";
    if (withoutAttempt.includes("tutorial extraction failed")) return "Matching piano tutorials were found, but their notes could not be extracted reliably. No arrangement was published.";
    return "This source needs review; no new arrangement was published. Try another source or import a MIDI you have permission to use.";
  }
  if (/^video longer than \d+(?:\.\d+)?s \(/i.test(withoutAttempt)) return withoutAttempt;
  if (/^audio file too small \(/i.test(withoutAttempt)) return "the downloaded audio was invalid or incomplete";
  if (/^no audio file produced$/i.test(withoutAttempt)) return "no playable audio was produced";
  return "conversion failed; retry the import or check the worker logs";
}
