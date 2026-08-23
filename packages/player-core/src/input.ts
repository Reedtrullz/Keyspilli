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
  // physical base midi -> effective midi captured at press time, so an octave
  // change while held releases the same pitch that was pressed.
  private heldNotes = new Map<number, number>();
  octave = 2; // base octave offset from middle C

  constructor(private cb: InputCallbacks) {}

  setOctave(value: number): void {
    this.octave = Math.min(4, Math.max(0, value));
  }

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
      const effective = base + (this.octave - 2) * 12;
      this.heldNotes.set(base, effective);
      this.cb.onNoteOn(effective);
    } else if (e.type === "keyup" && this.down.has(k)) {
      this.down.delete(k);
      const physicalBase = base;
      const effective =
        this.heldNotes.get(physicalBase) ?? base + (this.octave - 2) * 12;
      this.heldNotes.delete(physicalBase);
      this.cb.onNoteOff(effective);
    }
  }
}

export function midiSupported(): boolean {
  return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
}

export class MidiInput {
  private handlers = new Map<string, { input: MIDIInput; handler: (e: MIDIMessageEvent) => void }>();
  private access: MIDIAccess | undefined;

  constructor(private cb: InputCallbacks) {}

  async connect(): Promise<boolean> {
    if (this.access) return this.handlers.size > 0;
    if (!midiSupported()) return false;
    try {
      const access = await navigator.requestMIDIAccess();
      this.access = access;
      access.onstatechange = () => this.rescan();
      this.rescan();
      return this.handlers.size > 0;
    } catch {
      return false;
    }
  }

  get connectedCount(): number {
    return this.handlers.size;
  }

  /** Remove all MIDI message handlers (call when the consumer unmounts). */
  disconnect(): void {
    for (const { input } of this.handlers.values()) input.onmidimessage = null;
    this.handlers.clear();
    if (this.access) this.access.onstatechange = null;
    this.access = undefined;
  }

  private makeHandler(): (e: MIDIMessageEvent) => void {
    return (e) => {
      if (!e.data) return;
      const [status, note, vel] = e.data;
      if (status === undefined || note === undefined || vel === undefined) return;
      if ((status & 0xf0) === 0x90 && vel > 0) this.cb.onNoteOn(note);
      else if ((status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && vel === 0)) this.cb.onNoteOff(note);
    };
  }

  private attach(input: MIDIInput): void {
    if (this.handlers.has(input.id)) return;
    const handler = this.makeHandler();
    input.onmidimessage = handler;
    this.handlers.set(input.id, { input, handler });
  }

  /** Re-sync handlers when devices appear or disappear (hotplug). */
  private rescan(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      if ("onmidimessage" in input) this.attach(input);
    }
    const currentInputs = [...this.access.inputs.values()];
    for (const [id, entry] of this.handlers) {
      // Match by id first; fall back to identity so mocks without ids stay stable.
      if (!this.access.inputs.has(id) && !currentInputs.includes(entry.input)) {
        entry.input.onmidimessage = null;
        this.handlers.delete(id);
      }
    }
  }
}
