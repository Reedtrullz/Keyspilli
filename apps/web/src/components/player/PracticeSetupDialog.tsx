"use client";

import { useEffect, useRef, useState } from "react";
import { dialogMotionClasses, useDialogMotion } from "./player-motion";

export type PracticeSetup = {
  input: "keyboard" | "midi" | "microphone";
  wait: boolean;
  scope: "current" | "beginning" | "loop";
  countInBeats: 0 | 4;
};

export function PracticeSetupDialog({ initialSetup, hasLoop, midiConnected, micReady, micPending, micError, error, onEnableMic, onInputChange, onStart, onCancel }: {
  initialSetup: PracticeSetup;
  hasLoop: boolean;
  midiConnected: boolean;
  micReady: boolean;
  micPending: boolean;
  micError: string;
  error: string;
  onEnableMic: () => void;
  onInputChange: (input: PracticeSetup["input"]) => void;
  onStart: (setup: PracticeSetup) => void;
  onCancel: () => void;
}) {
  const [setup, setSetup] = useState(initialSetup);
  const dialog = useRef<HTMLDialogElement>(null);
  const { visible, closing, requestClose } = useDialogMotion(onCancel);
  const motion = dialogMotionClasses(visible, closing);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  const unavailable = setup.input === "midi" ? !midiConnected : setup.input === "microphone" && !micReady;
  return (
    <dialog ref={dialog} aria-label="Set up practice" onCancel={(event) => { event.preventDefault(); requestClose(); }}
      className={`fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl backdrop:bg-black/40 ${motion.panel}`}>
      <h2 id="practice-setup-title" className="text-lg font-semibold mb-4">Set up practice</h2>
      <fieldset disabled={closing} className="space-y-4">
        <label className="block text-sm">Input
          <select aria-label="Input" autoFocus className="block w-full mt-1 min-h-11 rounded-lg border border-zinc-300 px-3" value={setup.input}
            onChange={(e) => { const input = e.target.value as PracticeSetup["input"]; setSetup({ ...setup, input }); onInputChange(input); }}>
            <option value="keyboard">Computer keyboard</option>
            <option value="midi" disabled={!midiConnected}>{midiConnected ? "Connected MIDI keyboard" : "MIDI — no keyboard connected"}</option>
            <option value="microphone">Microphone (beta)</option>
          </select>
        </label>
        {setup.input === "keyboard" && <p className="text-xs text-zinc-600">Use A–K for notes; Z/X shifts the octave.</p>}
        {setup.input === "microphone" && <div className="space-y-2 text-sm">
          <p className="text-zinc-600">Beta: single notes in a quiet room. Pitch detection can miss chords and repeated notes.</p>
          <button type="button" disabled={micReady || micPending} onClick={onEnableMic} className="min-h-11 rounded-lg border border-zinc-300 px-3 disabled:opacity-60">{micReady ? "Microphone ready" : micPending ? "Enabling microphone…" : "Enable microphone"}</button>
          {micError && <p role="alert" className="text-red-700">{micError} Choose keyboard or MIDI to continue.</p>}
        </div>}
        <label className="block text-sm">Behavior
          <select aria-label="Behavior" className="block w-full mt-1 min-h-11 rounded-lg border border-zinc-300 px-3" value={setup.wait ? "wait" : "along"} onChange={(e) => setSetup({ ...setup, wait: e.target.value === "wait" })}>
            <option value="along">Play along</option><option value="wait">Wait for notes</option>
          </select>
        </label>
        <label className="block text-sm">Passage
          <select aria-label="Passage" className="block w-full mt-1 min-h-11 rounded-lg border border-zinc-300 px-3" value={setup.scope} onChange={(e) => setSetup({ ...setup, scope: e.target.value as PracticeSetup["scope"] })}>
            <option value="current">From current position</option><option value="beginning">From beginning</option><option value="loop" disabled={!hasLoop}>Selected loop (once)</option>
          </select>
        </label>
        <label className="block text-sm">Count-in
          <select aria-label="Count-in" className="block w-full mt-1 min-h-11 rounded-lg border border-zinc-300 px-3" value={setup.countInBeats} onChange={(e) => setSetup({ ...setup, countInBeats: Number(e.target.value) as 0 | 4 })}>
            <option value={0}>Off</option><option value={4}>4 beats</option>
          </select>
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={requestClose} className="min-h-11 rounded-full border border-zinc-300 px-4">Cancel</button>
          <button type="button" disabled={unavailable || (setup.scope === "loop" && !hasLoop)} onClick={() => onStart(setup)} className="min-h-11 rounded-full bg-zinc-900 text-white px-4 disabled:opacity-40">Start practice</button>
        </div>
      </fieldset>
    </dialog>
  );
}
