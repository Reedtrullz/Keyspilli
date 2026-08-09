/**
 * Arrangement pipeline: for every song in catalog/manifest.json, parse the
 * seed MIDI, generate 6 difficulty variants, write artifacts
 * (data/artifacts/{baseId}/{level}/{variant.mid,variant.xml,notes.json})
 * and upsert one Song row per variant. Idempotent.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseMidi,
  buildVariants,
  writeMidi,
  writeMusicXml,
  LEVEL_ORDER,
  Variant,
} from "@keyspilli/midi";
import { upsertSong, getSongsByBase, countSongs, SongRow } from "../src/db.js";
import { ROOT, artifactsDir, seedMidiDir } from "../src/paths.js";

interface ManifestSong {
  id: string;
  title: string;
  artist: string;
  category?: string;
  style?: string;
  mood?: string;
  key?: string;
  tempo?: number;
  sourceFile: string;
  sourceUrl: string;
  license: string;
  instrument?: string;
}

const manifest: { songs: ManifestSong[] } = JSON.parse(
  await readFile(join(ROOT, "catalog", "manifest.json"), "utf8"),
);

const LEVEL_CODE: Record<string, string> = {
  "very-beginner": "vb",
  beginner: "b",
  "very-easy": "ve",
  easy: "e",
  medium: "m",
  advanced: "a",
};

async function processSong(s: ManifestSong): Promise<{ ok: boolean; error?: string; variants: number }> {
  const midiPath = join(seedMidiDir(), s.sourceFile);
  let buf: Buffer;
  try {
    buf = await readFile(midiPath);
  } catch {
    return { ok: false, error: "missing midi file", variants: 0 };
  }
  let parsed;
  try {
    parsed = parseMidi(new Uint8Array(buf));
  } catch (e) {
    return { ok: false, error: `parse: ${(e as Error).message}`, variants: 0 };
  }
  if (parsed.notes.length < 8) return { ok: false, error: "too few notes", variants: 0 };

  const variants = buildVariants(parsed, {
    title: s.title,
    artist: s.artist,
    key: s.key,
    tempo: s.tempo,
  });
  const durationSec = Math.round((parsed.durationBeats * 60) / parsed.tempoBpm);

  for (const v of variants) {
    const dir = artifactsDir(s.id, LEVEL_CODE[v.level]!);
    await mkdir(dir, { recursive: true });
    const midi = writeMidi(v.notes, {
      tempoBpm: v.tempoBpm,
      timeSig: v.timeSig,
      keySig: keySigOf(v.key),
      keyMode: v.key.includes("m") ? 1 : 0,
      title: `${s.title} (${v.level})`,
      tracks: [
        { name: "Right Hand", notes: v.notes.filter((n) => n.hand !== "L") },
        { name: "Left Hand", notes: v.notes.filter((n) => n.hand === "L") },
      ],
    });
    const xml = writeMusicXml(v, s.title, s.artist);
    const notesJson = JSON.stringify({
      notes: v.notes,
      chords: v.chords,
      measures: v.measures,
      key: v.key,
      tempoBpm: v.tempoBpm,
      timeSig: v.timeSig,
    });
    await Promise.all([
      writeFile(join(dir, "variant.mid"), midi),
      writeFile(join(dir, "variant.xml"), xml),
      writeFile(join(dir, "notes.json"), notesJson),
    ]);
    const row: SongRow = {
      id: `${s.id}-${LEVEL_CODE[v.level]!}`,
      baseId: s.id,
      title: s.title,
      artist: s.artist,
      category: s.category ?? "Classical",
      difficulty: v.level,
      difficultyScore: v.difficultyScore,
      key: v.key,
      tempo: v.tempoBpm,
      style: s.style ?? "classical",
      mood: s.mood ?? "peaceful",
      bassPattern: v.bassPattern,
      duration: durationSec,
      contentType: "standard",
      acquiredVia: null,
      sourceYoutubeUrl: null,
      hasSheetXml: 1,
      sections: null,
      plays: 0,
      level: LEVEL_CODE[v.level]!,
      createdAt: new Date().toISOString(),
    };
    upsertSong(row);
  }
  return { ok: true, variants: variants.length };
}

function keySigOf(key: string): number {
  const major = ["C", "G", "D", "A", "E", "B", "F#", "C#"];
  const flat = ["F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"];
  const root = key.split(" ")[0]!;
  const mi = major.indexOf(root);
  if (mi >= 0) return mi;
  const fi = flat.indexOf(root);
  if (fi >= 0) return -(fi + 1);
  return 0;
}

let ok = 0;
let failed = 0;
const failures: string[] = [];
const t0 = Date.now();
for (const s of manifest.songs) {
  const r = await processSong(s);
  if (r.ok) {
    ok++;
    process.stdout.write(`+ ${s.id} (${r.variants} variants)\n`);
  } else {
    failed++;
    failures.push(`${s.id}: ${r.error}`);
    process.stdout.write(`x ${s.id}: ${r.error}\n`);
  }
}
console.log(`\npipeline done: ${ok} ok, ${failed} failed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (failures.length) console.log(failures.join("\n"));
console.log(`songs in db: ${countSongs()}`);

// sanity: every variant has artifacts + db row
let missing = 0;
for (const s of manifest.songs) {
  const rows = getSongsByBase(s.id);
  if (rows.length !== LEVEL_ORDER.length) missing++;
}
console.log(`bases with incomplete variant sets: ${missing}`);
