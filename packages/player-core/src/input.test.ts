import { afterEach, describe, expect, it } from "vitest";
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
