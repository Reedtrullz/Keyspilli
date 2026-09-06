import { describe, expect, it, vi } from "vitest";
import {
  PIANO_TRANSCRIPTION_UNAVAILABLE,
  createPianoTranscriptionCache,
  createPianoTranscriptionAdapter,
  normalizePianoTranscription,
  pianoTranscriptionCacheKey,
  type PianoProcessRunner,
  type PianoProcessResult,
} from "../src/piano-transcriber.js";

describe("piano transcription adapter", () => {
  it("builds a stable cache key from media, model, backend version, and config", () => {
    const a = pianoTranscriptionCacheKey({ mediaSha256: "abc", model: "basic-piano", backendId: "backend-a", backendVersion: "1.2.0", config: { threshold: 0.4 } });
    const b = pianoTranscriptionCacheKey({ mediaSha256: "abc", model: "basic-piano", backendId: "backend-a", backendVersion: "1.2.0", config: { threshold: 0.4 } });
    const changed = pianoTranscriptionCacheKey({ mediaSha256: "abc", model: "basic-piano", backendId: "backend-a", backendVersion: "1.2.0", config: { threshold: 0.5 } });
    const changedBackend = pianoTranscriptionCacheKey({ mediaSha256: "abc", model: "basic-piano", backendId: "backend-b", backendVersion: "1.2.0", config: { threshold: 0.4 } });
    expect(a).toBe(b);
    expect(a).not.toBe(changed);
    expect(a).not.toBe(changedBackend);
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
    expect(result.provenance.cacheKey).toBe(pianoTranscriptionCacheKey({ mediaSha256: "abc", model: "model-a", backendId: "mock-piano", backendVersion: "0.3.0", config: { hop: 256 } }));
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

  it("returns unavailable rather than leaking backend parse/runtime errors", async () => {
    const run = vi.fn<PianoProcessRunner>().mockResolvedValue({ stdout: "not-json", stderr: "backend secret" });
    const adapter = createPianoTranscriptionAdapter({ command: "mock", backendId: "mock-piano", run });
    await expect(adapter.transcribe({ mediaPath: "audio.wav", mediaSha256: "abc", model: "m" })).resolves.toMatchObject({
      status: "unavailable",
      error: PIANO_TRANSCRIPTION_UNAVAILABLE,
    });
  });

  it("caches successful transcriptions by the complete provenance key", async () => {
    const run = vi.fn<PianoProcessRunner>().mockResolvedValue({
      stdout: JSON.stringify({ tempoBpm: 96, notes: [{ midi: 60, start: 0, dur: 1, vel: 99 }] }),
      stderr: "",
    });
    const adapter = createPianoTranscriptionAdapter({ command: "mock", run });
    const request = { mediaPath: "/tmp/audio.wav", mediaSha256: "abc", model: "model-a", config: { hop: 256 } };

    const first = await adapter.transcribe(request);
    const second = await adapter.transcribe(request);

    expect(first).toEqual(second);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent work for the same cache key", async () => {
    let resolveRun: ((result: PianoProcessResult) => void) | undefined;
    const run = vi.fn<PianoProcessRunner>().mockImplementation(() => new Promise((resolve) => {
      resolveRun = resolve;
    }));
    const adapter = createPianoTranscriptionAdapter({ command: "mock", run, cache: createPianoTranscriptionCache() });
    const request = { mediaPath: "/tmp/audio.wav", mediaSha256: "abc", model: "model-a" };
    const firstPromise = adapter.transcribe(request);
    const secondPromise = adapter.transcribe(request);

    expect(run).toHaveBeenCalledTimes(1);
    resolveRun?.({ stdout: JSON.stringify({ notes: [{ midi: 61, start: 0, dur: 1, vel: 90 }] }), stderr: "" });
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toEqual(second);
    expect(first.status).toBe("ok");
  });

  it("allows callers to disable the default cache", async () => {
    const run = vi.fn<PianoProcessRunner>().mockResolvedValue({
      stdout: JSON.stringify({ notes: [{ midi: 60, start: 0, dur: 1, vel: 90 }] }),
      stderr: "",
    });
    const adapter = createPianoTranscriptionAdapter({ command: "mock", run, cache: null });
    const request = { mediaPath: "audio.wav", mediaSha256: "abc", model: "m" };

    await adapter.transcribe(request);
    await adapter.transcribe(request);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not cache unavailable backend results", async () => {
    const run = vi.fn<PianoProcessRunner>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({ stdout: JSON.stringify({ notes: [{ midi: 62, start: 0, dur: 1, vel: 80 }] }), stderr: "" });
    const adapter = createPianoTranscriptionAdapter({ command: "mock", run, cache: createPianoTranscriptionCache() });
    const request = { mediaPath: "audio.wav", mediaSha256: "abc", model: "m" };

    expect((await adapter.transcribe(request)).status).toBe("unavailable");
    expect((await adapter.transcribe(request)).status).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("bounds the memory cache with deterministic least-recently-used eviction", () => {
    const cache = createPianoTranscriptionCache({ maxEntries: 2 });
    const evidence = (midi: number) => normalizePianoTranscription({ notes: [{ midi, start: 0, dur: 1, vel: 80 }] }, { backendId: "b", backendVersion: "1", model: "m", mediaSha256: String(midi), cacheKey: String(midi), config: {} });

    cache.set("a", evidence(60));
    cache.set("b", evidence(61));
    expect(cache.get("a")?.parsed.notes[0]?.midi).toBe(60);
    cache.set("c", evidence(62));

    expect(cache.get("a")?.parsed.notes[0]?.midi).toBe(60);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")?.parsed.notes[0]?.midi).toBe(62);
    expect(cache.size).toBe(2);
  });

  it("returns isolated cache values so callers cannot mutate future hits", () => {
    const cache = createPianoTranscriptionCache();
    const original = normalizePianoTranscription({ notes: [{ midi: 60, start: 0, dur: 1, vel: 80 }], trackNames: ["piano"] }, { backendId: "b", backendVersion: "1", model: "m", mediaSha256: "x", cacheKey: "x", config: { nested: { value: 1 } } });

    cache.set("key", original);
    const hit = cache.get("key");
    if (!hit) throw new Error("expected cache hit");
    hit.parsed.notes[0]!.midi = 12;
    hit.parsed.trackNames[0] = "changed";
    (hit.provenance.config.nested as Record<string, unknown>).value = 2;

    expect(cache.get("key")?.parsed.notes[0]?.midi).toBe(60);
    expect(cache.get("key")?.parsed.trackNames[0]).toBe("piano");
    expect((cache.get("key")?.provenance.config.nested as Record<string, unknown>).value).toBe(1);
  });

  it("normalizes invalid notes out while preserving parsed-midi compatibility", () => {
    const result = normalizePianoTranscription({ tempoBpm: 120, notes: [{ midi: 60, start: 2, dur: 1, vel: 80, identitySource: "guitar", lyrics: "hi" }, { midi: 200, start: 0, dur: 1, vel: 80 }] }, { backendId: "b", backendVersion: "1", model: "m", mediaSha256: "x", cacheKey: "k", config: {} });
    expect(result.parsed.notes).toEqual([{ midi: 60, start: 2, dur: 1, vel: 80, identitySource: "guitar", lyrics: "hi" }]);
    expect(result.parsed.format).toBe(1);
    expect(result.parsed.division).toBe(480);
  });

  it("falls back to a valid time signature when backend metadata is malformed", () => {
    const result = normalizePianoTranscription({ timeSig: [0, Number.NaN], notes: [] }, { backendId: "b", backendVersion: "1", model: "m", mediaSha256: "x", cacheKey: "k", config: {} });

    expect(result.parsed.timeSig).toEqual([4, 4]);
  });
});
