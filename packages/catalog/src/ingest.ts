import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import {
  parseMidi,
  parseMusicXmlNotes,
  cleanTranscription,
  buildVariants,
  normalizeTempoBpm,
  writeVariantArtifacts,
  validateArtifactFiles,
  LEVEL_ORDER,
  validateVariants,
} from "@keyspilli/midi";
import { replaceSongsByBase, getSongsByBase, SongRow } from "./db.js";
import { dataDir, uploadsDir } from "./paths.js";

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
  /** Override the default YouTube cleanup for curated human-authored MIDI. */
  cleanTranscription?: boolean;
}

/** Optional deterministic hook used by integration tests to exercise rollback. */
export interface IngestOptions {
  beforeReplace?: () => void;
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

function validBaseId(baseId: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,119}$/.test(baseId);
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
export async function ingestSource(inp: IngestInput, options: IngestOptions = {}): Promise<{ baseId: string; songIds: string[]; error?: string }> {
  if (inp.baseId && !validBaseId(inp.baseId)) {
    return { baseId: "", songIds: [], error: "invalid base id" };
  }
  let parsed;
  let isMxl = false;
  let sourceIsXml = false;
  try {
    isMxl = isZip(inp.buf);
    sourceIsXml = looksLikeXml(inp.buf);
    parsed = isMxl
      ? parseMusicXmlNotes(mxlScoreXml(inp.buf))
      : sourceIsXml
        ? parseMusicXmlNotes(new TextDecoder().decode(inp.buf))
        : parseMidi(inp.buf);
  } catch (e) {
    return { baseId: "", songIds: [], error: `parse failed: ${(e as Error).message}` };
  }
  // AI transcriptions carry ghost notes; human MIDI files do not.
  parsed.tempoBpm = normalizeTempoBpm(inp.tempo ?? parsed.tempoBpm);
  if (inp.contentType === "youtube" && inp.cleanTranscription !== false) {
    parsed.notes = cleanTranscription(parsed.notes, { tempoBpm: parsed.tempoBpm });
  }
  if (parsed.notes.length < 8) return { baseId: "", songIds: [], error: "too few notes" };

  const baseId = inp.baseId ?? `${slugify(inp.artist)}-${slugify(inp.title)}-${Date.now().toString(36)}`;
  // Re-ingests replace the six-row set atomically, but engagement history is
  // not part of the source arrangement. Preserve per-level plays and creation
  // timestamps so repairing an arrangement does not reset the live catalog.
  const existingRows = inp.baseId ? getSongsByBase(baseId) : [];
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

  const prepared = [];
  const artifactErrors: string[] = [];
  const createdAt = new Date().toISOString();
  for (const v of variants) {
    const code = LEVEL_CODE[v.level]!;
    try {
      const artifacts = writeVariantArtifacts(v, inp.title, inp.artist);
      const issues = validateArtifactFiles(v, artifacts);
      if (issues.length) artifactErrors.push(`${v.level}: ${issues.join("; ")}`);
      const durationSec = Math.round((parsed.durationBeats * 60) / v.tempoBpm);
      const previous = existingRows.find((row) => row.difficulty === v.level);
      const row: SongRow = {
        id: `${baseId}-${code}`,
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
        plays: previous?.plays ?? 0,
        level: code,
        createdAt: previous?.createdAt ?? createdAt,
      };
      prepared.push({ code, row, midi: artifacts.midi, xml: artifacts.xml, notesJson: JSON.stringify({
        notes: v.notes,
        warnings: v.warnings,
        chords: v.chords,
        measures: v.measures,
        key: v.key,
        tempoBpm: v.tempoBpm,
        timeSig: v.timeSig,
      }) });
    } catch (e) {
      artifactErrors.push(`${v.level}: artifact render failed: ${(e as Error).message}`);
    }
  }
  if (artifactErrors.length) {
    return { baseId: "", songIds: [], error: `artifact validation failed: ${artifactErrors.join("; ")}` };
  }

  const artifactsRoot = join(dataDir(), "artifacts");
  const finalRoot = join(artifactsRoot, baseId);
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const stageRoot = join(artifactsRoot, `.${baseId}.staging-${token}`);
  const backupRoot = join(artifactsRoot, `.${baseId}.backup-${token}`);
  const uploadExt = isMxl ? "mxl" : sourceIsXml ? "xml" : "mid";
  const uploadRoot = uploadsDir();
  const finalUpload = join(uploadRoot, `${baseId}.${uploadExt}`);
  const stageUpload = join(uploadRoot, `.${baseId}.staging-${token}.${uploadExt}`);
  const backupUpload = join(uploadRoot, `.${baseId}.backup-${token}.${uploadExt}`);
  let movedArtifactBackup = false;
  let movedUploadBackup = false;
  let movedStageArtifacts = false;
  let movedStageUpload = false;
  let dbCommitted = false;
  try {
    await mkdir(artifactsRoot, { recursive: true });
    await mkdir(stageRoot, { recursive: true });
    for (const item of prepared) {
      const dir = join(stageRoot, item.code);
      await mkdir(dir, { recursive: true });
      await Promise.all([
        writeFile(join(dir, "variant.mid"), item.midi),
        writeFile(join(dir, "variant.xml"), item.xml),
        writeFile(join(dir, "notes.json"), item.notesJson),
      ]);
    }
    if (inp.contentType === "upload") {
      await mkdir(uploadRoot, { recursive: true });
      await writeFile(stageUpload, inp.buf);
    }

    if (existsSync(finalRoot)) {
      await rename(finalRoot, backupRoot);
      movedArtifactBackup = true;
    }
    if (inp.contentType === "upload" && existsSync(finalUpload)) {
      await rename(finalUpload, backupUpload);
      movedUploadBackup = true;
    }
    await rename(stageRoot, finalRoot);
    movedStageArtifacts = true;
    if (inp.contentType === "upload") {
      await rename(stageUpload, finalUpload);
      movedStageUpload = true;
    }

    options.beforeReplace?.();
    replaceSongsByBase(baseId, prepared.map((item) => item.row));
    dbCommitted = true;
    // Cleanup is best-effort after the DB commit. A transient unlink failure
    // must never enter the rollback path and leave SQLite pointing at a
    // different artifact set than the filesystem.
    await rm(backupRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(backupUpload, { force: true }).catch(() => undefined);
    return { baseId, songIds: prepared.map((item) => item.row.id) };
  } catch (e) {
    if (dbCommitted) {
      console.warn(`publish cleanup warning for ${baseId}: ${(e as Error).message}`);
      return { baseId, songIds: prepared.map((item) => item.row.id) };
    }
    // Roll back both filesystem and DB-visible state. The DB transaction has
    // already rolled back if replaceSongsByBase threw.
    if (movedStageArtifacts) await rm(finalRoot, { recursive: true, force: true });
    if (movedArtifactBackup) await rename(backupRoot, finalRoot).catch(() => undefined);
    else await rm(backupRoot, { recursive: true, force: true });
    if (movedStageUpload) await rm(finalUpload, { force: true });
    if (movedUploadBackup) await rename(backupUpload, finalUpload).catch(() => undefined);
    else await rm(backupUpload, { force: true });
    await rm(stageRoot, { recursive: true, force: true });
    await rm(stageUpload, { force: true });
    return { baseId: "", songIds: [], error: `publish failed: ${(e as Error).message}` };
  }
}

export { LEVEL_ORDER, getSongsByBase };
