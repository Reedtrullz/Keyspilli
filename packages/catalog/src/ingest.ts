import { commitCatalogPublication, type CatalogPublication } from "./reconcile.js";
import { validateSourceArrangement, type SourceArrangement } from "./source-arrangement.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  parseMidi,
  parseMusicXmlNotes,
  cleanTranscription,
  buildVariants,
  assertSourceWorkload,
  normalizeTempoBpm,
  writeVariantArtifacts,
  validateArtifactFiles,
  LEVEL_ORDER,
  validateVariants,
  BEGINNER_OFFGRID_CANDIDATE,
  TRANSCRIPTION_CLEANUP_CONFIG as MIDI_TRANSCRIPTION_CLEANUP_CONFIG,
  DEFAULT_IMPORTED_MAX_SOUNDING,
  type ChordLabel,
  validateChordLabels,
} from "@keyspilli/midi";
import { getSongsByBase, SongRow } from "./db.js";
import { dataDir, uploadsDir } from "./paths.js";
import {
  parseTranscriptionProvenance,
  readArrangementManifest,
  transcriptionConfigForFingerprint,
  writeArrangementManifestFile,
  parseArrangementManifest,
  type ArrangementManifest,
  type TempoSource,
  type TranscriptionProvenance,
} from "./artifact-manifest.js";
import { canonicalizeSourceProvenance } from "./provenance.js";
import { AUDIO_ONSET_DETECTOR_CONFIG, ONSET_MATCH_SEC, TRANSCRIPTION_FILTER_VERSION, TRANSCRIPTION_MAX_RECONSTRUCTED_DUR_BEATS } from "./transcribe.js";
import { ArtifactReconciliationError, assertCompleteArtifactTree, REQUIRED_ARTIFACT_FILES, inspectBaseArtifact, publishBaseArtifact } from "./publish.js";
import { validateSourceCandidateHandoffLink, type SourceCandidateHandoffLink } from "./source-candidate-handoff.js";
import { stagePreparedBacking } from "./chord-timeline.js";

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
export const MAX_YOUTUBE_IMPORT_DUR_BEATS = TRANSCRIPTION_MAX_RECONSTRUCTED_DUR_BEATS;

// These identifiers are part of the rebuild identity. Bumping one when its
// corresponding transformation changes makes an old fingerprint stale even
// when the input bytes and user-facing ingest options are unchanged.
export const INGEST_NORMALIZER_ID = "midi-normalizer-v2";
export const INGEST_GRID_POLICY_ID = "beat-grid-v2";
export const INGEST_VARIANT_POLICY_ID = "learner-variant-ladder-v10-source-easy-spacing";

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
  /** Optional hash of the logical source bytes. Audio workers use the source
   * audio hash here; ordinary imports default to hashing the supplied MIDI or
   * MusicXML bytes. */
  sourceArtifactHash?: string;
  title: string;
  artist: string;
  category?: string;
  style?: string;
  mood?: string;
  key?: string;
  tempo?: number;
  /** Keep curated MIDI note beats when a playback tempo override replaces its tempo map. */
  preserveSourceBeats?: boolean;
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
  arrangementProfile?: "source" | "learner" | "metal";
  /** Optional role-aware harmony evidence; preserved as authored variant chords. */
  chords?: ChordLabel[];
  /**
   * Effective audio-transcription settings. Standard MIDI/MusicXML uploads
   * omit this block; Basic Pitch workers persist it on the base manifest and
   * in every level's notes.json provenance.
  */
  transcription?: TranscriptionProvenance;
  /** Server-created lineage for an explicitly selected discovery lead. */
  sourceCandidateHandoff?: SourceCandidateHandoffLink;
  sourceArrangement?: SourceArrangement;
}

/** Optional deterministic hook used by integration tests to exercise rollback. */
export interface IngestOptions {
  beforeReplace?: () => void;
  job?: { id: string; owner: string };
  uploadReplay?: { mode: "reuse" } | { mode: "replace"; expectedRevision: string };
}

