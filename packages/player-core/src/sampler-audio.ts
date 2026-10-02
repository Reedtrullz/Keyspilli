import { configurePlaybackSession } from "./audio-session.js";
import type { TimedNote } from "./timeline.js";
import type { AudioLike } from "./engine.js";
import { AudioEngine } from "./audio.js";
import { SampleLoader, SplendidGrandPiano, type Smplr } from "smplr";

// ponytail: one default piano set/sample rate; key by preset if other libraries are added.
let pianoSamples: { sampleRate: number; buffers: Map<string, AudioBuffer>; promise: Promise<Map<string, AudioBuffer>> | null; expiry?: ReturnType<typeof setTimeout> } | null = null;

function sharedPianoLoader(ctx: AudioContext): SampleLoader {
  return {
    load(preset) {
      if (!pianoSamples || pianoSamples.sampleRate !== ctx.sampleRate) {
        if (pianoSamples?.expiry) clearTimeout(pianoSamples.expiry);
        const entry = { sampleRate: ctx.sampleRate, buffers: new Map<string, AudioBuffer>(), promise: null as Promise<Map<string, AudioBuffer>> | null, expiry: undefined as ReturnType<typeof setTimeout> | undefined };
        pianoSamples = entry;
        entry.expiry = setTimeout(() => { if (pianoSamples === entry) pianoSamples = null; }, 5 * 60_000);
      }
      const entry = pianoSamples;
      if (!entry.promise) {
        // Deselection may finish warming this one set; no disposed instrument is installed.
        const signal = AbortSignal.timeout(30_000);
        entry.promise = SampleLoader(ctx, { storage: { fetch: url => fetch(url, { signal }).catch(() => new Response(null, { status: 503 })) } }).load(preset, { buffers: entry.buffers }).then(buffers => {
          entry.buffers = buffers;
          if (preset.groups.some(group => group.regions.some(region => !buffers.has(region.sample)))) throw new Error("Piano samples are incomplete. Retry or choose synthesis fallback.");
          return buffers;
        }).catch(error => { entry.promise = null; throw error; });
      }
      return entry.promise;
    },
  };
}

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
  onStateChange: ((state: string) => void) | null = null;
  get state(): string { return (this.playbackTimbre === "fallback" ? this.fallbackEngine?.state : undefined) ?? this.ctx?.state ?? "uninitialized"; }
  private compressor: DynamicsCompressorNode | null = null;
  private master: GainNode | null = null;
  private voiceGainNode: GainNode | null = null;
  private pianoGainNode: GainNode | null = null;
  private piano: Smplr | null = null;
  private voicePiano: Smplr | null = null;
  /** Physical holds/pedal are owned by the input adapter, separately from playback CC64. */
  private inputPiano: Smplr | null = null;
  private clicks = new Set<{ osc: OscillatorNode; gain: GainNode }>();
  private pianoReady = false;
  private chosenTimbre: "sampled" | "fallback" | null = null;
  samplePolicy: "fallback" | "wait" = "fallback";
  loadLatencyMs: number | null = null;
  private loadStartMs = 0;
  private retryCount = 0;
  onReadinessChange: (() => void) | null = null;
  get readiness(): "uninitialized" | "loading" | "ready" | "failed" { return !this.loadStarted ? "uninitialized" : this.pianoFailed ? "failed" : this.pianoReady ? "ready" : "loading"; }
  get playbackTimbre(): "sampled" | "fallback" { return this.chosenTimbre ?? (this.pianoReady ? "sampled" : "fallback"); }
  /** Called only at deliberate boundaries; readiness alone never changes the current timbre. */
  prepareTimbre(): boolean {
    this.ensure();
    if (this.samplePolicy === "wait" && !this.pianoReady) return false;
    const next = this.pianoReady ? "sampled" : "fallback";
    if (next !== this.chosenTimbre) this.cancelAll();
    this.chosenTimbre = next; this.onReadinessChange?.();
    return true;
  }
  retrySamples(): boolean {
    if (!this.ctx || this.ctx.state === "closed" || !this.pianoFailed || this.retryCount >= 2) return false;
    this.retryCount++; this.pianoFailed = false; this.loadStarted = false; this.pianoLoadPromise = null;
    this.ensure(); return true;
  }
  private useSamples(): boolean {
    if (this.chosenTimbre === null) { this.chosenTimbre = this.pianoReady ? "sampled" : "fallback"; this.onReadinessChange?.(); }
    return this.chosenTimbre === "sampled" && this.pianoReady;
  }
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
  private _sustainPedal = true;

  get sustainPedal(): boolean {
    return this._sustainPedal;
  }

  set sustainPedal(value: boolean) {
    this._sustainPedal = value;
    this.syncPedal();
    if (this.fallbackEngine) this.fallbackEngine.sustainPedal = value;
  }

  /** True while samples are being fetched; UI may show a loading indicator. */
  get isLoading(): boolean {
    return !this.pianoReady && !this.pianoFailed;
  }

  /** Sync the sampler's CC64 sustain pedal with the current setting. */
  private syncPedal(): void {
    if (this.pianoReady) for (const instrument of [this.voicePiano, this.piano]) instrument?.setCC(64, this.sustainPedal ? 127 : 0);
  }

  ensure(activate = true): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      // A closed context cannot accept an instrument that is still loading.
      // Invalidate any previous request before creating the replacement.
      this.loadGeneration++;
      this.pianoLoadPromise = null;
      this.loadStarted = false;
      this.pianoReady = false;
      this.chosenTimbre = null;
      this.pianoFailed = false;
      this.retryCount = 0; this.loadLatencyMs = null;
      this.inputPiano?.dispose();
      this.inputPiano = null;
      this.voicePiano?.dispose();
      this.piano?.dispose();
      this.voicePiano = null;
      this.piano = null;
      configurePlaybackSession();
      this.ctx = new AudioContext();
      const observed = this.ctx;
      observed.onstatechange = () => { if (this.ctx === observed && (this.playbackTimbre === "sampled" || this.clicks.size > 0)) this.onStateChange?.(observed.state); };
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
      this.voiceGainNode.gain.value = this.voiceGain;
      this.pianoGainNode.gain.value = this.pianoGain;
      this.voiceGainNode.connect(this.master);
      this.pianoGainNode.connect(this.master);
      this.applyGains();
    }
    const context = this.ctx;
    if (activate && context.state === "suspended") void context.resume().catch(() => { if (this.ctx === context) this.onStateChange?.(context.state); });
    // Start fetching samples as soon as the context exists so the first
    // play uses the sampler rather than falling back to oscillators.
    if (!this.loadStarted && !this.pianoLoadPromise && !this.pianoFailed) {
      this.loadStarted = true;
      this.loadStartMs = performance.now();
      this.onReadinessChange?.();
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
    if (this.loadGeneration !== generation || this.ctx !== ctx || !this.pianoGainNode || !this.voiceGainNode) return;
    let voice: Smplr | null = null;
    let piano: Smplr | null = null;
    let input: Smplr | null = null;
    try {
      const loader = sharedPianoLoader(ctx);
      voice = SplendidGrandPiano(ctx, { destination: this.voiceGainNode, loader });
      piano = SplendidGrandPiano(ctx, { destination: this.pianoGainNode, loader });
      input = SplendidGrandPiano(ctx, { destination: this.voiceGainNode, loader });
      await Promise.all([voice.ready, piano.ready, input.ready]);
      // Dispose an instrument that completed after this engine moved to a new
      // context. Without this guard, a late load could resurrect audio after
      // `dispose()` and retain the old context graph.
      if (this.loadGeneration !== generation || this.ctx !== ctx) {
        input.dispose();
        voice.dispose();
        piano.dispose();
        return;
      }
      this.inputPiano = input; input.setCC(64, 0);
      this.voicePiano = voice;
      this.piano = piano;
      this.pianoReady = true;
      this.loadLatencyMs = performance.now() - this.loadStartMs;
      // Sync pedal state now that the sampler can receive CC64.
      this.syncPedal();
      this.onReadinessChange?.();
    } catch (e) {
      input?.dispose();
      voice?.dispose();
      piano?.dispose();
      if (this.loadGeneration !== generation || this.ctx !== ctx) return;
      console.warn("[SamplerAudioEngine] sample loading failed; falling back to oscillator mode", e);
      this.pianoFailed = true;
      this.loadLatencyMs = performance.now() - this.loadStartMs;
      this.onReadinessChange?.();
    }
  }

  noteOn(n: TimedNote, when = 0): void {
    const ctx = this.ensure();
    if (this.samplePolicy === "wait" && !this.pianoReady && this.chosenTimbre === null) return;
    const t = ctx.currentTime + when;
    const instrument = n.fromInput ? this.inputPiano : n.hand === "L" ? this.piano : this.voicePiano;
    if (instrument && this.useSamples()) {
      instrument.start({ note: n.midi, time: t, duration: n.fromInput ? undefined : n.durSec, velocity: n.vel, ...(n.fromInput ? { stopId: `input:${n.midi}` } : {}) });
      return;
    }
    this.useSamples();
    // Samples not ready yet: use fallback oscillator for immediate response.
    this.fallback().noteOn(n, when);
  }

  private fallback(): AudioEngine {
    if (!this.fallbackEngine) {
      this.fallbackEngine = new AudioEngine();
      this.fallbackEngine.onStateChange = state => { if (this.playbackTimbre === "fallback") this.onStateChange?.(state); };
      this.fallbackEngine.setGains(this.voiceGain, this.pianoGain);
      this.fallbackEngine.sustainPedal = this.sustainPedal;
    }
    return this.fallbackEngine;
  }

  noteOff(midi: number): void {
    if (this.pianoReady) this.inputPiano?.stop({ stopId: `input:${midi}` });
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
    const click = { osc, gain };
    this.clicks.add(click);
    osc.onended = () => { this.clicks.delete(click); gain.disconnect(); };
  }

  playChord(midiNotes: number[], when: number, durationSec: number): void {
    if (!Number.isFinite(durationSec) || durationSec <= 0) return;
    const ctx = this.ensure();
    if (this.samplePolicy === "wait" && !this.pianoReady && this.chosenTimbre === null) return;
    if (this.piano && this.useSamples()) {
      const t = ctx.currentTime + when;
      for (const midi of [...new Set(midiNotes)]) {
        this.piano.start({ note: midi, time: t, duration: durationSec });
      }
      return;
    }
    this.useSamples();
    // Fallback chord synthesis mirrors AudioEngine.playChord behavior.
    this.fallback().playChord(midiNotes, when, durationSec);
  }

  cancelAll(): void {
    if (this.pianoReady) for (const instrument of [this.voicePiano, this.piano, this.inputPiano]) instrument?.stop();
    this.fallbackEngine?.cancelAll();
    const now = this.ctx?.currentTime ?? 0;
    for (const click of this.clicks) {
      try { click.osc.stop(now + 0.02); } catch {}
      click.gain.disconnect();
    }
    this.clicks.clear();
  }

  setGains(voice: number, piano: number): void {
    this.voiceGain = voice;
    this.pianoGain = piano;
    this.applyGains();
    this.fallbackEngine?.setGains(voice, piano);
  }

  /** Backward-compatible alias for callers that explicitly request a sync. */
  set sustainPedalSynced(value: boolean) { this.sustainPedal = value; }

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
    this.chosenTimbre = null;
    this.cancelAll();
    this.pianoReady = false;
    this.pianoFailed = false;
    if (this.inputPiano) {
      try { this.inputPiano.dispose(); } catch { /* already disposed */ }
      this.inputPiano = null;
    }
    if (this.piano) {
      try { this.piano.dispose(); } catch { /* already disposed */ }
      this.piano = null;
    }
    if (this.voicePiano) {
      try { this.voicePiano.dispose(); } catch { /* already disposed */ }
      this.voicePiano = null;
    }
    this.fallbackEngine?.dispose();
    this.fallbackEngine = null;
    if (this.ctx) { this.ctx.onstatechange = null; if (this.ctx.state !== "closed") void this.ctx.close(); }
    this.ctx = null;
    this.compressor = null;
  }
}
