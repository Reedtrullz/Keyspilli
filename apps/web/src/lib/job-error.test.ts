import { describe, expect, it } from "vitest";
import { publicJobError } from "./job-error";

describe("public conversion errors", () => {
  it("turns YouTube bot challenges into an actionable safe message", () => {
    expect(publicJobError("attempt 2: Command failed: yt-dlp --proxy https://user:secret@example.test\nERROR: LOGIN_REQUIRED")).toContain("YouTube blocked server-side extraction");
    expect(publicJobError("attempt 2: Command failed: yt-dlp --proxy https://user:secret@example.test\nERROR: LOGIN_REQUIRED")).not.toContain("secret");
  });

  it("labels source review without leaking source diagnostics or suggesting blind retry", () => {
    const message = publicJobError("attempt 1: SOURCE_REVIEW_REQUIRED: wrong source https://user:secret@example.test");
    expect(message).toContain("needs review");
    expect(message).not.toContain("secret");
    expect(message).not.toContain("retry the import");
    expect(publicJobError("attempt 1: SOURCE_REVIEW_REQUIRED: insufficient free disk space")).toContain("storage");
  });

  it("does not expose arbitrary worker diagnostics", () => {
    expect(publicJobError("Error: /data/transcribed/job/audio.mp3 failed with internal detail")).toBe("conversion failed; retry the import or check the worker logs");
  });

  it("preserves bounded user-actionable duration failures", () => {
    expect(publicJobError("attempt 1: video longer than 600s (601s)")).toBe("video longer than 600s (601s)");
  });
});
