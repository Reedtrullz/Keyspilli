"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { measureIndex, pitchColor, secPerBeat, type ChordLabel, type PlayerSettings, type SongData } from "@keyspilli/player-core";
import { chordProvenance } from "./chord-provenance";

const LETTERS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const pitchName = (midi: number) => `${LETTERS[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

export function BeginnerView({ data, time, settings, chords }: { data: SongData; time: number; settings: PlayerSettings; chords: ChordLabel[] }) {
  const beat = time / secPerBeat(data.tempoBpm, settings.speed);
  const currentMeasure = measureIndex(time, data.tempoBpm, settings.speed, data.timeSig, data.measures.length);
  const m = data.measures[currentMeasure] ?? data.measures[0]!;
  const scroller = useRef<HTMLDivElement>(null);
  const activeCell = useRef<HTMLTableCellElement>(null);
  // Project only when the bar or settings change, not on every transport tick.
  const columns = useMemo(() => {
    const events = new Map<number, { notes: SongData["notes"]; chords: ChordLabel[] }>();
    const at = (start: number) => {
      if (!events.has(start)) events.set(start, { notes: [], chords: [] });
      return events.get(start)!;
    };
    for (const note of data.notes) {
      if (note.start >= m.startBeat && note.start < m.endBeat) {
        at(note.start).notes.push({ ...note, midi: note.midi + settings.transpose });
      }
    }
    for (const chord of chords) {
      if (chord.beat >= m.startBeat && chord.beat < m.endBeat) at(chord.beat).chords.push(chord);
    }
    return [...events].sort(([a], [b]) => a - b).map(([start, event]) => ({ start, ...event }));
  }, [data.notes, chords, m.startBeat, m.endBeat, settings.transpose]);
  const activeIndex = columns.findIndex((column, i) => beat >= column.start && beat < (columns[i + 1]?.start ?? m.endBeat));
  useEffect(() => {
    const panel = scroller.current;
    const cell = activeCell.current;
    if (!panel) return;
    if (!cell) { panel.scrollLeft = 0; return; }
    const panelBox = panel.getBoundingClientRect();
    const cellBox = cell.getBoundingClientRect();
    // Move only this panel; following playback must never scroll the page.
    if (cellBox.left < panelBox.left + 80 || cellBox.right > panelBox.right) {
      panel.scrollLeft += cellBox.left - panelBox.left - 88;
    }
  }, [activeIndex, currentMeasure]);
  const nextMeasure = data.measures[currentMeasure + 1];
  const nextNotes = useMemo(() => nextMeasure ? data.notes
    .filter((note) => note.start >= nextMeasure.startBeat && note.start < nextMeasure.endBeat)
    .sort((a, b) => a.start - b.start)
    .slice(0, 9) : [], [data.notes, nextMeasure]);

  return (
    <div className="note-letters-view p-4 sm:p-6" aria-label="Note letters view">
      <div className="flex flex-wrap justify-between gap-2 text-xs text-zinc-500 mb-3">
        <span>Bar {currentMeasure + 1} of {data.measures.length}</span>
        <span>{data.key} · {data.tempoBpm} BPM</span>
      </div>
      <p className="text-sm text-zinc-600 mb-4">Scroll across the bar. Notes in the same column start together.</p>
      <div ref={scroller} className="note-letters-scroll" tabIndex={0} role="region" aria-label="Notes in this bar, scroll horizontally">
        {columns.length ? <table className="note-letters-table">
          <caption className="sr-only">Note starts by beat and hand. Numbers after pitch letters indicate octave.</caption>
          <thead><tr><th scope="col">Beat</th>{columns.map((column, i) => <th
            key={column.start} scope="col" ref={i === activeIndex ? activeCell : undefined}
            aria-current={i === activeIndex ? "true" : undefined}>
            {Number((1 + (column.start - m.startBeat) * data.timeSig[1] / 4).toFixed(2))}
          </th>)}</tr></thead>
          <tbody>{(["R", "L"] as const).map((hand) => <tr key={hand}>
            <th scope="row"><span aria-hidden="true">{hand}H</span><span className="sr-only">{hand === "R" ? "Right" : "Left"} hand</span></th>
            {columns.map((column, i) => <td key={column.start} data-current={i === activeIndex || undefined}>
              <div className="note-letter-stack">{column.notes.filter((note) => note.hand === hand).map((note, n) => <span
                key={n} data-midi={note.midi} className="note-letter-badge"
                data-sounding={beat >= note.start && beat < note.start + note.dur || undefined}
                style={{ borderLeftColor: pitchColor(note.midi) }}
                title={`${hand === "R" ? "Right" : "Left"} hand: ${pitchName(note.midi)}`}>
                {pitchName(note.midi)}
                {note.lyrics && <small>{note.lyrics}</small>}
              </span>)}</div>
            </td>)}
          </tr>)}
          {columns.some((column) => column.chords.length) && <tr>
            <th scope="row">Chord</th>{columns.map((column) => <td key={column.start}>{column.chords.map((chord, i) => {
              const provenance = chordProvenance(chord);
              return <span key={i} title={`${chord.name}: ${provenance.label}`} className={`note-letter-chord ${provenance.textClass} ${provenance.backgroundClass} ${provenance.borderClass}`} style={{ borderStyle: provenance.dotted ? "dotted" : "solid" }}>
                {chord.name}<small>{provenance.label}</small>
              </span>;
            })}</td>)}
          </tr>}
          </tbody>
        </table> : <p className="p-4 text-sm text-zinc-500">No note or chord starts in this bar.</p>}
      </div>
      <p className="mt-3 text-xs text-zinc-600">LH: left hand · RH: right hand · Number: octave (C4 is middle C). Columns mark starts, not note length. Empty cells have no new note.</p>
      {nextMeasure && <p className="mt-3 text-sm text-zinc-700" aria-label="Next bar preview">
        <strong>Next bar {currentMeasure + 2}: </strong>
        {nextNotes.length ? nextNotes.slice(0, 8).map((note) => `${note.hand === "L" ? "LH" : "RH"} ${pitchName(note.midi + settings.transpose)}`).join(" · ") : "No note onsets"}
        {nextNotes.length > 8 && " …"}
      </p>}
    </div>
  );
}
