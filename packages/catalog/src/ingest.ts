import { createHash } from "node:crypto";
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
  TRANSCRIPTION_CLEANUP_CONFIG as MIDI_TRANSCRIPTION_CLEANUP_CONFIG,
  DEFAULT_IMPORTED_MAX_SOUNDING,
} from "@keyspilli/midi";
import { replaceSongsByBase, getSongsByBase, SongRow } from "./db.js";
import { dataDir, uploadsDir } from "./paths.js";
import {
  parseTranscriptionProvenance,
  transcriptionConfigForFingerprint,
  writeArrangementManifestFile,
  type ArrangementManifest,
  type TempoSource,
  type TranscriptionProvenance,
} from "./artifact-manifest.js";
import { AUDIO_ONSET_DETECTOR_CONFIG, ONSET_MATCH_SEC, TRANSCRIPTION_FILTER_VERSION } from "./transcribe.js";
import { publishBaseArtifact } from "./publish.js";

const LEVEL_CODE: Record<string, string> = {
  "very-beginner": "vb",
  beginner: "b",
  "very-easy": "ve",
  easy: "e",
  medium: "m",
  advanced: "a",
};

// Basic Pitch/other audio transcriptions routinely report the release tail
// (or pedal resonance) as a multi-beat note.  At a slow tempo that turns into
// a 2–4 second falling bar and masks the next melody attack.  Keep the
// transcription path conservative while leaving human-authored MIDI uploads
// free to contain legitimate longer holds.
export const MAX_YOUTUBE_IMPORT_DUR_BEATS = 1.5;

// These identifiers are part of the rebuild identity. Bumping one when its
// corresponding transformation changes makes an old fingerprint stale even
// when the input bytes and user-facing ingest options are unchanged.
export const INGEST_NORMALIZER_ID = "midi-normalizer-v2";
export const INGEST_GRID_POLICY_ID = "beat-grid-v2";
export const INGEST_VARIANT_POLICY_ID = "learner-variant-ladder-v3";

/**
 * Versioned processing identities used by audio transcription provenance and
 * the artifact config fingerprint. Keep this next to the actual ingest
 * policies so changing a transformation forces an explicit rebuild decision.
 */
export const TRANSCRIPTION_PIPELINE_CONFIG = {
  filterVersion: TRANSCRIPTION_FILTER_VERSION,
  normalizerId: INGEST_NORMALIZER_ID,
  gridPolicyId: INGEST_GRID_POLICY_ID,
  variantPolicyId: INGEST_VARIANT_POLICY_ID,
} as const;

