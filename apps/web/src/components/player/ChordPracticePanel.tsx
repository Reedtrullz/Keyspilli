"use client";

import type { ChordPracticeSnapshot, ChordPracticeTarget } from "@keyspilli/player-core";
import { chordProvenance } from "./chord-provenance";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const WHITE_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11];
const BLACK_PITCH_CLASSES = [1, 3, 6, 8, 10];

function noteName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function sourceLabel(target: ChordPracticeTarget): string {
  if (target.sourceKind === "authored") return "Charted chord";
  if (target.sourceKind === "inferred" || target.inferred) return "Inferred voicing";
  if (target.sourceKind === "generated") return "Generated from arrangement";
  return "Chord source unknown";
}

function PracticeKeyboard({ target, snapshot }: { target: ChordPracticeTarget; snapshot: ChordPracticeSnapshot }) {
  const lowest = Math.min(...target.notes);
  const startMidi = Math.max(12, Math.floor(lowest / 12) * 12);
  // Build the exact two-octave C-to-B range rather than relying on note count
  // when the target starts on a non-C boundary.
  const firstWhite = Array.from({ length: 24 }, (_, index) => startMidi + index)
    .filter((midi) => WHITE_PITCH_CLASSES.includes(pitchClass(midi)));
  const whites = firstWhite.slice(0, 14);
  const whiteIndex = new Map(whites.map((midi, index) => [midi, index]));
  const targetSet = new Set(target.notes);
  const played = new Set(snapshot.playedPitchClasses);
  const width = 100 / Math.max(1, whites.length);
  const blackMidis = Array.from({ length: 24 }, (_, index) => startMidi + index)
    .filter((midi) => BLACK_PITCH_CLASSES.includes(pitchClass(midi)) && whiteIndex.has(midi - 1));

  return (
    <div className="relative h-36 rounded-xl border border-zinc-300 bg-zinc-100 overflow-hidden" aria-label={`Reference keyboard for ${target.name}`}>
      <div className="absolute inset-0 flex">
        {whites.map((midi) => {
          const active = targetSet.has(midi);
          const isPlayed = played.has(pitchClass(midi));
          const isWrong = snapshot.lastWrongPitchClass === pitchClass(midi);
          return (
            <div
              key={midi}
              className={`relative h-full border-r border-zinc-300 flex-1 flex items-end justify-center pb-2 text-[10px] font-medium ${
                isWrong ? "bg-red-200 text-red-900" : isPlayed ? "bg-emerald-300 text-emerald-950" : active ? "bg-blue-200 text-blue-900" : "bg-white text-zinc-400"
              }`}
            >
              {active && <span>{noteName(midi)}</span>}
            </div>
          );
        })}
      </div>
      <div className="absolute inset-x-0 top-0 h-[62%]">
        {blackMidis.map((midi) => {
          const previous = whiteIndex.get(midi - 1);
          if (previous === undefined) return null;
          const active = targetSet.has(midi);
          const isPlayed = played.has(pitchClass(midi));
          const isWrong = snapshot.lastWrongPitchClass === pitchClass(midi);
          return (
            <div
              key={midi}
              className={`absolute top-0 h-full rounded-b-md border border-zinc-900 shadow-sm ${isWrong ? "bg-red-500" : isPlayed ? "bg-emerald-500" : active ? "bg-blue-500" : "bg-zinc-900"}`}
              style={{ left: `${(previous + 1) * width - width * 0.31}%`, width: `${width * 0.62}%` }}
              title={active ? noteName(midi) : undefined}
            />
          );
        })}
      </div>
      <span className="sr-only">Blue keys are the target. Green keys are already played. Red indicates an extra note.</span>
    </div>
  );
}

export function ChordPracticePanel({
  targets,
  snapshot,
  active,
  onStart,
  onHear,
  onSkip,
  onExit,
}: {
  targets: ChordPracticeTarget[];
  snapshot: ChordPracticeSnapshot;
  active: boolean;
  onStart: () => void;
  onHear: () => void;
  onSkip: () => void;
  onExit: () => void;
}) {
  const target = snapshot.target;

  return (
    <section className="p-4 sm:p-6 bg-gradient-to-b from-indigo-50 to-white" aria-label="Chord practice" data-testid="chord-practice-panel">
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide font-semibold text-indigo-700">Chord practice</p>
          <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 mt-1">Play the chord together</h2>
          <p className="text-sm text-zinc-600 mt-1">The shown octave is a reference shape. Any octave is accepted, and note order does not matter.</p>
        </div>
        <button onClick={onExit} className="min-h-11 px-3 rounded-xl border border-zinc-300 bg-white text-sm">Close</button>
      </div>

      {!targets.length && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This arrangement has no usable chord timeline yet. Try a higher difficulty level or a song with chord data.
        </div>
      )}

      {target && (
        <div className="rounded-2xl border border-indigo-200 bg-white p-4 sm:p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-4xl sm:text-5xl font-bold tracking-tight text-zinc-900">{target.name}</span>
            <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-medium text-indigo-800">{sourceLabel(target)}</span>
            <span className="ml-auto text-xs font-medium text-zinc-500">
              {snapshot.finished ? `${snapshot.total} chords complete` : `Chord ${Math.min(snapshot.currentIndex + 1, snapshot.total)} of ${snapshot.total}`}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mb-4" aria-label="Target notes">
            {target.notes.map((midi) => (
              <span key={midi} className="rounded-lg bg-zinc-100 px-2.5 py-1 text-sm font-mono text-zinc-800">{noteName(midi)}</span>
            ))}
          </div>
          <PracticeKeyboard target={target} snapshot={snapshot} />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!active && !snapshot.finished && (
              <button onClick={onStart} className="min-h-11 px-4 rounded-xl bg-indigo-700 text-white font-medium hover:bg-indigo-800">Start chord practice</button>
            )}
            {active && !snapshot.finished && (
              <>
                <button onClick={onHear} className="min-h-11 px-4 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-700">Hear chord</button>
                <button onClick={onSkip} className="min-h-11 px-4 rounded-xl border border-zinc-300 text-sm hover:bg-zinc-50">Skip</button>
                <span className="text-xs text-zinc-500">Play the blue notes on your MIDI keyboard or computer keys.</span>
              </>
            )}
            {snapshot.finished && (
              <button onClick={onStart} className="min-h-11 px-4 rounded-xl bg-indigo-700 text-white font-medium hover:bg-indigo-800">Try again</button>
            )}
          </div>
          {active && !snapshot.finished && (
            <p className="mt-3 text-sm" role="status" aria-live="polite">
              {snapshot.remainingPitchClasses.length
                ? `Still needed: ${snapshot.remainingPitchClasses.map((pc) => NOTE_NAMES[pc]).join(" · ")}`
                : "Chord complete — moving to the next chord."}
            </p>
          )}
        </div>
      )}
      {targets.length > 0 && snapshot.finished && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950" role="status">
          <h3 className="text-xl font-bold">Chord practice complete</h3>
          <p className="mt-2 text-sm">{snapshot.completed} completed · {snapshot.skipped} skipped · {snapshot.wrong} extra notes · {snapshot.accuracyPct}% shape accuracy.</p>
          <button onClick={onStart} className="mt-4 min-h-11 px-4 rounded-xl bg-indigo-700 text-white font-medium hover:bg-indigo-800">Try again</button>
        </div>
      )}
    </section>
  );
}
