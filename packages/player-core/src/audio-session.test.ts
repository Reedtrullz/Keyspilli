import { afterEach, expect, it, vi } from "vitest";
import { configurePlaybackSession } from "./audio-session.js";

afterEach(() => vi.unstubAllGlobals());
it("uses music playback rather than ambient audio, preserving microphone sessions", () => {
  const audioSession = { type: "auto" };
  vi.stubGlobal("navigator", { audioSession });
  configurePlaybackSession();
  expect(audioSession.type).toBe("playback");
  audioSession.type = "play-and-record";
  configurePlaybackSession();
  expect(audioSession.type).toBe("play-and-record");
});
it("works without the optional API or when the browser rejects it", () => {
  vi.stubGlobal("navigator", {});
  expect(configurePlaybackSession).not.toThrow();
  vi.stubGlobal("navigator", { audioSession: { get type() { throw new Error("unsupported"); } } });
  expect(configurePlaybackSession).not.toThrow();
});
