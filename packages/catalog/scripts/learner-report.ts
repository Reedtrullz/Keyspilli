/**
 * Learner-focused catalogue audit.
 *
 * The normal verifier checks whether an artifact is safe to publish. This
 * report measures whether it is useful to learn from: a recognizable RH line,
 * a meaningful LH part, human-sized spans/density, and no transcription
 * clutter. Owner listening verdicts live in catalog/learner-review.json and
 * are shown alongside the structural evidence rather than being overwritten
 * by it.
 *
 * Usage:
 *   npx tsx packages/catalog/scripts/learner-report.ts
 *   npx tsx packages/catalog/scripts/learner-report.ts --all
 */
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { getDb } from "../src/db.js";
import { artifactsDir, ROOT } from "../src/paths.js";
import type { Note } from "@keyspilli/midi";

const LEVELS = ["vb", "b", "ve", "e", "m", "a"] as const;
type ReviewRating = "good" | "polish" | "bad";

interface VariantFile { notes: Note[]; tempoBpm: number; warnings?: string[] }
interface ReviewEntry { rating: ReviewRating; feedback: string; action: string; blocked?: boolean }

function quantile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (index - lo);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function maxSimultaneous(notes: Note[]): number {
  const events = notes.flatMap((n) => [[n.start, 1], [n.start + n.dur, -1]] as [number, number][])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  let max = 0;
  for (const [, delta] of events) {
    active += delta;
    max = Math.max(max, active);
  }
  return max;
}

function samePitchOverlaps(notes: Note[]): number {
  const groups = new Map<string, Note[]>();
  for (const note of notes) {
    const key = `${note.hand === "L" ? "L" : "R"}:${note.midi}`;
    const group = groups.get(key) ?? [];
    group.push(note);
    groups.set(key, group);
  }
  let count = 0;
  for (const group of groups.values()) {
    group.sort((a, b) => a.start - b.start || a.dur - b.dur);
    let previous: Note | undefined;
    for (const note of group) {
      if (previous && previous.start + previous.dur > note.start + 1e-9 && note.start > previous.start + 1e-9) count++;
      if (!previous || note.start + note.dur > previous.start + previous.dur) previous = note;
    }
  }
  return count;
}

function handNotes(notes: Note[], hand: "L" | "R"): Note[] {
  return notes.filter((note) => (hand === "L" ? note.hand === "L" : note.hand !== "L"));
}

function maxLeap(notes: Note[]): number {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  let max = 0;
  for (let i = 1; i < sorted.length; i++) max = Math.max(max, Math.abs(sorted[i]!.midi - sorted[i - 1]!.midi));
  return max;
}

function medianIoi(notes: Note[]): number {
  const starts = [...new Set(notes.map((n) => Number(n.start.toFixed(6))))].sort((a, b) => a - b);
  return quantile(starts.slice(1).map((start, i) => start - starts[i]!), 0.5);
}

function chordAttackRatio(notes: Note[]): number {
  const byStart = new Map<number, Set<number>>();
  for (const note of notes) {
    const key = Number(note.start.toFixed(6));
    const pitches = byStart.get(key) ?? new Set<number>();
    pitches.add(note.midi);
    byStart.set(key, pitches);
  }
  if (!byStart.size) return 0;
  const chordAttacks = [...byStart.values()].filter((pitches) => pitches.size >= 2).length;
  return chordAttacks / byStart.size;
}

function profile(notes: Note[]) {
  const lh = handNotes(notes, "L");
  const rh = handNotes(notes, "R");
  const allPitches = notes.map((n) => n.midi);
  const allStarts = [...new Set(notes.map((n) => Number(n.start.toFixed(6))))].sort((a, b) => a - b);
  const duration = Math.max(1, ...notes.map((n) => n.start + n.dur));
  const totalSec = duration * 60 / 120;
  const handRatio = Math.min(lh.length, rh.length) / Math.max(1, Math.max(lh.length, rh.length));
  return {
    notes: notes.length,
    leftHandNotes: lh.length,
    rightHandNotes: rh.length,
    handRatio: round(handRatio, 3),
    allOneHand: lh.length === 0 || rh.length === 0,
    pitchMin: allPitches.length ? Math.min(...allPitches) : 0,
    pitchMax: allPitches.length ? Math.max(...allPitches) : 0,
    pitchSpan: allPitches.length ? Math.max(...allPitches) - Math.min(...allPitches) : 0,
    onsetCount: allStarts.length,
    onsetDensitySec: round(allStarts.length / totalSec, 2),
    maxSimultaneous: maxSimultaneous(notes),
    samePitchOverlaps: samePitchOverlaps(notes),
    maxDur: round(Math.max(0, ...notes.map((n) => n.dur)), 3),
    medianDur: round(quantile(notes.map((n) => n.dur), 0.5), 3),
    p90Dur: round(quantile(notes.map((n) => n.dur), 0.9), 3),
    rightHand: {
      notes: rh.length,
      onsetCount: new Set(rh.map((n) => Number(n.start.toFixed(6)))).size,
      medianIoiBeats: round(medianIoi(rh), 3),
      maxLeap: maxLeap(rh),
      chordAttackRatio: round(chordAttackRatio(rh), 3),
    },
    leftHand: {
      notes: lh.length,
      onsetCount: new Set(lh.map((n) => Number(n.start.toFixed(6)))).size,
      medianIoiBeats: round(medianIoi(lh), 3),
      maxLeap: maxLeap(lh),
      chordAttackRatio: round(chordAttackRatio(lh), 3),
    },
  };
}

