import { LEVEL_ORDER, Note, Variant } from "./types.js";

/**
 * Playability/correctness limits per difficulty level, calibrated against
 * the current catalog (P99 + headroom): full-band multitrack MIDIs flattened
 * into piano notes exceed these; real piano arrangements do not.
 */
const LIMITS: Record<string, { maxSim: number; maxDensity: number }> = {
  "very-beginner": { maxSim: 2, maxDensity: 4 },
  beginner: { maxSim: 2, maxDensity: 4 },
  "very-easy": { maxSim: 5, maxDensity: 7 },
  easy: { maxSim: 5, maxDensity: 7 },
  medium: { maxSim: 12, maxDensity: 10 },
  advanced: { maxSim: 13, maxDensity: 10 },
};

/** Max grid-shift tolerance between neighboring levels (round-half-up boundaries). */
const LADDER_TOL: Record<string, number> = {
  "very-beginner": 0.26,
  beginner: 0.02,
  "very-easy": 0.13,
  easy: 0.02,
  medium: 0.02,
};

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

function validateVariant(v: Variant): string[] {
  const out: string[] = [];
  const lim = LIMITS[v.level];
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
  let maxSim = 0;
  let span = 0;
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
    const k = n.start.toFixed(3);
    const c = (byStart.get(k) ?? 0) + 1;
    byStart.set(k, c);
    if (c > maxSim) maxSim = c;
    span = Math.max(span, n.start + n.dur);
  }
  if (maxSim > lim.maxSim) out.push(`${v.level}: ${maxSim} simultaneous notes (limit ${lim.maxSim})`);
  if (span > 0) {
    const density = v.notes.length / span;
    if (density > lim.maxDensity) {
      out.push(`${v.level}: ${density.toFixed(1)} notes/sec (limit ${lim.maxDensity})`);
    }
  }
  return out;
}

/** Fail-closed gate: every issue returned must be fixed before a song goes live. */
export function validateVariants(variants: Variant[]): string[] {
  const errors: string[] = [];
  const byLevel = new Map(variants.map((v) => [v.level, v]));
  for (const v of variants) errors.push(...validateVariant(v));
  for (let i = 0; i < LEVEL_ORDER.length - 1; i++) {
    const level = LEVEL_ORDER[i]!;
    const easier = byLevel.get(level);
    const harder = byLevel.get(LEVEL_ORDER[i + 1]!);
    if (!easier || !harder) continue;
    const harderByMidi = rhStartsByMidi(harder.notes);
    const tol = LADDER_TOL[level] ?? 0.02;
    for (const n of easier.notes) {
      if (n.hand === "L") continue;
      if (!hasNear(harderByMidi, n.midi, n.start, tol)) {
        errors.push(`${level}: note ${n.midi}@${n.start.toFixed(2)} missing from ${harder.level} (ladder broken)`);
      }
    }
  }
  return errors;
}
