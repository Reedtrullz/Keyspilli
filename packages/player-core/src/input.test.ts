import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./prefs.js";
import type { AudioLike } from "./engine.js";
import type { TimedNote } from "./timeline.js";
import { PlaybackEngine } from "./engine.js";
import { KeyboardInput, MidiInput } from "./input.js";

type MidiHandler = (e: { data?: Uint8Array }) => void;

interface FakeMidiInput {
  id: string;
  onmidimessage: MidiHandler | null;
}

function makeAccess(inputs: Map<string, FakeMidiInput>) {
  return {
    inputs,
    onstatechange: null as (() => void) | null,
    requestMIDIAccess: async () => access,
  };
}

let access: ReturnType<typeof makeAccess>;

function installNavigator(inputs: FakeMidiInput[]) {
  const map = new Map(inputs.map((i) => [i.id, i]));
  access = makeAccess(map);
  const real = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { requestMIDIAccess: async () => access },
    configurable: true,
    writable: true,
  });
  return () => {
    if (real) {
      Object.defineProperty(globalThis, "navigator", real);
    }
  };
}

afterEach(() => {
  if (access) access.onstatechange = null;
});

describe("KeyboardInput octave tracking", () => {
  it("releases the effective pitch pressed before an octave shift", () => {
    const events: string[] = [];
    const ki = new KeyboardInput({
      onNoteOn: (m) => events.push(`on:${m}`),
      onNoteOff: (m) => events.push(`off:${m}`),
    });
    const key = (type: string) =>
      ({ key: "a", type, repeat: false, preventDefault: () => {} }) as unknown as KeyboardEvent;

    ki.handleKey(key("keydown"));
    ki.setOctave(3);
    ki.handleKey(key("keyup"));
    expect(events).toEqual(["on:60", "off:60"]);

    // New presses use the new octave.
    ki.handleKey(key("keydown"));
    expect(events).toEqual(["on:60", "off:60", "on:72"]);
    ki.setOctave(2);
    ki.handleKey(key("keyup"));
    expect(events).toEqual(["on:60", "off:60", "on:72", "off:72"]);
  });
});

describe("MidiInput lifecycle", () => {
  it("legacy shape: input without id still counts as connected", async () => {
    const input = { onmidimessage: null } as unknown as FakeMidiInput;
    const restore = installNavigator([input]);
    try {
      const mi = new MidiInput({ onNoteOn: () => {}, onNoteOff: () => {} });
      expect(await mi.connect()).toBe(true);
      expect(mi.connectedCount).toBe(1);
      mi.disconnect();
      expect(input.onmidimessage).toBeNull();
    } finally {
      restore();
    }
  });

  it("connect is idempotent and does not leak duplicate handlers", async () => {
    const input: FakeMidiInput = { id: "in-a", onmidimessage: null };
    const restore = installNavigator([input]);
    try {
      const mi = new MidiInput({ onNoteOn: () => {}, onNoteOff: () => {} });
      expect(await mi.connect()).toBe(true);
      const firstHandler = input.onmidimessage;
      expect(firstHandler).not.toBeNull();
      expect(await mi.connect()).toBe(true);
      expect(input.onmidimessage).toBe(firstHandler);
      expect(mi.connectedCount).toBe(1);
    } finally {
      restore();
    }
  });

  it("statechange attaches newly connected inputs and detaches removed ones", async () => {
    const a: FakeMidiInput = { id: "in-a", onmidimessage: null };
    const restore = installNavigator([a]);
    const notes: number[][] = [];
    try {
      const mi = new MidiInput({
        onNoteOn: (m) => notes.push([m]),
        onNoteOff: (m) => notes.push([-1]),
      });
      await mi.connect();
      expect(mi.connectedCount).toBe(1);

      const b: FakeMidiInput = { id: "in-b", onmidimessage: null };
      access.inputs.set(b.id, b);
      access.onstatechange?.();
      expect(mi.connectedCount).toBe(2);
      expect(b.onmidimessage).not.toBeNull();

      access.inputs.delete(a.id);
      access.onstatechange?.();
      expect(mi.connectedCount).toBe(1);
      expect(a.onmidimessage).toBeNull();
      expect(b.onmidimessage).not.toBeNull();

      b.onmidimessage!({ data: new Uint8Array([0x90, 64, 100]) });
      expect(notes.at(-1)).toEqual([64]);
    } finally {
      restore();
    }
  });

  it("disconnect removes all per-input handlers and clears onstatechange", async () => {
    const a: FakeMidiInput = { id: "in-a", onmidimessage: null };
    const b: FakeMidiInput = { id: "in-b", onmidimessage: null };
    const restore = installNavigator([a, b]);
    try {
      const mi = new MidiInput({ onNoteOn: () => {}, onNoteOff: () => {} });
      await mi.connect();
      expect(mi.connectedCount).toBe(2);
      mi.disconnect();
      expect(a.onmidimessage).toBeNull();
      expect(b.onmidimessage).toBeNull();
      expect(mi.connectedCount).toBe(0);

      // Reconnect works after disconnect.
      expect(await mi.connect()).toBe(true);
      expect(mi.connectedCount).toBe(2);
      expect(a.onmidimessage).not.toBeNull();
    } finally {
      restore();
    }
  });
});

