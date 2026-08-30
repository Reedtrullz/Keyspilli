/**
 * Deterministic, local-only listening-pack selection for the score corpus.
 *
 * This module deliberately does not know how a score was produced and does
 * not invoke an OMR, MIDI, or audio tool.  It only chooses already accepted
 * short sections and writes a small manifest pointing at caller-provided
 * artifacts.  In particular, the manifest never needs to contain an
 * absolute path to a private corpus checkout.
 */

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export const SCORE_LISTENING_PACK_SCHEMA_VERSION = 1 as const;

export type ScoreCorpusValidationStatus =
  | "PASS"
  | "PASS_WITH_WARNINGS"
  | "REVIEW_REQUIRED"
  | "FAILED";

export type AcceptedScoreCorpusValidationStatus = Extract<
  ScoreCorpusValidationStatus,
  "PASS" | "PASS_WITH_WARNINGS"
>;

export interface ScoreCorpusArtifactRef {
  ref?: string;
  path?: string;
  id?: string;
}

export type ScoreCorpusReferenceValue = string | ScoreCorpusArtifactRef | null | undefined;

export interface ScoreCorpusSection {
  id: string;
  startSeconds: number;
  endSeconds: number;
  label?: string;
  role?: string;
  /** Section-local artifacts, for example `{ midi, wav }`. */
  references?: Readonly<Record<string, ScoreCorpusReferenceValue>>;
  /** Alias accepted for manifests that call these artifacts. */
  artifacts?: Readonly<Record<string, ScoreCorpusReferenceValue>>;
  midiRef?: string;
  wavRef?: string;
  sourceRef?: string;
}

export interface ScoreCorpusValidation {
  status?: string;
}

export interface ScoreCorpusScoreMetadata {
  status?: string;
  validationStatus?: string;
  durationSeconds?: number;
}

/**
 * Minimal corpus shape consumed by the pack builder.  Extra corpus-manifest
 * fields are intentionally allowed by callers; this utility only reads the
 * fields below.
 */
export interface ScoreCorpusSong {
  id: string;
  artist?: string;
  title?: string;
  status?: string;
  validation?: ScoreCorpusValidation;
  score?: ScoreCorpusScoreMetadata;
  durationSeconds?: number;
  sections?: readonly ScoreCorpusSection[];
  references?: Readonly<Record<string, ScoreCorpusReferenceValue>>;
}

export interface ScoreListeningPackSelectionOptions {
  /** Stable seed. Equal inputs and seed produce equal output byte-for-byte. */
  seed?: string | number;
  targetSeconds?: number;
  minSeconds?: number;
  maxSeconds?: number;
  /** A listening pack must contain at least this many distinct songs. */
  minSongs?: number;
  /** Sections shorter than this are ignored. */
  minSectionSeconds?: number;
  /** Long sections are clipped to this short listening excerpt length. */
  maxSectionSeconds?: number;
  /** Optional stable id; otherwise one is derived from the seed and selection. */
  packId?: string;
  /**
   * Include REVIEW_REQUIRED scores as explicitly provisional listening material.
   * The default remains trusted-only (PASS/PASS_WITH_WARNINGS).
   */
  includeReviewRequired?: boolean;
}

export type ScoreListeningPackStatus = "ready" | "insufficient";

export interface ScoreListeningPackSong {
  id: string;
  artist: string | null;
  title: string | null;
  validationStatus: ScoreCorpusValidationStatus;
}

export interface ScoreListeningPackExcerpt {
  id: string;
  songId: string;
  sectionId: string;
  artist: string | null;
  title: string | null;
  label: string | null;
  role: string | null;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  /** Logical or path-safe artifact references; never required to be local paths. */
  references: Record<string, string>;
}

export interface ScoreListeningPack {
  schemaVersion: typeof SCORE_LISTENING_PACK_SCHEMA_VERSION;
  kind: "score-rotating-listening-pack";
  packId: string;
  seed: string;
  targetSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  totalSeconds: number;
  status: ScoreListeningPackStatus;
  songs: ScoreListeningPackSong[];
  excerpts: ScoreListeningPackExcerpt[];
  warnings: string[];
}

export interface ScoreListeningPackManifest extends ScoreListeningPack {
  /** Absolute output paths are intentionally not part of this record. */
  pathSafe: true;
}

