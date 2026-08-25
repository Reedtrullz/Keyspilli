import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pianoFactory = vi.hoisted(() => vi.fn());

vi.mock("smplr", () => ({
  SplendidGrandPiano: pianoFactory,
}));

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {} as AudioNode;

  createDynamicsCompressor() {
    return {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect: vi.fn(),
    } as unknown as DynamicsCompressorNode;
  }

  createGain() {
    return {
      gain: { setTargetAtTime: vi.fn() },
      connect: vi.fn(),
    } as unknown as GainNode;
  }

  resume() {
    return Promise.resolve();
  }

  close() {
    this.state = "closed";
    return Promise.resolve();
  }
}

describe("SamplerAudioEngine", () => {
  beforeEach(() => {
    pianoFactory.mockReset();
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shares one in-flight sample load across fallback note-ons", async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    const dispose = vi.fn();
    pianoFactory.mockReturnValue({
      ready,
      setCC: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      dispose,
    });

    const { AudioEngine } = await import("../src/audio.js");
    vi.spyOn(AudioEngine.prototype, "noteOn").mockImplementation(() => {});
    const { SamplerAudioEngine } = await import("../src/sampler-audio.js");
    const engine = new SamplerAudioEngine();

    const note = { midi: 60, startSec: 0, durSec: 0.4, vel: 100 };
    engine.noteOn(note);
    engine.noteOn({ ...note, midi: 62 });
    engine.noteOn({ ...note, midi: 64 });

    expect(pianoFactory).toHaveBeenCalledTimes(1);

    engine.dispose();
    resolveReady();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
