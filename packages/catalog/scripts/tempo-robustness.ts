/**
 * Tempo 2x/0.5x error detection.
 *
 * Given a MIDI file, detect likely tempo doubling/halving errors.
 * Heuristic: if note density is very low for the detected tempo, try 2x;
 * if very high, try 0.5x.  Returns the recommended tempo with confidence.
 *
 * Usage:
 *   npx tsx packages/catalog/scripts/tempo-robustness.ts <midi-file> [midi-file ...]
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseMidi, type Note } from "@keyspilli/midi";

// ---------------------------------------------------------------------------
// Density thresholds (notes per second)
// ---------------------------------------------------------------------------

/**
 * Expected note density range for a solo piano arrangement at a given tempo.
 * Lower than LOW_DENSITY_NPS suggests the tempo is too slow (actual tempo is 2x).
 * Higher than HIGH_DENSITY_NPS suggests the tempo is too fast (actual tempo is 0.5x).
 */
const LOW_DENSITY_NPS = 1.0;
const HIGH_DENSITY_NPS = 8.0;

// ---------------------------------------------------------------------------
// Metric helpers
// ---------------------------------------------------------------------------

function noteCountPerSecond(notes: Note[], tempoBpm: number): number {
  if (!notes.length || tempoBpm <= 0) return 0;
  const secPerBeat = 60 / tempoBpm;
  const durationBeats = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  const durationSec = durationBeats * secPerBeat;
  return durationSec > 0 ? notes.length / durationSec : 0;
}

function distinctPitches(notes: Note[]): number {
  return new Set(notes.map((n) => n.midi)).size;
}

