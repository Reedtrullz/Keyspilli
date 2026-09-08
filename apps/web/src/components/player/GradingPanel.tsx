"use client";

import type { TimedNote, GradeResult } from "@keyspilli/player-core";
import type { PracticeSetup } from "./PracticeSetupDialog";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function GradingPanel({ waitMode, waitNote, result, countIn, input, onExit, onRepeat, onDismiss }: {
  waitMode: boolean;
  waitNote: TimedNote | null | undefined;
  result: GradeResult | null;
  countIn: number | null;
  input: PracticeSetup["input"];
  onExit: () => void;
  onRepeat: () => void;
  onDismiss: () => void;
}) {
  return <div className="grading-panel border-b border-zinc-200 px-4 py-3 text-sm" role="region" aria-label="Practice grading">
    <div className="flex flex-wrap items-center gap-3">
      <strong>{result ? "Practice result" : countIn !== null ? `Count-in: ${countIn}` : waitMode ? "Wait for notes" : "Play along"}</strong>
      <span className="text-zinc-600">{input === "keyboard" ? "Computer keyboard · A–K, Z/X octave" : input === "midi" ? "MIDI keyboard" : "Microphone · beta"}</span>
      {!result && countIn !== null && <button onClick={onExit} className="ml-auto min-h-11 rounded-full border border-zinc-300 px-3">Cancel count-in</button>}
      {result && <><button onClick={onRepeat} className="ml-auto min-h-11 rounded-full bg-zinc-900 px-3 text-white">Repeat passage</button><button onClick={onDismiss} className="min-h-11 rounded-full border border-zinc-300 px-3">Dismiss result</button></>}
    </div>
    {countIn !== null && <p role="status" className="mt-2">Start in {countIn} {countIn === 1 ? "beat" : "beats"}…</p>}
    {!result && countIn === null && waitMode && waitNote && <p role="status" className="mt-2">Play: <strong>{NOTE_NAMES[waitNote.midi % 12]}{Math.floor(waitNote.midi / 12) - 1}</strong> ({waitNote.hand === "L" ? "left hand" : "right hand"})</p>}
    {!result && <p className="text-xs text-zinc-600 mt-2">Finish practice to change setup.</p>}
    {result && <div role="status" className="mt-2"><strong>{result.accuracyPct}%</strong> · {result.summary}<p className="text-xs text-zinc-600 mt-1">{result.hit} hit · {result.missed} missed · {result.wrong} wrong · {result.late} late</p></div>}
  </div>;
}
