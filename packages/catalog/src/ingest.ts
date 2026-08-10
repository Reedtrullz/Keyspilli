import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseMidi,
  parseMusicXmlNotes,
  cleanTranscription,
  buildVariants,
  writeMidi,
  writeMusicXml,
  keySignature,
  LEVEL_ORDER,
  validateVariants,
} from "@keyspilli/midi";
import { upsertSong, getSongsByBase, SongRow } from "./db.js";
import { artifactsDir, uploadsDir } from "./paths.js";

const LEVEL_CODE: Record<string, string> = {
  "very-beginner": "vb",
  beginner: "b",
  "very-easy": "ve",
  easy: "e",
  medium: "m",
  advanced: "a",
};

export interface IngestInput {
  buf: Uint8Array;
  title: string;
  artist: string;
  category?: string;
  style?: string;
  mood?: string;
  key?: string;
  tempo?: number;
  contentType: "standard" | "youtube" | "upload";
  acquiredVia?: string | null;
  sourceYoutubeUrl?: string | null;
  baseId?: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function looksLikeXml(buf: Uint8Array): boolean {
  const head = new TextDecoder().decode(buf.slice(0, 64)).trimStart();
  return head.startsWith("<?xml") || head.startsWith("<score-partwise");
}

/**
 * Parse a MIDI/MusicXML buffer, generate 6 difficulty variants, write
 * artifacts and DB rows. Returns the base id + created song ids.
 */
export async function ingestSource(inp: IngestInput): Promise<{ baseId: string; songIds: string[]; error?: string }> {
  let parsed;
  try {
    parsed = looksLikeXml(inp.buf)
      ? parseMusicXmlNotes(new TextDecoder().decode(inp.buf))
      : parseMidi(inp.buf);
  } catch (e) {
    return { baseId: "", songIds: [], error: `parse failed: ${(e as Error).message}` };
  }
  // AI transcriptions carry ghost notes; human MIDI files do not.
  if (inp.contentType === "youtube") {
    parsed.notes = cleanTranscription(parsed.notes);
  }
  if (parsed.notes.length < 8) return { baseId: "", songIds: [], error: "too few notes" };

  const baseId = inp.baseId ?? `${slugify(inp.artist)}-${slugify(inp.title)}-${Date.now().toString(36)}`;
  const variants = buildVariants(parsed, {
    title: inp.title,
    artist: inp.artist,
    key: inp.key,
    tempo: inp.tempo,
  });
  const validationErrors = validateVariants(variants);
  if (validationErrors.length) {
    return { baseId: "", songIds: [], error: `validation failed: ${validationErrors.join("; ")}` };
  }
  // Keep the raw source for future re-validation when thresholds change.
  if (inp.contentType === "upload") {
    await mkdir(uploadsDir(), { recursive: true });
    await writeFile(join(uploadsDir(), `${baseId}.${looksLikeXml(inp.buf) ? "xml" : "mid"}`), inp.buf);
  }
  const durationSec = Math.round((parsed.durationBeats * 60) / parsed.tempoBpm);
  const songIds: string[] = [];

  for (const v of variants) {
    const dir = artifactsDir(baseId, LEVEL_CODE[v.level]!);
    await mkdir(dir, { recursive: true });
    const midi = writeMidi(v.notes, {
      tempoBpm: v.tempoBpm,
      timeSig: v.timeSig,
      keySig: keySignature(v.key).fifths,
      keyMode: keySignature(v.key).mode,
      title: `${inp.title} (${v.level})`,
      tracks: [
        { name: "Right Hand", notes: v.notes.filter((n) => n.hand !== "L") },
        { name: "Left Hand", notes: v.notes.filter((n) => n.hand === "L") },
      ],
    });
    const xml = writeMusicXml(v, inp.title, inp.artist);
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
    const id = `${baseId}-${LEVEL_CODE[v.level]!}`;
    songIds.push(id);
    const row: SongRow = {
      id,
      baseId,
      title: inp.title,
      artist: inp.artist,
      category: inp.category ?? "Upload",
      difficulty: v.level,
      difficultyScore: v.difficultyScore,
      key: v.key,
      tempo: v.tempoBpm,
      style: inp.style ?? "classical",
      mood: inp.mood ?? "peaceful",
      bassPattern: v.bassPattern,
      duration: durationSec,
      contentType: inp.contentType,
      acquiredVia: inp.acquiredVia ?? null,
      sourceYoutubeUrl: inp.sourceYoutubeUrl ?? null,
      hasSheetXml: 1,
      sections: null,
      plays: 0,
      level: LEVEL_CODE[v.level]!,
      createdAt: new Date().toISOString(),
    };
    upsertSong(row);
  }
  return { baseId, songIds };
}

export { LEVEL_ORDER, getSongsByBase };
