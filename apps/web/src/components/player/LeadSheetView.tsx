"use client";

import React, { useMemo } from "react";
import { measureIndex, pitchColor, playbackMeasures, secPerBeat, timeSignatureAtBeat, type ChordLabel, type PlayerSettings, type SongData } from "@keyspilli/player-core";
import { chordProvenance } from "./chord-provenance";
import { displayChordName } from "./chord-practice";

const LETTERS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function LeadSheetView({ data, time, settings, chords }: { data: SongData; time: number; settings: PlayerSettings; chords: ChordLabel[] }) {
  const beatSec = secPerBeat(data.tempoBpm, settings.speed);
  const measures = useMemo(() => playbackMeasures(data), [data]);
  const currentMeasure = measureIndex(
    time,
    data.tempoBpm,
    settings.speed,
    data.timeSig,
    measures.length,
    measures,
  );
  const m = measures[currentMeasure] ?? measures[0]!;
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
    }).map((chord) => ({ chord: { ...chord, name: displayChordName(chord.name, settings.transpose) }, provenance: chordProvenance(chord) }));
  }, [chords, m.startBeat, m.endBeat, settings.transpose]);
  const events = useMemo(() => {
    // ponytail: bounded to one bar; group by onset if dense scores make this scan measurable.
    const starts = [...new Set([...notes.map(n => n.start), ...measureChords.map(({ chord }) => Math.max(m.startBeat, chord.beat))])].sort((a, b) => a - b);
    return starts.map(start => ({ start, notes: notes.filter(n => n.start === start), chords: measureChords.filter(({ chord }) => Math.max(m.startBeat, chord.beat) === start) }));
  }, [notes, measureChords, m.startBeat]);

  return (
    <div className="overflow-x-auto">
      <div className="p-6">
        <svg viewBox={`0 0 ${W} ${H}`} className="player-notation-svg w-full" role="img" aria-label="Lead sheet pitch positions. Notes, lyrics and chord provenance are listed by beat below.">
          <rect width={W} height={H} fill="#fff" rx="12" />
          {notes.map((n, i) => {
            const x = 80 + ((n.start - m.startBeat) / measureBeats) * (W - 160);
            const y = 28 + ((hi - n.midi) / (hi - lo || 1)) * (H - 80);
            return (
              <g key={i}>
                <title>{`${LETTERS[((n.midi % 12) + 12) % 12]}${Math.floor(n.midi / 12) - 1}`}</title>
                <circle cx={x} cy={y} r="3" fill={pitchColor(n.midi)} />
              </g>
            );
          })}
          {time > 0 && <line x1={playX} y1="28" x2={playX} y2={H - 52} stroke="#dc2626" strokeWidth="2" />}
        </svg>
        {events.length > 0 && <div className="lead-events-scroll" tabIndex={0} role="region" aria-label="Lead sheet events">
          <table className="lead-events"><caption className="sr-only">Right-hand attacks, lyrics and chord provenance by beat</caption>
            <thead><tr>{events.map(event => <th scope="col" key={event.start}>Beat {Number((1 + (event.start - m.startBeat) * timeSignatureAtBeat(event.start, data.timeSig, data.timeSigEvents)[1] / 4).toFixed(3))}</th>)}</tr></thead>
            <tbody><tr>{events.map(event => <td key={event.start}>
              {event.notes.map((note, index) => <div key={index} data-midi={note.midi} className="lead-pitch">{LETTERS[((note.midi % 12) + 12) % 12]}{Math.floor(note.midi / 12) - 1}</div>)}
              {[...new Set(event.notes.flatMap(note => note.lyrics?.trim() ? [note.lyrics] : []))].map(lyric => <p className="lead-lyric" key={lyric}>{lyric}</p>)}
              {event.chords.map(({ chord, provenance }, index) => <p key={index} className={`lead-chord ${provenance.textClass}`} title={`${chord.name}: ${provenance.label}`}>{chord.name}<small>{provenance.label}</small></p>)}
            </td>)}</tr></tbody>
          </table>
        </div>}
        <p className="text-xs text-zinc-500 mt-2">
          Bar {currentMeasure + 1} of {measures.length} · {notes.length ? "Pitch labels follow the right-hand notes." : "No right-hand note onsets in this bar."}
        </p>
        <p className="text-sm text-zinc-600 mt-2">
          {!hasLyrics ? "No lyrics available for this arrangement" : !hasMeasureLyrics ? "No sung words in this bar" : ""}
        </p>
        <p className="text-sm text-zinc-600 mt-2">
          {measureChords.length ? "Chord labels below retain the selected source’s provenance." : "No chord shown for this bar — follow the written notes or rest."}
        </p>
      </div>
    </div>
  );
}
