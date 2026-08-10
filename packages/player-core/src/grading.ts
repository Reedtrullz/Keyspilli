import type { TimedNote } from "./timeline.js";

export interface GradeResult {
  total: number;
  hit: number;
  missed: number;
  wrong: number;
  late: number;
  accuracyPct: number;
  summary: string;
}

const TIME_TOLERANCE = 0.35; // seconds

/**
 * Grades a player's note events against the expected notes.
 * - hit: correct pitch within the time window
 * - wrong: incorrect pitch within the time window
 * - missed: expected note whose window passed with no matching event
 * - late: correct pitch played after its window (counted once)
 */
export class Grader {
  private remaining: TimedNote[];
  private hits = 0;
  private wrongs = 0;
  private late = 0;
  private missed = 0;
  private waitMode = false;
  private waitingFor: TimedNote | null = null;

  constructor(
    notes: TimedNote[],
    opts: { waitMode?: boolean } = {},
  ) {
    this.remaining = [...notes].sort((a, b) => a.startSec - b.startSec);
    this.waitMode = opts.waitMode ?? false;
  }

  /** Call as time advances; counts expected notes whose window passed without input. */
  tick(now: number): void {
    if (this.waitMode) return; // wait mode advances only on correct input
    let i = 0;
    while (i < this.remaining.length) {
      const n = this.remaining[i]!;
      if (now - n.startSec > TIME_TOLERANCE) {
        this.missed++;
        this.remaining.splice(i, 1);
      } else {
        i++;
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
      if (Math.abs(now - this.waitingFor.startSec) <= TIME_TOLERANCE) {
        this.hits++;
        this.remaining.splice(this.remaining.indexOf(this.waitingFor), 1);
        this.waitingFor = null;
        return true;
      }
      return false; // correct pitch, outside the window: hold
    }
    const window = this.remaining.filter((n) => Math.abs(now - n.startSec) <= TIME_TOLERANCE);
    const exact = window.find((n) => n.midi === midi);
    if (exact) {
      this.hits++;
      this.remaining.splice(this.remaining.indexOf(exact), 1);
      return true;
    }
    if (window.length > 0) {
      this.wrongs++;
      return true;
    }
    const pastIdx = this.remaining.findIndex((n) => n.midi === midi && now > n.startSec + TIME_TOLERANCE);
    if (pastIdx >= 0) {
      this.late++;
      this.remaining.splice(pastIdx, 1);
    }
    return true;
  }

  /** In wait mode, the note the player must press right now. */
  get currentWait(): TimedNote | null {
    if (!this.waitMode) return null;
    if (this.waitingFor) return this.waitingFor;
    const next = this.remaining[0];
    if (next) this.waitingFor = next;
    return this.waitingFor;
  }

  result(): GradeResult {
    const total = this.hits + this.wrongs + this.missed + this.late;
    const accuracyPct = total === 0 ? 100 : Math.round((this.hits / total) * 100);
    let summary = "";
    if (accuracyPct >= 90) summary = "Great run — clean and in time.";
    else if (accuracyPct >= 70) summary = "Good work. A few spots to polish.";
    else if (this.missed > this.wrongs) summary = "Most mistakes were missed notes.";
    else summary = "Many notes were technically right but off the beat.";
    return { total, hit: this.hits, missed: this.missed, wrong: this.wrongs, late: this.late, accuracyPct, summary };
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
