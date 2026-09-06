import { AudioEngine } from "./audio.js";
import type { AudioLike } from "./engine.js";
import type { TimedNote } from "./timeline.js";

const DRAWBAR_RATIOS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8] as const;
const DRAWBAR_HARMONICS = [1, 3, 2, 4, 6, 8, 10, 12, 16] as const;

/** Classic-rock registration: strong fundamental, sub-octave and first overtones. */
export const ROCK_REGISTRATION = [8, 8, 8, 8, 0, 0, 0, 0, 0] as const;

export const ROTARY_SPEEDS = {
  slow: { lowHz: 0.45, highHz: 0.72 },
  fast: { lowHz: 5.2, highHz: 6.8 },
} as const;

export function drawbarAmplitude(digit: number): number {
  if (digit <= 0) return 0;
  return Math.pow(10, (-3 * (8 - Math.min(8, digit))) / 20);
}

export function tonewheelFrequencies(midi: number): number[] {
  const fundamental = 440 * Math.pow(2, (midi - 69) / 12);
  return DRAWBAR_RATIOS.map((ratio) => fundamental * ratio);
}

export function buildTonewheelCoefficients(registration: readonly number[]): {
  real: Float32Array;
  imag: Float32Array;
} {
  if (registration.length !== 9 || registration.some((digit) => !Number.isInteger(digit) || digit < 0 || digit > 8)) {
    throw new RangeError("Tonewheel registration must contain nine drawbar digits from 0 to 8");
  }
  const amplitudes = registration.map(drawbarAmplitude);
  const total = amplitudes.reduce((sum, amplitude) => sum + amplitude, 0) || 1;
  const real = new Float32Array(17);
  for (let i = 0; i < DRAWBAR_HARMONICS.length; i++) {
    real[DRAWBAR_HARMONICS[i]!] = amplitudes[i]! / total;
  }
  return { real, imag: new Float32Array(17) };
}

export function organVelocityLevel(velocity: number): number {
  return 0.75 + 0.25 * Math.min(127, Math.max(0, velocity)) / 127;
}

export function buildDriveCurve(drive: number, samples = 1024): Float32Array<ArrayBuffer> {
  const amount = Math.min(1, Math.max(0, drive));
  const curve = new Float32Array(samples);
  const strength = 1 + amount * 3;
  const norm = Math.tanh(strength);
  for (let i = 0; i < samples; i++) {
    const x = samples === 1 ? 0 : (i / (samples - 1)) * 2 - 1;
    curve[i] = amount === 0 ? x : Math.tanh(strength * x) / norm;
  }
  return curve;
}

const ATTACK_SEC = 0.006;
const RELEASE_SEC = 0.06;
const RELEASE_STOP_SEC = 0.3;

type RotarySpeed = keyof typeof ROTARY_SPEEDS;
type Voice = { osc: OscillatorNode; gain: GainNode; fromInput: boolean };
type Click = { osc: OscillatorNode; gain: GainNode };

export class OrganAudioEngine implements AudioLike {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private master: GainNode | null = null;
  private voiceGainNode: GainNode | null = null;
  private pianoGainNode: GainNode | null = null;
  private driveNode: WaveShaperNode | null = null;
  private lowFilter: BiquadFilterNode | null = null;
  private highFilter: BiquadFilterNode | null = null;
  private lowPanner: StereoPannerNode | null = null;
  private highPanner: StereoPannerNode | null = null;
  private lowLfo: OscillatorNode | null = null;
  private highLfo: OscillatorNode | null = null;
  private lowLfoDepth: GainNode | null = null;
  private highLfoDepth: GainNode | null = null;
  private wave: PeriodicWave | null = null;
  private fallback: AudioEngine | null = null;
  private active = new Map<number, Voice[]>();
  private clicks = new Set<Click>();
  private rotary: RotarySpeed;
  private drive: number;

  voiceGain = 1;
  pianoGain = 0.4;
  /** Kept for AudioLike compatibility; organ voices never gain a piano tail. */
  sustainPedal = false;

  constructor(drive = 0.2, rotary: RotarySpeed = "slow") {
    this.drive = drive;
    this.rotary = rotary;
  }

