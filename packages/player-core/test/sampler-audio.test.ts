import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pianoFactory = vi.hoisted(() => vi.fn());

vi.mock("smplr", async (importOriginal) => ({
  ...await importOriginal<typeof import("smplr")>(),
  SplendidGrandPiano: pianoFactory,
}));

class FakeAudioContext {
  static last: FakeAudioContext;
  static rate = 48000;
  state = "running";
  currentTime = 0;
  sampleRate = FakeAudioContext.rate;
  decodes = 0;
  destination = {} as AudioNode;
  oscillators: Array<{ stops: number[]; onended: (() => void) | null }> = [];
  gains: GainNode[] = [];

  constructor() { FakeAudioContext.last = this; }

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
    const gain = {
      gain: { setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as GainNode;
    this.gains.push(gain);
    return gain;
  }

  createOscillator() {
    const osc = { frequency: { value: 0 }, type: "sine", starts: [] as number[], stops: [] as number[],
      onended: null as (() => void) | null, connect: vi.fn(), start(time: number) { this.starts.push(time); }, stop(time: number) { this.stops.push(time); } };
    this.oscillators.push(osc);
    return osc as unknown as OscillatorNode;
  }

  resume() {
    return Promise.resolve();
  }

  async decodeAudioData() {
    this.decodes++;
    return { sampleRate: this.sampleRate } as AudioBuffer;
  }

  close() {
    this.state = "closed";
    return Promise.resolve();
  }
}

describe("SamplerAudioEngine", () => {
  it("fetches and decodes the piano once for independent voices and a warm replacement context", async () => {
    const fetchSample = vi.fn(async () => new Response(new Uint8Array([1, 2])));
    vi.stubGlobal("fetch", fetchSample);
    const { SampleLoader, pianoToPreset } = await import("smplr");
    const preset = pianoToPreset({ baseUrl: "https://samples.example/piano", formats: ["ogg"], detune: 0, decayTime: 0.5 });
    pianoFactory.mockImplementation((ctx: AudioContext, options: { loader?: import("smplr").SampleLoader }) => ({
      ready: (options.loader ?? SampleLoader(ctx)).load(preset),
      setCC: vi.fn(), start: vi.fn(), stop: vi.fn(), dispose: vi.fn(),
    }));
    const { SamplerAudioEngine } = await import("../src/sampler-audio.js");
    const first = new SamplerAudioEngine(); first.ensure();
    const firstContext = FakeAudioContext.last;
    await vi.waitFor(() => expect(first.readiness).toBe("ready"));
    expect(fetchSample).toHaveBeenCalledTimes(226);
    expect(firstContext.decodes).toBe(226);
    first.dispose();
    const second = new SamplerAudioEngine(); second.ensure();
    await vi.waitFor(() => expect(second.readiness).toBe("ready"));
    expect(fetchSample).toHaveBeenCalledTimes(226);
    expect(FakeAudioContext.last.decodes).toBe(0);
    second.dispose();
  });
  it("rejects an incomplete set and retries missing samples rather than reporting Ready", async () => {
    FakeAudioContext.rate = 44100;
    let fail = true;
    const fetchSample = vi.fn(async () => new Response(new Uint8Array([1, 2]), { status: fail ? 503 : 200 }));
    vi.stubGlobal("fetch", fetchSample);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { SampleLoader, pianoToPreset } = await import("smplr");
    const preset = pianoToPreset({ baseUrl: "https://samples.example/piano", formats: ["ogg"], detune: 0, decayTime: 0.5 });
    pianoFactory.mockImplementation((ctx: AudioContext, options: { loader?: import("smplr").SampleLoader }) => ({
      ready: (options.loader ?? SampleLoader(ctx)).load(preset),
      setCC: vi.fn(), start: vi.fn(), stop: vi.fn(), dispose: vi.fn(),
    }));
    const { SamplerAudioEngine } = await import("../src/sampler-audio.js");
    const engine = new SamplerAudioEngine(); engine.ensure();
    await vi.waitFor(() => expect(engine.readiness).toBe("failed"));
    fail = false; expect(engine.retrySamples()).toBe(true);
    await vi.waitFor(() => expect(engine.readiness).toBe("ready"));
    expect(fetchSample).toHaveBeenCalledTimes(452);
    engine.dispose();
  });
  it("waits explicitly and bounds failed-load retries without replacing its context", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    pianoFactory.mockImplementation(() => ({ ready: Promise.reject(new Error("fixture")), setCC: vi.fn(), start: vi.fn(), stop: vi.fn(), dispose: vi.fn() }));
    const { SamplerAudioEngine } = await import("../src/sampler-audio.js");
    const engine = new SamplerAudioEngine(); engine.samplePolicy = "wait";
    expect(engine.prepareTimbre()).toBe(false);
    const context = FakeAudioContext.last;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(engine.readiness).toBe("failed"); expect(engine.loadLatencyMs).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 2; i++) {
      expect(engine.retrySamples()).toBe(true);
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(FakeAudioContext.last).toBe(context);
    }
    expect(engine.retrySamples()).toBe(false); expect(pianoFactory).toHaveBeenCalledTimes(9);
    engine.samplePolicy = "fallback"; expect(engine.prepareTimbre()).toBe(true);
    expect(engine.playbackTimbre).toBe("fallback"); engine.dispose();
  });
  beforeEach(() => {
    pianoFactory.mockReset();
    FakeAudioContext.rate = 48000;
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("preserves short passing-chord and long held-chord releases at the audio boundary", async () => {
    const start = vi.fn();
    pianoFactory.mockReturnValue({ ready: Promise.resolve(), setCC: vi.fn(), start, stop: vi.fn(), dispose: vi.fn() });
    const { SamplerAudioEngine } = await import("../src/sampler-audio.js");
    const engine = new SamplerAudioEngine();
    engine.ensure();
    await new Promise<void>(resolve => setImmediate(resolve));
    engine.playChord([60, 64, 67], 0, 0.125);
    engine.playChord([60], 1, 12);
    engine.playChord([60], 0, NaN);
    expect(start.mock.calls.map(([event]) => event.duration)).toEqual([0.125, 0.125, 0.125, 12]);
    engine.dispose();
  });

  it("keeps sampled hardware input sustain independent of playback CC64", async () => {
    const instruments: Array<{ setCC: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
    pianoFactory.mockImplementation(() => {
      const instance = { ready: Promise.resolve(), setCC: vi.fn(), start: vi.fn(), stop: vi.fn(), dispose: vi.fn() };
      instruments.push(instance); return instance;
    });
    const { SamplerAudioEngine } = await import("../src/sampler-audio.js");
    const engine = new SamplerAudioEngine(); engine.ensure();
    await new Promise<void>(resolve => setImmediate(resolve));
    engine.sustainPedal = true; engine.noteOff(60);
    expect(instruments[0]?.setCC).toHaveBeenLastCalledWith(64, 127);
    expect(instruments[2]?.setCC).toHaveBeenLastCalledWith(64, 0);
    expect(instruments[0]?.stop).not.toHaveBeenCalled();
    expect(instruments[2]?.stop).toHaveBeenCalledExactlyOnceWith({ stopId: "input:60" });
    engine.dispose();
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

    expect(pianoFactory).toHaveBeenCalledTimes(3);

    engine.dispose();
    resolveReady();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(dispose).toHaveBeenCalledTimes(3);
  });

  it("keeps fallback timbre through late sample readiness and ignores its state after an explicit switch", async () => {
    let ready!: () => void;
    const pending = new Promise<void>(resolve => { ready = resolve; });
    const sampled = vi.fn(), fallbackNote = vi.spyOn((await import("../src/audio.js")).AudioEngine.prototype, "noteOn").mockImplementation(() => {});
    pianoFactory.mockReturnValue({ ready: pending, setCC: vi.fn(), start: sampled, stop: vi.fn(), dispose: vi.fn() });
    const { SamplerAudioEngine } = await import("../src/sampler-audio.js");
    const engine = new SamplerAudioEngine(), states: string[] = [];
    engine.onStateChange = state => states.push(state);
    engine.prepareTimbre();
    const ownContext = FakeAudioContext.last as unknown as { state: string; onstatechange: () => void };
    ownContext.state = "suspended"; ownContext.onstatechange();
    expect(states).toEqual([]); ownContext.state = "running";
    engine.noteOn({ midi: 60, startSec: 0, durSec: 1, vel: 80 });
    const fallback = (engine as unknown as { fallbackEngine: { onStateChange: ((state: string) => void) | null } }).fallbackEngine;
    ready(); await new Promise<void>(resolve => setImmediate(resolve));
    expect(engine.readiness).toBe("ready"); expect(engine.playbackTimbre).toBe("fallback");
    engine.noteOn({ midi: 64, startSec: 0, durSec: 1, vel: 80 });
    expect(sampled).not.toHaveBeenCalled(); expect(fallbackNote).toHaveBeenCalledTimes(2);
    fallback.onStateChange?.("suspended"); expect(states).toEqual(["suspended"]);
    engine.prepareTimbre();
    engine.noteOn({ midi: 67, startSec: 0, durSec: 1, vel: 80 });
    expect(sampled).toHaveBeenCalledOnce(); expect(engine.playbackTimbre).toBe("sampled");
    ownContext.state = "suspended"; ownContext.onstatechange();
    expect(states).toEqual(["suspended", "suspended"]); ownContext.state = "running";
    fallback.onStateChange?.("suspended"); expect(states).toEqual(["suspended", "suspended"]);
    engine.dispose();
  });

  it("starts chord-only fallback with current gains and sustain", async () => {
    pianoFactory.mockReturnValue({ ready: new Promise(() => {}), setCC: vi.fn(), start: vi.fn(), stop: vi.fn(), dispose: vi.fn() });
    const { AudioEngine } = await import("../src/audio.js");
    let fallback: InstanceType<typeof AudioEngine> | undefined;
    const playChord = vi.spyOn(AudioEngine.prototype, "playChord").mockImplementation(function (this: InstanceType<typeof AudioEngine>) { fallback = this; });
    const { SamplerAudioEngine } = await import("../src/sampler-audio.js");
    const engine = new SamplerAudioEngine();
    engine.setGains(0.8, 0.2);
    engine.sustainPedal = false;
    engine.playChord([48, 52, 55], 0, 0.3);
    expect(playChord).toHaveBeenCalledExactlyOnceWith([48, 52, 55], 0, 0.3);
    expect(fallback).toMatchObject({ voiceGain: 0.8, pianoGain: 0.2, sustainPedal: false });
    engine.dispose();
  });

  it("routes sampled RH input and LH accompaniment to separate live gain buses", async () => {
    const instruments: Array<{ destination: GainNode; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
    pianoFactory.mockImplementation((_ctx: AudioContext, options: { destination: GainNode }) => {
      const inst = { destination: options.destination, ready: Promise.resolve(), setCC: vi.fn(), start: vi.fn(), stop: vi.fn(), dispose: vi.fn() };
      instruments.push(inst);
      return inst;
    });
    const { SamplerAudioEngine } = await import("../src/sampler-audio.js");
    const engine = new SamplerAudioEngine();
    engine.ensure();
    await Promise.resolve();
    await Promise.resolve();
    engine.setGains(1, 0);
    engine.noteOn({ midi: 60, startSec: 0, durSec: 0.4, vel: 100, hand: "R", fromInput: true });
    engine.noteOn({ midi: 48, startSec: 0, durSec: 0.4, vel: 90, hand: "L" });
    expect(instruments).toHaveLength(3);
    expect(instruments[0]!.destination).not.toBe(instruments[1]!.destination);
    expect(instruments[2]!.start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ note: 60, stopId: "input:60" }));
    expect(instruments[1]!.start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ note: 48, duration: 0.4 }));
    const rightGain = instruments[0]!.destination.gain.setTargetAtTime as ReturnType<typeof vi.fn>;
    const leftGain = instruments[1]!.destination.gain.setTargetAtTime as ReturnType<typeof vi.fn>;
    expect(rightGain).toHaveBeenLastCalledWith(1, 0, 0.02);
    expect(leftGain).toHaveBeenLastCalledWith(0, 0, 0.02);
    engine.setGains(0, 1);
    expect(rightGain).toHaveBeenLastCalledWith(0, 0, 0.02);
    expect(leftGain).toHaveBeenLastCalledWith(1, 0, 0.02);
    expect(instruments.every(inst => inst.stop.mock.calls.length === 0)).toBe(true);
    engine.dispose();
  });
  it("releases only the sampled input voice and also clears a pre-load fallback voice", async () => {
    const start = vi.fn(), stop = vi.fn();
    pianoFactory.mockReturnValue({ ready: Promise.resolve(), setCC: vi.fn(), start, stop, dispose: vi.fn() });
    const { AudioEngine } = await import("../src/audio.js");
    vi.spyOn(AudioEngine.prototype, "noteOn").mockImplementation(() => {});
    const fallbackOff = vi.spyOn(AudioEngine.prototype, "noteOff").mockImplementation(() => {});
    const { SamplerAudioEngine } = await import("../src/sampler-audio.js");
    const engine = new SamplerAudioEngine();
    const note = { midi: 60, startSec: 0, durSec: 0.4, vel: 100 };
    engine.noteOn({ ...note, fromInput: true });
    await new Promise<void>(resolve => setImmediate(resolve));
    engine.prepareTimbre(); // explicit next-run boundary after the pre-load fallback voice
    engine.noteOn(note);
    engine.noteOn({ ...note, fromInput: true });
    stop.mockClear();
    engine.noteOff(60);
    expect(start.mock.calls[0]![0]).toMatchObject({ duration: 0.4 });
    expect(start.mock.calls[1]![0]).toMatchObject({ stopId: "input:60", duration: undefined });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenLastCalledWith({ stopId: "input:60" });
    expect(fallbackOff).toHaveBeenCalledExactlyOnceWith(60);
    engine.dispose();
  });

