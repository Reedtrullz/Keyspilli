export interface InputCallbacks {
  onNoteOn: (midi: number, identity?: string) => void;
  onNoteOff: (midi: number, identity?: string) => void;
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

  constructor(private cb: InputCallbacks, private onOctaveChange?: (octave: number) => void) {}

  setOctave(value: number): void {
    const next = Math.min(4, Math.max(0, Math.trunc(value)));
    if (!Number.isFinite(next) || next === this.octave) return;
    this.octave = next;
    this.onOctaveChange?.(next);
  }

  releaseAll(): void {
    for (const key of this.down) {
      const midi = this.heldNotes.get(KEYMAP[key]!);
      if (midi !== undefined) this.cb.onNoteOff(midi, `key:${key}`);
    }
    this.down.clear(); this.heldNotes.clear();
  }

  handleKey(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (k === "z" || k === "x") {
      if (e.type === "keydown" && !e.repeat) this.setOctave(this.octave + (k === "z" ? -1 : 1));
      return;
    }
    const base = KEYMAP[k];
    if (base === undefined) return;
    e.preventDefault();
    if (e.type === "keydown" && !e.repeat && !this.down.has(k)) {
      this.down.add(k);
      const effective = base + (this.octave - 2) * 12;
      this.heldNotes.set(base, effective);
      this.cb.onNoteOn(effective, `key:${k}`);
    } else if (e.type === "keyup" && this.down.has(k)) {
      this.down.delete(k);
      const physicalBase = base;
      const effective =
        this.heldNotes.get(physicalBase) ?? base + (this.octave - 2) * 12;
      this.heldNotes.delete(physicalBase);
      this.cb.onNoteOff(effective, `key:${k}`);
    }
  }
}

export function midiSupported(): boolean {
  return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
}

export class MidiInput {
  private handlers = new Map<string, { input: MIDIInput; handler: (e: MIDIMessageEvent) => void }>();
  private access: MIDIAccess | undefined;
  private pending: Promise<boolean> | undefined;
  private generation = 0;
  private held = new Map<string, { midi: number; device: string }>();

  constructor(private cb: InputCallbacks) {}

  connect(): Promise<boolean> {
    if (this.access) return Promise.resolve(this.handlers.size > 0);
    if (this.pending) return this.pending;
    if (!midiSupported()) return Promise.resolve(false);
    const generation = this.generation;
    this.pending = navigator.requestMIDIAccess().then(access => {
      if (generation !== this.generation) return false;
      this.access = access;
      access.onstatechange = () => this.rescan();
      this.rescan();
      return this.handlers.size > 0;
    }).catch(() => false).finally(() => {
      if (generation === this.generation) this.pending = undefined;
    });
    return this.pending;
  }

  releaseAll(device?: string): void {
    for (const [identity, note] of this.held) {
      if (device !== undefined && note.device !== device) continue;
      this.cb.onNoteOff(note.midi, identity);
      this.held.delete(identity);
    }
  }

  get connectedCount(): number {
    return this.handlers.size;
  }

  /** Remove all MIDI message handlers (call when the consumer unmounts). */
  disconnect(): void {
    this.generation++; this.pending = undefined;
    this.releaseAll();
    for (const { input } of this.handlers.values()) input.onmidimessage = null;
    this.handlers.clear();
    if (this.access) this.access.onstatechange = null;
    this.access = undefined;
  }

  private makeHandler(device: string): (e: MIDIMessageEvent) => void {
    return (e) => {
      if (!e.data) return;
      const [status, note, vel] = e.data;
      if (status === undefined || note === undefined || vel === undefined) return;
      const identity = `midi:${device}:${status & 0x0f}:${note}`;
      if ((status & 0xf0) === 0x90 && vel > 0) {
        this.held.set(identity, { midi: note, device });
        this.cb.onNoteOn(note, identity);
      } else if ((status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && vel === 0)) {
        this.held.delete(identity);
        this.cb.onNoteOff(note, identity);
      }
    };
  }

  private attach(input: MIDIInput): void {
    const previous = this.handlers.get(input.id);
    if (previous?.input === input) return;
    if (previous) { this.releaseAll(input.id); previous.input.onmidimessage = null; }
    const handler = this.makeHandler(input.id);
    input.onmidimessage = handler;
    this.handlers.set(input.id, { input, handler });
  }

  /** Re-sync handlers when devices appear or disappear (hotplug). */
  private rescan(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      if ("onmidimessage" in input && input.state !== "disconnected") this.attach(input);
    }
    const currentInputs = [...this.access.inputs.values()];
    for (const [id, entry] of this.handlers) {
      // Match by id first; fall back to identity so mocks without ids stay stable.
      if (entry.input.state === "disconnected" || (!this.access.inputs.has(id) && !currentInputs.includes(entry.input))) {
        this.releaseAll(id);
        entry.input.onmidimessage = null;
        this.handlers.delete(id);
      }
    }
  }
}
