"use client";

import type { TimedNote } from "@keyspilli/player-core";

export function GradingPanel({
  waitMode,
  waitNote,
  result,
  onWaitToggle,
  onExit,
}: {
  waitMode: boolean;
  waitNote: TimedNote | null | undefined;
  result: string | null;
  onWaitToggle: () => void;
  onExit: () => void;
}) {
  return (
    <div className="absolute top-3 right-3 z-20 w-72 rounded-2xl border border-zinc-200 bg-white/95 shadow-lg p-4">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-semibold">Practice mode</h3>
        <button onClick={onExit} className="text-xs px-2 py-1 rounded-lg border border-zinc-300">Exit</button>
      </div>
      <p className="text-xs text-zinc-500 mb-3">
        Play along on your keyboard (computer keys A–K), a MIDI keyboard, or your microphone. Wait mode pauses until you hit the right note.
      </p>
      <label className="flex items-center gap-2 text-sm mb-3">
        <input type="checkbox" checked={waitMode} onChange={onWaitToggle} />
        Wait for each note
      </label>
      {waitMode && waitNote && (
        <div className="rounded-xl bg-indigo-50 p-3 text-sm mb-2">
          Play: <span className="font-bold">{waitNote.midi}</span>
          <span className="text-zinc-500"> (MIDI {waitNote.midi})</span>
        </div>
      )}
      {result && <div className="rounded-xl bg-green-50 p-3 text-sm">{result}</div>}
      <p className="text-[11px] text-zinc-400 mt-2">Mic grading needs a quiet room; MIDI/keyboard grading is exact.</p>
    </div>
  );
}
