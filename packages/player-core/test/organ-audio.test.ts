import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROCK_REGISTRATION,
  ROTARY_SPEEDS,
  OrganAudioEngine,
  buildDriveCurve,
  buildTonewheelCoefficients,
  drawbarAmplitude,
  organVelocityLevel,
  tonewheelFrequencies,
} from "../src/organ-audio.js";

class FakeParam {
  value = 0;
  setValues: [number, number][] = [];
  linearRamps: [number, number][] = [];
  targets: [number, number, number][] = [];
  cancellations: number[] = [];
  setValueAtTime(value: number, time: number) { this.value = value; this.setValues.push([value, time]); }
  linearRampToValueAtTime(value: number, time: number) { this.value = value; this.linearRamps.push([value, time]); }
  exponentialRampToValueAtTime(value: number, time: number) { this.value = value; this.linearRamps.push([value, time]); }
  setTargetAtTime(value: number, time: number, constant: number) { this.value = value; this.targets.push([value, time, constant]); }
  cancelScheduledValues(time: number) { this.cancellations.push(time); }
}

class FakeNode {
  connections: unknown[] = [];
  disconnected = false;
  connect(target: unknown) { this.connections.push(target); return target; }
  disconnect() { this.disconnected = true; }
}

class FakeOscillator extends FakeNode {
  frequency = new FakeParam();
  type: OscillatorType = "sine";
  starts: number[] = [];
  stops: number[] = [];
  wave: PeriodicWave | null = null;
  onended: (() => void) | null = null;
  setPeriodicWave(wave: PeriodicWave) { this.wave = wave; }
  start(time = 0) { this.starts.push(time); }
  stop(time = 0) { this.stops.push(time); }
}

class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeFilter extends FakeNode { type: BiquadFilterType = "lowpass"; frequency = new FakeParam(); Q = new FakeParam(); }
class FakePanner extends FakeNode { pan = new FakeParam(); }
class FakeWaveShaper extends FakeNode { curve: Float32Array<ArrayBuffer> | null = null; oversample: OverSampleType = "none"; }
class FakeCompressor extends FakeNode {
  threshold = new FakeParam(); knee = new FakeParam(); ratio = new FakeParam();
  attack = new FakeParam(); release = new FakeParam();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = "running";
  currentTime = 10;
  destination = new FakeNode() as unknown as AudioDestinationNode;
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  panners: FakePanner[] = [];
  shapers: FakeWaveShaper[] = [];
  waves: { real: Float32Array; imag: Float32Array }[] = [];
  closeCalls = 0;

  constructor() { FakeAudioContext.instances.push(this); }
  createOscillator() { const node = new FakeOscillator(); this.oscillators.push(node); return node as unknown as OscillatorNode; }
  createGain() { const node = new FakeGain(); this.gains.push(node); return node as unknown as GainNode; }
  createBiquadFilter() { return new FakeFilter() as unknown as BiquadFilterNode; }
  createStereoPanner() { const node = new FakePanner(); this.panners.push(node); return node as unknown as StereoPannerNode; }
  createWaveShaper() { const node = new FakeWaveShaper(); this.shapers.push(node); return node as unknown as WaveShaperNode; }
  createDynamicsCompressor() { return new FakeCompressor() as unknown as DynamicsCompressorNode; }
  createPeriodicWave(real: Float32Array, imag: Float32Array) { const wave = {} as PeriodicWave; this.waves.push({ real, imag }); return wave; }
  resume() { return Promise.resolve(); }
  close() { this.closeCalls++; this.state = "closed"; return Promise.resolve(); }
}