  it("updates sampled CC64 when the shared playback pedal changes", async () => {
    const setCC = vi.fn();
    pianoFactory.mockReturnValue({ ready: Promise.resolve(), setCC, start: vi.fn(), stop: vi.fn(), dispose: vi.fn() });
    const { SamplerAudioEngine } = await import("../src/sampler-audio.js");
    const engine = new SamplerAudioEngine();

    engine.ensure();
    await Promise.resolve();
    await Promise.resolve();
    engine.sustainPedal = false;
    engine.sustainPedal = true;

    expect(setCC).toHaveBeenLastCalledWith(64, 127);
    expect(setCC.mock.calls.map(([controller, value]) => [controller, value])).toContainEqual([64, 0]);
    engine.dispose();
  });

  it("cancels a future sampled metronome click and disconnects its gain", async () => {
    pianoFactory.mockReturnValue({ ready: new Promise(() => {}), setCC: vi.fn(), start: vi.fn(), stop: vi.fn(), dispose: vi.fn() });
    const { SamplerAudioEngine } = await import("../src/sampler-audio.js");
    const engine = new SamplerAudioEngine();
    engine.metronomeClick(0, 1);
    const click = FakeAudioContext.last.oscillators[0]!;
    expect(click.stops).toEqual([1.06]);
    engine.cancelAll();
    expect(click.stops).toContain(0.02);
    expect(FakeAudioContext.last.gains.at(-1)!.disconnect).toHaveBeenCalledOnce();
    engine.dispose();
  });

});
