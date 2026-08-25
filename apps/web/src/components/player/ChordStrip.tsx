"use client";

import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ChordLabel } from "@keyspilli/midi";
import { chordProvenance } from "./chord-provenance";

interface ChordStripProps {
  chords: ChordLabel[];
  currentBeat: number;
}

const MINI_KEYBOARD_WIDTH = 56;
const MINI_KEYBOARD_HEIGHT = 28;
const WHITE_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11] as const;
const BLACK_PITCH_CLASSES = [1, 3, 6, 8, 10] as const;
const MINI_WHITE_KEY_WIDTH = MINI_KEYBOARD_WIDTH / WHITE_PITCH_CLASSES.length;

// The existing strip's measured Horn items are ~72px wide with an 8px flex
// gap. Keep the same slot geometry so virtualization preserves the scroll
// range while only materializing the viewport plus a small overscan buffer.
const CHORD_ITEM_WIDTH = 72;
const CHORD_ITEM_GAP = 8;
const CHORD_SLOT_WIDTH = CHORD_ITEM_WIDTH + CHORD_ITEM_GAP;
const CHORD_VIRTUAL_BUFFER = 4;
const CHORD_DEFAULT_VIEWPORT_WIDTH = 960;
const CHORD_STRIP_HEIGHT = 52;

function roundedRectPath(x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  const n = (value: number) => Number(value.toFixed(2)).toString();
  return [
    `M${n(x + r)} ${n(y)}`,
    `H${n(x + width - r)}`,
    `Q${n(x + width)} ${n(y)} ${n(x + width)} ${n(y + r)}`,
    `V${n(y + height - r)}`,
    `Q${n(x + width)} ${n(y + height)} ${n(x + width - r)} ${n(y + height)}`,
    `H${n(x + r)}`,
    `Q${n(x)} ${n(y + height)} ${n(x)} ${n(y + height - r)}`,
    `V${n(y + r)}`,
    `Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}`,
    "Z",
  ].join("");
}

function keyPath(pitchClass: number) {
  const whiteIndex = WHITE_PITCH_CLASSES.indexOf(pitchClass as (typeof WHITE_PITCH_CLASSES)[number]);
  if (whiteIndex >= 0) {
    return roundedRectPath(whiteIndex * MINI_WHITE_KEY_WIDTH, 0, MINI_WHITE_KEY_WIDTH - 1, MINI_KEYBOARD_HEIGHT, 2);
  }
  const whiteBefore = WHITE_PITCH_CLASSES.filter((pc) => pc <= pitchClass).length;
  return roundedRectPath(
    whiteBefore * MINI_WHITE_KEY_WIDTH - MINI_WHITE_KEY_WIDTH * 0.3,
    0,
    MINI_WHITE_KEY_WIDTH * 0.6,
    MINI_KEYBOARD_HEIGHT * 0.6,
    1,
  );
}

const MINI_KEY_IDS = new Map(
  [...WHITE_PITCH_CLASSES, ...BLACK_PITCH_CLASSES].map((pc) => [pc, `keyspilli-mini-key-${pc}`]),
);
const MINI_KEYBOARD_BASE_ID = "keyspilli-mini-keyboard-base";

/** Define the immutable keyboard geometry once per strip. Each keyboard then
 * references this base plus only its active pitch classes via <use>, avoiding
 * repeated path data in the server-rendered HTML. */
function MiniKeyboardDefs() {
  return (
    <svg aria-hidden="true" width={0} height={0} className="absolute h-0 w-0 overflow-hidden">
      <defs>
        {[...WHITE_PITCH_CLASSES, ...BLACK_PITCH_CLASSES].map((pc) => (
          <path key={pc} id={MINI_KEY_IDS.get(pc)} d={keyPath(pc)} />
        ))}
        <g id={MINI_KEYBOARD_BASE_ID}>
          {WHITE_PITCH_CLASSES.map((pc) => (
            <use key={`base-w-${pc}`} href={`#${MINI_KEY_IDS.get(pc)}`} fill="#ffffff" stroke="#d4d4d8" strokeWidth={0.5} />
          ))}
          {BLACK_PITCH_CLASSES.map((pc) => (
            <use key={`base-b-${pc}`} href={`#${MINI_KEY_IDS.get(pc)}`} fill="#27272a" />
          ))}
        </g>
      </defs>
    </svg>
  );
}

