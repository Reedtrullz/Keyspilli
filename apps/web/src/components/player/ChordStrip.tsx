"use client";

import { memo, useEffect, useRef } from "react";
import type { ChordLabel } from "@keyspilli/midi";
import { chordProvenance } from "./chord-provenance";

interface ChordStripProps {
  chords: ChordLabel[];
  currentBeat: number;
}

/** Mini piano keyboard diagram for a single chord. Memoized so per-frame
 * active-index changes only re-render the two affected items. */
const MiniKeyboard = memo(function MiniKeyboard({ notes }: { notes: number[] }) {
  if (notes.length === 0) return null;
  const low = Math.min(...notes);
  // Anchor a full octave at the chord's lowest note and highlight by pitch
  // class. Chords in the data span 3-4 octaves (bass + melody doublings), so a
  // window cropped to the note span would hide most of the chord's keys.
  const rangeLow = Math.floor(low / 12) * 12;
  const W = 56;
  const H = 28;
  const noteSet = new Set(notes.map((n) => n % 12));
  const WHITE = [0, 2, 4, 5, 7, 9, 11];
  const whites = [...WHITE];
  const ww = W / whites.length;

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {whites.map((pc, i) => {
        const midi = pc + rangeLow;
        const active = noteSet.has(pc);
        return (
          <rect
            key={`w${i}`}
            x={i * ww}
            y={0}
            width={ww - 1}
            height={H}
            rx={2}
            fill={active ? "#3b82f6" : "#ffffff"}
            stroke="#d4d4d8"
            strokeWidth={0.5}
          />
        );
      })}
      {whites.slice(0, -1).map((pc, i) => {
        const sharpPc = pc + 1;
        const isBlack = !WHITE.includes(sharpPc);
        if (!isBlack) return null;
        const midi = sharpPc + rangeLow;
        const active = noteSet.has(midi % 12);
        const x = (i + 1) * ww - ww * 0.3;
        const bw = ww * 0.6;
        return (
          <rect
            key={`b${i}`}
            x={x}
            y={0}
            width={bw}
            height={H * 0.6}
            rx={1}
            fill={active ? "#2563eb" : "#27272a"}
          />
        );
      })}
    </svg>
  );
});

export const ChordStrip = memo(function ChordStrip({ chords, currentBeat }: ChordStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  // Find which chord is currently active
  let activeIdx = 0;
  for (let i = chords.length - 1; i >= 0; i--) {
    if (currentBeat >= chords[i]!.beat) {
      activeIdx = i;
      break;
    }
  }

  // Keep the active chord visible even when the user scrolled elsewhere.
  useEffect(() => {
    stripRef.current
      ?.querySelector(`[data-chord-idx="${activeIdx}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeIdx]);

  if (chords.length === 0) return null;

  return (
    <div ref={stripRef} className="flex gap-2 overflow-x-auto px-3 py-2 border-b border-zinc-100 bg-white" role="list" aria-label="Chord progression. Amber dotted chords are inferred; gray dotted chords have unknown provenance.">
      {chords.map((c, i) => {
        const provenance = chordProvenance(c);
        return (
          <div
            key={i}
            data-chord-idx={i}
            data-source-kind={c.sourceKind ?? "unknown"}
            role="listitem"
            aria-label={`${c.name}: ${provenance.label}`}
            title={provenance.label}
            className={`flex flex-col items-center gap-0.5 shrink-0 px-2 py-1 rounded-lg transition-colors ${
              i === activeIdx ? "bg-blue-50 ring-1 ring-blue-300" : ""
            }`}
          >
            <span className={`text-[10px] font-semibold leading-tight ${provenance.textClass} ${provenance.dotted ? `border-b border-dotted ${provenance.borderClass}` : ""}`}>
              {c.name}
            </span>
            <MiniKeyboard notes={c.notes} />
          </div>
        );
      })}
    </div>
  );
});
