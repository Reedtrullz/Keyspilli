"use client";

import { useEffect, useRef, useState } from "react";
import { dialogMotionClasses, useDialogMotion } from "./player-motion";
import { practicePulseMeters, practicePulseProblem, type EngineSongMeta, type PracticePulse, type PracticePulseSettings } from "@keyspilli/player-core";
import { practicePulseDraft } from "./player-practice-pulse";

const GROUPING_EXAMPLES: Record<string, string> = { "6/8": "3+3", "9/8": "3+3+3", "5/8": "2+3", "7/8": "2+2+3" };

export type PracticeSetup = {
  input: "keyboard" | "midi" | "microphone";
  wait: boolean;
  scope: "bars" | "current" | "beginning" | "loop";
  countInBeats: 0 | 4;
  allowUnsupportedRange?: boolean;
  articulation?: boolean;
  articulationToleranceMs?: number;
  metronome?: boolean;
  practicePulse?: PracticePulseSettings;
};

export function PracticeSetupDialog({ practiceTiming, articulationEligible=false, describeSetup, keyboardTarget, onChordPractice, initialSetup, hasLoop, midiConnected, micReady, micPending, micError, error, onEnableMic, onInputChange, onStart, onCancel, microphoneTarget, micSignal }: {
  practiceTiming?: EngineSongMeta;
  articulationEligible?: boolean;
  microphoneTarget: (setup: PracticeSetup) => { eligible: boolean; reason: string }; micSignal: string;
  describeSetup?: (setup: PracticeSetup) => string;
  keyboardTarget: (setup: PracticeSetup) => { total:number; visible:number; overflow:number; physicalUnavailable:number|null; overflowPitches:number[] };
  onChordPractice?: () => void;
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
  const [pulseChoice, setPulseChoice] = useState<PracticePulse | "default">(initialSetup.practicePulse?.pulse ?? "default");
  const [groupTexts, setGroupTexts] = useState<Record<string, string>>(() => Object.fromEntries(
    (initialSetup.practicePulse?.beatGroups ?? []).map(pattern => [pattern.timeSig.join("/"), pattern.groups.join("+")]),
  ));
  const meters = practiceTiming ? practicePulseMeters(practiceTiming) : [];
  const pulseDraft = practicePulseDraft(pulseChoice, meters.map(timeSig => ({ timeSig, text: groupTexts[timeSig.join("/")] ?? "" })));
  const pulseUnavailable = practiceTiming ? practicePulseProblem(practiceTiming, { pulse: "quarter" }, practiceTiming.endBeat ?? 0) : null;
  const pulseError = pulseDraft.error ?? (pulseChoice === "default" ? null : pulseUnavailable);
  const resolvedSetup = { ...setup, practicePulse: pulseDraft.settings };
  const dialog = useRef<HTMLDialogElement>(null);
  const { visible, closing, requestClose } = useDialogMotion(() => {
    // The parent restores trigger focus on the next frame. Close the native
    // modal first: passive unmount cleanup can occur after that frame, while
    // the trigger is still inert and cannot receive focus.
    dialog.current?.close();
    onCancel();
  });
  const motion = dialogMotionClasses(visible, closing);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  const micTarget = microphoneTarget(setup);
  const reach = keyboardTarget(setup), needsRangeReview = reach.overflow > 0 || (reach.physicalUnavailable ?? 0) > 0;
  const unavailable = setup.input === "midi" ? !midiConnected : setup.input === "microphone" && (!micReady || !micTarget.eligible);
  return (
    <dialog ref={dialog} aria-label="Set up practice" onCancel={(event) => { event.preventDefault(); requestClose(); }}
      className={`fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md max-h-[calc(100%_-_2rem)] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl backdrop:bg-black/40 ${motion.panel}`}>
      <h2 id="practice-setup-title" className="text-lg font-semibold mb-4">Set up practice</h2>
      <fieldset disabled={closing} className="space-y-4">
        <label className="block text-sm">Input
          <select aria-label="Input" autoFocus className="block w-full mt-1 min-h-11 rounded-lg border border-zinc-300 px-3" value={setup.input}
            onChange={(e) => { const input = e.target.value as PracticeSetup["input"]; setSetup({ ...setup, input, articulation:false, allowUnsupportedRange: false }); onInputChange(input); }}>
            <option value="keyboard">Computer / on-screen keys</option>
            <option value="midi" disabled={!midiConnected}>{midiConnected ? "Connected MIDI keyboard" : "MIDI — no keyboard connected"}</option>
            <option value="microphone">Microphone (beta)</option>
          </select>
        </label>
        {setup.input === "keyboard" && <p className="text-xs text-zinc-600">Use A–K or the on-screen piano for notes; Z/X shifts the computer-key octave.</p>}
        {setup.input === "microphone" && <div className="space-y-2 text-sm">
          <p className="text-zinc-600">{micTarget.reason}</p><p role="status">{micSignal}</p>
          <button type="button" disabled={micReady || micPending} onClick={onEnableMic} className="min-h-11 rounded-lg border border-zinc-300 px-3 disabled:opacity-60">{micReady ? "Microphone ready" : micPending ? "Enabling microphone…" : "Enable microphone"}</button>
          {micError && <p role="alert" className="text-red-700">{micError} Choose keyboard or MIDI to continue.</p>}
        </div>}
        <label className="block text-sm">Behavior
          <select aria-label="Behavior" className="block w-full mt-1 min-h-11 rounded-lg border border-zinc-300 px-3" value={setup.wait ? "wait" : "along"} onChange={(e) => setSetup({ ...setup, wait: e.target.value === "wait", articulation:e.target.value === "wait"?false:setup.articulation })}>
            <option value="along">Play along</option><option value="wait">Wait for notes</option>
          </select>
        </label>
        <label className="flex gap-2 text-sm"><input type="checkbox" disabled={!articulationEligible||setup.input!=="midi"||setup.wait} checked={setup.articulation??false} onChange={event=>setSetup({...setup,articulation:event.target.checked,articulationToleranceMs:setup.articulationToleranceMs??150})}/>Assess key holds and releases (MIDI timing prototype)</label>
        <p className="text-xs text-zinc-600">Select one MIDI device and channel in Input and use play-along. Physical release timestamps are separate from pedal sound. Safety releases and missing timestamps remain unobserved. Hardware latency, technique and fingering are not measured.</p>
        {setup.articulation&&<label className="block text-sm">Hold/release tolerance (ms)<input aria-label="Hold/release tolerance (ms)" type="number" min="50" max="400" step="25" value={setup.articulationToleranceMs??150} onChange={event=>setSetup({...setup,articulationToleranceMs:Number(event.target.value)})}/><small className="block">A manual tolerance, not a device calibration. Release dispatch closes 400ms after the passage.</small></label>}
        <label className="block text-sm">Passage
          <select aria-label="Passage" className="block w-full mt-1 min-h-11 rounded-lg border border-zinc-300 px-3" value={setup.scope} onChange={(e) => setSetup({ ...setup, allowUnsupportedRange: false, scope: e.target.value as PracticeSetup["scope"] })}>
            <option value="bars">Current 4 bars</option><option value="current">From current position to end</option><option value="beginning">From beginning</option><option value="loop" disabled={!hasLoop}>Selected loop (once)</option>
          </select>
        </label>
        <label className="block text-sm">Count-in
          <select aria-label="Count-in" className="block w-full mt-1 min-h-11 rounded-lg border border-zinc-300 px-3" value={setup.countInBeats} onChange={(e) => setSetup({ ...setup, countInBeats: Number(e.target.value) as 0 | 4 })}>
            <option value={0}>Off</option><option value={4}>4 quarter-note beats</option>
          </select>
        </label>
        {practiceTiming && <fieldset className="space-y-3 rounded-xl border border-zinc-200 p-3">
          <legend className="px-1 text-sm font-medium">Practice clicks</legend>
          <label className="flex gap-2 text-sm"><input aria-label="Metronome during playback" type="checkbox" checked={setup.metronome ?? false} onChange={event => setSetup({ ...setup, metronome: event.target.checked })}/>Metronome during playback</label>
          <label className="block text-sm">Practice pulse
            <select aria-label="Practice pulse" className="block w-full mt-1 min-h-11 rounded-lg border border-zinc-300 px-3" value={pulseChoice} onChange={event => setPulseChoice(event.target.value as PracticePulse | "default")}>
              <option value="default">Default quarter-note clicks</option>
              <option value="quarter" disabled={!!pulseUnavailable}>Quarter notes</option>
              <option value="eighth" disabled={!!pulseUnavailable}>Eighth notes</option>
              <option value="dotted-quarter" disabled={!!pulseUnavailable}>Dotted quarter notes</option>
            </select>
            <small className="block mt-1 text-zinc-600">Default clicks keep the existing quarter-note grid. The explicit pulse choices align to each displayed bar.</small>
          </label>
          {pulseChoice !== "default" && meters.map(meter => <label key={meter.join("/")} className="block text-sm">Grouping in {meter.join("/")} (optional)
            <input aria-label={`Grouping in ${meter.join("/")}`} type="text" inputMode="text" maxLength={160} className="block w-full mt-1 min-h-11 rounded-lg border border-zinc-300 px-3" value={groupTexts[meter.join("/")] ?? ""} placeholder="Leave blank for bar accents only" onChange={event => setGroupTexts({ ...groupTexts, [meter.join("/")]: event.target.value })}/>
            <small className="block mt-1 text-zinc-600">Counts of 1/{meter[1]} notes totaling {meter[0]}, separated by +.{GROUPING_EXAMPLES[meter.join("/")] && ` Example only: ${GROUPING_EXAMPLES[meter.join("/")]}.`}</small>
          </label>)}
          <p className="text-xs text-zinc-600">Group starts add accent clicks alongside the selected pulse. Choose a grouping explicitly; source notes keep their accents. This choice is saved for this song when practice starts.</p>
          <p className="text-xs text-zinc-600">{practiceTiming.measureStartBeat !== undefined ? "Explicit pulses use the verified source bar phase, including any pickup." : "Explicit pulses follow displayed bars; the source downbeat phase is unverified."}</p>
          <p className="text-xs text-zinc-600">The count-in uses quarter-note beats. During practice, steady clicks require Play along.</p>
          {(pulseError || pulseUnavailable) && <p role={pulseError ? "alert" : "status"} className="text-xs text-amber-800">{pulseError ?? pulseUnavailable}</p>}
        </fieldset>}
        <p aria-label="Practice target reachability" className="text-xs text-zinc-600">{reach.total} onset targets · {reach.visible} inside the piano view · {reach.overflow} outside the view{setup.input === "keyboard" ? "." : reach.physicalUnavailable === null ? ". Physical keyboard range not confirmed." : ` · ${reach.physicalUnavailable} outside your confirmed physical range.`}</p>
        {needsRangeReview && <label className="flex gap-2 text-sm text-amber-800"><input type="checkbox" checked={setup.allowUnsupportedRange??false} onChange={event=>setSetup({...setup,allowUnsupportedRange:event.target.checked})}/>I reviewed these unreachable targets and want to attempt this range. All targets will still be graded.</label>}
        {onChordPractice && <button type="button" className="min-h-11 px-3 rounded-lg border border-indigo-300 text-indigo-800" onClick={onChordPractice}>Chord practice</button>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {describeSetup && <p className="practice-setup-summary" aria-label="Practice setup summary">{describeSetup(resolvedSetup)} · {setup.input === "keyboard" ? "Computer / on-screen keys" : setup.input === "midi" ? "MIDI" : "Microphone (beta)"} · {setup.wait ? "Wait for notes" : "Play along"}</p>}
        {unavailable && <p className="text-sm text-amber-800">{setup.input === "midi" ? "Connect a MIDI keyboard or choose computer keys before starting." : micReady && !micTarget.eligible ? "Choose a monophonic target or keyboard/MIDI before starting." : "Enable the microphone or choose another input before starting."}</p>}
        {setup.scope === "loop" && !hasLoop && <p className="text-sm text-amber-800">Select a loop before practicing it.</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={requestClose} className="min-h-11 rounded-full border border-zinc-300 px-4">Cancel</button>
          <button type="button" disabled={!!pulseError || unavailable || (setup.articulation&&(!articulationEligible||setup.input!=="midi"||setup.wait||!Number.isFinite(setup.articulationToleranceMs??150)||(setup.articulationToleranceMs??150)<50||(setup.articulationToleranceMs??150)>400)) || (needsRangeReview && !setup.allowUnsupportedRange) || (setup.scope === "loop" && !hasLoop)} onClick={() => onStart(resolvedSetup)} className="min-h-11 rounded-full bg-zinc-900 text-white px-4 disabled:opacity-40">Start practice</button>
        </div>
      </fieldset>
    </dialog>
  );
}
