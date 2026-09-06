import { PUBLIC_DIFFICULTY_ORDER, Note, Variant } from "./types.js";
import { maxDurationBeatsForTempo } from "./clean.js";

/**
 * Playability/correctness limits per difficulty level, calibrated against
 * the current catalog (P99 + headroom): full-band multitrack MIDIs flattened
 * into piano notes exceed these; real piano arrangements do not.
 */
/** Single source of truth for the playability gate; calibrate with npm run calibrate. */
export const PLAYABILITY_LIMITS: Record<string, { maxSim: number; maxDensity: number; minMedianIoi: number }> = {
  // Attack density and IOI are measured in seconds (see validateVariant below).
  // These are catalog P99/P1 values with modest headroom, recalibrated after
  // fixing the old beat/second unit mismatch.
  "very-beginner": { maxSim: 2, maxDensity: 5, minMedianIoi: 0.15 },
  beginner: { maxSim: 2, maxDensity: 6, minMedianIoi: 0.08 },
  "very-easy": { maxSim: 5, maxDensity: 12, minMedianIoi: 0.08 },
  easy: { maxSim: 5, maxDensity: 12, minMedianIoi: 0.08 },
  medium: { maxSim: 12, maxDensity: 16, minMedianIoi: 0.08 },
  advanced: { maxSim: 13, maxDensity: 18, minMedianIoi: 0.08 },
};

/** Max grid-shift tolerance between neighboring levels (round-half-up boundaries). */
export const LADDER_TOL: Record<string, number> = {
  "very-beginner": 0.26,
  beginner: 0.02,
  "very-easy": 0.13,
  easy: 0.02,
  medium: 0.02,
};

/** Internal, non-serialized marker for the frozen Beginner off-grid allowance. */
export const BEGINNER_OFFGRID_CANDIDATE = Symbol.for("keyspilli.beginner-offgrid-rh-candidate");

function rhStartsByMidi(notes: Note[]): Map<number, number[]> {
  const by = new Map<number, number[]>();
  for (const n of notes) {
    if (n.hand === "L") continue;
    const arr = by.get(n.midi) ?? [];
    arr.push(n.start);
    by.set(n.midi, arr);
  }
  return by;
}

function hasNear(harder: Map<number, number[]>, midi: number, start: number, tol: number): boolean {
  const starts = harder.get(midi);
  if (!starts) return false;
  return starts.some((s) => Math.abs(s - start) <= tol);
}

export interface VariantValidationOptions {
  /**
   * Source-aware sustain ceiling. `null` skips the generic duration gate for
   * human-authored sources; omission keeps the legacy safety default.
   */
  maxDurBeats?: number | null;
}

function validateVariant(v: Variant, opts: VariantValidationOptions): string[] {
  const out: string[] = [];
  const lim = PLAYABILITY_LIMITS[v.level];
  if (!lim) {
    out.push(`${v.level}: unknown difficulty level`);
    return out;
  }
  if (!Number.isFinite(v.tempoBpm) || v.tempoBpm < 20 || v.tempoBpm > 300) {
    out.push(`${v.level}: tempo ${v.tempoBpm} outside 20-300 BPM`);
  }
  const [num, den] = v.timeSig;
  if (
    !Number.isInteger(num) || num < 1 || num > 16 ||
    !Number.isInteger(den) || den < 1 || den > 32 || (den & (den - 1)) !== 0
  ) {
    out.push(`${v.level}: bad time signature ${num}/${den}`);
  }
  if (v.notes.length < 8) out.push(`${v.level}: only ${v.notes.length} notes`);

  const byStart = new Map<string, number>();
  const starts: number[] = [];
  let maxSim = 0;
  let maxSounding = 0;
  let span = 0;
  let validCount = 0;
  let tooLong = 0;
  const validNotes: Note[] = [];
  const tempoBpm = Number.isFinite(v.tempoBpm) && v.tempoBpm > 0 ? v.tempoBpm : 120;
  const maxDurBeats = opts.maxDurBeats === null
    ? undefined
    : opts.maxDurBeats ?? maxDurationBeatsForTempo(tempoBpm);
  for (const n of v.notes) {
    if (!Number.isFinite(n.midi) || n.midi < 21 || n.midi > 108) {
      out.push(`${v.level}: midi ${n.midi} outside piano range 21-108`);
      continue;
    }
    if (!Number.isFinite(n.start) || n.start < 0) {
      out.push(`${v.level}: invalid start ${n.start}`);
      continue;
    }
    if (!Number.isFinite(n.dur) || n.dur <= 0) {
      out.push(`${v.level}: invalid duration ${n.dur}`);
      continue;
    }
    validCount++;
    validNotes.push(n);
    if (maxDurBeats !== undefined && n.dur > maxDurBeats + 1e-6) tooLong++;
    const k = n.start.toFixed(3);
    const c = (byStart.get(k) ?? 0) + 1;
    byStart.set(k, c);
    if (c > maxSim) maxSim = c;
    span = Math.max(span, n.start + n.dur);
    starts.push(n.start);
  }
  if (maxSim > lim.maxSim) out.push(v.level + ": " + maxSim + " simultaneous notes (limit " + lim.maxSim + ")");
  const soundingEvents = validNotes.flatMap((n) => [[n.start, 1], [n.start + n.dur, -1]] as [number, number][])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let sounding = 0;
  for (const [, delta] of soundingEvents) {
    sounding += delta;
    if (sounding > maxSounding) maxSounding = sounding;
  }
  if (maxSounding > lim.maxSim) out.push(v.level + ": " + maxSounding + " sounding notes (limit " + lim.maxSim + ")");
  if (tooLong) out.push(v.level + ": " + tooLong + " notes longer than " + maxDurBeats + " beats");
  if (span > 0) {
    // `start`/`dur` are stored in beats, but playability limits are expressed
    // in real-time units so the same gate behaves consistently at 60 BPM and
    // 240 BPM. Invalid tempo is reported above; use a neutral fallback here
    // so this check remains deterministic and never emits NaN.
    const spanSec = span * 60 / tempoBpm;
    // Chord members are one physical attack, not separate rhythmic events.
    // Count distinct onsets here and use maxSim above to gate chord size; this
    // avoids rejecting fast but playable arpeggios/chords merely because a
    // score contains several pitches at one attack.
    const density = byStart.size / spanSec;
    if (density > lim.maxDensity) {
      out.push(`${v.level}: ${density.toFixed(1)} attacks/sec (limit ${lim.maxDensity})`);
    }
  }
  const distinct = [...new Set(starts.map((s) => s.toFixed(3)).map(Number))].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < distinct.length; i++) gaps.push(distinct[i]! - distinct[i - 1]!);
  if (gaps.length) {
    const medianIoi = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!;
    const medianIoiSec = medianIoi * 60 / tempoBpm;
    if (medianIoiSec < lim.minMedianIoi) {
      out.push(`${v.level}: median inter-onset ${medianIoiSec.toFixed(3)}s below floor ${lim.minMedianIoi}s`);
    }
  }
  return out;
}

