import type { TimedNote } from "./timeline.js";

const NOTE_FREQ = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Piano-ish voice: three detuned oscillators through a bandpass-aware
 * filter chain.  The extra partials and slight detuning give warmth on
 * laptop/tablet speakers where a simple triangle+sine sounds thin.  A
 * soft-compressor on the master bus keeps the bass from booming on small
 * drivers while preserving dynamics on headphones.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private master: GainNode | null = null;
  private voiceGainNode: GainNode | null = null;
  private pianoGainNode: GainNode | null = null;
  private active = new Map<number, { osc: OscillatorNode; gain: GainNode }[]>();
  private activeChords = new Set<{ osc: OscillatorNode; gain: GainNode }>();
  private activeClicks = new Set<{ osc: OscillatorNode; gain: GainNode }>();
  private visibilityHandler: (() => void) | null = null;

  voiceGain = 1;
  pianoGain = 0.4;
  /** Simulated pedal ring after the written duration (see PlayerSettings). */
  sustainPedal = true;

  ensure(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext();
      // Soft compressor prevents bass notes from clipping small speakers
      // while leaving quiet passages untouched.
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
    return this.ctx;
  }

  /** Start listening for tab visibility changes to suspend/resume audio. */
  startVisibilityTracking(): void {
    if (this.visibilityHandler) return;
    this.visibilityHandler = () => {
      if (!this.ctx || this.ctx.state === "closed") return;
      if (document.hidden) {
        this.ctx.suspend().catch(() => {});
      } else {
        this.ctx.resume().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  /** Stop listening for tab visibility changes. */
  stopVisibilityTracking(): void {
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  setGains(voice: number, piano: number): void {
    this.voiceGain = voice;
    this.pianoGain = piano;
    this.applyGains();
  }

  private applyGains(): void {
    if (this.ctx && this.voiceGainNode && this.pianoGainNode) {
      this.voiceGainNode.gain.setTargetAtTime(this.voiceGain, this.ctx.currentTime, 0.02);
      this.pianoGainNode.gain.setTargetAtTime(this.pianoGain, this.ctx.currentTime, 0.02);
    }
  }

  /** Which gain bus a note should use. */
  private busFor(n: TimedNote): GainNode | null {
    return n.hand === "L" ? this.pianoGainNode : this.voiceGainNode;
  }

  noteOn(n: TimedNote, when = 0): void {
    const ctx = this.ensure();
    const t = ctx.currentTime + when;
    const bus = this.busFor(n);
    if (!bus) return;
    const freq = NOTE_FREQ(n.midi);

    // --- Three-oscillator voice ---
    // osc1: main tone (triangle) — body of the note
    // osc2: second partial (sine at 2x) — adds brightness without shrillness
    // osc3: slight detune (triangle at 1x, ~3 cents sharp) — chorus warmth
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const osc3 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc1.type = "triangle";
    osc2.type = "sine";
    osc3.type = "triangle";
    osc1.frequency.value = freq;
    // Slight detune (~3 cents) on the third oscillator for chorus warmth.
    osc3.frequency.value = freq * Math.pow(2, 3 / 1200);

    const isSubBass = n.midi < 36;
    const isLow = n.midi < 48;
    const isMid = n.midi >= 48 && n.midi <= 72;
    const isHigh = n.midi > 72;

    // High partial for harmonic richness. Low notes use 3x to avoid the
    // inaudible fundamental-doubling problem on small speakers.
    osc2.frequency.value = isSubBass ? freq * 4 : isLow ? freq * 3 : freq * 2;

    filter.type = "lowpass";
    // Velocity-aware cutoff: quiet notes are mellower, loud notes brighter.
    // Raise the floor so mid-range notes don't sound muffled on laptop speakers.
    const baseCutoff = isHigh ? 1200 : isMid ? 1000 : 800;
    filter.frequency.value = baseCutoff + n.vel * (isHigh ? 18 : 22);
    filter.Q.value = isHigh ? 0.8 : 1.2; // gentle resonance for body

    // Dynamic range curve (~10x range from softest to loudest).
    let peak = 0.01 + Math.pow(n.vel / 127, 1.5) * 0.25;
    // Mild bass presence, but not as aggressive — the compressor handles the rest.
    if (isSubBass) peak *= 1.3;
    else if (isLow) peak *= 1 + Math.max(0, 60 - n.midi) * 0.01;

    const decay = Math.max(0.06, n.durSec * 0.85);

    const osc2Gain = ctx.createGain();
    const osc3Gain = ctx.createGain();
    // osc3 (detune) mixed in gently — more for mid-range warmth, less for extremes.
    osc3Gain.gain.value = isMid ? 0.35 : isLow ? 0.2 : 0.15;
    osc2Gain.gain.value = isSubBass ? 1.6 : isLow ? 1.1 : isHigh ? Math.max(0.3, 1 - (n.midi - 72) * 0.02) : 1;

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.005);
    if (n.durSec < 0.2) {
      // Staccato notes: sharp falloff instead of a 4x-too-long tail.
      gain.gain.setTargetAtTime(0, t + 0.005, 0.015);
    } else if (this.sustainPedal) {
      // Quiet pedal ring after the decay so notes don't cut mechanically.
      gain.gain.exponentialRampToValueAtTime(peak * 0.05, t + decay * 0.7);
      gain.gain.setTargetAtTime(peak * 0.03, t + decay * 0.7, 0.15);
    } else {
      gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
    }
    osc1.connect(filter);
    osc2.connect(osc2Gain);
    osc2Gain.connect(filter);
    osc3.connect(osc3Gain);
    osc3Gain.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    osc1.start(t);
    osc2.start(t);
    osc3.start(t);
    // ponytail: sustain tail scales with note length so short notes don't ring
    // 3x their written duration; cap at 0.6s for long notes.
    const tail = this.sustainPedal && n.durSec >= 0.2 ? Math.min(0.6, n.durSec * 0.4) : 0.05;
    const stopAt = t + decay + tail;
    osc1.stop(stopAt);
    osc2.stop(stopAt);
    osc3.stop(stopAt);
    const entry = { osc: osc1, gain };
    const list = this.active.get(n.midi) ?? [];
    list.push(entry);
    this.active.set(n.midi, list);
    osc1.onended = () => {
      const arr = this.active.get(n.midi);
      if (arr) {
        const i = arr.indexOf(entry);
        if (i >= 0) arr.splice(i, 1);
        if (arr.length === 0) this.active.delete(n.midi);
      }
      gain.disconnect();
    };
  }

  /** Stop any sounding note at this pitch (input-driven playback). */
  noteOff(midi: number): void {
    const arr = this.active.get(midi);
    if (!arr) return;
    const t = this.ctx?.currentTime ?? 0;
    for (const e of arr) {
      try {
        e.gain.gain.cancelScheduledValues(t);
        e.gain.gain.setTargetAtTime(0, t, 0.03);
        e.osc.stop(t + 0.12);
      } catch {}
    }
    this.active.delete(midi);
  }

  /** Silence everything without closing the context (loop wraps, pause). */
  cancelAll(): void {
    const t = this.ctx?.currentTime ?? 0;
    for (const [, entries] of this.active) {
      for (const e of entries) {
        try {
          e.gain.gain.cancelScheduledValues(t);
          e.gain.gain.setTargetAtTime(0, t, 0.01);
          e.osc.stop(t + 0.05);
        } catch {}
      }
    }
    this.active.clear();
    this.cancelChords();
    this.cancelClicks();
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
    const entry = { osc, gain };
    this.activeClicks.add(entry);
    osc.onended = () => {
      this.activeClicks.delete(entry);
      gain.disconnect();
    };
  }

  /**
   * Synthesize an explicit-MIDI chord used by chord-mode background.
   *
   * Notes are sorted and exact duplicate MIDI numbers are collapsed at the
   * audio boundary as a defensive guarantee for direct callers. Distinct
   * octaves remain separate voices. Cancellation remains global via
   * cancelAll(); this method does not promise per-voice identity.
   */
  playChord(midiNotes: number[], when: number, durationSec: number): void {
    const ctx = this.ensure();
    if (!this.pianoGainNode) return;
    const t = ctx.currentTime + when;
    const duration = Math.max(0.2, Math.min(8, durationSec));
    // Keep exact octave doublings but avoid creating duplicate oscillators for
    // the same MIDI number. Sorting makes direct and engine callers agree on
    // a deterministic handoff without changing the voicing itself.
    const notes = [...new Set(midiNotes)].sort((a, b) => a - b);
    for (const midi of notes) {
      const freq = NOTE_FREQ(midi);
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      // Two-oscillator chord voice: triangle body + sine overtone for warmth.
      osc1.type = "triangle";
      osc1.frequency.value = freq;
      osc2.type = "sine";
      osc2.frequency.value = freq * 2;
      filter.type = "lowpass";
      filter.frequency.value = 1400;
      filter.Q.value = 0.7;
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.pianoGainNode);
      osc1.start(t);
      osc2.start(t);
      const entry = { osc: osc1, gain };
      this.activeChords.add(entry);
      osc1.onended = () => {
        this.activeChords.delete(entry);
        gain.disconnect();
      };
      osc1.stop(t + duration + 0.1);
      osc2.stop(t + duration + 0.1);
    }
  }

  private cancelChords(): void {
    const t = this.ctx?.currentTime ?? 0;
    for (const entry of this.activeChords) {
      try {
        entry.gain.gain.cancelScheduledValues(t);
        entry.gain.gain.setTargetAtTime(0, t, 0.02);
        entry.osc.stop(t + 0.05);
      } catch {
        // An oscillator may have ended between iteration and cancellation.
      }
    }
    this.activeChords.clear();
  }

  private cancelClicks(): void {
    const t = this.ctx?.currentTime ?? 0;
    for (const entry of this.activeClicks) {
      try {
        entry.gain.gain.cancelScheduledValues(t);
        entry.gain.gain.setTargetAtTime(0, t, 0.01);
        entry.osc.stop(t + 0.02);
      } catch {
        // A short click may have ended between iteration and cancellation.
      }
    }
    this.activeClicks.clear();
  }

  dispose(): void {
    this.stopVisibilityTracking();
    this.cancelChords();
    this.cancelClicks();
    if (this.ctx && this.ctx.state !== "closed") {
      void this.ctx.close();
    }
    this.ctx = null;
    this.compressor = null;
  }
}