export interface WriteScoreListeningPackOptions {
  fileName?: string;
}

export interface WrittenScoreListeningPackManifest {
  path: string;
  manifest: ScoreListeningPackManifest;
  json: string;
}

export interface WrittenScoreListeningPackBundle extends WrittenScoreListeningPackManifest {
  /** Human worksheet path written alongside the path-safe manifest. */
  worksheetPath: string;
  worksheet: string;
}

const EPSILON = 1e-9;
const DEFAULT_TARGET_SECONDS = 120;
const DEFAULT_MIN_SECONDS = 90;
const DEFAULT_MAX_SECONDS = 180;
const DEFAULT_MIN_SONGS = 2;
const DEFAULT_MIN_SECTION_SECONDS = 8;
const DEFAULT_MAX_SECTION_SECONDS = 30;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveFinite(value: unknown): value is number {
  return finite(value) && value > 0;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function normalizedStatus(song: ScoreCorpusSong): ScoreCorpusValidationStatus | null {
  if (!song || typeof song !== "object") return null;
  const value = song.validation?.status ?? song.status ?? song.score?.validationStatus ?? song.score?.status;
  if (typeof value !== "string") return null;
  const status = value.trim().toUpperCase();
  return status === "PASS" || status === "PASS_WITH_WARNINGS" || status === "REVIEW_REQUIRED" || status === "FAILED"
    ? status
    : null;
}

export function isAcceptedScoreCorpusSong(song: ScoreCorpusSong): song is ScoreCorpusSong & {
  validation: ScoreCorpusValidation;
} {
  const status = normalizedStatus(song);
  return status === "PASS" || status === "PASS_WITH_WARNINGS";
}

/** Return accepted songs in code-point order, independent of input order. */
export function acceptedScoreCorpusSongs(songs: readonly ScoreCorpusSong[]): ScoreCorpusSong[] {
  return songs
    .filter(isAcceptedScoreCorpusSong)
    .map((song) => ({ ...song, id: requireText(song.id, "song.id") }))
    .sort((left, right) => compareText(left.id, right.id));
}

/**
 * Turn a local-looking reference into a portable manifest reference.  A
 * relative corpus reference is preserved; absolute paths and traversal are
 * represented by an `external/` basename.  This intentionally does not copy
 * or inspect the referenced artifact.
 */
export function pathSafeScoreReference(value: string | undefined): string | null {
  if (value === undefined || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^(?:https?|s3):\/\//i.test(trimmed)) {
    // Do not allow URL user-info to become a credential leak in a manifest.
    try {
      const url = new URL(trimmed);
      url.username = "";
      url.password = "";
      // Signed query strings and fragments are not logical artifact identity
      // and may contain credentials or other private tokens.
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return "external/url-reference";
    }
  }

  const withoutFileScheme = trimmed.replace(/^file:\/\//i, "");
  const slashNormalized = withoutFileScheme.replaceAll("\\", "/");
  const isAbsolute = slashNormalized.startsWith("/") || /^[A-Za-z]:\//.test(slashNormalized);
  const parts = slashNormalized.split("/").filter((part) => part && part !== ".");
  const hasTraversal = parts.some((part) => part === "..");
  const safeBase = sanitizePathSegment(parts.at(-1) ?? "artifact");
  if (isAbsolute || hasTraversal) return `external/${safeBase || "artifact"}`;

  const safeParts = parts.map(sanitizePathSegment).filter(Boolean);
  return safeParts.length ? safeParts.join("/") : null;
}

function sanitizePathSegment(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
}

function hash32(value: string): number {
  // FNV-1a is small, deterministic, and does not depend on runtime locale.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function rank(seed: string, ...parts: string[]): number {
  return hash32([seed, ...parts].join("\u0000"));
}

interface NormalizedSection {
  song: ScoreCorpusSong;
  id: string;
  label: string | null;
  role: string | null;
  startSeconds: number;
  endSeconds: number;
  references: Record<string, string>;
}

function referenceValue(value: ScoreCorpusReferenceValue): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.ref ?? value.path ?? value.id;
  return undefined;
}

function collectReferences(
  song: ScoreCorpusSong,
  section: ScoreCorpusSection | undefined,
): Record<string, string> {
  const references: Record<string, string> = {};
  const add = (key: string, value: string | undefined) => {
    const safe = pathSafeScoreReference(value);
    if (safe) references[key] = safe;
  };
  for (const [key, value] of Object.entries(song.references ?? {}).sort(([a], [b]) => compareText(a, b))) {
    add(key, referenceValue(value));
  }
  if (section) {
    const sectionRefs = section.references ?? section.artifacts ?? {};
    for (const [key, value] of Object.entries(sectionRefs).sort(([a], [b]) => compareText(a, b))) {
      add(key, referenceValue(value));
    }
    add("midi", section.midiRef);
    add("wav", section.wavRef);
    add("source", section.sourceRef);
  }
  return Object.fromEntries(Object.entries(references).sort(([a], [b]) => compareText(a, b)));
}

function sourceSections(song: ScoreCorpusSong): readonly ScoreCorpusSection[] {
  if (!song || typeof song !== "object") return [];
  if (Array.isArray(song.sections)) return song.sections;
  const duration = song.durationSeconds ?? song.score?.durationSeconds;
  if (positiveFinite(duration)) {
    return [{ id: "full", startSeconds: 0, endSeconds: duration }];
  }
  return [];
}

function normalizeSections(
  song: ScoreCorpusSong,
  minSectionSeconds: number,
  maxSectionSeconds: number,
): NormalizedSection[] {
  const sections = sourceSections(song);
  const seen = new Set<string>();
  const output: NormalizedSection[] = [];
  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const id = typeof section?.id === "string" ? section.id.trim() : "";
    if (!id) continue;
    if (seen.has(id)) throw new Error(`duplicate section id ${id} in song ${song.id}`);
    seen.add(id);
    if (!finite(section.startSeconds) || !finite(section.endSeconds)) continue;
    if (section.startSeconds < 0 || section.endSeconds <= section.startSeconds + EPSILON) continue;
    const endSeconds = Math.min(section.endSeconds, section.startSeconds + maxSectionSeconds);
    if (endSeconds - section.startSeconds + EPSILON < minSectionSeconds) continue;
    output.push({
      song,
      id,
      label: typeof section.label === "string" && section.label.trim() ? section.label.trim() : null,
      role: typeof section.role === "string" && section.role.trim() ? section.role.trim() : null,
      startSeconds: round(section.startSeconds),
      endSeconds: round(endSeconds),
      references: collectReferences(song, section),
    });
  }
  return output.sort((left, right) => compareText(left.id, right.id));
}

