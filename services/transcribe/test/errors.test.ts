import { describe, expect, it } from "vitest";
import {
  isYoutubeBotChallenge,
  redactSensitiveText,
  sanitizeProcessError,
  YOUTUBE_BOT_BLOCK_MESSAGE,
} from "../src/errors.js";

describe("worker subprocess error handling", () => {
  it("uses stderr instead of Node's command-bearing error message", () => {
    const result = sanitizeProcessError({
      message: "Command failed: yt-dlp --proxy https://user:secret@example.test:8443 -- https://youtube.test/video",
      stderr: "ERROR: sign in to confirm you’re not a bot",
    });
    expect(result.message).toBe("ERROR: sign in to confirm you’re not a bot");
    expect(result.message).not.toContain("secret");
  });

  it("redacts proxy credentials and sensitive yt-dlp flags", () => {
    expect(redactSensitiveText("proxy https://user:secret@example.test:8443")).toBe("proxy https://[redacted]@example.test:8443");
    expect(redactSensitiveText("proxy socks5h://user:secret@example.test:1080")).toBe("proxy socks5h://[redacted]@example.test:1080");
    expect(redactSensitiveText("--cookies /run/secrets/youtube.txt --proxy=http://user:secret@example.test")).toBe("--cookies [redacted] --proxy [redacted]");
  });

  it("recognizes bot challenges and exposes one actionable terminal message", () => {
    expect(isYoutubeBotChallenge(new Error("LOGIN_REQUIRED: sign in to confirm you're not a bot"))).toBe(true);
    expect(isYoutubeBotChallenge(new Error("network timeout"))).toBe(false);
    expect(isYoutubeBotChallenge(new Error(YOUTUBE_BOT_BLOCK_MESSAGE))).toBe(true);
  });
});
