/**
 * Measurement harness for YouTube transcriptions: per-song quality metrics
 * over stored artifacts, plus comparison against a seed reference MIDI when
 * one exists for the same piece. Read-only.
 *
 * Usage: npx tsx packages/catalog/scripts/audit-transcriptions.ts
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Note, parseMidi } from "@keyspilli/midi";
import { getDb } from "../src/db.js";
import { artifactsDir, seedMidiDir } from "../src/paths.js";

interface VariantJson {
  notes: Note[];
  tempoBpm: number;
}

const LEVELS = ["a", "m", "e"] as const;

// Reference matching is a token-overlap heuristic: the seed filename must be
// fully explained by the song's base slug + title (all its tokens known, >=2
// shared).
// ponytail: naive slug matching, add editorial refs if it mis-matches.
const STOP = new Set([
  "piano", "cover", "tutorial", "video", "with", "lyrics", "performed", "by",
  "and", "the", "of", "for", "official", "sheet", "music",
]);
const slug = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\x00-\x7f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const tokens = (s: string) => new Set(slug(s).split("-").filter((t) => t.length > 1 && !STOP.has(t)));

async function readVariant(baseId: string, level: string): Promise<VariantJson | undefined> {
  try {
    return JSON.parse(await readFile(join(artifactsDir(baseId, level), "notes.json"), "utf8")) as VariantJson;
  } catch {
    return undefined;
  }
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function maxSim(notes: Note[]): number {
  const ev: [number, number][] = [];
  for (const n of notes) {
    ev.push([n.start, 1]);
    ev.push([n.start + n.dur, -1]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let mx = 0;
  for (const [, d] of ev) {
    cur += d;
    if (cur > mx) mx = cur;
  }
  return mx;
}

function gridPct(notes: Note[]): number {
  let on = 0;
  for (const n of notes) {
    const d = n.start / 0.25;
    if (Math.abs(d - Math.round(d)) * 0.25 <= 0.01) on++;
  }
  return (100 * on) / Math.max(1, notes.length);
}

const seedIndex = (await readdir(seedMidiDir()).catch(() => [] as string[]))
  .filter((f) => f.endsWith(".mid"))
  .map((f) => ({ f, tokens: tokens(f) }));

function findReference(baseId: string, title: string): string | undefined {
  const known = new Set([...tokens(baseId), ...tokens(title)]);
  let best: { f: string; score: number } | undefined;
  for (const { f, tokens: t } of seedIndex) {
    if ([...t].some((x) => !known.has(x))) continue;
    const score = t.size;
    if (score >= 2 && (!best || score > best.score)) best = { f, score };
  }
  return best?.f;
}

async function compareReference(v: VariantJson, refFile: string): Promise<{ pcOverlap: number; onsetErr: number }> {
  const ref = parseMidi(new Uint8Array(await readFile(join(seedMidiDir(), refFile))));
  const refSec = ref.notes.map((n) => (n.start * 60) / ref.tempoBpm).sort((a, b) => a - b);
  const songSec = v.notes.map((n) => (n.start * 60) / v.tempoBpm).sort((a, b) => a - b);
  const errs = refSec.map((r) => Math.min(...songSec.map((s) => Math.abs(s - r))));
  const hist = (ns: Note[]) => {
    const h = new Array(12).fill(0) as number[];
    for (const n of ns) h[n.midi % 12]!++;
    const tot = Math.max(1, ns.length);
    return h.map((x) => x / tot);
  };
  const a = hist(v.notes);
  const b = hist(ref.notes);
  return { pcOverlap: a.reduce((acc, x, i) => acc + Math.min(x, b[i]!), 0), onsetErr: median(errs) };
}

const cols = [
  "base", "title", "tempoBpm", "notes_a", "notes_m", "notes_e", "durMax_a",
  "pct>2", "pct>8", "maxSim_a", "pctGrid16", "refPCoverlap", "refOnsetErr",
];
console.log(cols.join("\t"));

const bases = getDb().prepare("SELECT DISTINCT base_id FROM songs WHERE content_type='youtube' ORDER BY base_id").all() as { base_id: string }[];
const med: number[][] = Array.from({ length: 7 }, () => []);
let refCount = 0;

for (const { base_id: base } of bases) {
  const song = getDb().prepare("SELECT title FROM songs WHERE base_id = ? LIMIT 1").get(base) as { title: string } | undefined;
  const title = song?.title ?? "";
  const a = await readVariant(base, "a");
  const m = await readVariant(base, "m");
  const e = await readVariant(base, "e");
  const v = a ?? m ?? e;
  if (!v) {
    console.log([base, title, ...Array(cols.length - 2).fill("n/a")].join("\t"));
    continue;
  }
  const notes = a?.notes ?? v.notes;
  const pct2 = (100 * notes.filter((n) => n.dur > 2).length) / Math.max(1, notes.length);
  const pct8 = (100 * notes.filter((n) => n.dur > 8).length) / Math.max(1, notes.length);
  const durMax = Math.max(...notes.map((n) => n.dur));
  const sim = maxSim(notes);
  const grid = gridPct(notes);
  let pc = "n/a";
  let oe = "n/a";
  const ref = findReference(base, title);
  if (ref) {
    const r = await compareReference(v, ref);
    pc = r.pcOverlap.toFixed(3);
    oe = r.onsetErr.toFixed(3);
    refCount++;
  }
  console.log(
    [base, title, v.tempoBpm, a?.notes.length ?? 0, m?.notes.length ?? 0, e?.notes.length ?? 0,
      durMax.toFixed(2), pct2.toFixed(1), pct8.toFixed(2), sim, grid.toFixed(1), pc, oe].join("\t"),
  );
  med[0]!.push(v.tempoBpm);
  med[1]!.push(a?.notes.length ?? 0);
  med[2]!.push(durMax);
  med[3]!.push(pct2);
  med[4]!.push(pct8);
  med[5]!.push(sim);
  med[6]!.push(grid);
}

console.log(
  `SUMMARY\tbases=${bases.length}\trefs=${refCount}\tmedTempo=${median(med[0]!).toFixed(0)}` +
    `\tmedNotesA=${median(med[1]!).toFixed(0)}\tmedDurMax=${median(med[2]!).toFixed(2)}` +
    `\tmedPct>2=${median(med[3]!).toFixed(1)}\tmedPct>8=${median(med[4]!).toFixed(2)}` +
    `\tmedMaxSim=${median(med[5]!).toFixed(0)}\tmedGrid=${median(med[6]!).toFixed(1)}`,
);
