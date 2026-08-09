export interface InputCallbacks {
  onNoteOn: (midi: number) => void;
  onNoteOff: (midi: number) => void;
}

/** Computer-keyboard mapping: row keys = white keys, top row = black keys. */
export const KEYMAP: Record<string, number> = {
  a: 60,
  w: 61,
  s: 62,
  e: 63,
  d: 64,
  f: 65,
  t: 66,
  g: 67,
  y: 68,
  h: 69,
  u: 70,
  j: 71,
  k: 72,
  o: 73,
  l: 74,
  p: 75,
  ";": 76,
};

export class KeyboardInput {
  private down = new Set<string>();
  octave = 2; // base octave offset from middle C

  constructor(private cb: InputCallbacks) {}

  handleKey(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (k === "z") {
      this.octave = Math.max(0, this.octave - 1);
      return;
    }
    if (k === "x") {
      this.octave = Math.min(4, this.octave + 1);
      return;
    }
    const base = KEYMAP[k];
    if (base === undefined) return;
    e.preventDefault();
    if (e.type === "keydown" && !e.repeat && !this.down.has(k)) {
      this.down.add(k);
      this.cb.onNoteOn(base + (this.octave - 2) * 12);
    } else if (e.type === "keyup" && this.down.has(k)) {
      this.down.delete(k);
      this.cb.onNoteOff(base + (this.octave - 2) * 12);
    }
  }
}

export function midiSupported(): boolean {
  return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
}

export class MidiInput {
  private inputs: MIDIInput[] = [];

  constructor(private cb: InputCallbacks) {}

  async connect(): Promise<boolean> {
    if (!midiSupported()) return false;
    try {
      const access = await navigator.requestMIDIAccess();
      this.inputs = [...access.inputs.values()];
      for (const input of this.inputs) {
        input.onmidimessage = (e) => {
          if (!e.data) return;
          const [status, note, vel] = e.data;
          if (status === undefined || note === undefined || vel === undefined) return;
          if ((status & 0xf0) === 0x90 && vel > 0) this.cb.onNoteOn(note);
          else if ((status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && vel === 0)) this.cb.onNoteOff(note);
        };
      }
      return this.inputs.length > 0;
    } catch {
      return false;
    }
  }

  get connectedCount(): number {
    return this.inputs.length;
  }
}
