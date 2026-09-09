"use client";
import { KEYMAP, noteLabel } from "@keyspilli/player-core";

export function InputStatus({ octave, midiConnected, pending, error, supported, onOctaveChange, onConnectMidi }: {
  octave: number; midiConnected: boolean; pending: boolean; error: string; supported: boolean;
  onOctaveChange: (octave: number) => void; onConnectMidi: () => void;
}) {
  const shift = (octave - 2) * 12;
  return <div className="space-y-4 text-sm">
    <p>Computer keys play <strong>{noteLabel(60 + shift)}–{noteLabel(76 + shift, true)}</strong>. Input octave changes the notes you play, not the song or its view.</p>
    <div className="flex items-center gap-2" role="group" aria-label="Input octave">
      <button className="min-h-11 min-w-11 border rounded-lg" disabled={octave === 0} aria-label="Lower input octave" onClick={() => onOctaveChange(octave - 1)}>−</button>
      <span>Octave {octave + 2}</span>
      <button className="min-h-11 min-w-11 border rounded-lg" disabled={octave === 4} aria-label="Raise input octave" onClick={() => onOctaveChange(octave + 1)}>+</button>
      <button className="min-h-11 px-3 border rounded-lg" onClick={() => onOctaveChange(2)}>Reset octave</button>
    </div>
    <p className="text-xs text-zinc-600">Z lowers the octave. X raises it.</p>
    <div className="flex flex-wrap gap-2" aria-label="Computer key mapping">{Object.entries(KEYMAP).map(([key, midi]) => <span className="border rounded px-2 py-1 text-xs" key={key}><kbd>{key.toUpperCase()}</kbd> · {noteLabel(midi + shift, true)}</span>)}</div>
    <div className="border-t pt-3">
      <p role="status">{midiConnected ? "MIDI connected" : pending ? "Connecting to MIDI…" : !supported ? "MIDI is unavailable in this browser. Computer and on-screen keys are available." : error || "No MIDI keyboard connected"}</p>
      {!midiConnected && <button className="min-h-11 px-3 mt-2 border rounded-lg" disabled={!supported || pending} onClick={onConnectMidi}>Connect MIDI</button>}
    </div>
  </div>;
}
