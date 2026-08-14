/**
 * Prints catalog P50/P99 statistics per difficulty level next to the
 * configured playability limits and exits non-zero when P99 drifts past a
 * limit (time to recalibrate PLAYABILITY_LIMITS). Run before shipping data.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { LEVEL_ORDER, PLAYABILITY_LIMITS } from "@keyspilli/midi";
import { ROOT } from "../src/paths.js";

const LEVEL_CODE: Record<string, string> = {
  "very-beginner": "vb",
  beginner: "b",
  "very-easy": "ve",
  easy: "e",
  medium: "m",
  advanced: "a",
};

const artifactsRoot = join(ROOT, "data", "artifacts");
const rows: Record<string, { maxSim: number[]; density: number[]; ioi: number[] }> = {};
for (const level of LEVEL_ORDER) rows[level] = { maxSim: [], density: [], ioi: [] };

for (const song of await readdir(artifactsRoot)) {
  for (const level of LEVEL_ORDER) {
    try {
      const v = JSON.parse(await readFile(join(artifactsRoot, song, LEVEL_CODE[level]!, "notes.json"), "utf8"));
      const byStart = new Map<string, number>();
      const starts: number[] = [];
      let maxSim = 0;
      let span = 0;
      for (const n of v.notes) {
        const k = n.start.toFixed(3);
        const c = (byStart.get(k) ?? 0) + 1;
        byStart.set(k, c);
        if (c > maxSim) maxSim = c;
        span = Math.max(span, n.start + n.dur);
        starts.push(n.start);
      }
      const distinct = [...new Set(starts.map((s) => s.toFixed(3)).map(Number))].sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < distinct.length; i++) gaps.push(distinct[i]! - distinct[i - 1]!);
      // Keep this statistic identical to validateVariants(): the median is
      // taken from the sorted inter-onset gaps, not from their chronological
      // order. Using the unsorted array understated/overstated the P1 tail
      // depending on the song's rhythm and caused false calibration failures.
      gaps.sort((a, b) => a - b);
      const tempoBpm = Number.isFinite(v.tempoBpm) && v.tempoBpm > 0 ? v.tempoBpm : 120;
      rows[level]!.maxSim.push(maxSim);
      // Chord members share one physical attack. Match the publication gate
      // by counting distinct starts rather than raw note count.
      rows[level]!.density.push(span > 0 ? byStart.size / (span * 60 / tempoBpm) : 0);
      rows[level]!.ioi.push(gaps.length ? gaps[Math.floor(gaps.length / 2)]! * 60 / tempoBpm : Infinity);
    } catch {
      // missing artifacts are reported by verify-catalog
    }
  }
}

const pct = (arr: number[], p: number): number => {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
};

let drift = 0;
for (const level of LEVEL_ORDER) {
  const lim = PLAYABILITY_LIMITS[level]!;
  const p99MaxSim = pct(rows[level]!.maxSim, 0.99);
  const p99Density = pct(rows[level]!.density, 0.99);
  const p1Ioi = pct(rows[level]!.ioi, 0.01);
  const flags: string[] = [];
  if (p99MaxSim > lim.maxSim) { drift++; flags.push(`maxSim P99 ${p99MaxSim} > ${lim.maxSim}`); }
  if (p99Density > lim.maxDensity) { drift++; flags.push(`density P99 ${p99Density.toFixed(2)} > ${lim.maxDensity}`); }
  if (p1Ioi < lim.minMedianIoi) { drift++; flags.push(`IOI P1 ${p1Ioi.toFixed(3)} < ${lim.minMedianIoi}`); }
  console.log(
    `${level}: maxSim P50/P99 ${pct(rows[level]!.maxSim, 0.5)}/${p99MaxSim} | density P99 ${p99Density.toFixed(2)} attacks/sec | ` +
      `IOI P1 ${p1Ioi.toFixed(3)}s | limits ${lim.maxSim}/${lim.maxDensity}/${lim.minMedianIoi}${flags.length ? " DRIFT: " + flags.join("; ") : ""}`,
  );
}
if (drift) process.exitCode = 1;