interface NormalizedSelectionOptions {
  seed: string;
  targetSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  minSongs: number;
  minSectionSeconds: number;
  maxSectionSeconds: number;
  includeReviewRequired: boolean;
}

function normalizeOptions(options: ScoreListeningPackSelectionOptions): NormalizedSelectionOptions {
  const seed = String(options.seed ?? "default").trim();
  if (!seed) throw new Error("seed must be non-empty");
  const targetSeconds = options.targetSeconds ?? DEFAULT_TARGET_SECONDS;
  const minSeconds = options.minSeconds ?? DEFAULT_MIN_SECONDS;
  const maxSeconds = options.maxSeconds ?? DEFAULT_MAX_SECONDS;
  const minSongs = options.minSongs ?? DEFAULT_MIN_SONGS;
  const minSectionSeconds = options.minSectionSeconds ?? DEFAULT_MIN_SECTION_SECONDS;
  const maxSectionSeconds = options.maxSectionSeconds ?? DEFAULT_MAX_SECTION_SECONDS;
  if (!positiveFinite(targetSeconds) || !positiveFinite(minSeconds) || !positiveFinite(maxSeconds)) {
    throw new Error("targetSeconds, minSeconds, and maxSeconds must be positive and finite");
  }
  if (minSeconds > targetSeconds + EPSILON || targetSeconds > maxSeconds + EPSILON) {
    throw new Error("expected minSeconds <= targetSeconds <= maxSeconds");
  }
  if (!Number.isInteger(minSongs) || minSongs < 2) throw new Error("minSongs must be an integer >= 2");
  if (!positiveFinite(minSectionSeconds) || !positiveFinite(maxSectionSeconds) || minSectionSeconds > maxSectionSeconds) {
    throw new Error("expected 0 < minSectionSeconds <= maxSectionSeconds");
  }
  return {
    seed,
    targetSeconds: round(targetSeconds),
    minSeconds: round(minSeconds),
    maxSeconds: round(maxSeconds),
    minSongs,
    minSectionSeconds: round(minSectionSeconds),
    maxSectionSeconds: round(maxSectionSeconds),
    includeReviewRequired: options.includeReviewRequired === true,
  };
}

