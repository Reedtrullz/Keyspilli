import type { TimedNote } from "./timeline.js";
import type { AudioLike } from "./engine.js";
import { AudioEngine } from "./audio.js";
import { SplendidGrandPiano, type Smplr } from "smplr";

/**
 * Sampled-piano AudioLike implementation backed by smplr's
 * SplendidGrandPiano. Lazily loads the sample set on first ensure(); falls
 * back to the oscillator-based AudioEngine if loading fails or is slow.
 *
 * The instrument's output routes through a shared compressor + master gain,
 * with separate voice/piano gain buses so existing volume sliders keep working
 * unchanged. Sustain pedal maps to MIDI CC64 on the sampler.
 */
export class SamplerAudioEngine implements AudioLike {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private master: GainNode | null = null;
  private voiceGainNode: GainNode | null = null;
  private pianoGainNode: GainNode | null = null;
  private piano: Smplr | null = null;
  private pianoReady = false;
  private pianoFailed = false;
  private loadStarted = false;
  /** One shared load promise prevents duplicate sample graphs/fetches. */
  private pianoLoadPromise: Promise<void> | null = null;
  /** Invalidates a load that resolves after dispose/context recreation. */
  private loadGeneration = 0;
  /** Fallback engine used until samples are loaded or if loading fails. */
  private fallbackEngine: AudioEngine | null = null;

  voiceGain = 1;
  pianoGain = 0.4;
  sustainPedal = true;

  /** True while samples are being fetched; UI may show a loading indicator. */
  get isLoading(): boolean {
    return !this.pianoReady && !this.pianoFailed;
  }

  /** Sync the sampler's CC64 sustain pedal with the current setting. */
  private syncPedal(): void {
    if (this.piano && this.pianoReady) {
      this.piano.setCC(64, this.sustainPedal ? 127 : 0);
    }
  }

  ensure(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      // A closed context cannot accept an instrument that is still loading.
      // Invalidate any previous request before creating the replacement.
      this.loadGeneration++;
      this.pianoLoadPromise = null;
      this.loadStarted = false;
      this.pianoReady = false;
      this.pianoFailed = false;
      this.piano = null;
      this.ctx = new AudioContext();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -24;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 3;
      this.compressor.attack.value = 0.005;
      this.compressor.release.value = 0.15;
      this.master = this.ctx.createGain();
      this.master.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);
      this.voiceGainNode = this.ctx.createGain();
      this.pianoGainNode = this.ctx.createGain();
      this.voiceGainNode.connect(this.master);
      this.pianoGainNode.connect(this.master);
      this.applyGains();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    // Start fetching samples as soon as the context exists so the first
    // play uses the sampler rather than falling back to oscillators.
    if (!this.loadStarted && !this.pianoLoadPromise && !this.pianoFailed) {
      this.loadStarted = true;
      const generation = this.loadGeneration;
      const context = this.ctx;
      const load = this.loadPiano(context, generation);
      this.pianoLoadPromise = load;
      // `loadPiano` handles expected failures itself; this handler only
      // releases the in-flight marker once the request settles.
      void load.then(
        () => {
          if (this.loadGeneration === generation) this.pianoLoadPromise = null;
        },
        () => {
          if (this.loadGeneration === generation) this.pianoLoadPromise = null;
        },
      );
    }
    return this.ctx;
  }

  private async loadPiano(ctx: AudioContext, generation: number): Promise<void> {
    if (this.loadGeneration !== generation || this.ctx !== ctx || !this.pianoGainNode) return;
    try {
      const inst = SplendidGrandPiano(ctx, {
        destination: this.pianoGainNode,
      });
      await inst.ready;
      // Dispose an instrument that completed after this engine moved to a new
      // context. Without this guard, a late load could resurrect audio after
      // `dispose()` and retain the old context graph.
      if (this.loadGeneration !== generation || this.ctx !== ctx) {
        try { inst.dispose(); } catch { /* already disposed */ }
        return;
      }
      this.piano = inst;
      this.pianoReady = true;
      // Sync pedal state now that the sampler can receive CC64.
      inst.setCC(64, this.sustainPedal ? 127 : 0);
    } catch (e) {
      if (this.loadGeneration !== generation || this.ctx !== ctx) return;
      console.warn("[SamplerAudioEngine] sample loading failed; falling back to oscillator mode", e);
      this.pianoFailed = true;
    }
  }

  noteOn(n: TimedNote, when = 0): void {
    const ctx = this.ensure();
    const t = ctx.currentTime + when;
    if (this.piano && this.pianoReady) {
      this.piano.start({ note: n.midi, time: t, duration: n.durSec, velocity: n.vel });
      return;
    }
    // Samples not ready yet: use fallback oscillator for immediate response.
    if (!this.fallbackEngine) {
      this.fallbackEngine = new AudioEngine();
      this.fallbackEngine.setGains(this.voiceGain, this.pianoGain);
    }
    this.fallbackEngine.noteOn(n, when);
  }

  noteOff(midi: number): void {
    if (this.piano && this.pianoReady) {
      this.piano.stop(midi);
      return;
    }
    this.fallbackEngine?.noteOff(midi);
  }

  metronomeClick(beat: number, when = 0): void {
    const ctx = this.ensure();
    if (!this.master) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = beat === 0 ? 1760 : 1174;
    gain.gain.setValueAtTime(0.04, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.06);
    osc.onended = () => gain.disconnect();
  }

  playChord(midiNotes: number[], when: number, durationSec: number): void {
    if (this.piano && this.pianoReady) {
      const ctx = this.ensure();
      const t = ctx.currentTime + when;
      for (const midi of [...new Set(midiNotes)]) {
        this.piano.start({ note: midi, time: t, duration: Math.max(0.2, Math.min(8, durationSec)) });
      }
      return;
    }
    // Fallback chord synthesis mirrors AudioEngine.playChord behavior.
    if (!this.fallbackEngine) return;
    this.fallbackEngine.playChord?.(midiNotes, when, durationSec);
  }

  cancelAll(): void {
    if (this.piano && this.pianoReady) this.piano.stop();
    this.fallbackEngine?.cancelAll();
  }

  setGains(voice: number, piano: number): void {
    this.voiceGain = voice;
    this.pianoGain = piano;
    this.applyGains();
    this.fallbackEngine?.setGains(voice, piano);
  }

  set sustainPedalSynced(value: boolean) {
    this.sustainPedal = value;
    this.syncPedal();
  }

  private applyGains(): void {
    if (this.ctx && this.voiceGainNode && this.pianoGainNode) {
      this.voiceGainNode.gain.setTargetAtTime(this.voiceGain, this.ctx.currentTime, 0.02);
      this.pianoGainNode.gain.setTargetAtTime(this.pianoGain, this.ctx.currentTime, 0.02);
    }
  }

  dispose(): void {
    this.loadGeneration++;
    this.pianoLoadPromise = null;
    this.loadStarted = false;
    this.cancelAll();
    this.pianoReady = false;
    this.pianoFailed = false;
    if (this.piano) {
      try { this.piano.dispose(); } catch { /* already disposed */ }
      this.piano = null;
    }
    this.fallbackEngine?.dispose();
    this.fallbackEngine = null;
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close();
    this.ctx = null;
    this.compressor = null;
  }
}
