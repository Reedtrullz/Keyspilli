import { secPerBeat, type LoopRegion, type PlayerSettings } from "@keyspilli/player-core";
import { displayChordName } from "./chord-practice";
import type { PracticeSetup } from "./PracticeSetupDialog";

export function practiceContext(key: string, bpm: number, settings: Pick<PlayerSettings, "transpose" | "speed">, provisional = false): string {
  const playbackKey = displayChordName(key, settings.transpose);
  const keyText = settings.transpose ? `Source ${key} · Playback ${playbackKey}` : `Key ${key}`;
  return `${keyText} · ${Math.round(settings.speed * 100)}% · ${provisional ? "Tempo provisional" : `${Number((bpm * settings.speed).toFixed(1))} practice BPM`}`;
}

export function resolvePracticeRange(scope: PracticeSetup["scope"], measures: readonly { startBeat: number; endBeat: number }[], index: number, time: number, duration: number, bpm: number, speed: number, loop: LoopRegion | null): LoopRegion | null {
  if (scope === "loop") return loop;
  if (scope !== "bars") return { startSec: scope === "beginning" ? 0 : time, endSec: duration };
  const start = measures[index];
  const end = measures[Math.min(measures.length - 1, index + 3)];
  const spb = secPerBeat(bpm, speed);
  return start && end ? { startSec: start.startBeat * spb, endSec: end.endBeat * spb } : null;
}

export function loopFromBars(start: number, end: number, measures: readonly { startBeat: number; endBeat: number }[]) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > measures.length || start > end) return null;
  return { startBeat: measures[start - 1]!.startBeat, endBeat: measures[end - 1]!.endBeat };
}