  ensure(): AudioContext {
    if (this.fallback) return this.fallback.ensure();
    if (!this.ctx || this.ctx.state === "closed") {
      try {
        this.createGraph();
      } catch (error) {
        console.warn("[OrganAudioEngine] native organ initialization failed; falling back to oscillator mode", error);
        this.disposeNativeGraph();
        this.fallback = new AudioEngine();
        this.fallback.sustainPedal = false;
        this.fallback.setGains(this.voiceGain, this.pianoGain);
        return this.fallback.ensure();
      }
    }
    if (!this.ctx) throw new Error("Organ audio initialization failed");
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private createGraph(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.voiceGainNode = ctx.createGain();
    this.pianoGainNode = ctx.createGain();
    this.master = ctx.createGain();
    this.lowLfoDepth = ctx.createGain();
    this.highLfoDepth = ctx.createGain();
    this.driveNode = ctx.createWaveShaper();
    this.lowFilter = ctx.createBiquadFilter();
    this.highFilter = ctx.createBiquadFilter();
    this.lowPanner = ctx.createStereoPanner();
    this.highPanner = ctx.createStereoPanner();
    this.compressor = ctx.createDynamicsCompressor();

    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.15;
    this.driveNode.oversample = "2x";
    this.lowFilter.type = "lowpass";
    this.highFilter.type = "highpass";
    this.lowFilter.frequency.value = 800;
    this.highFilter.frequency.value = 800;
    this.lowFilter.Q.value = 0.5;
    this.highFilter.Q.value = 0.5;
    this.lowLfoDepth.gain.value = 0.32;
    this.highLfoDepth.gain.value = 0.48;

    this.voiceGainNode.connect(this.driveNode);
    this.pianoGainNode.connect(this.driveNode);
    this.driveNode.connect(this.lowFilter);
    this.driveNode.connect(this.highFilter);
    this.lowFilter.connect(this.lowPanner);
    this.highFilter.connect(this.highPanner);
    this.lowPanner.connect(this.master);
    this.highPanner.connect(this.master);
    this.master.connect(this.compressor);
    this.compressor.connect(ctx.destination);

    this.lowLfo = ctx.createOscillator();
    this.highLfo = ctx.createOscillator();
    this.lowLfo.frequency.value = ROTARY_SPEEDS[this.rotary].lowHz;
    this.highLfo.frequency.value = ROTARY_SPEEDS[this.rotary].highHz;
    this.lowLfo.connect(this.lowLfoDepth);
    this.highLfo.connect(this.highLfoDepth);
    this.lowLfoDepth.connect(this.lowPanner.pan);
    this.highLfoDepth.connect(this.highPanner.pan);
    this.lowLfo.start();
    this.highLfo.start();

    const coefficients = buildTonewheelCoefficients(ROCK_REGISTRATION);
    this.wave = ctx.createPeriodicWave(coefficients.real, coefficients.imag, { disableNormalization: true });
    this.applyGains();
    this.applyDrive();
  }

  setGains(voice: number, piano: number): void {
    this.voiceGain = voice;
    this.pianoGain = piano;
    this.applyGains();
    this.fallback?.setGains(voice, piano);
  }

  private applyGains(): void {
    if (!this.ctx || !this.voiceGainNode || !this.pianoGainNode) return;
    this.voiceGainNode.gain.setTargetAtTime(this.voiceGain, this.ctx.currentTime, 0.02);
    this.pianoGainNode.gain.setTargetAtTime(this.pianoGain, this.ctx.currentTime, 0.02);
  }

  setOrganControls(rotary: RotarySpeed, drive: number): void {
    this.drive = Math.min(1, Math.max(0, drive));
    this.applyDrive();
    if (rotary === this.rotary) return;
    this.rotary = rotary;
    if (!this.ctx || !this.lowLfo || !this.highLfo) return;
    const now = this.ctx.currentTime;
    const timeConstant = rotary === "fast" ? 0.45 : 0.9;
    this.lowLfo.frequency.cancelScheduledValues(now);
    this.highLfo.frequency.cancelScheduledValues(now);
    this.lowLfo.frequency.setTargetAtTime(ROTARY_SPEEDS[rotary].lowHz, now, timeConstant);
    this.highLfo.frequency.setTargetAtTime(ROTARY_SPEEDS[rotary].highHz, now, timeConstant);
  }

  private applyDrive(): void {
    if (this.driveNode) this.driveNode.curve = buildDriveCurve(this.drive);
  }

  noteOn(note: TimedNote, when = 0): void {
    const ctx = this.ensure();
    if (this.fallback) {
      this.fallback.sustainPedal = false;
      this.fallback.noteOn(note, when);
      return;
    }
    const bus = note.hand === "L" ? this.pianoGainNode : this.voiceGainNode;
    if (!bus) return;
    this.startVoice(note.midi, note.vel, note.fromInput ?? false, bus, ctx.currentTime + when, note.fromInput ? null : note.durSec);
  }

  private startVoice(midi: number, velocity: number, fromInput: boolean, bus: GainNode, start: number, duration: number | null): void {
    if (!this.ctx || !this.wave) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const peak = organVelocityLevel(velocity) * 0.22;
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12) * 0.5;
    osc.setPeriodicWave(this.wave);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + ATTACK_SEC);
    if (duration !== null) {
      const releaseAt = start + Math.max(0, duration);
      gain.gain.setValueAtTime(peak, releaseAt);
      gain.gain.setTargetAtTime(0, releaseAt, RELEASE_SEC);
      osc.stop(releaseAt + RELEASE_STOP_SEC);
    }
    osc.connect(gain);
    gain.connect(bus);
    osc.start(start);
    const voice = { osc, gain, fromInput };
    const voices = this.active.get(midi) ?? [];
    voices.push(voice);
    this.active.set(midi, voices);
    osc.onended = () => this.removeVoice(midi, voice);
  }

  private removeVoice(midi: number, voice: Voice): void {
    const voices = this.active.get(midi);
    if (voices) {
      const index = voices.indexOf(voice);
      if (index >= 0) voices.splice(index, 1);
      if (voices.length === 0) this.active.delete(midi);
    }
    voice.osc.disconnect();
    voice.gain.disconnect();
  }

  noteOff(midi: number): void {
    if (this.fallback) {
      this.fallback.noteOff(midi);
      return;
    }
    const voices = this.active.get(midi);
    if (!voices || !this.ctx) return;
    const now = this.ctx.currentTime;
    const scheduled = voices.filter((voice) => !voice.fromInput);
    for (const voice of voices) {
      if (!voice.fromInput) continue;
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0, now, RELEASE_SEC);
        voice.osc.stop(now + RELEASE_STOP_SEC);
      } catch {}
    }
    if (scheduled.length) this.active.set(midi, scheduled);
    else this.active.delete(midi);
  }

  playChord(midiNotes: number[], when: number, durationSec: number): void {
    const ctx = this.ensure();
    if (this.fallback) {
      this.fallback.sustainPedal = false;
      this.fallback.playChord(midiNotes, when, durationSec);
      return;
    }
    if (!this.pianoGainNode) return;
    const start = ctx.currentTime + when;
    const duration = Math.max(0.2, Math.min(8, durationSec));
    for (const midi of [...new Set(midiNotes)].sort((a, b) => a - b)) {
      this.startVoice(midi, 100, false, this.pianoGainNode, start, duration);
    }
  }

  metronomeClick(beat: number, when = 0): void {
    const ctx = this.ensure();
    if (this.fallback) {
      this.fallback.metronomeClick(beat, when);
      return;
    }
    if (!this.master) return;
    const start = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = beat === 0 ? 1760 : 1174;
    gain.gain.setValueAtTime(0.04, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.05);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(start);
    osc.stop(start + 0.06);
    const click = { osc, gain };
    this.clicks.add(click);
    osc.onended = () => {
      this.clicks.delete(click);
      gain.disconnect();
    };
  }

  cancelAll(): void {
    this.fallback?.cancelAll();
    const now = this.ctx?.currentTime ?? 0;
    for (const voices of this.active.values()) {
      for (const voice of voices) {
        try {
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setTargetAtTime(0, now, 0.01);
          voice.osc.stop(now + 0.1);
        } catch {}
      }
    }
    this.active.clear();
    for (const click of this.clicks) {
      try { click.osc.stop(now + 0.02); } catch {}
      click.gain.disconnect();
    }
    this.clicks.clear();
  }

  dispose(): void {
    this.cancelAll();
    this.fallback?.dispose();
    this.fallback = null;
    this.disposeNativeGraph();
  }

  private disposeNativeGraph(): void {
    for (const lfo of [this.lowLfo, this.highLfo]) {
      if (!lfo) continue;
      try { lfo.stop(); } catch {}
      lfo.disconnect();
    }
    for (const node of [
      this.voiceGainNode, this.pianoGainNode, this.driveNode, this.lowFilter,
      this.highFilter, this.lowPanner, this.highPanner, this.lowLfoDepth,
      this.highLfoDepth, this.master, this.compressor,
    ]) node?.disconnect();
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close();
    this.ctx = null;
    this.wave = null;
    this.lowLfo = null;
    this.highLfo = null;
    this.voiceGainNode = null;
    this.pianoGainNode = null;
    this.driveNode = null;
    this.lowFilter = null;
    this.highFilter = null;
    this.lowPanner = null;
    this.highPanner = null;
    this.lowLfoDepth = null;
    this.highLfoDepth = null;
    this.master = null;
    this.compressor = null;
  }
}