describe("tonewheel math", () => {
  it("maps A4 to the nine Hammond drawbar frequencies", () => {
    expect(tonewheelFrequencies(69)).toEqual([220, 660, 440, 880, 1320, 1760, 2200, 2640, 3520]);
  });

  it("maps the frozen 888800000 registration onto one normalized PeriodicWave", () => {
    const { real, imag } = buildTonewheelCoefficients(ROCK_REGISTRATION);
    expect([...real]).toEqual([0, 0.25, 0.25, 0.25, 0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...imag]).toEqual(Array(17).fill(0));
  });

  it("uses silent zero and monotonic 3 dB drawbar steps", () => {
    const levels = Array.from({ length: 9 }, (_, digit) => drawbarAmplitude(digit));
    expect(levels[0]).toBe(0);
    expect(levels[7]).toBeCloseTo(0.7079, 4);
    expect(levels[8]).toBe(1);
    expect(levels.every((level, index) => index === 0 || level > levels[index - 1]!)).toBe(true);
  });

  it("keeps velocity influence shallow", () => {
    expect(organVelocityLevel(1)).toBeCloseTo(0.752, 3);
    expect(organVelocityLevel(64)).toBeCloseTo(0.876, 3);
    expect(organVelocityLevel(127)).toBe(1);
  });
});

describe("organ effects math", () => {
  it("keeps drive curves finite, bounded, symmetric, and linear at zero", () => {
    const linear = buildDriveCurve(0, 5);
    const driven = buildDriveCurve(1, 5);
    expect([...linear]).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(driven.every(Number.isFinite)).toBe(true);
    expect(Math.max(...driven)).toBeLessThanOrEqual(1);
    expect(Math.min(...driven)).toBeGreaterThanOrEqual(-1);
    expect(driven[0]).toBeCloseTo(-driven[4]!, 6);
    expect(driven[1]).toBeCloseTo(-driven[3]!, 6);
    expect(driven[3]).toBeGreaterThan(linear[3]!);
  });

  it("defines materially distinct bounded slow and fast rotor rates", () => {
    expect(ROTARY_SPEEDS.slow.lowHz).toBeLessThan(1);
    expect(ROTARY_SPEEDS.slow.highHz).toBeLessThan(1);
    expect(ROTARY_SPEEDS.fast.lowHz).toBeGreaterThanOrEqual(5);
    expect(ROTARY_SPEEDS.fast.highHz).toBeGreaterThan(ROTARY_SPEEDS.fast.lowHz);
    expect(ROTARY_SPEEDS.fast.highHz).toBeLessThanOrEqual(8);
  });
});