class ReconnectAudio implements AudioLike {
  noteOns: { midi: number; fromInput?: boolean }[] = [];
  noteOffs: number[] = [];
  ensured = 0;
  cancelled = 0;
  clicks: number[] = [];
  ensure(): unknown { this.ensured++; return {}; }
  noteOn(n: TimedNote, when = 0): void { void when; this.noteOns.push({ midi: n.midi, fromInput: n.fromInput }); }
  noteOff(midi: number): void { this.noteOffs.push(midi); }
  metronomeClick(beat: number): void { void beat; }
  cancelAll(): void { this.cancelled++; }
  setGains(): void {}
  dispose(): void {}
  sustainPedal = true;
}

describe("MIDI reconnect held-note release through the engine", () => {
  it("releases a pressed note after adapter disconnect and reconnect without stale state", async () => {
    // Mirror Player.tsx: the owner tracks pressed keys; MidiInput only forwards events.
    const pressed = new Map<number, number>();
    const audio = new ReconnectAudio();
    const eng = new PlaybackEngine(audio, [], 10, { tempoBpm: 120, timeSig: [4, 4] }, { ...DEFAULT_SETTINGS });
    let tick = 0;
    const mi = new MidiInput({
      onNoteOn: (m) => { eng.handleNoteOn(m); pressed.set(m, ++tick); },
      onNoteOff: (m) => { eng.handleNoteOff(m); pressed.delete(m); },
    });

    const input: FakeMidiInput = { id: "in-a", onmidimessage: null };
    const restore = installNavigator([input]);
    try {
      expect(await mi.connect()).toBe(true);

      // Press and release C4 over the first connection.
      input.onmidimessage!({ data: new Uint8Array([0x90, 64, 100]) });
      expect(pressed.has(64)).toBe(true);
      expect(audio.noteOns.at(-1)?.fromInput).toBe(true);
      input.onmidimessage!({ data: new Uint8Array([0x80, 64, 0]) });
      expect(pressed.has(64)).toBe(false);
      expect(audio.noteOffs.at(-1)).toBe(64);

      // Adapter disappears and returns as a fresh device.
      mi.disconnect();
      access.inputs.delete(input.id);
      expect(await mi.connect()).toBe(false); // access exists, but no device is attached yet
      const fresh: FakeMidiInput = { id: "in-b", onmidimessage: null };
      access.inputs.set(fresh.id, fresh);
      access.onstatechange?.();
      expect(mi.connectedCount).toBe(1);
      expect(pressed.size).toBe(0);

      // Same key press/release on the reconnected device stays consistent.
      fresh.onmidimessage!({ data: new Uint8Array([0x90, 64, 100]) });
      expect(pressed.has(64)).toBe(true);
      expect(audio.noteOns.filter((n) => n.fromInput).length).toBe(2);
      fresh.onmidimessage!({ data: new Uint8Array([0x80, 64, 0]) });
      expect(pressed.has(64)).toBe(false);
      expect(audio.noteOffs.at(-1)).toBe(64);
    } finally {
      restore();
    }
  });
});

