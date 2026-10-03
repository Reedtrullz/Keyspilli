import { afterEach, expect, it, vi } from "vitest";
import { AudioEngine } from "../src/audio.js";

class Param {
  value = 0;
  setValueAtTime() {}
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
  setTargetAtTime() {}
  cancelScheduledValues() {}
}
class Node {
  connections: unknown[] = [];
  gain = new Param();
  frequency = new Param();
  Q = new Param();
  threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
  connect(target: unknown) { this.connections.push(target); }
  disconnect() {}
}
class Oscillator extends Node {
  stops: number[] = [];
  onended: (() => void) | null = null;
  start() {}
  stop(time: number) { this.stops.push(time); }
}
class Context {
  static last: Context;
  state: AudioContextState = "running";
  currentTime = 0;
  destination = new Node();
  oscillators: Oscillator[] = [];
  gains: Node[] = [];
  constructor() { Context.last = this; }
  createGain() { const gain = new Node(); this.gains.push(gain); return gain; }
  createDynamicsCompressor() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createOscillator() { const osc = new Oscillator(); this.oscillators.push(osc); return osc; }
  resume() { return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
}

afterEach(() => vi.unstubAllGlobals());

it.each([true, false])("holds physical input until release with sustain=%s, while scheduled notes remain bounded", pedal => {
  vi.stubGlobal("AudioContext", Context);
  const engine = new AudioEngine();
  engine.sustainPedal = pedal;
  engine.noteOn({ midi: 60, startSec: 0, durSec: 0.4, vel: 100, hand: "R", fromInput: true });
  const ctx = Context.last;
  expect(ctx.oscillators.slice(0, 3).every(osc => osc.stops.length === 0)).toBe(true);
  ctx.currentTime = 1; // physical key is still down beyond the old 0.6s cutoff
  engine.noteOn({ midi: 62, startSec: 0, durSec: 0.4, vel: 80, hand: "L" });
  expect(ctx.oscillators.slice(3, 6).every(osc => osc.stops.length === 1)).toBe(true);
  expect(ctx.gains[3]!.connections[0]).toBe(ctx.gains[1]);
  expect(ctx.gains[6]!.connections[0]).toBe(ctx.gains[2]);
  engine.noteOff(60);
  expect(ctx.oscillators.slice(0, 3).every(osc => osc.stops.length === 1 && osc.stops[0]! > 1)).toBe(true);
  engine.cancelAll();
  engine.noteOn({ midi: 64, startSec: 0, durSec: 0.4, vel: 100, hand: "R", fromInput: true });
  expect(ctx.oscillators.slice(6, 9).every(osc => osc.stops.length === 0)).toBe(true);
  engine.dispose(); // instrument switch releases the held voice
  expect(ctx.oscillators.slice(6, 9).every(osc => osc.stops.length === 1)).toBe(true);
  expect(ctx.state).toBe("closed");
});

it("releases repeated-pitch physical input without stealing a scheduled note", () => {
  vi.stubGlobal("AudioContext", Context);
  const engine = new AudioEngine();
  engine.noteOn({ midi: 60, startSec: 0, durSec: 2, vel: 80, hand: "R" });
  engine.noteOn({ midi: 60, startSec: 0, durSec: 0.4, vel: 100, hand: "R", fromInput: true });
  const ctx = Context.last;
  engine.noteOff(60);
  expect(ctx.oscillators.slice(0, 3).every(osc => osc.stops.length === 1)).toBe(true);
  expect(ctx.oscillators.slice(3, 6).every(osc => osc.stops.length === 1)).toBe(true);
  engine.dispose();
});

it("reports AudioContext interruption without a transport frame and stops observing on disposal", () => {
  vi.stubGlobal("AudioContext", Context);
  const audio = new AudioEngine(), states: string[] = [];
  audio.onStateChange = state => states.push(state);
  const context = audio.ensure();
  Context.last.state = "suspended";
  context.onstatechange?.(new Event("statechange"));
  expect(states).toEqual(["suspended"]);
  audio.dispose();
  expect(context.onstatechange).toBeNull();
});