/** Effective defaults for the two cleanup stages used by YouTube ingestion. */
export const TRANSCRIPTION_POST_PROCESSING_DEFAULTS = {
  ...MIDI_TRANSCRIPTION_CLEANUP_CONFIG,
  importedMaxSounding: DEFAULT_IMPORTED_MAX_SOUNDING,
} as const;

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
  /** Stable, non-secret source label persisted in each variant notes.json. */
  sourceRef?: string | null;
  baseId?: string;
  /** Override the default YouTube cleanup for curated human-authored MIDI. */
  cleanTranscription?: boolean;
  /**
   * Optional sustain ceiling for a transcription source. `null` explicitly
   * preserves long human-authored MIDI/MusicXML sustains.
   */
  maxDurBeats?: number | null;
  /** Arrangement intent; catalogue imports default to the learner profile. */
  arrangementProfile?: "source" | "learner";
  /**
   * Effective audio-transcription settings. Standard MIDI/MusicXML uploads
   * omit this block; Basic Pitch workers persist it on the base manifest and
   * in every level's notes.json provenance.
   */
  transcription?: TranscriptionProvenance;
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
  let transcription: TranscriptionProvenance | undefined;
  if (inp.transcription !== undefined) {
    try {
      // Validate once at the ingest boundary, then use the same normalized
      // value for the manifest, notes sidecars, and config fingerprint.
      transcription = parseTranscriptionProvenance(inp.transcription);
    } catch (e) {
      return { baseId: "", songIds: [], error: (e as Error).message };
    }
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
    // cleanTranscription uses a temporary pitch split while capping sustained
    // overlaps. Those labels are inferred implementation details, not source
    // staff assignments; remove them before the learner arranger decides
    // whether a dense one-staff texture needs inner-voice redistribution.
    const hadExplicitHands = parsed.notes.some((note) => note.hand !== undefined);
    parsed.notes = cleanTranscription(parsed.notes, { tempoBpm: parsed.tempoBpm });
    if (!hadExplicitHands) {
      parsed.notes = parsed.notes.map(({ hand: _hand, ...note }) => note);
    }
  }
  if (parsed.notes.length < 8) return { baseId: "", songIds: [], error: "too few notes" };

  const baseId = inp.baseId ?? `${slugify(inp.artist)}-${slugify(inp.title)}-${Date.now().toString(36)}`;
  // Re-ingests replace the six-row set atomically, but engagement history is
  // not part of the source arrangement. Preserve per-level plays and creation
  // timestamps so repairing an arrangement does not reset the live catalog.
  const existingRows = inp.baseId ? getSongsByBase(baseId) : [];
  // Audio/YouTube transcriptions need a conservative tail ceiling. Standard
  // MIDI and MusicXML are commonly human-authored and may contain legitimate
  // multi-measure pedal tones, so they opt out unless a caller explicitly
  // supplies a transcription ceiling (e.g. a curated audio-derived seed).
  const maxDurBeats = inp.maxDurBeats !== undefined
    ? inp.maxDurBeats
    : inp.contentType === "youtube"
      ? MAX_YOUTUBE_IMPORT_DUR_BEATS
      : null;
  const variants = buildVariants(
    parsed,
    {
      title: inp.title,
      artist: inp.artist,
      key: inp.key,
      tempo: inp.tempo,
    },
    {
      ...(maxDurBeats === undefined ? {} : { maxDurBeats }),
      arrangementProfile: inp.arrangementProfile ?? "learner",
      audioDerived: inp.contentType === "youtube",
    },
  );
  const validationErrors = validateVariants(variants, { maxDurBeats });
  if (validationErrors.length) {
    return { baseId: "", songIds: [], error: `validation failed: ${validationErrors.join("; ")}` };
  }

  // Resolve both tempo roles once at ingestion. The manifest is the runtime
  // authority; every generated notes.json receives the same role-tagged copy
  // as diagnostic provenance, so a variant remains self-describing without
  // creating a second source of truth.
  const resolvedAt = new Date().toISOString();
  const calibrationSource: TempoSource = inp.tempo !== undefined
    ? "override"
    : transcription?.tempoSource
      ?? (inp.contentType === "youtube" ? "detected" : "midi-meta");
  const tempoProvenance = {
    calibration: { bpm: parsed.tempoBpm, source: calibrationSource, resolvedAt, role: "source-calibration" as const },
    playback: { bpm: parsed.tempoBpm, source: calibrationSource, resolvedAt, role: "playback" as const },
  };
  const prepared: Array<{ code: string; row: SongRow; midi: Uint8Array; xml: string; notesJson: string }> = [];
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
      const provenance = {
        kind: inp.contentType,
        acquiredVia: inp.acquiredVia ?? null,
        sourceRef: inp.sourceRef ?? inp.sourceYoutubeUrl ?? null,
        sourceYoutubeUrl: inp.sourceYoutubeUrl ?? null,
        tempo: tempoProvenance,
        ...(transcription ? { transcription } : {}),
      };
      prepared.push({ code, row, midi: artifacts.midi, xml: artifacts.xml, notesJson: JSON.stringify({
        notes: v.notes,
        warnings: v.warnings,
        chords: v.chords,
        measures: v.measures,
        key: v.key,
        tempoBpm: v.tempoBpm,
        timeSig: v.timeSig,
        provenance,
      }) });
    } catch (e) {
      artifactErrors.push(`${v.level}: artifact render failed: ${(e as Error).message}`);
    }
  }
  if (artifactErrors.length) {
    return { baseId: "", songIds: [], error: `artifact validation failed: ${artifactErrors.join("; ")}` };
  }

  const artifactsRoot = join(dataDir(), "artifacts");
  const uploadExt = isMxl ? "mxl" : sourceIsXml ? "xml" : "mid";
  const uploadRoot = uploadsDir();
  const finalUpload = join(uploadRoot, `${baseId}.${uploadExt}`);
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const stageUpload = join(uploadRoot, `.${baseId}.staging-${token}.${uploadExt}`);
  const backupUpload = join(uploadRoot, `.${baseId}.backup-${token}.${uploadExt}`);
  let movedUploadBackup = false;
  let movedStageUpload = false;
  const sourceArtifactHash = createHash("sha256").update(inp.buf).digest("hex");
  const configFingerprint = createHash("sha256")
    .update(JSON.stringify({
      pipeline: "ingest-v2",
      normalizerId: INGEST_NORMALIZER_ID,
      gridPolicyId: INGEST_GRID_POLICY_ID,
      variantPolicyId: INGEST_VARIANT_POLICY_ID,
      contentType: inp.contentType,
      cleanTranscription: inp.contentType === "youtube" && inp.cleanTranscription !== false,
      maxDurBeats,
      arrangementProfile: inp.arrangementProfile ?? "learner",
      key: inp.key ?? null,
      tempoOverride: inp.tempo ?? null,
      transcription: transcription ? transcriptionConfigForFingerprint(transcription) : null,
      // Keep the effective downstream processing identity in the fingerprint
      // even when an older caller supplies provenance without the newer
      // pipeline/postProcessing fields. This makes a policy change visible
      // without rewriting legacy provenance in place.
      transcriptionPipeline: transcription ? TRANSCRIPTION_PIPELINE_CONFIG : null,
      transcriptionPostProcessing: transcription ? {
        filterApplied: transcription.postProcessing?.filterApplied ?? null,
        cleanupApplied: inp.contentType === "youtube" && inp.cleanTranscription !== false,
        onsetMatchSec: ONSET_MATCH_SEC,
        onsetDetector: AUDIO_ONSET_DETECTOR_CONFIG,
        minVelocity: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.minVelocity,
        minDurationBeats: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.minDurationBeats,
        mergeWindowBeats: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.mergeWindowBeats,
        maxPolyphony: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.maxPolyphony,
        maxSounding: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.maxSounding,
        maxDurationSec: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.maxDurationSec,
        maxDurationBeats: transcription.postProcessing?.maxDurationBeats ?? null,
        importedMaxDurationBeats: maxDurBeats,
        importedMaxSounding: TRANSCRIPTION_POST_PROCESSING_DEFAULTS.importedMaxSounding,
      } : null,
    }))
    .digest("hex");
  const manifest: ArrangementManifest = {
    schemaVersion: 1,
    baseId,
    identityStatus: "current",
    sourceArtifactHash,
    configFingerprint,
    arrangementProfile: inp.arrangementProfile ?? "learner",
    tempo: {
      calibration: { bpm: parsed.tempoBpm, source: calibrationSource, resolvedAt, role: "source-calibration" },
      playback: { bpm: parsed.tempoBpm, source: calibrationSource, resolvedAt, role: "playback" },
    },
    ...(transcription ? { transcription } : {}),
    artifactWrittenAt: resolvedAt,
  };
  try {
    const result = await publishBaseArtifact(baseId, async (stageRoot) => {
      for (const item of prepared) {
        const dir = join(stageRoot, item.code);
        await mkdir(dir, { recursive: true });
        await Promise.all([
          writeFile(join(dir, "variant.mid"), item.midi),
          writeFile(join(dir, "variant.xml"), item.xml),
          writeFile(join(dir, "notes.json"), item.notesJson),
        ]);
      }
      // Keep the existing failure-injection hook before the commit marker is
      // written. A failed preparation therefore cannot swap a partial tree.
      options.beforeReplace?.();
      if (inp.contentType === "upload") {
        await mkdir(uploadRoot, { recursive: true });
        await writeFile(stageUpload, inp.buf);
      }
      // The manifest is deliberately written last inside the stage. The
      // shared publisher validates it again immediately before swapping.
      await writeArrangementManifestFile(join(stageRoot, "manifest.json"), manifest);
      return { baseId, songIds: prepared.map((item) => item.row.id) };
    }, {
      artifactsRoot,
      semanticValidation: "strict",
      afterSwap: async () => {
        if (inp.contentType === "upload") {
          if (existsSync(finalUpload)) {
            await rename(finalUpload, backupUpload);
            movedUploadBackup = true;
          }
          await rename(stageUpload, finalUpload);
          movedStageUpload = true;
        }
        replaceSongsByBase(baseId, prepared.map((item) => item.row));
        // Cleanup is best-effort after the DB commit. A transient unlink
        // failure must not make a successfully published artifact look like
        // a failed ingest.
        await rm(backupUpload, { force: true }).catch(() => undefined);
      },
    });
    return result;
  } catch (e) {
    // A writer/preparation failure leaves the old artifact root untouched.
    // If an auxiliary upload move failed before completion, restore its old
    // sidecar; a post-swap DB failure intentionally leaves the new artifact
    // tree in place for reconciliation by the catalog verifier.
    if (!movedStageUpload && movedUploadBackup) {
      await rename(backupUpload, finalUpload).catch(() => undefined);
    }
    await rm(stageUpload, { force: true });
    await rm(backupUpload, { force: true });
    return { baseId: "", songIds: [], error: `publish failed: ${(e as Error).message}` };
  }
}

export { LEVEL_ORDER, getSongsByBase };