it("notifies octave changes and releases held notes idempotently", () => {
  const events: string[] = [], octaves: number[] = [];
  const input = new KeyboardInput({ onNoteOn: m => events.push(`on:${m}`), onNoteOff: m => events.push(`off:${m}`) }, octave => octaves.push(octave));
  input.handleKey({ key: "a", type: "keydown", repeat: false, preventDefault() {} } as KeyboardEvent);
  input.setOctave(3); input.setOctave(3);
  input.releaseAll(); input.releaseAll();
  expect(events).toEqual(["on:60", "off:60"]);
  expect(octaves).toEqual([3]);
});

it("releases each MIDI device/channel owner on unplug and disconnect", async () => {
  const a: FakeMidiInput = { id: "a", onmidimessage: null };
  const b: FakeMidiInput = { id: "b", onmidimessage: null };
  const restore = installNavigator([a, b]);
  const released: string[] = [];
  try {
    const midi = new MidiInput({ onNoteOn() {}, onNoteOff: (_, id) => released.push(id!) });
    await midi.connect();
    for (const status of [0x90, 0x91]) a.onmidimessage!({ data: new Uint8Array([status, 60, 100]) });
    b.onmidimessage!({ data: new Uint8Array([0x90, 60, 100]) });
    access.inputs.delete("a"); access.onstatechange!();
    expect(released).toEqual(["midi:a:0:60", "midi:a:1:60"]);
    expect(midi.connectedCount).toBe(1);
    midi.disconnect();
    expect(released).toEqual(["midi:a:0:60", "midi:a:1:60", "midi:b:0:60"]);
  } finally { restore(); }
});

it("deduplicates permission requests and ignores permission granted after disconnect", async () => {
  const input: FakeMidiInput = { id: "a", onmidimessage: null };
  const restore = installNavigator([input]);
  try {
    let resolve!: (value: MIDIAccess) => void;
    Object.assign(navigator, { requestMIDIAccess: () => new Promise<MIDIAccess>(done => { resolve = done; }) });
    const midi = new MidiInput({ onNoteOn() {}, onNoteOff() {} });
    const pending = midi.connect();
    expect(midi.connect()).toBe(pending);
    midi.disconnect();
    resolve(access as unknown as MIDIAccess);
    expect(await pending).toBe(false);
    expect(input.onmidimessage).toBeNull();
    expect(midi.connectedCount).toBe(0);
  } finally { restore(); }
});

it("rebinds a replacement MIDI port with the same device id", async () => {
  const original: FakeMidiInput = { id: "a", onmidimessage: null };
  const replacement: FakeMidiInput = { id: "a", onmidimessage: null };
  const restore = installNavigator([original]);
  const events: string[] = [];
  try {
    const midi = new MidiInput({ onNoteOn: () => events.push("on"), onNoteOff: () => events.push("off") });
    await midi.connect();
    original.onmidimessage!({ data: new Uint8Array([0x90, 60, 100]) });
    access.inputs.set("a", replacement); access.onstatechange!();
    expect(events).toEqual(["on", "off"]);
    expect(original.onmidimessage).toBeNull();
    replacement.onmidimessage!({ data: new Uint8Array([0x90, 64, 100]) });
    expect(events).toEqual(["on", "off", "on"]);
    midi.disconnect();
  } finally { restore(); }
});

it("releases a shifted punctuation note when Shift is released before its physical key", () => {
  const events: string[] = [];
  const input = new KeyboardInput({ onNoteOn: midi => events.push(`on:${midi}`), onNoteOff: midi => events.push(`off:${midi}`) });
  input.handleKey({ key: ";", code: "Comma", type: "keydown", repeat: false, preventDefault() {} } as KeyboardEvent);
  input.handleKey({ key: ",", code: "Comma", type: "keyup", repeat: false, preventDefault() {} } as KeyboardEvent);
  expect(events).toEqual(["on:76", "off:76"]);
});
