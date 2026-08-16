"use client";

import { useEffect } from "react";
import { pitchColor, type SongData } from "@keyspilli/player-core";
import { chordProvenance } from "@/components/player/chord-provenance";

const LETTERS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function SimplifyScore({ data, title }: { data: SongData; title: string }) {
  useEffect(() => {
    (window as unknown as { __sheetReady?: boolean }).__sheetReady = true;
  }, []);
  const notes = data.notes.filter((n) => n.hand !== "L");
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
        const ms = data.measures.slice(row * measuresPerRow, (row + 1) * measuresPerRow);
        return (
          <div key={row} style={{ display: "flex", gap: 16, marginBottom: 24 }}>
            {ms.map((m) => {
              const mNotes = notes.filter((n) => n.start >= m.startBeat && n.start < m.endBeat);
              const mChords = data.chords.filter((c) => c.beat >= m.startBeat && c.beat < m.endBeat);
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