/** Mini piano keyboard diagram for a single chord. Memoized so per-frame
 * active-index changes only re-render the two affected items. Referencing
 * shared geometry keeps each keyboard at four-to-five SVG nodes (the prior
 * rect-per-key version needed twelve), which materially reduces the 745-chord
 * player DOM and server HTML while preserving the visual and accessible
 * contract. */
const MiniKeyboard = memo(function MiniKeyboard({ notes }: { notes: number[] }) {
  if (notes.length === 0) return null;
  const noteSet = new Set(notes.map((n) => n % 12));
  const activeWhiteKeys = WHITE_PITCH_CLASSES.filter((pc) => noteSet.has(pc));
  const activeBlackKeys = BLACK_PITCH_CLASSES.filter((pc) => noteSet.has(pc));

  return (
    <svg width={MINI_KEYBOARD_WIDTH} height={MINI_KEYBOARD_HEIGHT} viewBox={`0 0 ${MINI_KEYBOARD_WIDTH} ${MINI_KEYBOARD_HEIGHT}`} aria-hidden="true">
      <use href={`#${MINI_KEYBOARD_BASE_ID}`} />
      {activeWhiteKeys.map((pc) => (
        <use key={`active-w-${pc}`} href={`#${MINI_KEY_IDS.get(pc)}`} fill="#3b82f6" stroke="#d4d4d8" strokeWidth={0.5} />
      ))}
      {activeBlackKeys.map((pc) => (
        <use key={`active-b-${pc}`} href={`#${MINI_KEY_IDS.get(pc)}`} fill="#2563eb" />
      ))}
    </svg>
  );
});

const ACTIVE_CHORD_CLASS = "bg-blue-50 ring-1 ring-blue-300";

/**
 * Chord content is immutable while the playhead moves. Keep each item behind
 * a memo boundary so a list rebuild only renders the item whose active state
 * changed (the active class itself is toggled by ChordStrip below).
 */
const ChordItem = memo(function ChordItem({
  chord,
  index,
  active,
  setSize,
}: {
  chord: ChordLabel;
  index: number;
  active: boolean;
  setSize: number;
}) {
  const provenance = chordProvenance(chord);
  return (
    <div
      data-chord-idx={index}
      data-source-kind={chord.sourceKind ?? "unknown"}
      role="listitem"
      aria-posinset={index + 1}
      aria-setsize={setSize}
      aria-label={`${chord.name}: ${provenance.label}`}
      title={provenance.label}
      className={`flex flex-col items-center gap-0.5 shrink-0 px-2 py-1 rounded-lg transition-colors ${active ? ACTIVE_CHORD_CLASS : ""}`}
    >
      <span className={`text-[10px] font-semibold leading-tight ${provenance.textClass} ${provenance.dotted ? `border-b border-dotted ${provenance.borderClass}` : ""}`}>
        {chord.name}
      </span>
      <MiniKeyboard notes={chord.notes} />
    </div>
  );
});

