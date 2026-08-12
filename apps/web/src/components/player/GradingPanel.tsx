"use client";

import { detectPitch, type TimedNote } from "@keyspilli/player-core";
import { useEffect, useRef, useState } from "react";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function GradingPanel({
  waitMode,
  waitNote,
  result,
  onWaitToggle,
  onExit,
  onMicNote,
}: {
  waitMode: boolean;
  waitNote: TimedNote | null | undefined;
  result: { summary: string; accuracyPct: number; hit: number; missed: number; wrong: number; late: number; total: number } | null;
  onWaitToggle: () => void;
  onExit: () => void;
  onMicNote: (midi: number) => void;
}) {
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const onMicNoteRef = useRef(onMicNote);
  onMicNoteRef.current = onMicNote;

  useEffect(() => {
    if (!micOn) return;
    let cancelled = false;
    let raf = 0;
    let lastMidi: number | null = null;
    let lastFire = 0;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        src.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          if (cancelled) return;
          analyser.getFloatTimeDomainData(buf);
          const midi = detectPitch(buf, ctx.sampleRate);
          const now = performance.now();
          if (midi !== null && midi !== lastMidi && now - lastFire > 120) {
            lastFire = now;
            lastMidi = midi;
            onMicNoteRef.current(midi);
          } else if (midi === null) {
            lastMidi = null;
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        setMicError(`Microphone unavailable: ${(e as Error).message}`);
        setMicOn(false);
      }
    }
    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [micOn]);

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
      <button
        onClick={() => setMicOn((m) => !m)}
        className={`w-full px-3 py-2 rounded-xl text-sm border mb-2 ${micOn ? "bg-indigo-100 border-indigo-300 text-indigo-800" : "border-zinc-300 hover:bg-zinc-100"}`}
      >
        {micOn ? "🎤 Mic grading on — stop" : "🎤 Use microphone (acoustic piano)"}
      </button>
      {micError && <p className="text-xs text-red-600 mb-2">{micError}</p>}
      {waitMode && waitNote && (
        <div className="rounded-xl bg-indigo-50 p-3 text-sm mb-2">
          Play: <span className="font-bold">{NOTE_NAMES[waitNote.midi % 12]}{Math.floor(waitNote.midi / 12) - 1}</span>
          <span className="text-zinc-500"> ({waitNote.hand === "L" ? "left hand" : "right hand"})</span>
        </div>
      )}
      {result && (
        <div className="rounded-xl bg-green-50 p-3 text-sm">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold">{result.accuracyPct}%</span>
            <span className="text-zinc-600">{result.summary}</span>
          </div>
          <div className="text-xs text-zinc-500 flex gap-3">
            <span>✓ {result.hit} hit</span>
            <span>✗ {result.missed} missed</span>
            <span>~ {result.wrong} wrong</span>
            {result.late > 0 && <span>⏱ {result.late} late</span>}
          </div>
        </div>
      )}
      <p className="text-[11px] text-zinc-400 mt-2">Mic grading needs a quiet room; MIDI/keyboard grading is exact.</p>
    </div>
  );
}
