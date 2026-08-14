/** Read-only whole-catalog quality audit. */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseMidi, parseMusicXmlNotes } from "@keyspilli/midi";
import { getDb } from "../src/db.js";
import { artifactsDir } from "../src/paths.js";
import type { Note } from "@keyspilli/midi";

const levels = ["vb", "b", "ve", "e", "m", "a"];
const db = getDb();
const rows = db.prepare("SELECT DISTINCT base_id AS baseId, title, artist, content_type AS contentType, acquired_via AS acquiredVia FROM songs ORDER BY base_id").all() as any[];

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
function metrics(notes: Note[], tempo: number) {
  const starts = [...new Set(notes.map((n) => Number(n.start.toFixed(6))))].sort((a, b) => a - b);
  const gaps = starts.slice(1).map((x, i) => x - starts[i]!);
  const events: Array<[number, number]> = [];
  for (const n of notes) events.push([n.start, 1], [n.start + n.dur, -1]);
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let maxSim = 0;
  for (const [, delta] of events) {
    current += delta;
    if (current > maxSim) maxSim = current;
  }
  const attacks = new Map<string, number>();
  for (const n of notes) {
    const key = n.start.toFixed(3);
    attacks.set(key, (attacks.get(key) ?? 0) + 1);
  }
  const hand: Record<"R" | "L", { min: number; max: number; count: number }> = {
    R: { min: 999, max: -999, count: 0 },
    L: { min: 999, max: -999, count: 0 },
  };
  const byHand: Record<"R" | "L", Note[]> = { R: [], L: [] };
  let maxLeap = 0;
  for (const n of notes) {
    const h = n.hand === "L" ? "L" : "R";
    hand[h].min = Math.min(hand[h].min, n.midi);
    hand[h].max = Math.max(hand[h].max, n.midi);
    hand[h].count++;
    byHand[h].push(n);
  }
  for (const h of ["R", "L"] as const) {
    const sorted = byHand[h].sort((a, b) => a.start - b.start || a.midi - b.midi);
    for (let i = 1; i < sorted.length; i++) maxLeap = Math.max(maxLeap, Math.abs(sorted[i]!.midi - sorted[i - 1]!.midi));
  }
  const totalBeats = Math.max(1, ...notes.map((n) => n.start + n.dur));
  const totalSec = totalBeats * 60 / tempo;
  return {
    notes: notes.length,
    totalBeats,
    totalSec,
    densitySec: notes.length / totalSec,
    maxSim,
    maxAttack: Math.max(0, ...attacks.values()),
    medianIoiBeats: median(gaps),
    medianIoiSec: median(gaps) * 60 / tempo,
    maxDur: Math.max(...notes.map((n) => n.dur)),
    long8: notes.filter((n) => n.dur > 8).length,
    rangeMin: Math.min(...notes.map((n) => n.midi)),
    rangeMax: Math.max(...notes.map((n) => n.midi)),
    rhSpan: hand.R.count ? hand.R.max - hand.R.min : 0,
    lhSpan: hand.L.count ? hand.L.max - hand.L.min : 0,
    maxLeap,
  };
}

const out: any[] = [];
let midiRoundtripErrors = 0;
let xmlRoundtripErrors = 0;
for (const row of rows) {
  const record: any = { ...row, variants: {}, issues: [] as string[] };
  for (const level of levels) {
    const dir = artifactsDir(row.baseId, level);
    let variant: any;
    try {
      variant = JSON.parse(await readFile(join(dir, "notes.json"), "utf8"));
    } catch {
      record.issues.push(level + ":missing-notes");
      continue;
    }
    record.variants[level] = { ...metrics(variant.notes, variant.tempoBpm), tempo: variant.tempoBpm, key: variant.key, warnings: variant.warnings ?? [] };
    try {
      const parsed = parseMidi(new Uint8Array(await readFile(join(dir, "variant.mid"))));
      const source = variant.notes.map((n: Note) => n.midi + "@" + n.start.toFixed(3) + ":" + n.dur.toFixed(3)).sort();
      const roundtrip = parsed.notes.map((n: Note) => n.midi + "@" + n.start.toFixed(3) + ":" + n.dur.toFixed(3)).sort();
      if (source.length !== roundtrip.length || source.some((x: string, i: number) => x !== roundtrip[i])) {
        record.issues.push(level + ":midi-roundtrip");
        midiRoundtripErrors++;
      }
    } catch (e) {
      record.issues.push(level + ":midi-error:" + (e as Error).message);
      midiRoundtripErrors++;
    }
    try {
      const xml = await readFile(join(dir, "variant.xml"), "utf8");
      const parsed = parseMusicXmlNotes(xml);
      const source = variant.notes.map((n: Note) => n.midi + "@" + n.start.toFixed(3)).sort();
      const roundtrip = parsed.notes.map((n: Note) => n.midi + "@" + n.start.toFixed(3)).sort();
      if (source.length !== roundtrip.length || source.some((x: string, i: number) => x !== roundtrip[i])) {
        record.issues.push(level + ":xml-roundtrip");
        xmlRoundtripErrors++;
      }
    } catch (e) {
      record.issues.push(level + ":xml-error:" + (e as Error).message);
      xmlRoundtripErrors++;
    }
  }
  const advanced = record.variants.a;
  const medium = record.variants.m;
  if (advanced && medium && advanced.notes === medium.notes) record.issues.push("advanced-equals-medium");
  out.push(record);
}
const summary: any = { rows: rows.length, midiRoundtripErrors, xmlRoundtripErrors, issueCounts: {}, sourceWarningVariants: 0 };
for (const record of out) {
  for (const variant of Object.values(record.variants) as any[]) {
    if (Array.isArray(variant?.warnings) && variant.warnings.length) summary.sourceWarningVariants++;
  }
  for (const issue of record.issues) {
    const key = issue.split(":")[1] ?? issue;
    summary.issueCounts[key] = (summary.issueCounts[key] ?? 0) + 1;
  }
}
console.log(JSON.stringify(summary));
for (const record of out.filter((x) => x.issues.length).sort((a, b) => b.issues.length - a.issues.length).slice(0, 120)) {
  console.log(JSON.stringify({ baseId: record.baseId, title: record.title, contentType: record.contentType, issues: record.issues, a: record.variants.a, m: record.variants.m, e: record.variants.e }));
}
