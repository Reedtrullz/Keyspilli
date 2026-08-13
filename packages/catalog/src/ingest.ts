import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
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

function isZip(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

const MAX_MXL_ENTRIES = 200;
const MAX_MXL_UNCOMPRESSED = 64 * 1024 * 1024;

/**
 * Reject zip bombs before fflate inflates anything: read the EOCD and central
 * directory directly and enforce entry-count and total uncompressed-size
 * limits. The upload route accepts ~10MB, so an unbounded unzipSync is an
 * amplification vector.
 */
function assertMxlZipSafe(buf: Uint8Array): void {
  if (buf.length < 22) throw new Error("invalid .mxl zip (truncated)");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  const scanStart = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= scanStart; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("invalid .mxl zip (no end-of-central-directory)");
  const totalEntries = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error(".mxl zip64 not supported");
  }
  if (totalEntries > MAX_MXL_ENTRIES) {
    throw new Error(`.mxl zip has too many entries (${totalEntries} > ${MAX_MXL_ENTRIES})`);
  }
  if (cdOffset + cdSize > buf.length) throw new Error("invalid .mxl zip central directory");
  const cdEnd = cdOffset + cdSize;
  let offset = cdOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > cdEnd || dv.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("invalid .mxl zip central directory");
    }
    totalUncompressed += dv.getUint32(offset + 24, true);
    if (totalUncompressed > MAX_MXL_UNCOMPRESSED) {
      throw new Error(`.mxl zip expands beyond ${MAX_MXL_UNCOMPRESSED / (1024 * 1024)}MB`);
    }
    offset += 46 + dv.getUint16(offset + 28, true) + dv.getUint16(offset + 30, true) + dv.getUint16(offset + 32, true);
  }
}

/**
 * Extract the score .xml from a compressed .mxl. Container.xml is the
 * canonical pointer; some exports omit it, so fall back to a .musicxml
 * entry, then any .xml outside META-INF/ (signatures/container live there
 * and are not scores).
 */
function mxlScoreXml(buf: Uint8Array): string {
  assertMxlZipSafe(buf);
  const files = unzipSync(buf);
  const names = Object.keys(files);
  let scoreName: string | undefined;
  const container = files["META-INF/container.xml"];
  if (container) {
    // ponytail: regex on container.xml; a DOM parser only if files ever miss rootfile full-path
    const m = new TextDecoder().decode(container).match(/full-path="([^"]+)"/);
    if (m?.[1] && files[m[1]]) scoreName = m[1];
  }
  if (!scoreName) scoreName = names.find((n) => n.endsWith(".musicxml"));
  if (!scoreName) scoreName = names.find((n) => n.endsWith(".xml") && !n.startsWith("META-INF/"));
  if (!scoreName) throw new Error("no MusicXML score in .mxl");
  return new TextDecoder().decode(files[scoreName]);
}

/**
 * Parse a MIDI/MusicXML buffer, generate 6 difficulty variants, write
 * artifacts and DB rows. Returns the base id + created song ids.
 */
export async function ingestSource(inp: IngestInput): Promise<{ baseId: string; songIds: string[]; error?: string }> {
  let parsed;
  try {
    const isMxl = isZip(inp.buf);
    parsed = isMxl
      ? parseMusicXmlNotes(mxlScoreXml(inp.buf))
      : looksLikeXml(inp.buf)
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
    const ext = isZip(inp.buf) ? "mxl" : looksLikeXml(inp.buf) ? "xml" : "mid";
    await writeFile(join(uploadsDir(), `${baseId}.${ext}`), inp.buf);
  }
  const songIds: string[] = [];

  for (const v of variants) {
    // Playback uses the variant tempo (which may be a forwarded override),
    // so duration must match that tempo, not the raw source tempo.
    const durationSec = Math.round((parsed.durationBeats * 60) / v.tempoBpm);
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
