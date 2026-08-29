import { describe, expect, it, vi } from "vitest";
import {
  PIANO_TRANSCRIPTION_UNAVAILABLE,
  createPianoTranscriptionAdapter,
  normalizePianoTranscription,
  pianoTranscriptionCacheKey,
  type PianoProcessRunner,
} from "../src/piano-transcriber.js";

describe("piano transcription adapter", () => {
  it("builds a stable cache key from media, model, backend version, and config", () => {
    const a = pianoTranscriptionCacheKey({ mediaSha256: "abc", model: "basic-piano", backendVersion: "1.2.0", config: { threshold: 0.4 } });
    const b = pianoTranscriptionCacheKey({ mediaSha256: "abc", model: "basic-piano", backendVersion: "1.2.0", config: { threshold: 0.4 } });
    const changed = pianoTranscriptionCacheKey({ mediaSha256: "abc", model: "basic-piano", backendVersion: "1.2.0", config: { threshold: 0.5 } });
    expect(a).toBe(b);
    expect(a).not.toBe(changed);
    expect(a).toMatch(/^piano-transcription:[a-f0-9]{64}$/);
  });

  it("invokes the configured external process and normalizes notes with provenance", async () => {
    const run = vi.fn<PianoProcessRunner>().mockResolvedValue({
      stdout: JSON.stringify({ tempoBpm: 96, notes: [{ midi: 60, start: 0, dur: 1, vel: 99 }] }),
      stderr: "",
    });
    const adapter = createPianoTranscriptionAdapter({
      command: "piano-transcriber",
      backendId: "mock-piano",
      backendVersion: "0.3.0",
      run,
    });
    const result = await adapter.transcribe({ mediaPath: "/tmp/audio.wav", mediaSha256: "abc", model: "model-a", config: { hop: 256 } });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.parsed.notes).toEqual([{ midi: 60, start: 0, dur: 1, vel: 99 }]);
    expect(result.provenance).toMatchObject({ backendId: "mock-piano", backendVersion: "0.3.0", model: "model-a", mediaSha256: "abc" });
    expect(run).toHaveBeenCalledWith("piano-transcriber", expect.arrayContaining(["--model", "model-a", "/tmp/audio.wav"]), expect.anything());
  });

  it("returns a graceful unavailable result when the backend cannot run", async () => {
    const run = vi.fn<PianoProcessRunner>().mockRejectedValue(new Error("ENOENT"));
    const adapter = createPianoTranscriptionAdapter({ command: "missing", run });
    await expect(adapter.transcribe({ mediaPath: "audio.wav", mediaSha256: "abc", model: "m" })).resolves.toMatchObject({
      status: "unavailable",
      error: PIANO_TRANSCRIPTION_UNAVAILABLE,
    });
  });

  it("normalizes invalid notes out while preserving parsed-midi compatibility", () => {
    const result = normalizePianoTranscription({ tempoBpm: 120, notes: [{ midi: 60, start: 2, dur: 1, vel: 80 }, { midi: 200, start: 0, dur: 1, vel: 80 }] }, { backendId: "b", backendVersion: "1", model: "m", mediaSha256: "x", cacheKey: "k" });
    expect(result.parsed.notes).toEqual([{ midi: 60, start: 2, dur: 1, vel: 80 }]);
    expect(result.parsed.format).toBe(1);
    expect(result.parsed.division).toBe(480);
  });
});
