"use client";

import React from "react";
import { measureIndex, pitchColor, secPerBeat, type ChordLabel, type PlayerSettings, type SongData } from "@keyspilli/player-core";
import { chordProvenance } from "./chord-provenance";

const LETTERS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function BeginnerView({ data, time, settings, chords }: { data: SongData; time: number; settings: PlayerSettings; chords: ChordLabel[] }) {
  const beatSec = secPerBeat(data.tempoBpm, settings.speed);
  const currentMeasure = measureIndex(
    time,
    data.tempoBpm,
    settings.speed,
    data.timeSig,
    data.measures.length,
  );
  const m = data.measures[currentMeasure] ?? data.measures[0]!;
  // Views must show the same pitches the audio engine sounds (which are
  // transposed), so shift note MIDI values to match.
  const notes = data.notes
    .filter((n) => n.start >= m.startBeat && n.start < m.endBeat)
    .map((n) => ({ ...n, midi: n.midi + settings.transpose }));
  const measureBeats = m.endBeat - m.startBeat;
  const W = 880;
  const H = 300;
  const playX = 60 + ((time / beatSec - m.startBeat) / measureBeats) * (W - 120);
  // Scale the staff to the measure's actual pitch range so wide arrangements
  // don't render notes above/below the visible area.
  const mids = notes.map((n) => n.midi);
  const lo = Math.min(...mids, 55);
  const hi = Math.max(...mids, 72);
  const spread = Math.max(12, hi - lo);

  const startCounts = new Map<number, number>();
  const startIndices = new Map<number, number>();
  notes.forEach((n) => startCounts.set(n.start, (startCounts.get(n.start) ?? 0) + 1));

  return (
    <div className="overflow-x-auto">
      <div className="p-6">
        <div className="flex justify-between text-xs text-zinc-500 mb-3">
          <span>Measure {currentMeasure + 1} of {data.measures.length}</span>
          <span>{data.key} · {data.tempoBpm} BPM</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Beginner notes view. Amber dotted chords are inferred; gray dotted chords have unknown provenance.">
          <rect x="0" y="0" width={W} height={H} fill="#fff" rx="12" />
          <line x1="24" y1="40" x2={W - 24} y2="40" stroke="#e4e4e7" />
          <line x1="24" y1="230" x2={W - 24} y2="230" stroke="#e4e4e7" />
          {notes.map((n, i) => {
            const beatOffset = n.start - m.startBeat;
            const count = startCounts.get(n.start) ?? 1;
            const idx = startIndices.get(n.start) ?? 0;
            startIndices.set(n.start, idx + 1);
            const xOffset = count > 1 ? (idx - (count - 1) / 2) * 16 : 0;
            const x = 60 + (beatOffset / measureBeats) * (W - 120) + xOffset;
            const y = 40 + ((hi - n.midi) / spread) * 190;
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
          {chords
            .filter((c) => c.beat >= m.startBeat && c.beat < m.endBeat)
            .map((c, i) => {
              const provenance = chordProvenance(c);
              const x = 60 + ((c.beat - m.startBeat) / measureBeats) * (W - 120);
              const width = Math.max(34, c.name.length * 7.5 + 10);
              return (
                <g key={`c${i}`} aria-label={`${c.name}: ${provenance.label}`}>
                  {provenance.dotted && (
                    <rect
                      x={x - width / 2}
                      y="246"
                      width={width}
                      height="24"
                      rx="4"
                      fill={provenance.fill}
                      stroke={provenance.stroke}
                      strokeWidth="1"
                      strokeDasharray="2 2"
                    />
                  )}
                  <title>{`${c.name}: ${provenance.label}`}</title>
                  <text
                    x={x}
                    y={264}
                    textAnchor="middle"
                    fontSize="13"
                    fontWeight="600"
                    fill={provenance.stroke}
                  >
                    {c.name}
                  </text>
                </g>
              );
            })}
          {time > 0 && <line x1={playX} y1="40" x2={playX} y2="230" stroke="#dc2626" strokeWidth="2" />}
        </svg>
      </div>
    </div>
  );
}
