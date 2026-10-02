import type { TimedNote } from "./timeline.js";
import { secPerBeat } from "./timeline.js";

export interface GradeEvent {
  targetIndex: number | null; expectedPitch: number | null; startSec: number | null; hand: "R" | "L" | null;
  playedPitch: number | null; playedSec: number | null; errorSec: number | null; rawSec?: number | null; offsetMs?: number;
  outcome: "hit" | "late" | "missed" | "wrong" | "unmatched";
}
export interface GradeDiagnostics { events: GradeEvent[]; omitted: number }

export interface GradeResult {
  total: number;
  hit: number;
  missed: number;
  wrong: number;
  late: number;
  accuracyPct: number;
  summary: string;
  diagnostics?: GradeDiagnostics;
  articulation?: import("./articulation.js").ArticulationResult;
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
  private diagnosticTargets: TimedNote[];
  private targetIndexes = new Map<TimedNote, number>();
  private targetEvents = new Map<number, GradeEvent>();
  private inputEvents: GradeEvent[] = [];
  private omittedInputs = 0;
  private eventTiming: { rawSec: number; offsetMs: number } | undefined;
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
  /** Reconciled prefix indexes; the retained evidence is bounded by run target count. */
  private reconciledMisses = new Set<number>();
  private waitMode = false;
  private waitingFor: TimedNote | null = null;
  private lastAcceptedNote: TimedNote | null = null;
  private tolerance: number;

  constructor(
    notes: TimedNote[],
    opts: { waitMode?: boolean; bpm?: number; speed?: number } = {},
  ) {
    this.remaining = notes.map(note => ({ ...note })).sort((a, b) => a.startSec - b.startSec);
    this.diagnosticTargets = this.remaining.slice(0, 2000);
    this.diagnosticTargets.forEach((note, index) => this.targetIndexes.set(note, index));
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

  private event(note: TimedNote | null, outcome: GradeEvent["outcome"], midi: number | null = null, now: number | null = null): GradeEvent {
    return { targetIndex: note ? this.targetIndexes.get(note) ?? null : null, expectedPitch: note?.midi ?? null,
      startSec: note?.startSec ?? null, hand: note?.hand ?? null, playedPitch: midi, playedSec: now,
      errorSec: note && now !== null ? now - note.startSec : null, ...(now === null ? {} : { rawSec: this.eventTiming?.rawSec ?? now, offsetMs: this.eventTiming?.offsetMs ?? 0 }), outcome };
  }
  private recordTarget(note: TimedNote, outcome: "hit" | "late", midi: number, now: number): void {
    const index = this.targetIndexes.get(note);
    if (index !== undefined) this.targetEvents.set(index, this.event(note, outcome, midi, now));
  }
  private recordInput(note: TimedNote | null, outcome: "wrong" | "unmatched", midi: number, now: number): void {
    // ponytail: retain 2,000 expected targets and 200 extra inputs; counts remain complete for longer runs.
    if (this.inputEvents.length < 200) this.inputEvents.push(this.event(note, outcome, midi, now));
    else this.omittedInputs++;
  }

  private consumeTarget(index: number): void {
    if (index < this.remainingStart) {
      this.reconciledMisses.add(index);
      this.missed--;
    } else {
      this.remaining.splice(index, 1);
      this.remainingCount--;
    }
  }

  /** Feed a played note (midi) at the given time. Returns true if accepted in wait mode. */
  play(midi: number, now: number, timing?: { rawSec: number; offsetMs: number }): boolean {
    this.lastAcceptedNote = null;
    this.eventTiming = timing;
    const waitingFor = this.currentWait;
    if (waitingFor) {
      const onset = waitingFor.startSec;
      const index = this.remaining.findIndex((note, index) => index >= this.remainingStart
        && Math.abs(note.startSec - onset) <= 1e-6 && note.midi === midi);
      if (index < 0) {
        this.wrongs++;
        this.recordInput(waitingFor, "wrong", midi, now);
        return false;
      }
      // In wait mode the transport is paused and time does not advance,
      // so the temporal window check would permanently block progress.
      // Accept any correct-pitch press immediately.
      this.hits++;
      this.lastAcceptedNote = this.remaining[index]!;
      this.recordTarget(this.lastAcceptedNote, "hit", midi, now);
      this.remaining.splice(index, 1);
      this.remainingCount--;
      this.waitingFor = null;
      return true;
    }
    const lower = now - this.tolerance;
    const upper = now + this.tolerance;
    let exactIndex = -1;
    let hasWindow = false;
    let windowTarget: TimedNote | null = null;
    // Search the complete timestamp window, including missed notes retained
    // in the prefix. Binary search keeps the scan bounded to overlapping notes.
    let low = 0;
    let high = this.remaining.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.remaining[mid]!.startSec < lower) low = mid + 1;
      else high = mid;
    }
    for (let i = low; i < this.remaining.length; i++) {
      const n = this.remaining[i]!;
      if (n.startSec > upper) break;
      if (i < this.remainingStart && this.reconciledMisses.has(i)) continue;
      if (n.startSec >= lower) {
        hasWindow = true;
        windowTarget ??= n;
        if (exactIndex < 0 && n.midi === midi) exactIndex = i;
      }
    }
    if (exactIndex >= 0) {
      this.hits++;
      this.lastAcceptedNote = this.remaining[exactIndex]!;
      this.recordTarget(this.lastAcceptedNote, "hit", midi, now);
      this.consumeTarget(exactIndex);
      return true;
    }
    if (hasWindow) {
      this.wrongs++;
      this.recordInput(windowTarget, "wrong", midi, now);
      return true;
    }
    let pastIdx = -1;
    // ponytail: O(n) prior-target scan per late input (O(n²) run); add a pitch index if profiling warrants it.
    for (let i = 0; i < low; i++) {
      const n = this.remaining[i]!;
      if (i < this.remainingStart && this.reconciledMisses.has(i)) continue;
      if (n.midi === midi) {
        pastIdx = i;
        break;
      }
    }
    if (pastIdx >= 0) {
      this.late++;
      this.lastAcceptedNote = this.remaining[pastIdx]!;
      this.recordTarget(this.lastAcceptedNote, "late", midi, now);
      this.consumeTarget(pastIdx);
      return true;
    }
    this.recordInput(null, "unmatched", midi, now);
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

