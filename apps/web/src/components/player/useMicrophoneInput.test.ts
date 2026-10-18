import { describe, expect, it, vi } from "vitest";
import { startMicrophoneCapture, type MicrophoneCaptureEnvironment } from "./useMicrophoneInput";

type Listener = () => void;

function fakeTrack() {
  const listeners: Listener[] = [];
  return {
    stop: vi.fn(),
    addEventListener: vi.fn((_type: string, listener: Listener) => { listeners.push(listener); }),
    end: () => listeners.forEach((listener) => listener()),
  };
}

function harness(frequency: number | null) {
  const track = fakeTrack();
  const stream = { getTracks: () => [track] };
  const sampleRate = 44_100;
  const close = vi.fn(async () => {});
  const analyser = {
    fftSize: 0,
    getFloatTimeDomainData(buffer: Float32Array) {
      for (let index = 0; index < buffer.length; index += 1) {
        buffer[index] = frequency === null ? 0 : 0.5 * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
      }
    },
  };
  const context = {
    sampleRate,
    close,
    createAnalyser: () => analyser,
    createMediaStreamSource: () => ({ connect: () => {} }),
  };
  const frames: Array<() => void> = [];
  let clock = 0;
  const environment: MicrophoneCaptureEnvironment<typeof stream, typeof analyser> = {
    getUserMedia: vi.fn(async () => stream),
    createAudioContext: () => context,
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: vi.fn(),
    now: () => clock,
  };
  const runFrame = (advanceMs = 300) => { clock += advanceMs; frames.shift()?.(); };
  return { track, close, environment, runFrame };
}

describe("startMicrophoneCapture", () => {
  it("reports signal quality and a pitch onset, and cleans up the stream and context", async () => {
    const h = harness(440);
    const onSignal = vi.fn();
    const onPitch = vi.fn();
    const cleanup = await startMicrophoneCapture({ isCurrent: () => true, onSignal, onPitch, onEnded: vi.fn(), environment: h.environment });
    expect(cleanup).toBeTypeOf("function");
    h.runFrame();
    expect(onSignal).toHaveBeenCalledWith("Single pitch detected (beta)");
    expect(onPitch).toHaveBeenCalledWith(69);
    if (!cleanup) throw new Error("Expected an active microphone capture");
    cleanup();
    expect(h.track.stop).toHaveBeenCalled();
    expect(h.close).toHaveBeenCalled();
    expect(h.environment.cancelFrame).toHaveBeenCalled();
  });

  it("labels silence without firing a pitch", async () => {
    const h = harness(null);
    const onSignal = vi.fn();
    const onPitch = vi.fn();
    await startMicrophoneCapture({ isCurrent: () => true, onSignal, onPitch, onEnded: vi.fn(), environment: h.environment });
    h.runFrame();
    expect(onSignal).toHaveBeenCalledWith("Quiet / no reliable pitch");
    expect(onPitch).not.toHaveBeenCalled();
  });

  it("stops the stream and resolves null when superseded during the permission prompt", async () => {
    const h = harness(440);
    const cleanup = await startMicrophoneCapture({ isCurrent: () => false, onSignal: vi.fn(), onPitch: vi.fn(), onEnded: vi.fn(), environment: h.environment });
    expect(cleanup).toBeNull();
    expect(h.track.stop).toHaveBeenCalled();
  });

  it("stops the loop once the request is no longer current", async () => {
    const h = harness(440);
    let current = true;
    const onPitch = vi.fn();
    await startMicrophoneCapture({ isCurrent: () => current, onSignal: vi.fn(), onPitch, onEnded: vi.fn(), environment: h.environment });
    current = false;
    h.runFrame();
    expect(onPitch).not.toHaveBeenCalled();
  });

  it("notifies only the current request when a track ends", async () => {
    const h = harness(440);
    let current = true;
    const onEnded = vi.fn();
    await startMicrophoneCapture({ isCurrent: () => current, onSignal: vi.fn(), onPitch: vi.fn(), onEnded, environment: h.environment });
    h.track.end();
    expect(onEnded).toHaveBeenCalledTimes(1);
    current = false;
    h.track.end();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("rejects with a clear error when capture is unsupported", async () => {
    const h = harness(440);
    await expect(startMicrophoneCapture({ isCurrent: () => true, onSignal: vi.fn(), onPitch: vi.fn(), onEnded: vi.fn(), environment: { ...h.environment, getUserMedia: undefined } }))
      .rejects.toThrow("This browser does not support microphone capture.");
  });

  it("releases a partially opened stream when setup fails", async () => {
    const h = harness(440);
    const failing = { ...h.environment, createAudioContext: () => { throw new Error("audio blocked"); } };
    await expect(startMicrophoneCapture({ isCurrent: () => true, onSignal: vi.fn(), onPitch: vi.fn(), onEnded: vi.fn(), environment: failing })).rejects.toThrow("audio blocked");
    expect(h.track.stop).toHaveBeenCalled();
  });
});