describe("OrganAudioEngine", () => {
  beforeEach(() => {
    FakeAudioContext.instances = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses one PeriodicWave oscillator per sounding note with a stable organ envelope", () => {
    const engine = new OrganAudioEngine();
    engine.noteOn({ midi: 69, startSec: 0, durSec: 1, vel: 64, hand: "R" });
    const ctx = FakeAudioContext.instances[0]!;
    const voice = ctx.oscillators[2]!;
    const envelope = ctx.gains.at(-1)!.gain;

    expect(ctx.waves).toHaveLength(1);
    expect(ctx.oscillators).toHaveLength(3); // two shared rotary LFOs + one voice
    expect(voice.frequency.value).toBe(220);
    expect(voice.wave).not.toBeNull();
    expect(envelope.linearRamps[0]).toEqual([organVelocityLevel(64) * 0.22, 10.006]);
    expect(envelope.setValues.at(-1)).toEqual([organVelocityLevel(64) * 0.22, 11]);
    expect(envelope.targets.at(-1)).toEqual([0, 11, 0.06]);
    expect(voice.stops).toEqual([11.3]);
  });

  it("keeps input notes alive until noteOff without stealing a scheduled same-pitch voice", () => {
    const engine = new OrganAudioEngine();
    engine.noteOn({ midi: 60, startSec: 0, durSec: 2, vel: 100, fromInput: false });
    engine.noteOn({ midi: 60, startSec: 0, durSec: 0.1, vel: 100, fromInput: true });
    const voices = FakeAudioContext.instances[0]!.oscillators.slice(2);

    expect(voices[0]!.stops).toEqual([12.3]);
    expect(voices[1]!.stops).toEqual([]);
    engine.noteOff(60);
    expect(voices[0]!.stops).toEqual([12.3]);
    expect(voices[1]!.stops).toEqual([10.3]);
  });

  it("ignores piano sustain and routes deduplicated chords through organ voices", () => {
    const engine = new OrganAudioEngine();
    engine.sustainPedal = true;
    engine.playChord([60, 60, 64, 67], 0, 1.5);
    const voices = FakeAudioContext.instances[0]!.oscillators.slice(2);
    expect(voices).toHaveLength(3);
    expect(voices.map((voice) => voice.stops[0])).toEqual([11.8, 11.8, 11.8]);
  });

  it("ramps shared rotary speed and updates bounded shared drive", () => {
    const engine = new OrganAudioEngine(0.2, "slow");
    engine.ensure();
    const ctx = FakeAudioContext.instances[0]!;
    engine.setOrganControls("fast", 0.8);

    expect(ctx.oscillators[0]!.frequency.targets.at(-1)).toEqual([ROTARY_SPEEDS.fast.lowHz, 10, 0.45]);
    expect(ctx.oscillators[1]!.frequency.targets.at(-1)).toEqual([ROTARY_SPEEDS.fast.highHz, 10, 0.45]);
    expect(ctx.shapers[0]!.curve!.every((value) => Number.isFinite(value) && Math.abs(value) <= 1)).toBe(true);

    engine.setOrganControls("slow", 0.2);
    expect(ctx.oscillators[0]!.frequency.targets.at(-1)).toEqual([ROTARY_SPEEDS.slow.lowHz, 10, 0.9]);
  });

  it("honors both hand gain buses", () => {
    const engine = new OrganAudioEngine();
    engine.ensure();
    const ctx = FakeAudioContext.instances[0]!;
    engine.setGains(0.7, 0.3);
    expect(ctx.gains[0]!.gain.targets.at(-1)).toEqual([0.7, 10, 0.02]);
    expect(ctx.gains[1]!.gain.targets.at(-1)).toEqual([0.3, 10, 0.02]);
  });

  it("keeps rotary infrastructure on cancelAll and stops it on dispose", () => {
    const engine = new OrganAudioEngine();
    for (let midi = 36; midi < 100; midi++) {
      engine.noteOn({ midi, startSec: 0, durSec: 3, vel: 100, fromInput: true });
    }
    const ctx = FakeAudioContext.instances[0]!;
    expect(ctx.oscillators).toHaveLength(66);
    engine.cancelAll();
    expect(ctx.oscillators.slice(2).every((voice) => voice.stops.length === 1)).toBe(true);
    expect(ctx.oscillators.slice(0, 2).every((lfo) => lfo.stops.length === 0)).toBe(true);
    engine.dispose();
    expect(ctx.oscillators.slice(0, 2).every((lfo) => lfo.stops.length === 1 && lfo.disconnected)).toBe(true);
    expect(ctx.closeCalls).toBe(1);
  });

  it("keeps the metronome as the existing square-wave click", () => {
    const engine = new OrganAudioEngine();
    engine.metronomeClick(0);
    const click = FakeAudioContext.instances[0]!.oscillators[2]!;
    expect(click.type).toBe("square");
    expect(click.frequency.value).toBe(1760);
    expect(click.stops).toEqual([10.06]);
  });

  it("falls back to the existing synth when native rotary graph creation fails", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    class BrokenRotaryContext extends FakeAudioContext {
      override createStereoPanner(): StereoPannerNode {
        throw new Error("stereo panner unavailable");
      }
    }
    vi.stubGlobal("AudioContext", BrokenRotaryContext);
    const engine = new OrganAudioEngine();

    expect(() => engine.noteOn({ midi: 60, startSec: 0, durSec: 1, vel: 100 })).not.toThrow();
    expect(FakeAudioContext.instances).toHaveLength(2);
    expect(FakeAudioContext.instances[0]!.closeCalls).toBe(1);
    expect(FakeAudioContext.instances[1]!.oscillators).toHaveLength(3);
    engine.dispose();
  });
});
