import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@keyspilli/player-core";
import { FallingCanvas } from "./FallingCanvas";

const hooks = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  refs: 0,
  canvas: {} as Record<string, unknown>,
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: (value: unknown) => ({ current: hooks.refs++ === 0 ? hooks.canvas : value }),
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));
afterEach(() => { vi.unstubAllGlobals(); hooks.effects = []; hooks.refs = 0; });

it("redraws a paused height-only resize in CSS pixels with a DPR backing store", () => {
  const fillText = vi.fn();
  const strokeRect = vi.fn();
  const measureText = vi.fn((text: string) => ({ width: text.length * 7 }));
  const timeRef = { current: 0 };
  const ctx = new Proxy({ fillText, strokeRect, measureText }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : vi.fn(),
  });
  hooks.canvas = { clientWidth: 390, clientHeight: 400, width: 0, height: 0, getContext: () => ctx };
  let resize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const raf = vi.fn();
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("window", { devicePixelRatio: 2, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  FallingCanvas({
    notes: [{ midi: 61, startSec: 0, durSec: 0.5, vel: 80 }],
    time: 0, timeRef, playing: false, settings: DEFAULT_SETTINGS, pressedKeys: new Map(),
    chords: [{ beat: 0, name: "C", notes: [60] }, { beat: 20, name: "F#maj7/C#", notes: [61, 65, 68] }],
    tempoBpm: 120, lowMidi: 21, highMidi: 108, loop: null,
  });
  const cleanups = hooks.effects.map((effect) => effect());
  expect(hooks.canvas.width).toBe(780);
  expect(hooks.canvas.height).toBe(800);
  const firstKeyX = strokeRect.mock.calls[0]![0];
  strokeRect.mockClear();
  timeRef.current = 10;
  resize();
  expect(strokeRect.mock.calls[0]![0]).toBe(firstKeyX);
  expect(measureText.mock.calls.filter(([label]) => label === "F#maj7/C#")).toHaveLength(1);
  hooks.canvas.clientHeight = 520;
  resize();
  expect(hooks.canvas.width).toBe(780);
  expect(hooks.canvas.height).toBe(1040);
  expect(raf).not.toHaveBeenCalled();
  expect(fillText.mock.calls.some(([label]) => /^\d+\.\ds$/.test(label))).toBe(false);
  // The narrow 88-key lane cannot hold a label; the separate cue identifies it.
  expect(fillText.mock.calls.some(([label]) => label.startsWith("R C#"))).toBe(true);
  for (const cleanup of cleanups) cleanup?.();
  expect(disconnect).toHaveBeenCalledOnce();
});

it("clears chord guide markers at the exact chord end and restores them for the next event", () => {
  const arc = vi.fn();
  const ctx = new Proxy({ arc, measureText: (text: string) => ({ width: text.length * 7 }) }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : vi.fn(),
  });
  hooks.canvas = { clientWidth: 880, clientHeight: 400, width: 0, height: 0, getContext: () => ctx };
  let redraw = () => {};
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { redraw = callback; } observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("window", { devicePixelRatio: 1, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const timeRef = { current: 0 };
  const settings = { ...DEFAULT_SETTINGS, chordKeys: true };
  FallingCanvas({ notes: [], time: 0, timeRef, playing: false, settings, pressedKeys: new Map(),
    chords: [{ beat: 0, durationBeats: 2, name: "C", notes: [60, 61] }, { beat: 4, name: "G", notes: [67] }],
    tempoBpm: 120, lowMidi: 48, highMidi: 84, loop: null });
  const cleanups = hooks.effects.map((effect) => effect());
  arc.mockClear(); redraw(); expect(arc).toHaveBeenCalledTimes(2);
  arc.mockClear(); timeRef.current = 1; redraw(); expect(arc).not.toHaveBeenCalled();
  arc.mockClear(); timeRef.current = 2; redraw(); expect(arc).toHaveBeenCalledTimes(1);
  arc.mockClear(); settings.chordKeys = false; redraw(); expect(arc).not.toHaveBeenCalled();
  for (const cleanup of cleanups) cleanup?.();
});