/**
 * Fail-closed gate: every issue returned must be fixed before a song goes live.
 * All physical rows are checked individually; cross-level ancestry follows
 * the public five-level order so legacy Very Easy stays available without
 * becoming a learner-facing edge.
 */
export function validateVariants(variants: Variant[], opts: VariantValidationOptions = {}): string[] {
  const errors: string[] = [];
  const byLevel = new Map(variants.map((v) => [v.level, v]));
  for (const v of variants) errors.push(...validateVariant(v, opts));
  // Physical generation still emits six rows, but the normative learner
  // ancestry is the public five-level order. Very Easy is validated above as
  // an ordinary physical variant and intentionally has no public edge.
  for (let i = 0; i < PUBLIC_DIFFICULTY_ORDER.length - 1; i++) {
    const level = PUBLIC_DIFFICULTY_ORDER[i]!;
    const easier = byLevel.get(level);
    const harder = byLevel.get(PUBLIC_DIFFICULTY_ORDER[i + 1]!);
    if (!easier || !harder) continue;
    const harderByMidi = rhStartsByMidi(harder.notes);
    const tol = LADDER_TOL[level] ?? 0.02;
    for (const n of easier.notes) {
      if (n.hand === "L") continue;
      if (!hasNear(harderByMidi, n.midi, n.start, tol)) {
        if (level === "beginner" && (n as Note & { [BEGINNER_OFFGRID_CANDIDATE]?: boolean })[BEGINNER_OFFGRID_CANDIDATE] === true) continue;
        errors.push(`${level}: note ${n.midi}@${n.start.toFixed(2)} missing from ${harder.level} (ladder broken)`);
      }
    }
  }
  return errors;
}

/**
 * Verify monotonicity across the public difficulty levels: each public level
 * should be a strict simplification of the level above it (note count
 * non-increasing, difficulty scores monotonically non-decreasing when moving
 * to harder levels). Very Easy remains individually validated but is not an
 * ordering edge.
 *
 * Returns an array of error strings; empty means all checks passed.
 */
export function verifyMonotonicity(variants: Variant[]): string[] {
  const errors: string[] = [];
  const byLevel = new Map(variants.map((v) => [v.level, v]));

  for (let i = 0; i < PUBLIC_DIFFICULTY_ORDER.length - 1; i++) {
    const easierName = PUBLIC_DIFFICULTY_ORDER[i]!;
    const harderName = PUBLIC_DIFFICULTY_ORDER[i + 1]!;
    const easier = byLevel.get(easierName);
    const harder = byLevel.get(harderName);
    if (!easier || !harder) continue;

    // Note count must be non-increasing from harder to easier
    if (easier.notes.length > harder.notes.length) {
      errors.push(
        `${easierName} has ${easier.notes.length} notes but ${harderName} has ${harder.notes.length} (easier should not have more)`,
      );
    }

    // Difficulty score must be non-decreasing from easier to harder
    if (easier.difficultyScore > harder.difficultyScore) {
      errors.push(
        `${easierName} difficultyScore ${easier.difficultyScore} > ${harderName} difficultyScore ${harder.difficultyScore}`,
      );
    }
  }

  return errors;
}
