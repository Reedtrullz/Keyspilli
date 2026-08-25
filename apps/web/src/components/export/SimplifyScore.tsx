"use client";

import React, { useEffect, useMemo } from "react";
import { pitchColor, type MeasureInfo, type SongData } from "@keyspilli/player-core";
import { chordProvenance } from "../player/chord-provenance";

const LETTERS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * Bucket timeline events by measure once instead of filtering the complete
 * arrangement for every measure in the printable score.  Normal catalogue
 * measures are sorted and non-overlapping, so a binary search gives O(N log M)
 * preprocessing while preserving each input array's order inside a bucket.
 * The fallback keeps the old inclusive-range semantics for malformed or
 * overlapping measure metadata rather than silently dropping an event.
 */
function bucketByMeasure<T>(
  items: readonly T[],
  measures: readonly MeasureInfo[],
  beatOf: (item: T) => number,
): T[][] {
  const buckets = measures.map(() => [] as T[]);
  if (items.length === 0 || measures.length === 0) return buckets;

  const ordered = measures.every((measure, index) => index === 0 || measure.startBeat >= measures[index - 1]!.startBeat);
  const disjoint = measures.every((measure, index) => index === 0 || measure.startBeat >= measures[index - 1]!.endBeat);
  if (!ordered || !disjoint) {
    for (const item of items) {
      const beat = beatOf(item);
      if (!Number.isFinite(beat)) continue;
      measures.forEach((measure, index) => {
        if (beat >= measure.startBeat && beat < measure.endBeat) buckets[index]!.push(item);
      });
    }
    return buckets;
  }

  for (const item of items) {
    const beat = beatOf(item);
    if (!Number.isFinite(beat)) continue;
    let low = 0;
    let high = measures.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (measures[middle]!.endBeat <= beat) low = middle + 1;
      else high = middle;
    }
    const measure = measures[low];
    if (measure && beat >= measure.startBeat && beat < measure.endBeat) buckets[low]!.push(item);
  }
  return buckets;
}

export function SimplifyScore({ data, title }: { data: SongData; title: string }) {
  useEffect(() => {
    (window as unknown as { __sheetReady?: boolean }).__sheetReady = true;
  }, []);
  const notes = useMemo(() => data.notes.filter((n) => n.hand !== "L"), [data.notes]);
  const noteBuckets = useMemo(
    () => bucketByMeasure(notes, data.measures, (note) => note.start),
    [notes, data.measures],
  );
  const chordBuckets = useMemo(
    () => bucketByMeasure(data.chords, data.measures, (chord) => chord.beat),
    [data.chords, data.measures],
  );
  const measuresPerRow = 4;
  const rows = Math.ceil(data.measures.length / measuresPerRow);
  return (
    <div style={{ padding: 40, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>{title}</h1>
      <p style={{ fontSize: 12, color: "#71717a", margin: "0 0 24px" }}>
        Key {data.key} · {data.tempoBpm} BPM · Color-coded learner score — every note colored by pitch
      </p>
      <p style={{ fontSize: 11, color: "#71717a", margin: "-12px 0 24px" }}>
        Dotted amber chords are inferred; dotted gray chords have unknown provenance.
      </p>
      {Array.from({ length: rows }, (_, row) => {
        const rowStart = row * measuresPerRow;
        const ms = data.measures.slice(rowStart, rowStart + measuresPerRow);
        return (
          <div key={row} style={{ display: "flex", gap: 16, marginBottom: 24 }}>
            {ms.map((m, column) => {
              const measureIndex = rowStart + column;
              const mNotes = noteBuckets[measureIndex] ?? [];
              const mChords = chordBuckets[measureIndex] ?? [];
              const beats = m.endBeat - m.startBeat;
              return (
                <div key={m.index} style={{ flex: 1, border: "1px solid #e4e4e7", borderRadius: 8, padding: 12, minHeight: 220 }}>
                  <div style={{ fontSize: 10, color: "#a1a1aa", marginBottom: 8 }}>{m.index + 1}</div>
                  <div style={{ position: "relative", height: 150 }}>
                    {mNotes.map((n, i) => {
                      const x = ((n.start - m.startBeat) / beats) * 100 + 4;
                      const y = 130 - (n.midi - 55) * 5;
                      return (
                        <div key={i} style={{ position: "absolute", left: `${x}%`, top: y, transform: "translateX(-50%)" }}>
                          <div
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: "50%",
                              background: pitchColor(n.midi),
                              color: "#fff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            {LETTERS[n.midi % 12]}
                          </div>
                          {n.lyrics && <div style={{ fontSize: 10, textAlign: "center", marginTop: 2 }}>{n.lyrics}</div>}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {mChords.map((c, i) => {
                      const provenance = chordProvenance(c);
                      return (
                        <span
                          key={i}
                          title={provenance.label}
                          aria-label={`${c.name}: ${provenance.label}`}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: provenance.stroke,
                            background: provenance.fill,
                            border: `1px ${provenance.dotted ? "dotted" : "solid"} ${provenance.stroke}`,
                            borderRadius: 6,
                            padding: "2px 6px",
                          }}
                        >
                          {c.name}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
