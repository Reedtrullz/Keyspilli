"use client";

import React, { useMemo } from "react";
import { learnerPitch, measureNoteIntervals, intervalSilences, intervalCue, measureIndex, pitchColor, playbackMeasures, secPerBeat, timeSignatureAtBeat, type ChordLabel, type PlayerSettings, type SongData } from "@keyspilli/player-core";
import { chordProvenance } from "./chord-provenance";
import { displayChordName } from "./chord-practice";


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
    () => measureNoteIntervals(data.notes.filter(note=>note.hand!=="L"),m.startBeat,m.endBeat)
      .map(interval=>({...interval.note,midi:interval.note.midi+settings.transpose,interval,pitch:learnerPitch(interval.note,settings.transpose,data.key)})),
    [data.notes, m.startBeat, m.endBeat, settings.transpose,data.key],
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
  const silences=useMemo(()=>intervalSilences(notes.map(note=>note.interval),m.startBeat,m.endBeat,"all"),[notes,m.startBeat,m.endBeat]);
  const events = useMemo(() => {
    // ponytail: bounded to one bar; group by onset if dense scores make this scan measurable.
    const starts = [...new Set([...notes.map(n => n.interval.startBeat), ...silences.map(item=>item.startBeat), ...measureChords.map(({ chord }) => Math.max(m.startBeat, chord.beat))])].sort((a, b) => a - b);
    return starts.map(start => ({ start, notes: notes.filter(n => n.interval.startBeat === start), silences:silences.filter(item=>item.startBeat===start), chords: measureChords.filter(({ chord }) => Math.max(m.startBeat, chord.beat) === start) }));
  }, [notes, silences, measureChords, m.startBeat]);

  return (
    <div className="overflow-x-auto" aria-label="Lead sheet view">
      <div className="p-6">
        <svg viewBox={`0 0 ${W} ${H}`} className="player-notation-svg w-full" role="img" aria-label="Lead sheet pitch positions. Notes, lyrics and chord provenance are listed by beat below.">
          <rect width={W} height={H} fill="#fff" rx="12" />
          {notes.map((n, i) => {
            const x = 80 + ((n.interval.startBeat - m.startBeat) / measureBeats) * (W - 160);
            const y = 28 + ((hi - n.midi) / (hi - lo || 1)) * (H - 80);
            return (
              <g key={i}>
                <title>{`${n.pitch.label} · ${n.pitch.authority} spelling · ${intervalCue(n.interval,m.startBeat,timeSignatureAtBeat(n.interval.startBeat,data.timeSig,data.timeSigEvents)[1]/4)}`}</title>
                <line x1={x} x2={80+((n.interval.endBeat-m.startBeat)/measureBeats)*(W-160)} y1={y} y2={y} stroke={pitchColor(n.midi)} strokeWidth="3" strokeDasharray={n.interval.carry?"3 2":undefined}/>
                <circle cx={x} cy={y} r="3" fill={n.interval.carry?"white":pitchColor(n.midi)} stroke={pitchColor(n.midi)} />
              </g>
            );
          })}
          {time > 0 && <line x1={playX} y1="28" x2={playX} y2={H - 52} stroke="#dc2626" strokeWidth="2" />}
        </svg>
        {events.length > 0 && <div className="lead-events-scroll" tabIndex={0} role="region" aria-label="Lead sheet events">
          <table className="lead-events"><caption className="sr-only">Right-hand intervals, carry, derived silence, lyrics and chord provenance by beat</caption>
            <thead><tr>{events.map(event => <th scope="col" key={event.start}>Beat {Number((1 + (event.start - m.startBeat) * timeSignatureAtBeat(event.start, data.timeSig, data.timeSigEvents)[1] / 4).toFixed(3))}</th>)}</tr></thead>
            <tbody><tr>{events.map(event => <td key={event.start}>
              {event.notes.map((note, index) => <div key={index} data-midi={note.midi} className="lead-pitch" title={`${note.pitch.authority} spelling`}>{note.pitch.label}<small>{intervalCue(note.interval,m.startBeat,timeSignatureAtBeat(note.interval.startBeat,data.timeSig,data.timeSigEvents)[1]/4)}</small></div>)}
              {event.silences.map(silence=><small key={silence.endBeat}>Silence to beat {Number((1+(silence.endBeat-m.startBeat)*timeSignatureAtBeat(event.start,data.timeSig,data.timeSigEvents)[1]/4).toFixed(3))}</small>)}
              {[...new Set(event.notes.flatMap(note => note.lyrics?.trim() ? [note.lyrics] : []))].map(lyric => <p className="lead-lyric" key={lyric}>{lyric}</p>)}
              {event.chords.map(({ chord, provenance }, index) => <p key={index} className={`lead-chord ${provenance.textClass}`} title={`${chord.name}: ${provenance.label}`}>{chord.name}<small>{provenance.label}</small></p>)}
            </td>)}</tr></tbody>
          </table>
        </div>}
        <p className="text-xs text-zinc-500 mt-2">
          Bar {currentMeasure + 1} of {measures.length} · {notes.length ? "Pitch labels follow the right-hand notes." : "No right-hand sounding intervals in this bar."}
        </p>
        <p className="text-xs text-zinc-500 mt-2">Lines show note intervals. Open marks show carry, not another attack. Silence is derived from the shown melody intervals, not invented written rests.</p>
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
