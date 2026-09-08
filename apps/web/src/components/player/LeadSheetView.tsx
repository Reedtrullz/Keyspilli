"use client";

import React, { useMemo } from "react";
import { measureIndex, pitchColor, secPerBeat, type ChordLabel, type PlayerSettings, type SongData } from "@keyspilli/player-core";
import { chordProvenance } from "./chord-provenance";

const LETTERS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

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
  // Match the transposed audio so visual pitch positions stay correct.
  // The parent refreshes the transport UI at 10Hz. Memoize the active-measure
  // projection so playhead movement does not rescan every note in the song.
  const notes = useMemo(
    () => data.notes
      .filter((n) => n.start >= m.startBeat && n.start < m.endBeat && n.hand !== "L")
      .map((n) => ({ ...n, midi: n.midi + settings.transpose })),
    [data.notes, m.startBeat, m.endBeat, settings.transpose],
  );
  const measureBeats = m.endBeat - m.startBeat;
  const W = 880;
  const H = 240;
  const playX = 80 + ((time / beatSec - m.startBeat) / measureBeats) * (W - 160);
  // Scale by absolute pitch (not pitch class) so octave leaps render apart.
  const mids = useMemo(() => notes.map((n) => n.midi), [notes]);
  const lo = Math.min(...mids, 55);
  const hi = Math.max(...mids, 72);
  const hasLyrics = useMemo(() => data.notes.some((note) => note.lyrics?.trim()), [data.notes]);
  const hasMeasureLyrics = notes.some((note) => note.lyrics?.trim());
  const measureChords = useMemo(() => {
    const ordered = [...chords].sort((a, b) => a.beat - b.beat);
    return ordered.filter((chord, index) => {
      if (chord.beat >= m.startBeat) return chord.beat < m.endBeat;
      // A previous label alone does not establish harmony across a rest.
      const duration = chord.durationBeats;
      const end = Math.min(chord.beat + (duration ?? 0), ordered[index + 1]?.beat ?? Infinity);
      return Number.isFinite(duration) && duration! > 0 && end > m.startBeat;
    }).map((chord) => ({ chord, provenance: chordProvenance(chord) }));
  }, [chords, m.startBeat, m.endBeat]);

  return (
    <div className="overflow-x-auto">
      <div className="p-6">
        <svg viewBox={`0 0 ${W} ${H}`} className="player-notation-svg w-full" role="img" aria-label="Lead sheet view. Amber dotted chords are inferred; gray dotted chords have unknown provenance.">
          <rect width={W} height={H} fill="#fff" rx="12" />
          {notes.map((n, i) => {
            const x = 80 + ((n.start - m.startBeat) / measureBeats) * (W - 160);
            const y = 28 + ((hi - n.midi) / (hi - lo || 1)) * (H - 80);
            return (
              <g key={i}>
                <title>{`${LETTERS[((n.midi % 12) + 12) % 12]}${Math.floor(n.midi / 12) - 1}`}</title>
                <circle cx={x} cy={y} r="10" fill={pitchColor(n.midi)} />
                <text x={x} y={y - 13} textAnchor="middle" fontSize="12" fill="#18181b">
                  {LETTERS[((n.midi % 12) + 12) % 12]}{Math.floor(n.midi / 12) - 1}
                </text>
                {n.lyrics && (
                  <text x={x} y={y + 34} textAnchor="middle" fontSize="13" fill="#3f3f46">
                    {n.lyrics}
                  </text>
                )}
              </g>
            );
          })}
          {measureChords.map(({ chord: c, provenance }, i) => {
              const x = 80 + ((Math.max(c.beat, m.startBeat) - m.startBeat) / measureBeats) * (W - 160);
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
        <p className="text-xs text-zinc-500 mt-2">
          Bar {currentMeasure + 1} of {data.measures.length} · {notes.length ? "Pitch labels follow the right-hand notes." : "No right-hand note onsets in this bar."}
        </p>
        <p className="text-sm text-zinc-600 mt-2">
          {!hasLyrics ? "No lyrics available for this arrangement" : !hasMeasureLyrics ? "No sung words in this bar" : "Lyrics appear beside their notes."}
        </p>
        <p className="text-sm text-zinc-600 mt-2">
          {measureChords.length ? "Chord labels below retain the selected source’s provenance." : "No chord shown for this bar — follow the written notes or rest."}
        </p>
      </div>
    </div>
  );
}
