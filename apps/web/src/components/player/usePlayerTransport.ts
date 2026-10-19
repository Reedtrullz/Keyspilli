import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { createTimeStore } from "./live-time";
import { secPerBeat, type LoopRegion } from "@keyspilli/player-core";

/** The part of the playback engine the transport state mirrors. */
export interface TransportSource {
  readonly time: number;
  readonly playing: boolean;
}

/** A loop anchored in musical time; seconds are derived from tempo and speed. */
export interface LoopBeats {
  startBeat: number;
  endBeat: number;
}

/** Bar-number text being edited in the loop controls before it is applied. */
export interface LoopDraft {
  start: string;
  end: string;
}

/**
 * Player transport state. The engine owns playback; React mirrors it.
 *
 * Per-frame engine ticks only write `timeRef`/`playingRef` (read by the canvas
 * rAF loop). Discrete events (play/pause/seek, grading start/finish) call
 * `syncTransportState()` or the setters so buttons and the progress bar
 * re-render. `seekVersion` increments on every user seek.
 */
export function usePlayerTransport(engineRef: RefObject<TransportSource | null>) {
  // The clock lives in an external store so a 10 Hz tick re-renders only the
  // components that subscribe to it, not the whole player.
  const timeStore = useMemo(() => createTimeStore(0), []);
  const setTime = timeStore.set;
  const [seekVersion, setSeekVersion] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timeRef = useRef(0);
  const playingRef = useRef(playing);
  const syncTransportState = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    timeRef.current = engine.time;
    playingRef.current = engine.playing;
    setTime(timeRef.current);
    setPlaying(playingRef.current);
  }, [engineRef]);
  return { timeStore, setTime, seekVersion, setSeekVersion, playing, setPlaying, timeRef, playingRef, syncTransportState };
}

/** Seconds for a beat-anchored loop at the given tempo and playback speed. */
export function loopRegionSeconds(loopBeats: LoopBeats | null, tempoBpm: number, speed: number): LoopRegion | null {
  if (!loopBeats) return null;
  const spb = secPerBeat(tempoBpm, speed);
  return { startSec: loopBeats.startBeat * spb, endSec: loopBeats.endBeat * spb };
}

/**
 * 1-based bar numbers shown in the loop controls: the bars covering the loop,
 * or, with no loop, the current bar and up to three bars after it.
 */
export function loopBarRange(
  loopBeats: LoopBeats | null,
  measures: readonly { startBeat: number; endBeat: number }[],
  currentMeasure: number,
): { startBar: number; endBar: number } {
  if (!loopBeats) return { startBar: currentMeasure + 1, endBar: Math.min(measures.length, currentMeasure + 4) };
  return {
    startBar: Math.max(0, measures.findIndex((measure) => measure.endBeat > loopBeats.startBeat)) + 1,
    endBar: Math.max(0, measures.findIndex((measure) => measure.endBeat >= loopBeats.endBeat)) + 1,
  };
}

/**
 * Loop region state. Anchors are stored in beats so a tempo or speed change
 * reprojects the region in seconds automatically.
 */
export function useLoopRegion(tempoBpm: number, speed: number) {
  const [loopBeats, setLoopBeats] = useState<LoopBeats | null>(null);
  const [loopDraft, setLoopDraft] = useState<LoopDraft | null>(null);
  const loop = useMemo(() => loopRegionSeconds(loopBeats, tempoBpm, speed), [loopBeats, tempoBpm, speed]);
  return { loopBeats, setLoopBeats, loopDraft, setLoopDraft, loop };
}
