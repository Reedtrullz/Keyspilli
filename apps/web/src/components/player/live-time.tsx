"use client";

import { memo, useSyncExternalStore } from "react";
import { secPerBeat } from "@keyspilli/player-core";
import { ChordStrip } from "./ChordStrip";

/**
 * Playback clock as an external store. The player publishes the engine time
 * here at 10 Hz; only components that display time subscribe, so a tick no
 * longer re-renders the whole player.
 */
export interface TimeStore {
  get(): number;
  set(time: number): void;
  subscribe(listener: () => void): () => void;
}

export function createTimeStore(initial = 0): TimeStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Subscribe to a primitive derived from the clock; re-renders only when it changes. */
export function useTimeSelector<T extends string | number | boolean>(store: TimeStore, select: (time: number) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}

export function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

/** Elapsed / total / remaining readout; changes once per second. */
export const TimeReadout = memo(function TimeReadout({ store, duration }: { store: TimeStore; duration: number }) {
  // One string selector keeps elapsed and remaining in step with the old
  // per-render formatting while still re-rendering at most once a second.
  const shown = useTimeSelector(store, (t) => `${formatClock(t)}|${formatClock(Math.max(0, duration - t))}`);
  const [elapsed, remaining] = shown.split("|");
  return (
    <output role="timer" aria-label="Elapsed time" className="ml-auto text-xs text-zinc-500 font-mono tabular-nums text-right select-none flex items-center gap-1.5">
      <span>{elapsed}</span>
      <span className="text-zinc-300">/</span>
      <span>{formatClock(duration)}</span>
      <span className="text-zinc-500">(-{remaining})</span>
    </output>
  );
});

export const SeekBar = memo(function SeekBar({ store, duration, onSeek }: { store: TimeStore; duration: number; onSeek: (time: number) => void }) {
  const time = useTimeSelector(store, (t) => t);
  const percent = (time / Math.max(1, duration)) * 100;
  return (
    <input
      type="range"
      min={0}
      max={Math.max(1, duration)}
      step={0.01}
      value={Math.min(time, duration)}
      onChange={(e) => onSeek(Number(e.target.value))}
      className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-zinc-900"
      style={{ background: `linear-gradient(to right, #18181b 0%, #18181b ${percent}%, #e4e4e7 ${percent}%, #e4e4e7 100%)` }}
      aria-label="Seek"
    />
  );
});

export function LiveChordStrip({ store, chords, tempoBpm, speed }: { store: TimeStore; chords: React.ComponentProps<typeof ChordStrip>["chords"]; tempoBpm: number; speed: number }) {
  const currentBeat = useTimeSelector(store, (t) => t / secPerBeat(tempoBpm, speed));
  return <ChordStrip chords={chords} currentBeat={currentBeat} />;
}
