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

  voiceGain = 1;
  pianoGain = 0.4;

  ensure(): AudioContext {
    if (!this.ctx) {
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
    osc2.frequency.value = freq * 2;
    filter.type = "lowpass";
    filter.frequency.value = 2200 + n.vel * 8;
    const peak = 0.06 + (n.vel / 127) * 0.12;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.15, n.durSec * 0.9));
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(bus);
    osc1.start(t);
    osc2.start(t);
    const stopAt = t + Math.max(0.2, n.durSec) + 0.1;
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
  }

  /** Synthesize a chord (pitch classes) — used by chord-mode background. */
  playChord(pcs: number[], bassMidi: number, when = 0): void {
    const ctx = this.ensure();
    if (!this.pianoGainNode) return;
    const t = ctx.currentTime + when;
    for (const pc of pcs) {
      let midi = bassMidi + ((pc - (bassMidi % 12) + 12) % 12);
      if (midi < bassMidi) midi += 12;
      if (midi > bassMidi + 24) midi -= 12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = NOTE_FREQ(midi);
      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
      osc.connect(gain);
      gain.connect(this.pianoGainNode);
      osc.start(t);
      osc.stop(t + 1.3);
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
