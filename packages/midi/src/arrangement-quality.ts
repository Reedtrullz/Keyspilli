import { Note } from "./types.js";

/**
 * Measure melody continuity: how stable the pitch line is and how
 * consistently gaps appear between consecutive melody notes.
 *
 * Returns a value in [0, 1] where 1 means perfectly continuous
 * (small, consistent intervals with no large jumps or long rests).
 */
export function melodyContinuity(notes: Note[]): number {
  if (notes.length < 2) return notes.length === 1 ? 1 : 0;

  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);

  // Pitch stability: penalise large interval jumps
  let pitchStability = 0;
  for (let i = 1; i < sorted.length; i++) {
    const interval = Math.abs(sorted[i]!.midi - sorted[i - 1]!.midi);
    // Stepwise motion (0-2 semitones) is ideal; beyond an octave is harsh
    if (interval <= 2) pitchStability += 1;
    else if (interval <= 5) pitchStability += 0.7;
    else if (interval <= 7) pitchStability += 0.4;
    else if (interval <= 12) pitchStability += 0.2;
    else pitchStability += 0.05;
  }
  pitchStability /= sorted.length - 1;

  // Gap consistency: how regular the inter-onset intervals are
  const iois: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    iois.push(sorted[i]!.start - sorted[i - 1]!.start);
  }
  if (iois.length === 0) return pitchStability;
  const meanIoi = iois.reduce((a, b) => a + b, 0) / iois.length;
  if (meanIoi <= 0) return pitchStability;
  const variance = iois.reduce((s, d) => s + (d - meanIoi) ** 2, 0) / iois.length;
  const cv = Math.sqrt(variance) / meanIoi; // coefficient of variation
  // cv=0 means perfect regularity; cv>2 means very erratic
  const gapConsistency = Math.max(0, 1 - cv / 2);

  // Weighted blend: pitch stability matters more than rhythm regularity
  return 0.65 * pitchStability + 0.35 * gapConsistency;
}

/** Crossing event: where a lower-pitch note plays after a higher-pitch note in the other hand. */
export interface RhLhBalance {
  rhRatio: number;
  lhRatio: number;
  crossingCount: number;
}

/**
 * Measure right-hand vs left-hand note distribution and crossing events.
 *
 * Hand assignment comes from `Note.hand`; notes without a hand label are
 * grouped by pitch relative to middle C (60).
 */
export function rhLhBalance(notes: Note[]): RhLhBalance {
  if (notes.length === 0) return { rhRatio: 0, lhRatio: 0, crossingCount: 0 };

  const assigned = notes.map((n) => {
    if (n.hand === "R" || n.hand === "L") return n;
    return { ...n, hand: (n.midi >= 60 ? "R" : "L") as "R" | "L" };
  });

  const rhNotes = assigned.filter((n) => n.hand === "R");
  const lhNotes = assigned.filter((n) => n.hand === "L");
  const rhRatio = rhNotes.length / notes.length;
  const lhRatio = lhNotes.length / notes.length;

  // Count crossing events: where a LH note sounds above the last RH note or vice versa.
  // Only count after both hands have been seen at least once.
  const sorted = [...assigned].sort((a, b) => a.start - b.start);
  let lastRhPitch: number | null = null;
  let lastLhPitch: number | null = null;
  let crossings = 0;
  for (const n of sorted) {
    if (n.hand === "R") {
      if (lastLhPitch !== null && n.midi < lastLhPitch) crossings++;
      lastRhPitch = lastRhPitch === null ? n.midi : Math.max(lastRhPitch, n.midi);
    } else {
      if (lastRhPitch !== null && n.midi > lastRhPitch) crossings++;
      lastLhPitch = lastLhPitch === null ? n.midi : Math.min(lastLhPitch, n.midi);
    }
  }

  return { rhRatio, lhRatio, crossingCount: crossings };
}

/**
 * Average number of simultaneously sounding notes per beat.
 * This measures texture density across the arrangement.
 */
export function soundingDensity(notes: Note[], durationBeats: number): number {
  if (notes.length === 0 || durationBeats <= 0) return 0;

  // Build sounding-level sweep events
  const events: [number, number][] = [];
  for (const n of notes) {
    events.push([n.start, 1]);
    events.push([n.start + n.dur, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // Accumulate weighted sounding level across the duration
  let level = 0;
  let totalWeighted = 0;
  let prev = 0;
  for (const [t, delta] of events) {
    if (t > prev && prev < durationBeats) {
      const segEnd = Math.min(t, durationBeats);
      totalWeighted += level * (segEnd - prev);
      prev = segEnd;
    }
    level += delta;
    if (t > prev) prev = t;
  }
  // Any remaining sounding time up to durationBeats
  if (prev < durationBeats) {
    totalWeighted += level * (durationBeats - prev);
  }
  return totalWeighted / durationBeats;
}

export interface ArrangementQualityReport {
  melodyContinuity: number;
  balance: RhLhBalance;
  density: number;
  flags: string[];
}

/**
 * Combined quality report with automatic flags for common arrangement problems:
 * - "unplayable texture": density > 8 simultaneous notes per beat on average
 * - "thin melody": continuity < 0.3
 * - "unbalanced": one hand holds < 20% of notes
 */
export function arrangementQualityReport(
  notes: Note[],
  durationBeats: number,
): ArrangementQualityReport {
  const mc = melodyContinuity(notes);
  const bal = rhLhBalance(notes);
  const den = soundingDensity(notes, durationBeats);
  const flags: string[] = [];

  if (den > 8) flags.push("unplayable texture");
  if (mc < 0.3) flags.push("thin melody");
  if (bal.rhRatio < 0.2 || bal.lhRatio < 0.2) flags.push("unbalanced");

  return { melodyContinuity: mc, balance: bal, density: den, flags };
}