function structuralFlags(metrics: ReturnType<typeof profile>): string[] {
  const flags: string[] = [];
  if (metrics.allOneHand) flags.push("one-sided hand assignment");
  if (metrics.handRatio < 0.15) flags.push("severely imbalanced hands");
  if (metrics.maxSimultaneous > 8) flags.push(`max simultaneous ${metrics.maxSimultaneous} > learner budget 8`);
  if (metrics.samePitchOverlaps >= 20) flags.push(`${metrics.samePitchOverlaps} same-pitch overlaps`);
  if (metrics.rightHand.maxLeap >= 19) flags.push(`RH leap ${metrics.rightHand.maxLeap} semitones`);
  if (metrics.leftHand.maxLeap >= 19) flags.push(`LH leap ${metrics.leftHand.maxLeap} semitones`);
  if (metrics.leftHand.notes > 0 && metrics.leftHand.chordAttackRatio < 0.05) flags.push("LH has few chord attacks");
  if (metrics.rightHand.notes > 0 && metrics.rightHand.chordAttackRatio > 0.65) flags.push("RH carries chord-wall texture");
  return flags;
}

function parseArgs(): { all: boolean; top: number } {
  const all = process.argv.includes("--all");
  const raw = process.argv.find((arg) => arg.startsWith("--top="))?.slice(6);
  const top = raw ? Math.max(0, Math.floor(Number(raw))) : 50;
  return { all, top: Number.isFinite(top) ? top : 50 };
}

const args = parseArgs();
const review = JSON.parse(await readFile(join(ROOT, "catalog", "learner-review.json"), "utf8")) as {
  verdicts: Record<string, ReviewEntry>;
};
const rows = getDb().prepare(
  `SELECT DISTINCT base_id AS baseId, title, artist, content_type AS contentType, acquired_via AS acquiredVia
     FROM songs ORDER BY base_id`,
).all() as Array<{ baseId: string; title: string; artist: string; contentType: string; acquiredVia: string | null }>;

const entries: Array<Record<string, unknown>> = [];
for (const row of rows) {
  const path = join(artifactsDir(row.baseId, "a"), "notes.json");
  if (!(await access(path).then(() => true).catch(() => false))) continue;
  const variant = JSON.parse(await readFile(path, "utf8")) as VariantFile;
  const metrics = profile(variant.notes);
  const flags = structuralFlags(metrics);
  const owner = review.verdicts[row.baseId];
  const structuralRating = flags.some((flag) => /one-sided|same-pitch overlaps|chord-wall/.test(flag)) ? "polish" : "good";
  entries.push({
    baseId: row.baseId,
    title: row.title,
    artist: row.artist,
    contentType: row.contentType,
    acquiredVia: row.acquiredVia,
    ownerRating: owner?.rating ?? null,
    blocked: owner?.blocked === true,
    ownerFeedback: owner?.feedback ?? null,
    recommendedAction: owner?.action ?? (flags.length ? "manual listening review" : "keep; no structural learner blocker"),
    structuralRating,
    flags,
    metrics,
  });
}

const riskRank: Record<string, number> = { bad: 5, polish: 3, good: 1 };
const risky = entries
  .filter((entry) => (entry.flags as string[]).length || entry.ownerRating === "bad" || entry.ownerRating === "polish")
  .sort((a, b) => (riskRank[String(b.ownerRating ?? b.structuralRating)] ?? 2) - (riskRank[String(a.ownerRating ?? a.structuralRating)] ?? 2) || String(a.baseId).localeCompare(String(b.baseId)));
const ownerCounts = Object.fromEntries((["good", "polish", "bad"] as const).map((rating) => [rating, entries.filter((e) => e.ownerRating === rating).length]));
const structuralCounts = Object.fromEntries((["good", "polish"] as const).map((rating) => [rating, entries.filter((e) => e.structuralRating === rating).length]));
const report = {
  generatedAt: new Date().toISOString(),
  purpose: "learner-first musical quality; structural evidence is not a substitute for listening",
  coverage: { bases: entries.length, advancedArtifacts: entries.length },
  ownerVerdicts: ownerCounts,
  structuralRatings: structuralCounts,
  gates: {
    learnerMaxSimultaneous: 8,
    severeHandImbalanceRatio: 0.15,
    samePitchOverlapReview: 20,
    note: "Good structural metrics do not prove recognizability; owner verdicts remain authoritative for listened songs.",
  },
  entries: args.all ? entries : undefined,
  topRisk: risky.slice(0, args.top),
};
console.log(JSON.stringify(report, null, 2));