  get currentWaitGroup(): TimedNote[] {
    const first = this.currentWait;
    if (!first) return [];
    return this.remaining.filter((note, index) => index >= this.remainingStart
      && Math.abs(note.startSec - first.startSec) <= 1e-6);
  }

  isWaitMode(): boolean {
    return this.waitMode;
  }

  /** The most recently accepted note in wait mode (for transport advance). */
  acceptedTargetIndex(): number | null { return this.lastAcceptedNote ? this.targetIndexes.get(this.lastAcceptedNote) ?? null : null; }

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
    if (this.waitMode) {
      if (accuracyPct >= 90) summary = "Great run — all notes found.";
      else if (accuracyPct >= 70) summary = "Good work. A few notes to revisit.";
      else summary = "Keep practising these notes.";
    } else if (accuracyPct >= 90) summary = "Great run — clean and in time.";
    else if (accuracyPct >= 70) summary = "Good work. A few spots to polish.";
    else if (missed > this.wrongs) summary = "Most mistakes were missed notes.";
    else summary = "Many notes were technically right but off the beat.";
    const diagnostics = { events: [ ...this.diagnosticTargets.map((note, index) => this.targetEvents.get(index) ?? this.event(note, "missed")), ...this.inputEvents ],
      omitted: this.remainingCount + this.hits + this.late + this.missed - this.diagnosticTargets.length + this.omittedInputs };
    return { total, hit: this.hits, missed, wrong: this.wrongs, late: this.late, accuracyPct, summary, diagnostics };
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

/** Group target errors into the existing measured passage ranges; never infer physical hand. */
export function gradeProblemWindows(result: GradeResult, measures: readonly { startBeat: number; endBeat: number }[], bpm: number, speed: number): Array<{ startBeat: number; endBeat: number; count: number }> {
  const windows = new Map<number, { startBeat: number; endBeat: number; count: number }>();
  for (const event of result.diagnostics?.events ?? []) {
    if (event.outcome === "hit" || event.outcome === "unmatched") continue;
    const seconds = event.startSec ?? event.playedSec;
    if (seconds === null) continue;
    const beat = seconds / secPerBeat(bpm, speed);
    const index = measures.findIndex(measure => beat >= measure.startBeat && beat < measure.endBeat);
    const measure = measures[index];
    if (!measure) continue;
    const window = windows.get(index) ?? { ...measure, count: 0 };
    window.count++; windows.set(index, window);
  }
  return [...windows.values()].sort((a, b) => a.startBeat - b.startBeat).slice(0, 12);
}

/** The current microphone detector observes one pitch, never a polyphonic target. */
export function microphoneEligibility(notes: readonly TimedNote[], range: { startSec: number; endSec: number }): { eligible: boolean; reason: string } {
  const targets = notes.filter(note => note.startSec < range.endSec && note.startSec + note.durSec > range.startSec).sort((a, b) => a.startSec - b.startSec);
  if (!targets.some(note => note.startSec >= range.startSec)) return { eligible: false, reason: "No note attacks in this passage. Choose another passage or keyboard/MIDI." };
  const active = new Map<number, number>();
  for (const note of targets) {
    for (const [pitch, end] of active) if (end <= note.startSec + 1e-6) active.delete(pitch);
    if ([...active.keys()].some(pitch => pitch !== note.midi)) return { eligible: false, reason: "Overlapping pitches exceed this monophonic microphone detector. Choose one hand or a monophonic variant, or use keyboard/MIDI." };
    active.set(note.midi, Math.max(active.get(note.midi) ?? 0, note.startSec + note.durSec));
  }
  return { eligible: true, reason: "Monophonic target; microphone pitch and repeated-note timing remain experimental. Use headphones to reduce playback leakage." };
}