function isPackEligibleScoreCorpusSong(
  song: ScoreCorpusSong,
  includeReviewRequired: boolean,
): boolean {
  const status = normalizedStatus(song);
  return status === "PASS" || status === "PASS_WITH_WARNINGS" ||
    (includeReviewRequired && status === "REVIEW_REQUIRED");
}

function excerptFromSection(section: NormalizedSection, durationSeconds: number): ScoreListeningPackExcerpt {
  const endSeconds = round(section.startSeconds + durationSeconds);
  const songId = requireText(section.song.id, "song.id");
  return {
    id: `${songId}:${section.id}`,
    songId,
    sectionId: section.id,
    artist: typeof section.song.artist === "string" && section.song.artist.trim() ? section.song.artist.trim() : null,
    title: typeof section.song.title === "string" && section.song.title.trim() ? section.song.title.trim() : null,
    label: section.label,
    role: section.role,
    startSeconds: section.startSeconds,
    endSeconds,
    durationSeconds: round(durationSeconds),
    references: { ...section.references },
  };
}

function stablePackId(seed: string, excerpts: readonly ScoreListeningPackExcerpt[]): string {
  const suffix = hash32(`${seed}\u0000${excerpts.map((excerpt) => excerpt.id).join("\u0000")}`).toString(16).padStart(8, "0");
  return `score-pack-${suffix}`;
}

/**
 * Select a short, multi-song listening pack.  The selector is pure and makes
 * no assumptions about available renderers or binaries.  If accepted corpus
 * material cannot reach the requested minimum, the result is explicitly
 * `insufficient` rather than silently claiming a complete listening pack.
 */
