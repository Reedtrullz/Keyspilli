"use client";
import { KEYMAP, noteLabel } from "@keyspilli/player-core";

export function InputStatus({ octave, midiConnected, pending, error, supported, onOctaveChange, onConnectMidi, devices, selection, onSelection, offsets, onTimingOffset }: {
  octave: number; midiConnected: boolean; pending: boolean; error: string; supported: boolean;
  devices: Array<{ id: string; name: string }>; selection: { device: string | null; channel: number | null };
  onSelection: (device: string | null, channel: number | null) => void;
  offsets: { keyboard: number | null; midi: number | null }; onTimingOffset: (input: "keyboard" | "midi", value: number | null) => void;
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
      {!!devices.length && <div className="flex flex-wrap gap-3 mt-3">
        <label>MIDI device<select className="block border rounded min-h-11" value={selection.device ?? ""} onChange={event => onSelection(event.target.value || null, selection.channel)}><option value="">All connected devices</option>{devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}{selection.device && !devices.some(device => device.id === selection.device) && <option value={selection.device}>Selected device unavailable</option>}</select></label>
        <label>MIDI channel<select className="block border rounded min-h-11" value={selection.channel ?? ""} onChange={event => onSelection(selection.device, event.target.value === "" ? null : Number(event.target.value))}><option value="">All channels</option>{Array.from({ length: 16 }, (_, channel) => <option key={channel} value={channel}>{channel + 1}</option>)}</select></label>
      </div>}
    </div>
    <fieldset className="border-t pt-3 space-y-2"><legend>Optional timing calibration</legend>
      <p className="text-xs text-zinc-600">Unknown is uncalibrated. Positive offsets subtract input delay; negative offsets add time. Raw timing remains in results. Calibration is specific to this input and chosen sound. Reset after changing speakers, headphones or output device.</p>
      {(["keyboard", "midi"] as const).map(input => <label key={input} className="block">{input === "keyboard" ? "Computer-key offset (ms)" : "Selected MIDI-device offset (ms)"}<input className="block border rounded min-h-11 px-2" type="number" min={-250} max={250} step={1} placeholder="Unknown" disabled={input === "midi" && !selection.device} value={offsets[input] ?? ""} onChange={event => onTimingOffset(input, event.target.value === "" ? null : Number(event.target.value))} /></label>)}
      <button className="min-h-11 underline" onClick={() => { onTimingOffset("keyboard", null); if (selection.device) onTimingOffset("midi", null); }}>Reset timing calibration</button>
    </fieldset>
  </div>;
}