export interface UploadPublicationReceipt {
  baseId: string;
  sourceHash: string;
  publicationRevision: string;
  songIds: string[];
  easySongId: string;
  title: string;
  artist: string;
}

export interface IngestResult {
  baseId: string;
  songIds: string[];
  error?: string;
  code?: "ARTIFACT_RECONCILIATION_REQUIRED" | "ARTIFACT_BUSY" | "UPLOAD_REVISION_STALE";
  uploadReceipt?: UploadPublicationReceipt;
  reused?: boolean;
}

class UploadRevisionConflictError extends Error {}

async function uploadPublicationReceiptAtRoot(baseId: string, sourceHash: string, root: string): Promise<UploadPublicationReceipt | null> {
  if (!existsSync(root)) {
    if (getSongsByBase(baseId).length) throw new ArtifactReconciliationError(baseId, new Error("catalog rows exist without published artifacts"));
    return null;
  }
  try {
    const manifest = parseArrangementManifest(JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")));
    if (manifest.baseId !== baseId || manifest.sourceArtifactHash !== sourceHash || manifest.source?.kind !== "upload") {
      throw new Error("published upload source does not match its content-addressed id");
    }
    const rows = getSongsByBase(baseId);
    const levels = ["vb", "b", "ve", "e", "m", "a"];
    if (rows.length !== levels.length || rows.some((row) => row.contentType !== "upload") || levels.some((level) => !rows.some((row) => row.id === `${baseId}-${level}`))) {
      throw new Error("published upload does not have its complete catalog rows");
    }
    await assertCompleteArtifactTree(root, levels, REQUIRED_ARTIFACT_FILES);
    let publicationRevision: string;
    try {
      publicationRevision = readFileSync(join(root, ".publication-id"), "utf8").trim();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(publicationRevision)) throw new Error("invalid publication id");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      publicationRevision = `legacy-${createHash("sha256").update(JSON.stringify({
        manifest,
        rows: rows.slice().sort((a, b) => a.id.localeCompare(b.id)).map(({ id, title, artist, category, difficulty, key, tempo, style, mood, contentType, acquiredVia, sourceYoutubeUrl }) =>
          ({ id, title, artist, category, difficulty, key, tempo, style, mood, contentType, acquiredVia, sourceYoutubeUrl })),
      })).digest("hex")}`;
    }
    const songIds = levels.map((level) => `${baseId}-${level}`);
    const easy = rows.find((row) => row.id === `${baseId}-e`)!;
    return { baseId, sourceHash, publicationRevision, songIds, easySongId: easy.id, title: easy.title, artist: easy.artist };
  } catch (error) {
    if (error instanceof ArtifactReconciliationError) throw error;
    throw new ArtifactReconciliationError(baseId, error);
  }
}

