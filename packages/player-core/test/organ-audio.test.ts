import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATHEDRAL_ENVELOPE,
  CATHEDRAL_IR_SECONDS,
  ROCK_REGISTRATION,
  ROTARY_SPEEDS,
  OrganAudioEngine,
  buildCathedralFoundationCoefficients,
  buildCathedralImpulseResponse,
  buildCathedralManualCoefficients,
  buildDriveCurve,
  buildTonewheelCoefficients,
  cathedralRankFrequencies,
  cathedralSpaceMix,
  cathedralVelocityLevel,
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
  stop(time = 0) {
    if (this.starts.length === 0) throw new DOMException("cannot call stop without calling start first", "InvalidStateError");
    this.stops.push(time);
  }
}

class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeFilter extends FakeNode { type: BiquadFilterType = "lowpass"; frequency = new FakeParam(); Q = new FakeParam(); }
class FakePanner extends FakeNode { pan = new FakeParam(); }
class FakeWaveShaper extends FakeNode { curve: Float32Array<ArrayBuffer> | null = null; oversample: OverSampleType = "none"; }
class FakeCompressor extends FakeNode {
  threshold = new FakeParam(); knee = new FakeParam(); ratio = new FakeParam();
  attack = new FakeParam(); release = new FakeParam();
}
class FakeConvolver extends FakeNode { buffer: AudioBuffer | null = null; }
class FakeBuffer {
  channels: Float32Array[];
  constructor(public length: number, public sampleRate: number) {
    this.channels = [new Float32Array(length), new Float32Array(length)];
  }
  copyToChannel(source: Float32Array, channel: number) { this.channels[channel]!.set(source); }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = "running";
  currentTime = 10;
  sampleRate = 48_000;
  destination = new FakeNode() as unknown as AudioDestinationNode;
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  panners: FakePanner[] = [];
  shapers: FakeWaveShaper[] = [];
  convolvers: FakeConvolver[] = [];
  waves: { real: Float32Array; imag: Float32Array }[] = [];
  closeCalls = 0;