function maxSimultaneous(notes: Note[]): number {
  const events: Array<[number, number]> = [];
  for (const n of notes) {
    events.push([n.start, 1]);
    events.push([n.start + n.dur, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let mx = 0;
  for (const [, d] of events) {
    cur += d;
    if (cur > mx) mx = cur;
  }
  return mx;
}

function medianInterOnsetInterval(notes: Note[], tempoBpm: number): number {
  if (notes.length < 2) return Infinity;
  const secPerBeat = 60 / tempoBpm;
  const starts = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
  if (starts.length < 2) return Infinity;
  const gaps: number[] = [];
  for (let i = 1; i < starts.length; i++) {
    gaps.push((starts[i]! - starts[i - 1]!) * secPerBeat);
  }
  gaps.sort((a, b) => a - b);
  const m = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[m]! : (gaps[m - 1]! + gaps[m]!) / 2;
}

// ---------------------------------------------------------------------------
// Tempo analysis
// ---------------------------------------------------------------------------

export interface TempoAnalysis {
  detectedTempo: number;
  noteCount: number;
  densityNps: number;
  distinctPitches: number;
  maxSimultaneous: number;
  medianIoiSec: number;
  candidates: TempoCandidate[];
}

export interface TempoCandidate {
  tempo: number;
  factor: string;
  densityNps: number;
  medianIoiSec: number;
  confidence: "low" | "medium" | "high";
  reason: string;
}

export function analyzeTempo(notes: Note[], detectedTempo: number): TempoAnalysis {
  const nps = noteCountPerSecond(notes, detectedTempo);
  const medianIoi = medianInterOnsetInterval(notes, detectedTempo);

  const candidates: TempoCandidate[] = [];

  // Check 2x (tempo too slow)
  const nps2x = noteCountPerSecond(notes, detectedTempo * 2);
  const medianIoi2x = medianIoi / 2;
  if (notes.length > 0 && nps < LOW_DENSITY_NPS) {
    const conf = nps < LOW_DENSITY_NPS * 0.5 ? "high" : "medium";
    candidates.push({
      tempo: detectedTempo * 2,
      factor: "2x",
      densityNps: nps2x,
      medianIoiSec: medianIoi2x,
      confidence: conf,
      reason: `density ${nps.toFixed(2)} nps is very low (threshold ${LOW_DENSITY_NPS})`,
    });
  }

  // Check 0.5x (tempo too fast)
  const npsHalf = noteCountPerSecond(notes, detectedTempo * 0.5);
  const medianIoiHalf = medianIoi * 2;
  if (notes.length > 0 && nps > HIGH_DENSITY_NPS) {
    const conf = nps > HIGH_DENSITY_NPS * 1.5 ? "high" : "medium";
    candidates.push({
      tempo: detectedTempo * 0.5,
      factor: "0.5x",
      densityNps: npsHalf,
      medianIoiSec: medianIoiHalf,
      confidence: conf,
      reason: `density ${nps.toFixed(2)} nps is very high (threshold ${HIGH_DENSITY_NPS})`,
    });
  }

  return {
    detectedTempo,
    noteCount: notes.length,
    densityNps: nps,
    distinctPitches: distinctPitches(notes),
    maxSimultaneous: maxSimultaneous(notes),
    medianIoiSec: medianIoi,
    candidates,
  };
}

export function recommendTempo(analysis: TempoAnalysis): { tempo: number; confidence: string; reason: string } {
  if (!analysis.candidates.length) {
    return {
      tempo: analysis.detectedTempo,
      confidence: "high",
      reason: "density is within normal range",
    };
  }
  // Pick highest confidence candidate; prefer 2x over 0.5x at equal confidence
  const best = analysis.candidates.reduce((a, b) => {
    const confOrder = { high: 3, medium: 2, low: 1 };
    if (confOrder[b.confidence] > confOrder[a.confidence]) return b;
    if (confOrder[b.confidence] === confOrder[a.confidence] && b.factor === "2x") return b;
    return a;
  });
  return {
    tempo: best.tempo,
    confidence: best.confidence,
    reason: best.reason,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/* istanbul ignore next -- only runs when executed as a script */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: tempo-robustness.ts <midi-file> [midi-file ...]");
    process.exit(1);
  }

  const results: Array<{
    file: string;
    analysis: TempoAnalysis;
    recommendation: ReturnType<typeof recommendTempo>;
  }> = [];

  for (const arg of args) {
    let files: string[];
    try {
      const fileStat = await stat(arg);
      if (fileStat.isDirectory()) {
        const entries = await readdir(arg);
        files = entries.filter((f) => f.endsWith(".mid") || f.endsWith(".midi")).map((f) => join(arg, f));
      } else {
        files = [arg];
      }
    } catch {
      console.error(`File not found: ${arg}`);
      continue;
    }

    for (const filePath of files) {
      try {
        const buf = new Uint8Array(await readFile(filePath));
        const parsed = parseMidi(buf);
        const analysis = analyzeTempo(parsed.notes, parsed.tempoBpm);
        const recommendation = recommendTempo(analysis);
        results.push({ file: filePath, analysis, recommendation });
      } catch (e) {
        console.error(`Error processing ${filePath}: ${(e as Error).message}`);
      }
    }
  }

  // --- JSON output ---
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    lowDensityThreshold: LOW_DENSITY_NPS,
    highDensityThreshold: HIGH_DENSITY_NPS,
    results,
  }, null, 2));

  // --- Human-readable summary ---
  console.error("\n--- Tempo Robustness Summary ---");
  console.error(
    "File".padEnd(45) +
    "Detected".padStart(10) +
    "Notes".padStart(8) +
    "NPS".padStart(8) +
    "MaxSim".padStart(8) +
    "Rec".padStart(10) +
    "Conf".padStart(8) +
    "Reason",
  );
  for (const r of results) {
    const f = r.file.length > 43 ? r.file.slice(0, 40) + "..." : r.file;
    console.error(
      f.padEnd(45) +
      r.analysis.detectedTempo.toFixed(0).padStart(10) +
      String(r.analysis.noteCount).padStart(8) +
      r.analysis.densityNps.toFixed(2).padStart(8) +
      String(r.analysis.maxSimultaneous).padStart(8) +
      (r.recommendation.tempo !== r.analysis.detectedTempo ? r.recommendation.tempo.toFixed(0) : "ok").padStart(10) +
      r.recommendation.confidence.padStart(8) +
      " " + r.recommendation.reason,
    );
  }
}

if (process.argv[1]?.endsWith("tempo-robustness.ts")) await main();