export async function getUploadPublicationReceipt(baseId: string, sourceHash: string): Promise<UploadPublicationReceipt | null> {
  if (!/^[a-f0-9]{64}$/.test(sourceHash) || baseId !== `upload-${sourceHash}`) throw new Error("invalid content-addressed upload identity");
  const artifactsRoot = join(dataDir(), "artifacts");
  return inspectBaseArtifact(baseId, { artifactsRoot }, (root) => uploadPublicationReceiptAtRoot(baseId, sourceHash, root));
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

function generatedBaseId(artist: string, title: string): string {
  const suffix = Date.now().toString(36);
  const artistSlug = slugify(artist) || "artist";
  const titleSlug = slugify(title) || "song";
  const stem = `${artistSlug}-${titleSlug}`;
  // Keep the uniqueness suffix even when both display fields are very long;
  // directory names and the manifest validator share a 120-character limit.
  const maxStemLength = Math.max(1, 120 - suffix.length - 1);
  const boundedStem = stem.slice(0, maxStemLength).replace(/-+$/g, "") || "song";
  return `${boundedStem}-${suffix}`;
}

function looksLikeXml(buf: Uint8Array): boolean {
  const head = new TextDecoder().decode(buf.slice(0, 64)).trimStart();
  return head.startsWith("<?xml") || head.startsWith("<score-partwise");
}

function isZip(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

/** The same bounded format dispatch used by ingestSource, exposed to routes
 * that need to bind provenance before the atomic ingest completes. */
export function inferIngestFormat(buf: Uint8Array): "midi" | "musicxml" | "mxl" {
  return isZip(buf) ? "mxl" : looksLikeXml(buf) ? "musicxml" : "midi";
}

const MAX_MXL_ENTRIES = 200;
const MAX_MXL_UNCOMPRESSED = 64 * 1024 * 1024;

/** Read the same validated central-directory entries that extraction uses. */
function mxlEntries(buf: Uint8Array): { entries: Array<{ name: string; offset: number; compressed: number; size: number; method: number; flags: number }>; cdOffset: number } {
  if (buf.length < 22) throw new Error("invalid .mxl zip (truncated)");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  const scanStart = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= scanStart; i--) {
    if (dv.getUint32(i, true) === 0x06054b50 && i + 22 + dv.getUint16(i + 20, true) === buf.length) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("invalid .mxl zip (no end-of-central-directory)");
  if (eocd >= 20 && dv.getUint32(eocd - 20, true) === 0x07064b50) throw new Error(".mxl zip64 not supported");
  const entriesOnDisk = dv.getUint16(eocd + 8, true);
  const totalEntries = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (totalEntries === 0xffff || entriesOnDisk === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error(".mxl zip64 not supported");
  }
  if (dv.getUint16(eocd + 4, true) !== 0 || dv.getUint16(eocd + 6, true) !== 0 || entriesOnDisk !== totalEntries) {
    throw new Error("invalid .mxl zip spanning or entry count");
  }
  if (totalEntries > MAX_MXL_ENTRIES) {
    throw new Error(`.mxl zip has too many entries (${totalEntries} > ${MAX_MXL_ENTRIES})`);
  }
  if (cdOffset + cdSize !== eocd) throw new Error("invalid .mxl zip central directory");
  const cdEnd = cdOffset + cdSize;
  let offset = cdOffset;
  let totalUncompressed = 0;
  const entries: Array<{ name: string; offset: number; compressed: number; size: number; method: number; flags: number }> = [];
  const names = new Set<string>();
  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > cdEnd || dv.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("invalid .mxl zip central directory");
    }
    const flags = dv.getUint16(offset + 8, true);
    const method = dv.getUint16(offset + 10, true);
    const compressed = dv.getUint32(offset + 20, true);
    const size = dv.getUint32(offset + 24, true);
    const nameLength = dv.getUint16(offset + 28, true);
    const extraLength = dv.getUint16(offset + 30, true);
    const commentLength = dv.getUint16(offset + 32, true);
    const disk = dv.getUint16(offset + 34, true);
    const localOffset = dv.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > cdEnd || disk !== 0 || localOffset === 0xffffffff || (flags & 1) || ![0, 8].includes(method)) {
      throw new Error("invalid or unsupported .mxl zip central directory");
    }
    for (let extra = offset + 46 + nameLength; extra < offset + 46 + nameLength + extraLength;) {
      if (extra + 4 > next) throw new Error("invalid .mxl zip central directory");
      const length = dv.getUint16(extra + 2, true);
      if (dv.getUint16(extra, true) === 1) throw new Error(".mxl zip64 not supported");
      extra += 4 + length;
      if (extra > offset + 46 + nameLength + extraLength) throw new Error("invalid .mxl zip central directory");
    }
    const name = new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(offset + 46, offset + 46 + nameLength));
    if (names.has(name)) throw new Error("invalid .mxl zip duplicate entry");
    names.add(name);
    totalUncompressed += size;
    if (totalUncompressed > MAX_MXL_UNCOMPRESSED) {
      throw new Error(`.mxl zip expands beyond ${MAX_MXL_UNCOMPRESSED / (1024 * 1024)}MB`);
    }
    entries.push({ name, offset: localOffset, compressed, size, method, flags });
    offset = next;
  }
  if (offset !== cdEnd) throw new Error("invalid .mxl zip central directory");
  return { entries, cdOffset };
}