  constructor() { FakeAudioContext.instances.push(this); }
  createOscillator() { const node = new FakeOscillator(); this.oscillators.push(node); return node as unknown as OscillatorNode; }
  createGain() { const node = new FakeGain(); this.gains.push(node); return node as unknown as GainNode; }
  createBiquadFilter() { return new FakeFilter() as unknown as BiquadFilterNode; }
  createStereoPanner() { const node = new FakePanner(); this.panners.push(node); return node as unknown as StereoPannerNode; }
  createWaveShaper() { const node = new FakeWaveShaper(); this.shapers.push(node); return node as unknown as WaveShaperNode; }
  createDynamicsCompressor() { return new FakeCompressor() as unknown as DynamicsCompressorNode; }
  createConvolver() { const node = new FakeConvolver(); this.convolvers.push(node); return node as unknown as ConvolverNode; }
  createBuffer(_channels: number, length: number, sampleRate: number) { return new FakeBuffer(length, sampleRate) as unknown as AudioBuffer; }
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

describe("cathedral spectrum", () => {
  it("freezes distinct safe manual and foundation pipe-rank spectra", () => {
    const manual = buildCathedralManualCoefficients().real;
    const foundation = buildCathedralFoundationCoefficients().real;
    expect([...manual].map((value) => Number(value.toFixed(3)))).toEqual([0, 0.08, 0.36, 0.04, 0.22, 0.04, 0.1, 0, 0.08, 0, 0.04, 0, 0.04]);
    expect([...foundation].map((value) => Number(value.toFixed(3)))).toEqual([0, 0.34, 0.32, 0.05, 0.16, 0.03, 0.05, 0, 0.025, 0, 0.015, 0, 0.01]);
    expect([...manual, ...foundation].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    expect(manual[2]).toBeGreaterThan(foundation[2]!);
    expect(manual.slice(4).reduce((sum, value) => sum + value, 0)).toBeGreaterThan(foundation.slice(4).reduce((sum, value) => sum + value, 0));
    expect(foundation[1]).toBeGreaterThan(manual[1]!);
    expect([...manual]).not.toEqual([...buildTonewheelCoefficients(ROCK_REGISTRATION).real]);
  });

  it("maps A4 rank relationships from the 16-foot oscillator base", () => {
    expect(cathedralRankFrequencies(69)).toMatchObject({ sixteen: 220, eight: 440, four: 880, mutation: 1320, two: 1760 });
  });

  it("keeps Cathedral articulation and velocity shallow", () => {
    expect(CATHEDRAL_ENVELOPE).toEqual({ attackSec: 0.015, releaseSec: 0.11, stopSec: 0.55 });
    expect(cathedralVelocityLevel(1)).toBeCloseTo(0.851, 3);
    expect(cathedralVelocityLevel(64)).toBeCloseTo(0.926, 3);
    expect(cathedralVelocityLevel(127)).toBe(1);
  });
});

describe("cathedral acoustics", () => {
  for (const sampleRate of [44_100, 48_000]) {
    it(`builds deterministic bounded stereo decay at ${sampleRate} Hz`, () => {
      const a = buildCathedralImpulseResponse(sampleRate);
      const b = buildCathedralImpulseResponse(sampleRate);
      expect(a.left).toEqual(b.left);
      expect(a.right).toEqual(b.right);
      expect(a.left).toHaveLength(Math.round(sampleRate * CATHEDRAL_IR_SECONDS));
      expect(a.left).not.toEqual(a.right);
      expect([...a.left, ...a.right].every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1)).toBe(true);
      expect(Math.sqrt(a.left.reduce((sum, sample) => sum + sample * sample, 0))).toBeLessThanOrEqual(1.001);
      expect(Math.sqrt(a.right.reduce((sum, sample) => sum + sample * sample, 0))).toBeLessThanOrEqual(1.001);
      const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      const window = Math.floor(sampleRate * 0.5);
      const early = rms(a.left.slice(Math.floor(sampleRate * 0.02), Math.floor(sampleRate * 0.02) + window));
      const middle = rms(a.left.slice(Math.floor(sampleRate * 2.5), Math.floor(sampleRate * 2.5) + window));
      const late = rms(a.left.slice(-window));
      expect(early).toBeGreaterThan(middle);
      expect(middle).toBeGreaterThan(late);
      expect(late).toBeGreaterThan(0);
    });
  }

  it("maps Space to an intelligible dry mix and at most 75% wet", () => {
    expect(cathedralSpaceMix(0)).toEqual({ dry: 1, wet: 0 });
    expect(cathedralSpaceMix(1)).toEqual({ dry: 0.65, wet: 0.75 });
    expect(cathedralSpaceMix(2)).toEqual({ dry: 0.65, wet: 0.75 });
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

  it("uses Cathedral manual/foundation waves through convolution without Rock rotary or drive", () => {
    const engine = new OrganAudioEngine(0.9, "fast", "cathedral", 0.65);
    engine.noteOn({ midi: 69, startSec: 0, durSec: 1, vel: 64, hand: "R" });
    engine.noteOn({ midi: 45, startSec: 0, durSec: 1, vel: 64, hand: "L" });
    const ctx = FakeAudioContext.instances[0]!;
    expect(ctx.waves).toHaveLength(2);
    expect(ctx.convolvers).toHaveLength(1);
    expect(ctx.shapers).toHaveLength(0);
    expect(ctx.panners).toHaveLength(0);
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators[0]!.wave).not.toBe(ctx.oscillators[1]!.wave);
    expect(ctx.gains.at(-2)!.gain.linearRamps[0]).toEqual([cathedralVelocityLevel(64) * 0.22, 10 + CATHEDRAL_ENVELOPE.attackSec]);
    expect(ctx.gains.at(-2)!.gain.targets.at(-1)).toEqual([0, 11, CATHEDRAL_ENVELOPE.releaseSec]);
  });

  it("updates Cathedral Space without rebuilding its deterministic IR", () => {
    const engine = new OrganAudioEngine(0.2, "slow", "cathedral", 0.65);
    engine.ensure();
    const ctx = FakeAudioContext.instances[0]!;
    const buffer = ctx.convolvers[0]!.buffer;
    engine.setOrganControls("fast", 1, 0.9);
    expect(ctx.convolvers[0]!.buffer).toBe(buffer);
    const mix = cathedralSpaceMix(0.9);
    expect(ctx.gains[3]!.gain.targets.at(-1)?.[0]).toBeCloseTo(mix.dry);
    expect(ctx.gains[4]!.gain.targets.at(-1)?.[0]).toBeCloseTo(mix.wet);
  });

  it("uses the Cathedral release for input notes and disposes its IR graph", () => {
    const engine = new OrganAudioEngine(0.2, "slow", "cathedral", 0.65);
    for (let midi = 48; midi < 80; midi++) {
      engine.noteOn({ midi, startSec: 0, durSec: 1, vel: 100, fromInput: true, hand: midi < 60 ? "L" : "R" });
    }
    const ctx = FakeAudioContext.instances[0]!;
    const convolver = ctx.convolvers[0]!;
    engine.noteOff(60);
    expect(ctx.oscillators[12]!.stops).toEqual([10 + CATHEDRAL_ENVELOPE.stopSec]);
    expect(ctx.gains[17]!.gain.targets.at(-1)).toEqual([0, 10, CATHEDRAL_ENVELOPE.releaseSec]);
    engine.dispose();
    expect(convolver.buffer).toBeNull();
    expect(convolver.disconnected).toBe(true);
    expect(ctx.oscillators.every((voice) => voice.stops.length === 1)).toBe(true);
    expect(ctx.closeCalls).toBe(1);
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

    expect(ctx.gains[3]!.gain.value).toBeGreaterThan(0);
    expect(ctx.gains[3]!.gain.value).toBeLessThan(0.5);
    expect(ctx.gains[4]!.gain.value).toBeGreaterThan(ctx.gains[3]!.gain.value);
    expect(ctx.gains[4]!.gain.value).toBeLessThanOrEqual(0.5);
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