export function selectRotatingScoreListeningPack(
  songs: readonly ScoreCorpusSong[],
  options: ScoreListeningPackSelectionOptions = {},
): ScoreListeningPack {
  const normalized = normalizeOptions(options);
  const accepted = songs
    .filter((song) => isPackEligibleScoreCorpusSong(song, normalized.includeReviewRequired))
    .map((song) => ({ ...song, id: requireText(song.id, "song.id") }))
    .sort((left, right) => compareText(left.id, right.id));
  const candidates = accepted.map((song) => ({
    song,
    sections: normalizeSections(song, normalized.minSectionSeconds, normalized.maxSectionSeconds)
      .sort((left, right) => rank(normalized.seed, song.id, left.id) - rank(normalized.seed, song.id, right.id) || compareText(left.id, right.id)),
  })).filter((entry) => entry.sections.length > 0)
    .sort((left, right) => rank(normalized.seed, left.song.id) - rank(normalized.seed, right.song.id) || compareText(left.song.id, right.song.id));

  if (candidates.length < normalized.minSongs) {
    const eligibility = normalized.includeReviewRequired ? "eligible" : "accepted";
    throw new Error(`at least ${normalized.minSongs} ${eligibility} songs with usable sections are required; found ${candidates.length}`);
  }

  const selected: ScoreListeningPackExcerpt[] = [];
  const selectedSectionIds = new Set<string>();
  const sectionCursor = new Map<string, number>();
  let totalSeconds = 0;

  const tryAdd = (entry: (typeof candidates)[number]): boolean => {
    const cursor = sectionCursor.get(entry.song.id) ?? 0;
    const section = entry.sections[cursor];
    if (!section) return false;
    const remaining = normalized.maxSeconds - totalSeconds;
    if (remaining + EPSILON < normalized.minSectionSeconds) return false;
    const sectionKey = `${entry.song.id}\u0000${section.id}`;
    if (selectedSectionIds.has(sectionKey)) {
      sectionCursor.set(entry.song.id, cursor + 1);
      return false;
    }
    const duration = Math.min(section.endSeconds - section.startSeconds, remaining);
    if (duration + EPSILON < normalized.minSectionSeconds) {
      sectionCursor.set(entry.song.id, cursor + 1);
      return false;
    }
    selected.push(excerptFromSection(section, duration));
    selectedSectionIds.add(sectionKey);
    sectionCursor.set(entry.song.id, cursor + 1);
    totalSeconds += duration;
    return true;
  };

  // First pass guarantees representation from several distinct songs.
  for (const entry of candidates) {
    if (selected.length >= normalized.minSongs) break;
    tryAdd(entry);
  }

  // Round-robin passes keep a pack varied while the target is not reached.
  let madeProgress = true;
  while (totalSeconds + EPSILON < normalized.targetSeconds && totalSeconds + EPSILON < normalized.maxSeconds && madeProgress) {
    madeProgress = false;
    for (const entry of candidates) {
      if (totalSeconds + EPSILON >= normalized.targetSeconds || totalSeconds + EPSILON >= normalized.maxSeconds) break;
      if (tryAdd(entry)) madeProgress = true;
    }
  }

  const selectedSongIds = [...new Set(selected.map((excerpt) => excerpt.songId))];
  const acceptedById = new Map(accepted.map((song) => [song.id, song]));
  const packSongs = selectedSongIds.map((id) => {
    const song = acceptedById.get(id)!;
    const status = normalizedStatus(song);
    return {
      id,
      artist: typeof song.artist === "string" && song.artist.trim() ? song.artist.trim() : null,
      title: typeof song.title === "string" && song.title.trim() ? song.title.trim() : null,
      validationStatus: status!,
    };
  });
  const warnings: string[] = [];
  if (accepted.length > candidates.length) warnings.push("some accepted corpus songs had no usable short sections");
  if (normalized.includeReviewRequired && packSongs.some((song) => song.validationStatus === "REVIEW_REQUIRED")) {
    warnings.push("pack includes REVIEW_REQUIRED scores for listening only; manual notation review is pending");
  }
  if (totalSeconds + EPSILON < normalized.minSeconds) {
    warnings.push(`selected duration ${round(totalSeconds)}s is below requested minimum ${normalized.minSeconds}s`);
  }
  if (totalSeconds + EPSILON < normalized.targetSeconds) {
    warnings.push(`available usable material stopped at ${round(totalSeconds)}s before target ${normalized.targetSeconds}s`);
  }

  const packId = options.packId === undefined ? stablePackId(normalized.seed, selected) : requireText(options.packId, "packId");
  return {
    schemaVersion: SCORE_LISTENING_PACK_SCHEMA_VERSION,
    kind: "score-rotating-listening-pack",
    packId,
    seed: normalized.seed,
    targetSeconds: normalized.targetSeconds,
    minSeconds: normalized.minSeconds,
    maxSeconds: normalized.maxSeconds,
    totalSeconds: round(totalSeconds),
    status: totalSeconds + EPSILON >= normalized.minSeconds && selectedSongIds.length >= normalized.minSongs ? "ready" : "insufficient",
    songs: packSongs,
    excerpts: selected,
    warnings,
  };
}

/** Short alias for callers that do not need the corpus-specific name. */
export const selectRotatingListeningPack = selectRotatingScoreListeningPack;
export const createRotatingScoreListeningPack = selectRotatingScoreListeningPack;

function canonicalManifest(pack: ScoreListeningPack): ScoreListeningPackManifest {
  const songs = [...pack.songs]
    .sort((left, right) => compareText(left.id, right.id))
    .map((song) => ({ ...song }));
  const excerpts = pack.excerpts.map((excerpt) => ({
    ...excerpt,
    references: Object.fromEntries(
      Object.entries(excerpt.references ?? {})
        .map(([key, value]) => [key, pathSafeScoreReference(value) ?? "external/artifact"] as const)
        .sort(([left], [right]) => compareText(left, right)),
    ),
  }));
  return {
    schemaVersion: SCORE_LISTENING_PACK_SCHEMA_VERSION,
    kind: "score-rotating-listening-pack",
    packId: requireText(pack.packId, "pack.packId"),
    seed: requireText(pack.seed, "pack.seed"),
    targetSeconds: round(pack.targetSeconds),
    minSeconds: round(pack.minSeconds),
    maxSeconds: round(pack.maxSeconds),
    totalSeconds: round(pack.totalSeconds),
    status: pack.status,
    songs,
    excerpts,
    warnings: [...new Set(pack.warnings.map((warning) => String(warning).trim()).filter(Boolean))].sort(compareText),
    pathSafe: true,
  };
}

function validateManifestFileName(fileName: string): string {
  const trimmed = requireText(fileName, "fileName");
  if (trimmed !== basename(trimmed) || !/^[A-Za-z0-9._-]+\.json$/i.test(trimmed)) {
    throw new Error("fileName must be a path-safe JSON file name");
  }
  return trimmed;
}