/**
 * Extract the score .xml from a compressed .mxl. Container.xml is the
 * canonical pointer; some exports omit it, so fall back to a .musicxml
 * entry, then any .xml outside META-INF/ (signatures/container live there
 * and are not scores).
 */
function mxlScoreXml(buf: Uint8Array): string {
  const { entries, cdOffset } = mxlEntries(buf);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const files: Record<string, Uint8Array> = Object.create(null);
  let extracted = 0;
  for (const entry of entries) {
    const at = entry.offset;
    if (at + 30 > cdOffset || dv.getUint32(at, true) !== 0x04034b50 || dv.getUint16(at + 6, true) !== entry.flags || dv.getUint16(at + 8, true) !== entry.method ||
      (!(entry.flags & 8) && (dv.getUint32(at + 18, true) !== entry.compressed || dv.getUint32(at + 22, true) !== entry.size))) {
      throw new Error("invalid .mxl zip local header");
    }
    const localNameLength = dv.getUint16(at + 26, true);
    const localExtraLength = dv.getUint16(at + 28, true);
    const start = at + 30 + localNameLength + localExtraLength;
    if (start > cdOffset) throw new Error("invalid .mxl zip local header");
    for (let extra = at + 30 + localNameLength; extra < start;) {
      if (extra + 4 > start) throw new Error("invalid .mxl zip local header");
      const length = dv.getUint16(extra + 2, true);
      if (dv.getUint16(extra, true) === 1) throw new Error(".mxl zip64 not supported");
      extra += 4 + length;
      if (extra > start) throw new Error("invalid .mxl zip local header");
    }
    const localName = new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(at + 30, at + 30 + localNameLength));
    if (localName !== entry.name || start + entry.compressed > cdOffset) throw new Error("invalid .mxl zip local header");
    const compressed = buf.subarray(start, start + entry.compressed);
    let output: Uint8Array;
    try {
      output = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: MAX_MXL_UNCOMPRESSED - extracted + 1 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") throw new Error(".mxl zip expands beyond 64MB");
      throw new Error("invalid .mxl zip compressed entry");
    }
    extracted += output.length;
    if (extracted > MAX_MXL_UNCOMPRESSED) throw new Error(".mxl zip expands beyond 64MB");
    if (output.length !== entry.size || (entry.method === 0 && entry.compressed !== entry.size)) throw new Error("invalid .mxl zip entry size");
    files[entry.name] = output;
  }
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
export async function ingestSource(inp: IngestInput, options: IngestOptions = {}): Promise<IngestResult> {
  if (inp.baseId && !validBaseId(inp.baseId)) {
    return { baseId: "", songIds: [], error: "invalid base id" };
  }
  if (inp.buf.byteLength > 16 * 1024 * 1024) return { baseId: "", songIds: [], error: "source exceeds 16 MiB limit" };
  const baseId = inp.baseId ?? generatedBaseId(inp.artist, inp.title);
  const sourceArtifactHash = inp.sourceArtifactHash ?? createHash("sha256").update(inp.buf).digest("hex");
  if (inp.sourceArtifactHash !== undefined && !/^[0-9a-f]{64}$/.test(inp.sourceArtifactHash)) {
    return { baseId: "", songIds: [], error: "invalid sourceArtifactHash: expected 64 lowercase hexadecimal characters" };
  }
  if (options.uploadReplay) {
    if (inp.contentType !== "upload" || baseId !== `upload-${sourceArtifactHash}` || sourceArtifactHash !== createHash("sha256").update(inp.buf).digest("hex")) {
      return { baseId: "", songIds: [], error: "upload replay requires the source-byte content address" };
    }
    if (options.uploadReplay.mode === "replace" && !options.uploadReplay.expectedRevision) {
      return { baseId: "", songIds: [], error: "expected publication revision is required" };
    }
    let receipt: UploadPublicationReceipt | null;
    try {
      receipt = await getUploadPublicationReceipt(baseId, sourceArtifactHash);
    } catch (error) {
      if (error instanceof ArtifactReconciliationError) return { baseId, songIds: [], error: error.message, code: error.code };
      if (error instanceof Error && error.message === "artifact publish already locked") return { baseId, songIds: [], error: error.message, code: "ARTIFACT_BUSY" };
      return { baseId, songIds: [], error: error instanceof Error ? error.message : "unable to inspect upload publication" };
    }
    if (options.uploadReplay.mode === "reuse" && receipt) {
      return { baseId, songIds: receipt.songIds, uploadReceipt: receipt, reused: true };
    }
    if (options.uploadReplay.mode === "replace" && receipt?.publicationRevision !== options.uploadReplay.expectedRevision) {
      return { baseId, songIds: [], error: "the accepted upload publication changed; review it before replacing", code: "UPLOAD_REVISION_STALE" };
    }
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
  if (inp.chords !== undefined) {
    const chordErrors = validateChordLabels(inp.chords);
    if (chordErrors.length) return { baseId: "", songIds: [], error: `invalid chords: ${chordErrors.join("; ")}` };
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
    assertSourceWorkload(parsed);
  } catch (e) {
    return { baseId: "", songIds: [], error: `parse failed: ${(e as Error).message}` };
  }
  // AI transcriptions carry ghost notes; human MIDI files do not.
  parsed.tempoBpm = normalizeTempoBpm(inp.tempo ?? parsed.tempoBpm);
  if (inp.preserveSourceBeats) parsed.tempoEvents = undefined;
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

  if (inp.sourceArrangement) {
    const errors = validateSourceArrangement(inp.sourceArrangement);
    if (inp.sourceArrangement.sourceSha256 !== sourceArtifactHash) errors.push("source arrangement hash mismatch");
    if (errors.length) return { baseId: "", songIds: [], error: errors.join("; ") };
  }
  if (inp.sourceCandidateHandoff) {
    const handoffErrors = validateSourceCandidateHandoffLink(inp.sourceCandidateHandoff);
    if (handoffErrors.length) return { baseId: "", songIds: [], error: `invalid source candidate handoff: ${handoffErrors.join("; ")}` };
    if (inp.sourceCandidateHandoff.uploadedSourceSha256 !== sourceArtifactHash) {
      return { baseId: "", songIds: [], error: "source candidate handoff hash does not match uploaded bytes" };
    }
    if (inp.sourceCandidateHandoff.intakeCandidateId !== baseId) {
      return { baseId: "", songIds: [], error: "source candidate handoff intake id does not match upload" };
    }
  }
  const candidate = inp.contentType === "upload"
    ? {
      candidateId: baseId,
      candidateClass: "GENERATION_CANDIDATE" as const,
      provenanceClass: "USER_SUPPLIED_PRIVATE" as const,
      timingAuthority: "NATIVE_AUTHORITATIVE" as const,
      alignmentState: "NATIVE_AUTHORITATIVE" as const,
      generationEligibility: { eligible: true, code: "READY_FOR_GENERATION" as const },
    }
    : undefined;
  // Rebuild/restore callers often know only the stable base id. Preserve a
  // current semantic profile when they omit an explicit override so a
  // canonical metal artifact cannot silently fall back to the learner
  // profile (and its short YouTube sustain cap) on the next catalog pass.
  const persistedProfile = inp.baseId
    ? await readArrangementManifest(baseId)
    : undefined;
  const arrangementProfile = inp.arrangementProfile
    ?? (persistedProfile?.status === "valid" && ["source", "learner", "metal"].includes(persistedProfile.manifest.arrangementProfile ?? "")
      ? persistedProfile.manifest.arrangementProfile as "source" | "learner" | "metal"
      : undefined)
    ?? "learner";
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
    : inp.contentType === "youtube" && arrangementProfile !== "metal"
      ? MAX_YOUTUBE_IMPORT_DUR_BEATS
      : null;
  let variants;
  try {
    variants = buildVariants(
    parsed,
    {
      title: inp.title,
      artist: inp.artist,
      key: inp.key,
      tempo: inp.tempo,
    },
    {
      ...(maxDurBeats === undefined ? {} : { maxDurBeats }),
      arrangementProfile,
      audioDerived: inp.contentType === "youtube",
      ...(inp.chords ? { chords: inp.chords } : {}),
    },
  );
  } catch (e) {
    return { baseId: "", songIds: [], error: `arrangement failed: ${(e as Error).message}` };
  }
  const validationErrors = validateVariants(variants, { maxDurBeats });
  if (validationErrors.length) {
    return { baseId: "", songIds: [], error: `validation failed: ${validationErrors.join("; ")}` };
  }

  // Keep the public/logical source identity separate from a physical seed or
  // upload path. For YouTube inputs the URL's video id wins over a legacy
  // `seed:<file>`/`youtube:<baseId>` label, so all six levels and the base
  // manifest carry one stable identity without losing the physical locator.
  const sourceProvenance = canonicalizeSourceProvenance({
    kind: inp.contentType,
    acquiredVia: inp.acquiredVia ?? null,
    sourceRef: inp.sourceRef ?? inp.sourceYoutubeUrl ?? null,
    sourceYoutubeUrl: inp.sourceYoutubeUrl ?? null,
  });

  // Resolve both tempo roles once at ingestion. The manifest is the runtime
  // authority; every generated notes.json receives the same role-tagged copy
  // as diagnostic provenance, so a variant remains self-describing without
  // creating a second source of truth.
  const resolvedAt = new Date().toISOString();
  const calibrationSource: TempoSource = inp.tempo !== undefined
    ? "override"
    : transcription?.tempoSource
      ?? (inp.sourceArrangement?.sourceKind === "tutorial-preview" ? "default" : inp.contentType === "youtube" ? "detected" : "midi-meta");
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
      const durationSec = Math.round(Math.max(...v.notes.map((note) => note.start + note.dur)) * 60 / v.tempoBpm);
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
        style: inp.style ?? (arrangementProfile === "metal" ? "metal" : "classical"),
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
        ...sourceProvenance,
        ...(candidate ? { candidate } : {}),
        ...(inp.sourceCandidateHandoff ? { sourceCandidateHandoff: inp.sourceCandidateHandoff } : {}),
    ...(inp.sourceArrangement ? { sourceArrangement: inp.sourceArrangement } : {}),
        tempo: tempoProvenance,
        ...(transcription ? { transcription } : {}),
      };
      const beginnerOffGridRh = v.level === "beginner"
        ? v.notes.flatMap((note) => (
          (note as typeof note & { [BEGINNER_OFFGRID_CANDIDATE]?: boolean })[BEGINNER_OFFGRID_CANDIDATE] === true
            ? [[note.midi, note.start] as [number, number]]
            : []
        ))
        : [];
      prepared.push({ code, row, midi: artifacts.midi, xml: artifacts.xml, notesJson: JSON.stringify({
        notes: v.notes,
        ...(beginnerOffGridRh.length ? { beginnerOffGridRh } : {}),
        warnings: v.warnings,
        chords: v.chords,
        measures: v.measures,
        key: v.key,
        tempoBpm: v.tempoBpm,
        timeSig: v.timeSig,
        ...(v.timeSigEvents?.length ? {
          timeSigEvents: v.timeSigEvents.map((event) => ({
            tick: event.tick,
            beat: event.beat,
            timeSig: [...event.timeSig] as [number, number],
          })),
        } : {}),
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
  const recoveryData: CatalogPublication = {
    baseId, rows: prepared.map(item => item.row),
    ...(options.job ? { job: options.job } : {}),
    ...(inp.contentType === "upload" ? { upload: {
      staged: basename(stageUpload), final: basename(finalUpload), backup: basename(backupUpload),
      sha256: createHash("sha256").update(inp.buf).digest("hex"),
    } } : {}),
  };
  const configFingerprint = createHash("sha256")
    .update(JSON.stringify({
      pipeline: "ingest-v2",
      normalizerId: INGEST_NORMALIZER_ID,
      gridPolicyId: INGEST_GRID_POLICY_ID,
      variantPolicyId: INGEST_VARIANT_POLICY_ID,
      contentType: inp.contentType,
      cleanTranscription: inp.contentType === "youtube" && inp.cleanTranscription !== false,
      maxDurBeats,
      arrangementProfile,
      chords: inp.chords ?? null,
      key: inp.key ?? null,
      tempoOverride: inp.tempo ?? null,
      ...(inp.preserveSourceBeats ? { preserveSourceBeats: true } : {}),
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
    arrangementProfile,
    source: sourceProvenance,
    ...(candidate ? { candidate } : {}),
    ...(inp.sourceCandidateHandoff ? { sourceCandidateHandoff: inp.sourceCandidateHandoff } : {}),
    ...(inp.sourceArrangement ? { sourceArrangement: inp.sourceArrangement } : {}),
    tempo: {
      calibration: { bpm: parsed.tempoBpm, source: calibrationSource, resolvedAt, role: "source-calibration" },
      playback: { bpm: parsed.tempoBpm, source: calibrationSource, resolvedAt, role: "playback" },
    },
    ...(transcription ? { transcription } : {}),
    artifactWrittenAt: resolvedAt,
  };
  let publicationRevision: string | undefined;
  try {
    const result = await publishBaseArtifact<IngestResult>(baseId, async (stageRoot) => {
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
      // The manifest is deliberately written last inside the stage. The
      // shared publisher validates it again immediately before swapping.
      await writeArrangementManifestFile(join(stageRoot, "manifest.json"), manifest);
      await stagePreparedBacking(baseId, stageRoot, artifactsRoot);
      return { baseId, songIds: prepared.map((item) => item.row.id) };
    }, {
      artifactsRoot,
      semanticValidation: "strict",
      reuseExisting: options.uploadReplay?.mode === "reuse" ? async (root) => {
        const receipt = await uploadPublicationReceiptAtRoot(baseId, sourceArtifactHash, root);
        return receipt ? { baseId, songIds: receipt.songIds, uploadReceipt: receipt, reused: true } : undefined;
      } : undefined,
      beforeSwap: async () => {
        options.beforeReplace?.();
        if (options.uploadReplay?.mode === "replace") {
          const current = await uploadPublicationReceiptAtRoot(baseId, sourceArtifactHash, join(artifactsRoot, baseId));
          if (current?.publicationRevision !== options.uploadReplay.expectedRevision) throw new UploadRevisionConflictError("the accepted upload publication changed; review it before replacing");
        }
      },
      recoveryData,
      afterSwap: (publicationId) => {
        publicationRevision = publicationId;
        return commitCatalogPublication(recoveryData);
      },
    });
    if (!options.uploadReplay || result.reused) return result;
    if (!publicationRevision) return { baseId, songIds: [], error: "published upload revision is unavailable", code: "ARTIFACT_RECONCILIATION_REQUIRED" };
    const receipt: UploadPublicationReceipt = {
      baseId,
      sourceHash: sourceArtifactHash,
      publicationRevision,
      songIds: result.songIds,
      easySongId: result.songIds.find((id) => id.endsWith("-e")) ?? result.songIds[0]!,
      title: inp.title,
      artist: inp.artist,
    };
    return { ...result, uploadReceipt: receipt };
  } catch (e) {
    if (e instanceof ArtifactReconciliationError) {
      return { baseId, songIds: [], error: e.message, code: e.code };
    }
    if (e instanceof UploadRevisionConflictError) {
      await rm(stageUpload, { force: true });
      return { baseId, songIds: [], error: e.message, code: "UPLOAD_REVISION_STALE" };
    }
    if (e instanceof Error && e.message === "artifact publish already locked") {
      return { baseId, songIds: [], error: e.message, code: "ARTIFACT_BUSY" };
    }
    await rm(stageUpload, { force: true });
    return { baseId, songIds: [], error: `publish failed: ${(e as Error).message}` };
  }
}

export { LEVEL_ORDER, getSongsByBase };
