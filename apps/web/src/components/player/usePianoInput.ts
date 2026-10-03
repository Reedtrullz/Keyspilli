"use client";
import { useEffect, useRef, type RefObject } from "react";
import { KeyboardInput, MidiInput, type InputEventMetadata } from "@keyspilli/player-core";

/** One owner for input listeners, permission lifetime, port cleanup and interruption release. */
export function usePianoInput(options: {
  keyboardRef: RefObject<KeyboardInput | null>; midiRef: RefObject<MidiInput | null>;
  onNote: (midi: number, on: boolean, source: "keyboard" | "midi", identity?: string, event?: InputEventMetadata) => void;
  onKey: (event: KeyboardEvent, input: KeyboardInput) => void;
  onOctaveChange: (octave: number) => void; onPedal: (down: boolean, scope: string, event?: InputEventMetadata) => void;
  onState: (devices: Array<{ id: string; name: string }>, count: number) => void;
  onRelease: () => void; onInterrupt: (reason: string) => void;
}) {
  const current = useRef(options); current.current = options;
  const navigating = useRef(false);
  useEffect(() => {
    let disposed = false;
    let pendingLinks = 0;
    const keyboard = new KeyboardInput({
      onNoteOn: (m, identity, event) => { if (!navigating.current) current.current.onNote(m, true, "keyboard", identity, event); },
      onNoteOff: (m, identity, event) => current.current.onNote(m, false, "keyboard", identity, event),
    }, octave => current.current.onOctaveChange(octave));
    const midi = new MidiInput({
      onNoteOn: (m, identity, event) => { if (!navigating.current) current.current.onNote(m, true, "midi", identity, event); },
      onNoteOff: (m, identity, event) => current.current.onNote(m, false, "midi", identity, event),
      onPedal: (down, scope, event) => { if (!navigating.current || !down) current.current.onPedal(down, scope, event); },
      onStateChange: () => { if (!disposed) current.current.onState(midi.devices, midi.connectedCount); },
    });
    current.current.keyboardRef.current = keyboard; current.current.midiRef.current = midi;
    const key = (event: KeyboardEvent) => { if (event.type === "keyup") keyboard.handleKey(event); else if (!navigating.current) current.current.onKey(event, keyboard); };
    const release = () => { keyboard.releaseAll(); midi.releaseAll(); current.current.onRelease(); };
    const blur = () => { release(); current.current.onInterrupt("Window focus was lost."); };
    const hidden = () => { if (document.hidden) { release(); current.current.onInterrupt("Page was hidden."); } };
    const navigate = (event: Event) => {
      const pending = (event as CustomEvent<boolean>).detail;
      pendingLinks = Math.max(0, pendingLinks + (pending ? 1 : -1)); navigating.current = pendingLinks > 0;
      if (pending) { release(); current.current.onInterrupt("Page navigation interrupted playback/practice."); }
    };
    window.addEventListener("keydown", key); window.addEventListener("keyup", key);
    window.addEventListener("blur", blur); document.addEventListener("visibilitychange", hidden);
    window.addEventListener("keyspilli:navigation", navigate);
    return () => {
      disposed = true;
      window.removeEventListener("keydown", key); window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur); document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("keyspilli:navigation", navigate);
      release(); midi.disconnect();
      current.current.keyboardRef.current = null; current.current.midiRef.current = null;
    };
  }, []);
  return navigating;
}
