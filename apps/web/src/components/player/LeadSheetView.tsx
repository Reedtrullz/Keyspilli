"use client";

import { pitchColor, type PlayerSettings, type SongData } from "@keyspilli/player-core";

export function LeadSheetView({ data, time, settings }: { data: SongData; time: number; settings: PlayerSettings }) {
  const beatSec = 60 / data.tempoBpm / settings.speed;
  const currentMeasure = Math.min(
    data.measures.length - 1,
    Math.floor(time / beatSec / (data.timeSig[0] * (4 / data.timeSig[1]))),
  );
  const m = data.measures[currentMeasure] ?? data.measures[0]!;
  const notes = data.notes.filter((n) => n.start >= m.startBeat && n.start < m.endBeat && n.hand !== "L");
  const measureBeats = m.endBeat - m.startBeat;
  const W = 880;
  const H = 240;
  const playX = 80 + ((time / beatSec - m.startBeat) / measureBeats) * (W - 160);

  return (
    <div className="overflow-x-auto">
      <div className="p-6">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Lead sheet view">
          <rect width={W} height={H} fill="#fff" rx="12" />
          {notes.map((n, i) => {
            const x = 80 + ((n.start - m.startBeat) / measureBeats) * (W - 160);
            const y = 80;
            return (
              <g key={i}>
                <circle cx={x} cy={y - ((n.midi % 12) - 5) * 4} r="10" fill={pitchColor(n.midi)} />
                {n.lyrics && (
                  <text x={x} y={y + 34} textAnchor="middle" fontSize="13" fill="#3f3f46">
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
                x={80 + ((c.beat - m.startBeat) / measureBeats) * (W - 160)}
                y={H - 36}
                textAnchor="middle"
                fontSize="14"
                fontWeight="700"
                fill="#18181b"
              >
                {c.name}
              </text>
            ))}
          {time > 0 && <line x1={playX} y1="28" x2={playX} y2={H - 52} stroke="#dc2626" strokeWidth="2" />}
        </svg>
        <p className="text-xs text-zinc-400 mt-2">
          Measure {currentMeasure + 1} of {data.measures.length} — dots follow the melody, chords below for your left hand.
        </p>
      </div>
    </div>
  );
}