/**
 * Write only the manifest.  No referenced MIDI/WAV/PDF is opened, copied, or
 * rendered, so this function is safe to use in a repository test suite.
 */
export async function writeRotatingScoreListeningPackManifest(
  outputDirectory: string,
  pack: ScoreListeningPack,
  options: WriteScoreListeningPackOptions = {},
): Promise<WrittenScoreListeningPackManifest> {
  const directory = requireText(outputDirectory, "outputDirectory");
  const fileName = validateManifestFileName(options.fileName ?? "manifest.json");
  const manifest = canonicalManifest(pack);
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  await mkdir(directory, { recursive: true });
  const path = join(directory, fileName);
  const temporary = join(directory, `.${fileName}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await writeFile(temporary, json, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return { path, manifest, json };
}

export const writeScoreListeningPackManifest = writeRotatingScoreListeningPackManifest;
export const writeRotatingListeningPackManifest = writeRotatingScoreListeningPackManifest;

function worksheetReference(value: string): string | null {
  const safe = pathSafeScoreReference(value);
  if (!safe) return null;
  return /^(?:https?|s3):\/\//i.test(safe) ? safe : `../${safe}`;
}

/**
 * Render the deliberately small human worksheet for a rotating score pack.
 * The score pack is a collection of reference excerpts rather than an A/B
 * candidate comparison, so the A/B prompt is explicitly marked optional.
 * All artifact links are converted to logical, path-safe references before
 * they are placed in the worksheet.
 */
export function renderScoreListeningPackWorksheet(pack: ScoreListeningPack): string {
  const manifest = canonicalManifest(pack);
  const songs = new Map(manifest.songs.map((song) => [song.id, song]));
  const lines = [
    "# Rotating score listening pack",
    "",
    `Pack: ${manifest.packId}`,
    `Seed: ${manifest.seed}`,
    `Total listening time: ${manifest.totalSeconds}s (target ${manifest.targetSeconds}s)`,
    "",
    "Listen to each short excerpt without treating OMR output as ground truth.",
    "Answer only the three questions below; add an optional one-line note if useful.",
    "",
    "## Excerpts",
    "",
  ];
  manifest.excerpts.forEach((excerpt, index) => {
    const song = songs.get(excerpt.songId);
    const title = [song?.artist, song?.title].filter(Boolean).join(" — ") || excerpt.songId;
    lines.push(`### ${index + 1}. ${title}`, `- Section: ${excerpt.label ?? excerpt.sectionId}`, `- Duration: ${excerpt.durationSeconds}s`);
    for (const [key, value] of Object.entries(excerpt.references).sort(([left], [right]) => compareText(left, right))) {
      const link = worksheetReference(value);
      if (link) lines.push(`- ${key}: [artifact](${link})`);
    }
    lines.push(
      "",
      "Recognizable? YES / NO:",
      "Anything obviously wrong? YES / NO:",
      "A or B better? A / B / SAME / N/A:",
      "Optional note:",
      "",
    );
  });
  if (!manifest.excerpts.length) lines.push("No usable excerpts were selected.", "");
  lines.push("Human listening status: pending.", "");
  return lines.join("\n");
}

/**
 * Write a complete local score listening bundle: the stable manifest plus a
 * minimal worksheet.  It intentionally does not open, copy, or render any
 * referenced artifacts; callers may use the logical links from the manifest
 * against their private corpus root.
 */
export async function writeRotatingScoreListeningPackBundle(
  outputDirectory: string,
  pack: ScoreListeningPack,
  options: WriteScoreListeningPackOptions = {},
): Promise<WrittenScoreListeningPackBundle> {
  const written = await writeRotatingScoreListeningPackManifest(outputDirectory, pack, options);
  const worksheet = renderScoreListeningPackWorksheet(pack);
  const worksheetPath = join(outputDirectory, "LISTENING.md");
  const temporary = join(outputDirectory, `.LISTENING.md.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await writeFile(temporary, worksheet, { encoding: "utf8", flag: "wx" });
    await rename(temporary, worksheetPath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return { ...written, worksheetPath, worksheet };
}

export const writeScoreListeningPackBundle = writeRotatingScoreListeningPackBundle;
