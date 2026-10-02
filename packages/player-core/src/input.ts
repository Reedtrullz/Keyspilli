export interface InputEventMetadata {
  timestampMs: number; timingSource: "event" | "dispatch"; velocity: number; deviceId?: string; channel?: number;
}
export function inputMetadata(event: { timeStamp?: number }, velocity: number, deviceId?: string, channel?: number): InputEventMetadata {
  const timestamp = event.timeStamp;
  const valid = typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0 && timestamp < 1e12;
  return { timestampMs: valid ? timestamp : performance.now(), timingSource: valid ? "event" : "dispatch", velocity, deviceId, channel };
}
export interface InputCallbacks {
  onNoteOn: (midi: number, identity?: string, event?: InputEventMetadata) => void;
  onNoteOff: (midi: number, identity?: string, event?: InputEventMetadata) => void;
  onStateChange?: () => void;
  onPedal?: (down: boolean, scope: string, event?: InputEventMetadata) => void;
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

/** Modified/composing attacks belong to the browser, OS or input method. */
export function isNativeKeyboardEvent(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey || e.altKey || e.isComposing;
}

export class KeyboardInput {
  // Capture pitch by physical key so octave/modifier changes cannot lose a release.
  private down = new Map<string, number>();
  octave = 2; // base octave offset from middle C

  constructor(private cb: InputCallbacks, private onOctaveChange?: (octave: number) => void) {}

  setOctave(value: number): void {
    const next = Math.min(4, Math.max(0, Math.trunc(value)));
    if (!Number.isFinite(next) || next === this.octave) return;
    this.octave = next;
    this.onOctaveChange?.(next);
  }

  releaseAll(): void {
    for (const [key, midi] of this.down) this.cb.onNoteOff(midi, `key:${key}`);
    this.down.clear();
  }

  handleKey(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    const physical = e.code || k;
    if (e.type === "keyup") {
      const midi = this.down.get(physical);
      if (midi !== undefined) { e.preventDefault(); this.down.delete(physical); this.cb.onNoteOff(midi, `key:${physical}`, inputMetadata(e, 0)); }
      return;
    }
    if (isNativeKeyboardEvent(e)) return;
    if (k === "z" || k === "x") {
      if (e.type === "keydown" && !e.repeat) this.setOctave(this.octave + (k === "z" ? -1 : 1));
      return;
    }
    const base = KEYMAP[k];
    if (base === undefined) return;
    e.preventDefault();
    if (e.type === "keydown" && !e.repeat && !this.down.has(physical)) {
      const effective = base + (this.octave - 2) * 12;
      this.down.set(physical, effective);
      this.cb.onNoteOn(effective, `key:${physical}`, inputMetadata(e, 100));
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
  private selectedDevice: string | null = null;
  private selectedChannel: number | null = null;
  private pedals = new Map<string, { device: string; event: InputEventMetadata }>();
  private held = new Map<string, { midi: number; device: string }>();

  constructor(private cb: InputCallbacks) {}

  connect(): Promise<boolean> {
    if (this.access) return Promise.resolve(this.connectedCount > 0);
    if (this.pending) return this.pending;
    if (!midiSupported()) return Promise.resolve(false);
    const generation = this.generation;
    this.pending = navigator.requestMIDIAccess().then(access => {
      if (generation !== this.generation) return false;
      this.access = access;
      access.onstatechange = () => this.rescan();
      this.rescan();
      return this.connectedCount > 0;
    }).catch(() => false).finally(() => {
      if (generation === this.generation) this.pending = undefined;
    });
    return this.pending;
  }

  select(device: string | null, channel: number | null): void {
    if (device !== null && (typeof device !== "string" || device.length > 256) || channel !== null && (!Number.isInteger(channel) || channel < 0 || channel > 15)) throw new RangeError("Invalid MIDI input selection");
    this.releaseAll(); this.selectedDevice = device; this.selectedChannel = channel; this.cb.onStateChange?.();
  }
  get devices(): Array<{ id: string; name: string }> {
    return [...this.handlers.entries()].map(([id, entry]) => ({ id, name: entry.input.name || "MIDI keyboard" }));
  }
  releaseAll(device?: string): void {
    for (const [scope, pedal] of this.pedals) {
      if (device !== undefined && pedal.device !== device) continue;
      this.cb.onPedal?.(false, scope, pedal.event); this.pedals.delete(scope);
    }
    for (const [identity, note] of this.held) {
      if (device !== undefined && note.device !== device) continue;
      this.cb.onNoteOff(note.midi, identity);
      this.held.delete(identity);
    }
  }

  get connectedCount(): number {
    return this.selectedDevice === null ? this.handlers.size : Number(this.handlers.has(this.selectedDevice));
  }

  /** Remove all MIDI message handlers (call when the consumer unmounts). */
  disconnect(): void {
    this.generation++; this.pending = undefined;
    this.releaseAll();
    for (const { input } of this.handlers.values()) input.onmidimessage = null;
    this.handlers.clear();
    if (this.access) this.access.onstatechange = null;
    this.access = undefined;
    this.cb.onStateChange?.();
  }

  private makeHandler(device: string): (e: MIDIMessageEvent) => void {
    return (e) => {
      if (!e.data) return;
      const [status, note, vel] = e.data;
      if (status === undefined || note === undefined || vel === undefined) return;
      const channel = status & 0x0f;
      if (this.selectedDevice !== null && device !== this.selectedDevice || this.selectedChannel !== null && channel !== this.selectedChannel) return;
      const scope = `midi:${device}:${channel}:`;
      const identity = `${scope}${note}`;
      if ((status & 0xf0) === 0xb0 && note === 64) {
        const event = inputMetadata(e, vel, device, channel), down = vel >= 64;
        if (down) this.pedals.set(scope, { device, event }); else this.pedals.delete(scope);
        this.cb.onPedal?.(down, scope, event); return;
      }
      if ((status & 0xf0) === 0x90 && vel > 0) {
        this.held.set(identity, { midi: note, device });
        this.cb.onNoteOn(note, identity, inputMetadata(e, vel, device, status & 0x0f));
      } else if ((status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && vel === 0)) {
        this.held.delete(identity);
        this.cb.onNoteOff(note, identity, inputMetadata(e, 0, device, status & 0x0f));
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
    this.cb.onStateChange?.();
  }
}
