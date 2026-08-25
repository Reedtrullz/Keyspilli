import type { TimedNote } from "./timeline.js";
import { secPerBeat } from "./timeline.js";

export interface GradeResult {
  total: number;
  hit: number;
  missed: number;
  wrong: number;
  late: number;
  accuracyPct: number;
  summary: string;
}

/**
 * Grades a player's note events against the expected notes.
 * - hit: correct pitch within the time window
 * - wrong: incorrect pitch within the time window
 * - missed: expected note whose window passed with no matching event
 * - late: correct pitch played after its window (counted once)
 */
export class Grader {
  private remaining: TimedNote[];
  /**
   * Index of the first note which has not been missed. `tick()` advances this
   * cursor instead of splicing one item at a time from the front of the
   * array. Front-splicing shifts every later note and made long grading runs
   * quadratic in the number of expected notes.
   */
  private remainingStart = 0;
  /** Number of active expected notes (the array can retain missed prefix rows). */
  private remainingCount: number;
  private hits = 0;
  private wrongs = 0;
  private late = 0;
  private missed = 0;
  private waitMode = false;
  private waitingFor: TimedNote | null = null;
  private lastAcceptedNote: TimedNote | null = null;
  private tolerance: number;

  constructor(
    notes: TimedNote[],
    opts: { waitMode?: boolean; bpm?: number; speed?: number } = {},
  ) {
    this.remaining = [...notes].sort((a, b) => a.startSec - b.startSec);
    this.remainingCount = this.remaining.length;
    this.waitMode = opts.waitMode ?? false;
    // Tempo-scaled tolerance: 40% of a beat, capped at 400ms (legacy fixed 350ms).
    this.tolerance = opts.bpm ? Math.min(0.4, secPerBeat(opts.bpm, opts.speed ?? 1) * 0.4) : 0.35;
  }

  /** Recompute tolerance when speed or BPM changes mid-grading. */
  updateTempo(bpm: number, speed: number): void {
    this.tolerance = Math.min(0.4, secPerBeat(bpm, speed) * 0.4);
  }

  /**
   * Change wait mode without rebuilding the run. The player exposes this as a
   * checkbox while a practice run is in progress, so the grader must follow
   * the engine's mode as well as the rendered control.
   */
  setWaitMode(wait: boolean): void {
    if (this.waitMode === wait) return;
    this.waitMode = wait;
    this.waitingFor = wait ? (this.remaining[this.remainingStart] ?? null) : null;
  }

  /** Call as time advances; counts expected notes whose window passed without input. */
  tick(now: number): void {
    if (this.waitMode) return; // wait mode advances only on correct input
    while (this.remainingStart < this.remaining.length) {
      const n = this.remaining[this.remainingStart]!;
      if (now - n.startSec > this.tolerance) {
        this.missed++;
        this.remainingStart++;
        this.remainingCount--;
      } else {
        break;
      }
    }
  }

  /** Feed a played note (midi) at the given time. Returns true if accepted in wait mode. */
  play(midi: number, now: number): boolean {
    if (this.waitMode && this.waitingFor) {
      if (midi !== this.waitingFor.midi) {
        this.wrongs++;
        return false;
      }
      // In wait mode the transport is paused and time does not advance,
      // so the temporal window check would permanently block progress.
      // Accept any correct-pitch press immediately.
      this.hits++;
      const index = this.remaining.indexOf(this.waitingFor, this.remainingStart);
      if (index >= this.remainingStart) {
        this.remaining.splice(index, 1);
        this.remainingCount--;
      }
      this.lastAcceptedNote = this.waitingFor;
      this.waitingFor = null;
      return true;
    }
    const lower = now - this.tolerance;
    const upper = now + this.tolerance;
    let exactIndex = -1;
    let hasWindow = false;
    // Expected notes are sorted by start time. Skip the stale prefix and stop
    // at the first future note beyond the input window instead of filtering
    // the entire queue for every key press.
    for (let i = this.remainingStart; i < this.remaining.length; i++) {
      const n = this.remaining[i]!;
      if (n.startSec > upper) break;
      if (n.startSec >= lower) {
        hasWindow = true;
        if (exactIndex < 0 && n.midi === midi) exactIndex = i;
      }
    }
    if (exactIndex >= 0) {
      this.hits++;
      this.remaining.splice(exactIndex, 1);
      this.remainingCount--;
      return true;
    }
    if (hasWindow) {
      this.wrongs++;
      return true;
    }
    let pastIdx = -1;
    for (let i = this.remainingStart; i < this.remaining.length; i++) {
      const n = this.remaining[i]!;
      if (n.startSec >= lower) break;
      if (n.midi === midi) {
        pastIdx = i;
        break;
      }
    }
    if (pastIdx >= this.remainingStart) {
      this.late++;
      this.remaining.splice(pastIdx, 1);
      this.remainingCount--;
    }
    return true;
  }

