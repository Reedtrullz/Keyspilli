"use client";

import type { TimedNote, GradeResult } from "@keyspilli/player-core";
import type { PracticeSetup } from "./PracticeSetupDialog";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function GradingPanel({ waitMode, waitNotes, result, countIn, input, onExit, onRepeat, onDismiss, problems = [], onRevisit, pitchCues = true }: {
  pitchCues?:boolean;
  waitMode: boolean;
  waitNotes: TimedNote[];
  result: GradeResult | null;
  countIn: number | null;
  input: PracticeSetup["input"];
  onExit: () => void;
  onRepeat: () => void;
  onDismiss: () => void;
  problems?: Array<{ startBeat: number; endBeat: number; count: number }>;
  onRevisit?: (range: { startBeat: number; endBeat: number }) => void;
}) {
  return <div className="grading-panel border-b border-zinc-200 px-4 py-3 text-sm" role="region" aria-label="Practice grading">
    <div className="flex flex-wrap items-center gap-3">
      <strong>{result ? "Practice result" : countIn !== null ? `Count-in: ${countIn}` : waitMode ? "Wait for notes" : "Play along"}</strong>
      <span className="text-zinc-600">{input === "keyboard" ? "Computer keyboard · A–K, Z/X octave" : input === "midi" ? "MIDI keyboard" : "Microphone · beta"}</span>
      {!result && countIn !== null && <button onClick={onExit} className="ml-auto min-h-11 rounded-full border border-zinc-300 px-3">Cancel count-in</button>}
      {result && <><button onClick={onRepeat} className="ml-auto min-h-11 rounded-full bg-zinc-900 px-3 text-white">Repeat passage</button><button onClick={onDismiss} className="min-h-11 rounded-full border border-zinc-300 px-3">Dismiss result</button></>}
    </div>
    {countIn !== null && <p role="status" className="mt-2">Start in {countIn} {countIn === 1 ? "beat" : "beats"}…</p>}
    {!result && countIn === null && waitMode && waitNotes.length > 0 && !pitchCues && <p role="status">Pitch cues reduced. Use Reveal guidance when needed.</p>}
    {!result && countIn === null && waitMode && waitNotes.length > 0 && pitchCues && <p role="status" className="mt-2">Play: {waitNotes.map((note, index) => <span key={`${note.midi}-${index}`}>{index > 0 && " · "}<strong>{NOTE_NAMES[note.midi % 12]}{Math.floor(note.midi / 12) - 1}</strong> ({note.hand === "L" ? "left hand" : "right hand"})</span>)}</p>}
    {!result && <p className="text-xs text-zinc-600 mt-2">Finish practice to change setup.</p>}
    {result && <div role="status" className="mt-2"><strong>{result.accuracyPct}% onset accuracy</strong> · {result.summary}<p className="text-xs text-zinc-600 mt-1">{result.hit} hit · {result.missed} missed · {result.wrong} wrong · {result.late} late</p></div>}
    {result?.articulation&&<div className="mt-2"><p>Key holds: {result.articulation.matchedHolds} within tolerance · {result.articulation.shortHolds} short · {result.articulation.longHolds} long. Releases: {result.articulation.onTimeReleases} within tolerance · {result.articulation.earlyReleases} early · {result.articulation.lateReleases} late · {result.articulation.unobserved} unobserved.</p><p className="text-xs">{result.articulation.toleranceMs}ms manual tolerance. Physical key evidence only; pedal sound, technique and device latency remain separate.</p><details><summary className="min-h-11 cursor-pointer">Raw key timing pairs</summary><ul>{result.articulation.events.map((event,index)=><li key={index}>MIDI {event.pitch}: press {event.rawPressSec.toFixed(3)}s, release {event.rawReleaseSec.toFixed(3)}s, offset {event.offsetMs}ms; hold {Math.round(event.holdErrorSec*1000)}ms, release {Math.round(event.releaseErrorSec*1000)}ms from target.</li>)}</ul><p>{result.articulation.omitted} pairs omitted.</p></details></div>}
    {result?.diagnostics && <div className="mt-2">
      <p className="text-xs text-zinc-600">Locations refer to expected notes. Physical hand and microphone pitch ambiguity are not measured.{result.diagnostics.omitted > 0 && ` ${result.diagnostics.omitted} events omitted from this bounded view.`}</p>
      <details><summary className="min-h-11 cursor-pointer">Note timing details</summary><table className="text-xs"><thead><tr><th scope="col">Outcome</th><th scope="col">Target pitch</th><th scope="col">Played pitch</th><th scope="col">Raw error (ms)</th><th scope="col">Adjusted error (ms)</th><th scope="col">Offset used (ms)</th></tr></thead><tbody>{result.diagnostics.events.filter(event => event.outcome !== "hit").slice(0, 12).map((event, index) => <tr key={index}><td>{event.outcome}</td><td>{event.expectedPitch ?? "Unknown"}</td><td>{event.playedPitch ?? "None"}</td><td>{event.rawSec !== undefined && event.rawSec !== null && event.startSec !== null ? Math.round((event.rawSec - event.startSec) * 1000) : "Unknown"}</td><td>{event.errorSec === null ? "Unknown" : Math.round(event.errorSec * 1000)}</td><td>{event.offsetMs ?? "Unknown"}</td></tr>)}</tbody></table></details>
      <ul>{problems.map((window, index) => <li key={window.startBeat}><button className="min-h-11 underline" onClick={() => onRevisit?.(window)}>Revisit difficult passage {index + 1} ({window.count} events)</button></li>)}</ul>
    </div>}
  </div>;
}
