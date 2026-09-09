/** Web Audio defaults to ambient on iOS, which the Ring/Silent switch mutes. */
export function configurePlaybackSession(): void {
  if (typeof navigator === "undefined") return;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  try {
    // Do not take the session away from microphone practice.
    if (session && session.type !== "play-and-record") session.type = "playback";
  } catch { /* Older browsers may expose but reject the optional API. */ }
}
