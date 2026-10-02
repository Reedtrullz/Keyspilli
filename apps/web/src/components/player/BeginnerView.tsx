"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { practiceContext } from "./player-ui-context";
import { learnerPitch, measureNoteIntervals, intervalSilences, intervalCue, type NoteInterval, measureIndex, pitchColor, playbackMeasures, secPerBeat, timeSignatureAtBeat, type ChordLabel, type PlayerSettings, type SongData } from "@keyspilli/player-core";
import { chordProvenance } from "./chord-provenance";
import { displayChordName } from "./chord-practice";


export function BeginnerView({ data, time, settings, chords, provisionalTempo = false, pitchCues = true }: { data: SongData; time: number; settings: PlayerSettings; chords: ChordLabel[]; provisionalTempo?: boolean; pitchCues?:boolean }) {
  const [following, setFollowing] = useState(true);
  const [reviewMeasure, setReviewMeasure] = useState(0);
  const beat = time / secPerBeat(data.tempoBpm, settings.speed);
  const measures = useMemo(() => playbackMeasures(data), [data]);
  const playbackMeasure = measureIndex(time, data.tempoBpm, settings.speed, data.timeSig, measures.length, measures);
  const currentMeasure = following ? playbackMeasure : Math.min(reviewMeasure, measures.length - 1);
  const pauseFollowing = () => { setReviewMeasure(currentMeasure); setFollowing(false); };
  const m = measures[currentMeasure] ?? measures[0]!;
  const scroller = useRef<HTMLDivElement>(null);
  const activeCell = useRef<HTMLTableCellElement>(null);
  // Project only when the bar or settings change, not on every transport tick.
  const columns = useMemo(() => {
    const events = new Map<number, { notes: NoteInterval[]; chords: ChordLabel[]; silences: {hand:"L"|"R"|undefined;endBeat:number}[] }>();
    const at = (start: number) => {
      if (!events.has(start)) events.set(start, { notes: [], chords: [], silences: [] });
      return events.get(start)!;
    };
    const intervals = measureNoteIntervals(data.notes,m.startBeat,m.endBeat);
    for (const interval of intervals) at(interval.startBeat).notes.push(interval);
    for(const hand of ["R","L",...(data.notes.some(note=>note.hand===undefined)?[undefined]:[])] as const) for(const silence of intervalSilences(intervals,m.startBeat,m.endBeat,hand)) at(silence.startBeat).silences.push({hand,endBeat:silence.endBeat});
    for (const chord of chords) {
      if (chord.beat >= m.startBeat && chord.beat < m.endBeat) at(chord.beat).chords.push(chord);
    }
    return [...events].sort(([a], [b]) => a - b).map(([start, event]) => ({ start, ...event }));
  }, [data.notes, chords, m.startBeat, m.endBeat, settings.transpose]);
  const activeIndex = columns.findIndex((column, i) => beat >= column.start && beat < (columns[i + 1]?.start ?? m.endBeat));
  useEffect(() => {
    const panel = scroller.current;
    const cell = activeCell.current;
    if (!panel || !following) return;
    if (!cell) { panel.scrollLeft = 0; return; }
    const panelBox = panel.getBoundingClientRect();
    const cellBox = cell.getBoundingClientRect();
    // Move only this panel; following playback must never scroll the page.
    if (cellBox.left < panelBox.left + 80 || cellBox.right > panelBox.right) {
      panel.scrollLeft += cellBox.left - panelBox.left - 88;
    }
  }, [activeIndex, currentMeasure, following]);
  useEffect(() => setFollowing(true), [data]);
  const nextMeasure = measures[currentMeasure + 1];
  const nextNotes = useMemo(() => nextMeasure ? data.notes
    .filter((note) => note.start < nextMeasure.endBeat && note.start+note.dur > nextMeasure.startBeat)
    .sort((a, b) => a.start - b.start)
    .slice(0, 9) : [], [data.notes, nextMeasure]);

  return (
    <div className="note-letters-view p-4 sm:p-6" aria-label="Note letters view">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-zinc-500 mb-3">
        <span>Bar {currentMeasure + 1} of {measures.length}</span>
        <span>{practiceContext(data.key, data.tempoBpm, settings, provisionalTempo)}</span>
      </div>
      <button className="player-follow-button" aria-pressed={following} onClick={() => following ? pauseFollowing() : setFollowing(true)}>{following ? "Pause following" : "Resume following"}</button>
      <div ref={scroller} className="note-letters-scroll" tabIndex={0} role="region" aria-label="Notes in this bar, scroll horizontally"
        onWheel={pauseFollowing} onTouchMove={pauseFollowing}
        onPointerDown={pauseFollowing} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) pauseFollowing(); }}>
        {columns.length ? <table className="note-letters-table">
          <caption className="sr-only">Note interval starts, carry and derived silence by beat and assigned hand. Numbers after pitch letters indicate octave.</caption>
          <thead><tr><th scope="col">Beat</th>{columns.map((column, i) => <th
            key={column.start} scope="col" ref={i === activeIndex ? activeCell : undefined}
            aria-current={i === activeIndex ? "true" : undefined}>
            {Number((1 + (column.start - m.startBeat) * timeSignatureAtBeat(column.start, data.timeSig, data.timeSigEvents)[1] / 4).toFixed(2))}
          </th>)}</tr></thead>
          <tbody>{(["R", "L",...(data.notes.some(note=>note.hand===undefined)?[undefined]:[])] as const).map((hand) => <tr key={hand??"unassigned"}>
            <th scope="row"><span aria-hidden="true">{hand?`${hand}H`:"?"}</span><span className="sr-only">{hand===undefined?"Unassigned part":hand === "R" ? "Right hand" : "Left hand"}</span></th>
            {columns.map((column, i) => <td key={column.start} data-current={i === activeIndex || undefined}>
              <div className="note-letter-stack">{column.notes.filter((interval) => interval.note.hand === hand).map((interval, n) => { const note=interval.note, midi=note.midi+settings.transpose; const pitch=learnerPitch(note,settings.transpose,data.key); const cue=intervalCue(interval,m.startBeat,timeSignatureAtBeat(interval.startBeat,data.timeSig,data.timeSigEvents)[1]/4); return <span
                key={n} data-midi={pitchCues?midi:undefined} className="note-letter-badge"
                data-sounding={beat >= note.start && beat < note.start + note.dur || undefined}
                style={{ borderLeftColor: pitchCues?pitchColor(midi):"currentColor" }}
                title={`${hand===undefined?"Unassigned part":hand === "R" ? "Right hand" : "Left hand"}: ${pitchCues?pitch.label:"Pitch cue reduced"} · ${cue} · ${pitch.authority} spelling`}>
                {pitchCues?pitch.label:"Pitch cue reduced"}
                <small>{cue}</small>
                {pitchCues && note.lyrics && <small>{note.lyrics}</small>}
              </span>; })}{column.silences.filter(silence=>silence.hand===hand).map(silence=><small key={silence.endBeat}>Silence to beat {Number((1+(silence.endBeat-m.startBeat)*timeSignatureAtBeat(column.start,data.timeSig,data.timeSigEvents)[1]/4).toFixed(3))}</small>)}</div>
            </td>)}
          </tr>)}
          {columns.some((column) => column.chords.length) && <tr>
            <th scope="row">Chord</th>{columns.map((column) => <td key={column.start}>{column.chords.map((chord, i) => {
              const provenance = chordProvenance(chord);
              const name = displayChordName(chord.name, settings.transpose);
              return <span key={i} title={`${pitchCues?name:"Chord cue reduced"}: ${provenance.label}`} className={`note-letter-chord ${provenance.textClass} ${provenance.backgroundClass} ${provenance.borderClass}`} style={{ borderStyle: provenance.dotted ? "dotted" : "solid" }}>
                {pitchCues?name:"Chord cue reduced"}<small>{provenance.label}</small>
              </span>;
            })}</td>)}
          </tr>}
          </tbody>
        </table> : <p className="p-4 text-sm text-zinc-500">No note or chord starts in this bar.</p>}
      </div>
      <p className="mt-3 text-xs text-zinc-600">LH: left hand · RH: right hand · Number: octave (C4 is middle C). Hold and carry cues follow note intervals, not inferred fingering or written ties. Silence is derived for each assigned hand; empty cells mean no new event.</p>
      {pitchCues && nextMeasure && <p className="mt-3 text-sm text-zinc-700" aria-label="Next bar preview">
        <strong>Next bar {currentMeasure + 2}: </strong>
        {nextNotes.length ? nextNotes.slice(0, 8).map((note) => `${note.start<nextMeasure.startBeat ? "Carry " : ""}${note.hand === "L" ? "LH" : "RH"} ${learnerPitch(note,settings.transpose,data.key).label}`).join(" · ") : "No note onsets"}
        {nextNotes.length > 8 && " …"}
      </p>}
    </div>
  );
}
