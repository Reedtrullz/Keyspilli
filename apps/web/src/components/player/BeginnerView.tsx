"use client";

import { measureIndex, pitchColor, secPerBeat, type PlayerSettings, type SongData } from "@keyspilli/player-core";

const LETTERS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function BeginnerView({ data, time, settings }: { data: SongData; time: number; settings: PlayerSettings }) {
  const beatSec = secPerBeat(data.tempoBpm, settings.speed);
  const currentMeasure = measureIndex(
    time,
    data.tempoBpm,
    settings.speed,
    data.timeSig,
    data.measures.length,
  );
  const m = data.measures[currentMeasure] ?? data.measures[0]!;
  const notes = data.notes.filter((n) => n.start >= m.startBeat && n.start < m.endBeat);
  const measureBeats = m.endBeat - m.startBeat;
  const W = 880;
  const H = 300;
  const playX = 60 + ((time / beatSec - m.startBeat) / measureBeats) * (W - 120);

  return (
    <div className="overflow-x-auto">
      <div className="p-6">
        <div className="flex justify-between text-xs text-zinc-500 mb-3">
          <span>Measure {currentMeasure + 1} of {data.measures.length}</span>
          <span>{data.key} · {data.tempoBpm} BPM</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Beginner notes view">
          <rect x="0" y="0" width={W} height={H} fill="#fff" rx="12" />
          <line x1="24" y1="40" x2={W - 24} y2="40" stroke="#e4e4e7" />
          <line x1="24" y1="230" x2={W - 24} y2="230" stroke="#e4e4e7" />
          {notes.map((n, i) => {
            const beatOffset = n.start - m.startBeat;
            const x = 60 + (beatOffset / measureBeats) * (W - 120);
            const y = 135 - (n.midi - 55) * 6;
            const col = pitchColor(n.midi);
            return (
              <g key={i}>
                <circle cx={x} cy={y} r="16" fill={col} stroke="#18181b" strokeWidth="1.5" />
                <text x={x} y={y + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">
                  {LETTERS[n.midi % 12]}
                </text>
                {n.lyrics && (
                  <text x={x} y={Math.min(255, y + 34)} textAnchor="middle" fontSize="12" fill="#52525b">
                    {n.lyrics}
                  </text>
                )}
              </g>
            );
          })}
          {data.chords
            .filter((c) => c.beat >= m.startBeat && c.beat < m.endBeat)
            .map((c, i) => (
              <text
                key={`c${i}`}
                x={60 + ((c.beat - m.startBeat) / measureBeats) * (W - 120)}
                y={264}
                textAnchor="middle"
                fontSize="13"
                fontWeight="600"
                fill="#3f3f46"
              >
                {c.name}
              </text>
            ))}
          {time > 0 && <line x1={playX} y1="40" x2={playX} y2="230" stroke="#dc2626" strokeWidth="2" />}
        </svg>
      </div>
    </div>
  );
}