  /** In wait mode, the note the player must press right now. */
  get currentWait(): TimedNote | null {
    if (!this.waitMode) return null;
    if (this.waitingFor) return this.waitingFor;
    const next = this.remaining[this.remainingStart];
    if (next) this.waitingFor = next;
    return this.waitingFor;
  }

  isWaitMode(): boolean {
    return this.waitMode;
  }

  /** The most recently accepted note in wait mode (for transport advance). */
  lastAccepted(): TimedNote | null {
    return this.lastAcceptedNote;
  }

  result(): GradeResult {
    // A run can be finished before playback reaches the end. Count every
    // expected note still in the queue so an early exit cannot score 100%.
    // Wait mode also suppresses tick(), so this covers that path too.
    const missed = this.missed + this.remainingCount;
    const total = this.hits + this.wrongs + missed + this.late;
    const accuracyPct = total === 0 ? 100 : Math.round((this.hits / total) * 100);
    let summary = "";
    if (accuracyPct >= 90) summary = "Great run — clean and in time.";
    else if (accuracyPct >= 70) summary = "Good work. A few spots to polish.";
    else if (missed > this.wrongs) summary = "Most mistakes were missed notes.";
    else summary = "Many notes were technically right but off the beat.";
    return { total, hit: this.hits, missed, wrong: this.wrongs, late: this.late, accuracyPct, summary };
  }
}

/**
 * Lightweight pitch detection for mic input: autocorrelation on a
 * mono downmix buffer at the given sample rate.
 */
export function detectPitch(buf: Float32Array, sampleRate: number): number | null {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
  const rms = Math.sqrt(sum / buf.length);
  if (rms < 0.01) return null;
  const minLag = Math.floor(sampleRate / 1200);
  const maxLag = Math.floor(sampleRate / 60);
  const norms = new Array(maxLag + 2).fill(0);
  let bestLag = -1;
  let maxNorm = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let energy = 0;
    for (let i = 0; i < buf.length - lag; i += 4) {
      corr += buf[i]! * buf[i + lag]!;
      energy += buf[i]! * buf[i]!;
    }
    if (energy === 0) continue;
    const norm = corr / Math.sqrt(energy * (energy + 1e-9));
    norms[lag] = norm;
    // Gentle short-lag bias avoids octave errors on periodic tones
    // (all integer multiples of the period correlate near 1.0).
    const score = norm * (1 - 0.3 * (lag - minLag) / (maxLag - minLag));
    if (score > maxNorm) {
      maxNorm = score;
      bestLag = lag;
    }
  }
  if (bestLag <= 0 || maxNorm < 0.6) return null;
  // Parabolic interpolation for sub-sample lag precision.
  const a = norms[bestLag - 1]!;
  const b = norms[bestLag]!;
  const c = norms[bestLag + 1]!;
  const denom = a - 2 * b + c;
  const delta = Math.abs(denom) > 1e-9 ? (0.5 * (a - c)) / denom : 0;
  const refinedLag = Math.max(minLag, bestLag + Math.max(-0.5, Math.min(0.5, delta)));
  const freq = sampleRate / refinedLag;
  return Math.round(69 + 12 * Math.log2(freq / 440));
}