export const ChordStrip = memo(function ChordStrip({ chords, currentBeat }: ChordStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const previousActiveIdxRef = useRef<number | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(CHORD_DEFAULT_VIEWPORT_WIDTH);
  // Find which chord is currently active
  let activeIdx = 0;
  for (let i = chords.length - 1; i >= 0; i--) {
    if (currentBeat >= chords[i]!.beat) {
      activeIdx = i;
      break;
    }
  }

  // Measure the real viewport after hydration. The deterministic fallback is
  // intentionally large enough for a useful first SSR paint and is replaced
  // by the actual width before the user can scroll.
  useEffect(() => {
    const root = stripRef.current;
    if (!root) return;
    const update = () => setViewportWidth(Math.max(1, root.clientWidth));
    update();
    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(update)
      : null;
    resizeObserver?.observe(root);
    window.addEventListener("resize", update);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const visibleCount = Math.max(1, Math.ceil(viewportWidth / CHORD_SLOT_WIDTH));
  const visibleStart = Math.max(0, Math.floor(scrollLeft / CHORD_SLOT_WIDTH) - CHORD_VIRTUAL_BUFFER);
  const visibleEnd = Math.min(chords.length, visibleStart + visibleCount + CHORD_VIRTUAL_BUFFER * 2);
  const activeOutsideWindow = activeIdx >= 0
    && activeIdx < chords.length
    && (activeIdx < visibleStart || activeIdx >= visibleEnd)
    ? activeIdx
    : null;
  // Keep the active item mounted even while smooth scrolling catches up. This
  // preserves its accessible position and gives the active-state effect a
  // stable target when playback advances outside the current window.
  const renderedIndices = useMemo(
    () => {
      const indices = Array.from(
        { length: Math.max(0, visibleEnd - visibleStart) },
        (_, offset) => visibleStart + offset,
      );
      if (activeOutsideWindow !== null) indices.push(activeOutsideWindow);
      return [...new Set(indices)].sort((a, b) => a - b);
    },
    [activeOutsideWindow, visibleEnd, visibleStart],
  );

  // Build the expensive chord/SVG subtree only when the timeline changes.
  // During playback currentBeat changes every 100ms, so rebuilding 700+
  // children here would otherwise dominate the React work. The initial active
  // class is captured for SSR/hydration; subsequent active changes are limited
  // to classList updates on the old and new elements below.
  const chordItems = useMemo(
    () => renderedIndices.map((index) => {
      const chord = chords[index]!;
      return (
        <div
          key={index}
          style={{
            position: "absolute",
            left: index * CHORD_SLOT_WIDTH,
            top: 0,
            width: CHORD_ITEM_WIDTH,
          }}
        >
          <ChordItem
            chord={chord}
            index={index}
            setSize={chords.length}
            active={index === activeIdx}
          />
        </div>
      );
    }),
    [chords, renderedIndices],
  );

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    const next = Math.max(0, event.currentTarget.scrollLeft);
    setScrollLeft((previous) => previous === next ? previous : next);
  }

  useEffect(() => {
    const root = stripRef.current;
    if (!root) return;
    const previousIdx = previousActiveIdxRef.current;
    if (previousIdx !== null && previousIdx !== activeIdx) {
      root.querySelector(`[data-chord-idx="${previousIdx}"]`)?.classList.remove(...ACTIVE_CHORD_CLASS.split(" "));
    }
    root.querySelector(`[data-chord-idx="${activeIdx}"]`)?.classList.add(...ACTIVE_CHORD_CLASS.split(" "));
    previousActiveIdxRef.current = activeIdx;
  }, [activeIdx]);

  // Keep the active chord visible even when the user scrolled elsewhere.
  useEffect(() => {
    stripRef.current
      ?.querySelector(`[data-chord-idx="${activeIdx}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeIdx]);

  if (chords.length === 0) return null;

  return (
    <>
      <MiniKeyboardDefs />
      <div
        ref={stripRef}
        onScroll={handleScroll}
        className="relative overflow-x-auto px-3 py-2 border-b border-zinc-100 bg-white"
        role="list"
        aria-label="Chord progression. Amber dotted chords are inferred; gray dotted chords have unknown provenance."
      >
        <div
          role="presentation"
          style={{
            position: "relative",
            width: chords.length * CHORD_SLOT_WIDTH,
            minWidth: chords.length * CHORD_SLOT_WIDTH,
            height: CHORD_STRIP_HEIGHT,
          }}
        >
          {chordItems}
        </div>
      </div>
    </>
  );
});
