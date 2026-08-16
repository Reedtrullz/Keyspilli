"use client";

import React from "react";
import { measureIndex, pitchColor, secPerBeat, type ChordLabel, type PlayerSettings, type SongData } from "@keyspilli/player-core";
import { chordProvenance } from "./chord-provenance";

export function LeadSheetView({ data, time, settings, chords }: { data: SongData; time: number; settings: PlayerSettings; chords: ChordLabel[] }) {
  const beatSec = secPerBeat(data.tempoBpm, settings.speed);
  const currentMeasure = measureIndex(
    time,
    data.tempoBpm,
    settings.speed,
    data.timeSig,
    data.measures.length,
  );
  const m = data.measures[currentMeasure] ?? data.measures[0]!;
  const notes = data.notes.filter((n) => n.start >= m.startBeat && n.start < m.endBeat && n.hand !== "L");
  const measureBeats = m.endBeat - m.startBeat;
  const W = 880;
  const H = 240;
  const playX = 80 + ((time / beatSec - m.startBeat) / measureBeats) * (W - 160);
  // Scale by absolute pitch (not pitch class) so octave leaps render apart.
  const mids = notes.map((n) => n.midi);
  const lo = Math.min(...mids, 55);
  const hi = Math.max(...mids, 72);

  return (
    <div className="overflow-x-auto">
      <div className="p-6">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Lead sheet view. Amber dotted chords are inferred; gray dotted chords have unknown provenance.">
          <rect width={W} height={H} fill="#fff" rx="12" />
          {notes.map((n, i) => {
            const x = 80 + ((n.start - m.startBeat) / measureBeats) * (W - 160);
            const y = 28 + ((hi - n.midi) / (hi - lo || 1)) * (H - 80);
            return (
              <g key={i}>
                <circle cx={x} cy={y} r="10" fill={pitchColor(n.midi)} />
                {n.lyrics && (
                  <text x={x} y={y + 34} textAnchor="middle" fontSize="13" fill="#3f3f46">
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
              const x = 80 + ((c.beat - m.startBeat) / measureBeats) * (W - 160);
              const width = Math.max(36, c.name.length * 8 + 12);
              return (
                <g key={`c${i}`} aria-label={`${c.name}: ${provenance.label}`}>
                  {provenance.dotted && (
                    <rect
                      x={x - width / 2}
                      y={H - 56}
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
                    y={H - 36}
                    textAnchor="middle"
                    fontSize="14"
                    fontWeight="700"
                    fill={provenance.stroke}
                  >
                    {c.name}
                  </text>
                </g>
              );
            })}
          {time > 0 && <line x1={playX} y1="28" x2={playX} y2={H - 52} stroke="#dc2626" strokeWidth="2" />}
        </svg>
        <p className="text-xs text-zinc-400 mt-2">
          Measure {currentMeasure + 1} of {data.measures.length} — dots follow the melody, chords below for your left hand.
        </p>
      </div>
    </div>
  );
}
