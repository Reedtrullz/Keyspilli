import type { TimedNote } from "./timeline.js";

const NOTE_FREQ = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Minimal piano-ish voice: two oscillators with fast attack + exponential
 * decay through a lowpass filter. Good enough for practice playback.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
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
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
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
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc1.type = "triangle";
    osc2.type = "sine";
    osc1.frequency.value = freq;
    // Low notes get overtones instead of a doubled fundamental (inaudible on
    // small speakers); high notes get a damped second partial (less shrill).
    const isSubBass = n.midi < 36;
    const isLow = n.midi < 48;
    const isHigh = n.midi > 84;
    osc2.frequency.value = isSubBass ? freq * 4 : isLow ? freq * 3 : freq * 2;
    filter.type = "lowpass";
    // Velocity sweep: quiet notes are duller, loud notes brighter; high notes tamed.
    filter.frequency.value = isHigh ? 800 + n.vel * 10 : 800 + n.vel * 25;
    // Dynamic range curve (~10x range from softest to loudest).
    let peak = 0.01 + Math.pow(n.vel / 127, 1.5) * 0.25;
    if (isSubBass) peak *= 1.8;
    else if (isLow) peak *= 1 + Math.max(0, 60 - n.midi) * 0.02; // bass presence
    const decay = Math.max(0.06, n.durSec * 0.85);
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = isSubBass ? 2.0 : isLow ? 1.2 : isHigh ? Math.max(0.2, 1 - (n.midi - 84) * 0.04) : 1;
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
    filter.connect(gain);
    gain.connect(bus);
    osc1.start(t);
    osc2.start(t);
    // ponytail: sustain tail scales with note length so short notes don't ring
    // 3× their written duration; cap at 0.6s for long notes.
    const tail = this.sustainPedal && n.durSec >= 0.2 ? Math.min(0.6, n.durSec * 0.4) : 0.05;
    const stopAt = t + decay + tail;
    osc1.stop(stopAt);
    osc2.stop(stopAt);
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
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = NOTE_FREQ(midi);
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(gain);
      gain.connect(this.pianoGainNode);
      osc.start(t);
      const entry = { osc, gain };
      this.activeChords.add(entry);
      osc.onended = () => {
        this.activeChords.delete(entry);
        gain.disconnect();
      };
      osc.stop(t + duration + 0.1);
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
  }
}
