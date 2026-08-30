#!/usr/bin/env node
/**
 * Build a local, provenance-first score benchmark corpus from PDFs.
 *
 * This is intentionally an orchestration layer around benchmark-score.ts:
 * every input PDF is read only from the local filesystem, every derived file
 * is written below the caller's output directory, and no result is uploaded,
 * published, or copied into the repository.  The command continues after a
 * per-score failure so a batch report can show the complete corpus state.
 *
 * Example:
 *   npm run benchmark:scores -- -w @keyspilli/catalog -- \
 *     --out /private/tmp/keyspilli-score-corpus.run \
 *     --pdf "/Users/reidar/Downloads/The Pretty Reckless - Kill Me.pdf" \
 *     --pdf "/Users/reidar/Downloads/Sleep Token - Take Me Back To Eden.pdf"
 */
import { mkdir, readFile, realpath, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  alignSymbolicScores,
  parseSymbolicCandidate,
  type SymbolicAlignmentResult,
} from "../src/symbolic-alignment.js";
import { runResearch, type ResearchReport } from "../src/research-report.js";
import {
  SCORE_BENCHMARK_SCHEMA_VERSION,
  canonicalBenchmarkCorpusJson,
  createBenchmarkCorpusManifest,
  scoreCorpusManifestHash,
  type BenchmarkCorpusSong,
} from "../src/score-benchmark.js";
import {
  SCORE_LISTENING_PACK_SCHEMA_VERSION,
  selectRotatingScoreListeningPack,
  writeRotatingScoreListeningPackManifest,
  type ScoreCorpusSong,
  type ScoreListeningPack,
} from "../src/score-listening-pack.js";
import { sha256Hex } from "../src/fixture-evidence.js";
import {
  runBenchmarkScore,
  assertOutsideRepository,
  assertSafeOutputPath,
  safeError,
  type ScoreBenchmarkResult,
  type ScoreValidationReport,
} from "./benchmark-score.js";

const EPSILON = 1e-9;

interface ScoreDescriptor {
  pdf: string;
  id: string;
  title: string;
  artist: string;
}

interface ScoreCorpusBatchOptions {
  pdfs: string[];
  pdfDir?: string;
  out: string;
  audiveris?: string;
  musescore?: string;
  fluidsynth?: string;
  soundfont?: string;
  timeoutMs?: number;
  noAudio: boolean;
  noNotation: boolean;
  noResearch: boolean;
  includeReview: boolean;
  seed: string;
  targetSeconds: number;
  minSeconds: number;
  maxSeconds: number;
}

interface BatchScoreResult {
  descriptor: ScoreDescriptor;
  result: ScoreBenchmarkResult | null;
  error?: string;
  research?: ResearchReport;
  alignment?: SymbolicAlignmentResult;
  sourceMetadata?: Record<string, unknown>;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

async function writeScoreCorpusText(path: string, contents: string, root?: string): Promise<void> {
  if (root) {
    await assertSafeOutputPath(dirname(path), root, "output directory");
    await mkdir(dirname(path), { recursive: true });
    await assertSafeOutputPath(dirname(path), root, "output directory");
    await assertSafeOutputPath(path, root, "output artifact");
  } else {
    await mkdir(dirname(path), { recursive: true });
  }
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function writeScoreCorpusJson(path: string, value: unknown, root?: string): Promise<void> {
  await writeScoreCorpusText(path, `${JSON.stringify(stableValue(value), null, 2)}\n`, root);
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "score";
}

function optionValue(argv: readonly string[], index: number, flag: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function positiveNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive finite number`);
  return parsed;
}

function defaultMetadata(filePath: string): Omit<ScoreDescriptor, "pdf"> {
  const name = basename(filePath).replace(/\.pdf$/i, "");
  const lower = name.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  let artist = "Unknown";
  let title = name;
  if (lower.includes("pretty reckless") && lower.includes("kill me")) {
    artist = "The Pretty Reckless";
    title = "Kill Me";
  } else if (lower.includes("sleep token") && lower.includes("take me back to eden")) {
    artist = "Sleep Token";
    title = "Take Me Back To Eden";
  } else if (/free bird/.test(lower)) {
    title = "Free Bird";
  } else if (lower.includes("gott mit uns")) {
    artist = "Sabaton";
    title = "Gott Mit Uns";
  } else if (lower.includes("lifetime of war")) {
    artist = "Sabaton";
    title = "A Lifetime of War";
  } else if (lower.includes("the final solution")) {
    artist = "Sabaton";
    title = "The Final Solution";
  } else if (lower.includes("caroleans prayer")) {
    artist = "Sabaton";
    title = "The Caroleans Prayer";
  } else if (lower.includes("christmas truce")) {
    artist = "Sabaton";
    title = "Christmas Truce";
  } else if (/\b1916\b/.test(lower)) {
    artist = "Sabaton";
    title = "1916";
  }
  return { id: slugify(`${artist}-${title}`), title, artist };
}

function describePdf(pdf: string): ScoreDescriptor {
  const metadata = defaultMetadata(pdf);
  return { pdf, ...metadata };
}

async function expandPdfInputs(options: ScoreCorpusBatchOptions): Promise<string[]> {
  const values = [...options.pdfs];
  if (options.pdfDir) {
    const root = await realpath(resolve(options.pdfDir));
    await assertOutsideRepository(root, "PDF directory");
    const entries = await readdir(root, { withFileTypes: true });
    values.push(...entries.filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".pdf").map((entry) => join(root, entry.name)));
  }
  const unique = [...new Set(values.map((value) => resolve(value)))].sort(compareText);
  if (!unique.length) throw new Error("at least one --pdf or --pdf-dir input is required");
  const descriptors = unique.map(describePdf);
  const ids = new Map<string, string>();
  for (const descriptor of descriptors) {
    const previous = ids.get(descriptor.id);
    if (previous && previous !== descriptor.pdf) throw new Error(`PDF inputs produce duplicate logical id ${descriptor.id}`);
    ids.set(descriptor.id, descriptor.pdf);
  }
  return unique;
}

function usage(): string {
  return [
    "Usage: build-score-corpus.ts --out DIR --pdf FILE [--pdf FILE ...] [options]",
    "  --out DIR              local output root (must be outside the repository)",
    "  --pdf FILE             local PDF outside the repository (repeatable)",
    "  --pdf-dir DIR          local directory; direct .pdf files are included",
    "  --audiveris FILE       Audiveris executable (or KEYSPILLI_AUDIVERIS)",
    "  --musescore FILE       optional MuseScore executable",
    "  --fluidsynth FILE      optional FluidSynth executable",
    "  --soundfont FILE       optional SoundFont (or KEYSPILLI_SOUNDFONT)",
    "  --timeout-ms N         per-score backend timeout (default 600000)",
    "  --no-audio             skip FluidSynth renders",
    "  --no-notation          skip MuseScore renders",
    "  --no-research          skip local no-network song research metadata",
    "  --exclude-review       do not include REVIEW_REQUIRED scores in the listening pack",
    "  --seed TEXT            deterministic listening-pack seed",
    "  --target-seconds N     listening-pack target (default 120)",
    "  --min-seconds N        listening-pack minimum (default 90)",
    "  --max-seconds N        listening-pack maximum (default 180)",
  ].join("\n");
}

export function parseBatchArgs(argv: readonly string[]): ScoreCorpusBatchOptions {
  const result: ScoreCorpusBatchOptions = {
    pdfs: [],
    out: "",
    noAudio: false,
    noNotation: false,
    noResearch: false,
    includeReview: true,
    seed: "score-corpus",
    targetSeconds: 120,
    minSeconds: 90,
    maxSeconds: 180,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equal = arg.indexOf("=");
    const flag = equal >= 0 ? arg.slice(0, equal) : arg;
    const inline = equal >= 0 ? arg.slice(equal + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const pair = optionValue(argv, index, flag);
      index = pair[1];
      return pair[0];
    };
    switch (flag) {
      case "--pdf": result.pdfs.push(value()); break;
      case "--pdf-dir": result.pdfDir = value(); break;
      case "--out": result.out = value(); break;
      case "--audiveris": result.audiveris = value(); break;
      case "--musescore": result.musescore = value(); break;
      case "--fluidsynth": result.fluidsynth = value(); break;
      case "--soundfont": result.soundfont = value(); break;
      case "--timeout-ms": result.timeoutMs = positiveNumber(value(), flag); break;
      case "--no-audio": result.noAudio = true; break;
      case "--no-notation": result.noNotation = true; break;
      case "--no-research": result.noResearch = true; break;
      case "--exclude-review": result.includeReview = false; break;
      case "--seed": result.seed = value(); break;
      case "--target-seconds": result.targetSeconds = positiveNumber(value(), flag); break;
      case "--min-seconds": result.minSeconds = positiveNumber(value(), flag); break;
      case "--max-seconds": result.maxSeconds = positiveNumber(value(), flag); break;
      case "--help": case "-h": throw new Error(usage());
      default: throw new Error(`unknown option: ${arg}\n${usage()}`);
    }
  }
  if (!result.out) throw new Error(`--out is required\n${usage()}`);
  if (result.minSeconds > result.targetSeconds + EPSILON || result.targetSeconds > result.maxSeconds + EPSILON) {
    throw new Error("expected --min-seconds <= --target-seconds <= --max-seconds");
  }
  return result;
}

function logicalArtifactPath(id: string, value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return `scores/${id}/${value.replaceAll("\\", "/").replace(/^\.\//, "")}`;
}

function scoreDurationSeconds(report: ScoreValidationReport): number | null {
  const beats = report.metrics?.parsedDurationBeats;
  const tempo = report.structure?.tempoBpm;
  if (!finite(beats) || beats <= 0 || !finite(tempo) || tempo <= 0) return null;
  return round((beats * 60) / tempo, 3);
}

async function readHash(path: string | undefined): Promise<{ bytes: number; sha256: string } | null> {
  if (!path) return null;
  try {
    const bytes = new Uint8Array(await readFile(path));
    return { bytes: bytes.byteLength, sha256: sha256Hex(bytes) };
  } catch {
    return null;
  }
}

async function writeResearchArtifacts(
  songOut: string,
  descriptor: ScoreDescriptor,
  report: ScoreValidationReport,
): Promise<ResearchReport | undefined> {
  const midiPath = report.artifacts.midi ? join(songOut, report.artifacts.midi) : undefined;
  if (!midiPath) {
    await writeScoreCorpusJson(join(songOut, "recording", "candidates.json"), {
      schemaVersion: 1,
      status: "unavailable",
      mode: "metadata-only-no-network",
      recommendation: null,
      reason: "normalized MIDI is unavailable",
      originalRecordingCandidates: [],
    }, songOut);
    return undefined;
  }
  try {
    const midiBytes = new Uint8Array(await readFile(midiPath));
    const durationSeconds = scoreDurationSeconds(report);
    const research = await runResearch({
      song: {
        artist: descriptor.artist,
        title: descriptor.title,
        durationSeconds,
        sourceYoutubeUrl: null,
        version: null,
      },
      localCandidates: [{
        bytes: midiBytes,
        format: "midi",
        id: `${descriptor.id}-normalized-midi`,
        title: descriptor.title,
        sourceType: "midi",
        durationSeconds,
      }],
      noNetwork: true,
    });
    await writeScoreCorpusText(join(songOut, "recording", "research.json"), research.json, songOut);
    await writeScoreCorpusJson(join(songOut, "recording", "candidates.json"), {
      schemaVersion: 1,
      status: "metadata-only-no-network",
      mode: "metadata-only-no-network",
      recommendation: null,
      reason: "No online recording discovery was performed; local symbolic metadata is not an original-recording claim.",
      originalRecordingCandidates: [],
      localSymbolicCandidates: research.report.symbolicArtifacts.map((artifact) => ({
        id: artifact.id,
        format: artifact.format,
        sha256: artifact.sha256,
        bytes: artifact.bytes,
        parser: artifact.parser ?? null,
      })),
    }, songOut);
    return research.report;
  } catch (error) {
    await writeScoreCorpusJson(join(songOut, "recording", "candidates.json"), {
      schemaVersion: 1,
      status: "failed",
      mode: "metadata-only-no-network",
      recommendation: null,
      reason: safeError(error, "local research unavailable"),
      originalRecordingCandidates: [],
    }, songOut);
    return undefined;
  }
}

async function writeRoundtripAlignment(
  songOut: string,
  report: ScoreValidationReport,
): Promise<SymbolicAlignmentResult | undefined> {
  const xmlPath = report.artifacts.musicxml ? join(songOut, report.artifacts.musicxml) : undefined;
  const midiPath = report.artifacts.midi ? join(songOut, report.artifacts.midi) : undefined;
  if (!xmlPath || !midiPath) {
    await writeScoreCorpusJson(join(songOut, "alignment", "roundtrip.json"), {
      schemaVersion: 1,
      status: "unavailable",
      basis: "normalized MusicXML to generated MIDI roundtrip",
      reason: "normalized MusicXML or MIDI is unavailable",
    }, songOut);
    return undefined;
  }
  try {
    const [xml, midi] = await Promise.all([readFile(xmlPath, "utf8"), readFile(midiPath)]);
    const reference = parseSymbolicCandidate(xml, "musicxml");
    const candidate = parseSymbolicCandidate(new Uint8Array(midi), "midi");
    const alignment = alignSymbolicScores(reference, candidate, {
      offsetsBeats: [0],
      transpositions: [0],
      beatScales: [1],
      allowOffset: false,
      allowTranspose: false,
      allowTempoStretch: false,
      minMatchedOnsets: 1,
    });
    await writeScoreCorpusJson(join(songOut, "alignment", "roundtrip.json"), {
      schemaVersion: 1,
      status: "diagnostic-only",
      basis: "normalized MusicXML to generated MIDI roundtrip",
      alignment,
    }, songOut);
    return alignment;
  } catch (error) {
    await writeScoreCorpusJson(join(songOut, "alignment", "roundtrip.json"), {
      schemaVersion: 1,
      status: "unavailable",
      basis: "normalized MusicXML to generated MIDI roundtrip",
      reason: safeError(error, "roundtrip alignment unavailable"),
    }, songOut);
    return undefined;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

async function corpusEntry(
  descriptor: ScoreDescriptor,
  result: ScoreBenchmarkResult,
  sourceMetadata: Record<string, unknown> | undefined,
): Promise<BenchmarkCorpusSong | null> {
  const report = result.report;
  if (!report.source.sha256) return null;
  const references = {
    fullScore: logicalArtifactPath(descriptor.id, report.artifacts.musicxml),
    piano: logicalArtifactPath(descriptor.id, report.artifacts.midi),
    harmony: logicalArtifactPath(descriptor.id, report.artifacts.notes),
  };
  if (!Object.values(references).some((reference) => reference !== undefined)) return null;
  const roles = report.structure
    ? Object.fromEntries(
      report.structure.parts
        .map((part) => ({ name: part.name, role: part.role }))
        .sort((left, right) => compareText(left.name, right.name))
        .map((part) => [part.name, part.role] as const),
    )
    : undefined;
  const durationSeconds = scoreDurationSeconds(report);
  const sourcePdf = record(sourceMetadata?.sourcePdf);
  const provenance = record(sourceMetadata?.provenance) as BenchmarkCorpusSong["provenance"] | undefined;
  return {
    id: descriptor.id,
    artist: descriptor.artist,
    title: descriptor.title,
    score: {
      sha256: report.source.sha256,
      ...(finite(sourcePdf?.bytes) ? { bytes: sourcePdf.bytes } : {}),
      pages: report.source.pages ?? undefined,
      omrStatus: report.omr.status,
    },
    references,
    validation: {
      status: report.status,
      warnings: report.warnings.map((warning) => `${warning.code}: ${warning.message}`),
    },
    ...(roles && Object.keys(roles).length ? { roles } : {}),
    ...(provenance ? { provenance } : {}),
    recording: {
      title: descriptor.title,
      ...(durationSeconds === null ? {} : { durationSeconds }),
      versionAmbiguity: "metadata-only-no-network; no original recording candidate selected",
    },
  };
}

function listeningSong(descriptor: ScoreDescriptor, report: ScoreValidationReport): ScoreCorpusSong | null {
  const midi = logicalArtifactPath(descriptor.id, report.artifacts.midi);
  if (!midi) return null;
  const durationSeconds = scoreDurationSeconds(report);
  if (!durationSeconds || durationSeconds <= 0) return null;
  const wav = report.artifacts.audio.status === "PASS" ? logicalArtifactPath(descriptor.id, report.artifacts.audio.path) : undefined;
  return {
    id: descriptor.id,
    artist: descriptor.artist,
    title: descriptor.title,
    validation: { status: report.status },
    durationSeconds,
    references: {
      midi,
      ...(wav ? { wav } : {}),
    },
    sections: [{
      id: "full",
      label: "Full normalized score",
      role: "score-reference",
      startSeconds: 0,
      endSeconds: durationSeconds,
      references: {
        midi,
        ...(wav ? { wav } : {}),
      },
    }],
  };
}

async function runOne(
  root: string,
  descriptor: ScoreDescriptor,
  options: ScoreCorpusBatchOptions,
): Promise<BatchScoreResult> {
  const songOut = join(root, "scores", descriptor.id);
  try {
    await assertSafeOutputPath(songOut, root, "score output directory");
    const result = await runBenchmarkScore({
      pdf: descriptor.pdf,
      out: songOut,
      id: descriptor.id,
      title: descriptor.title,
      artist: descriptor.artist,
      ...(options.audiveris ? { audiveris: options.audiveris } : {}),
      ...(options.musescore ? { musescore: options.musescore } : {}),
      ...(options.fluidsynth ? { fluidsynth: options.fluidsynth } : {}),
      ...(options.soundfont ? { soundfont: options.soundfont } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      noAudio: options.noAudio,
      noNotation: options.noNotation,
      noCorpus: true,
    });
    const research = options.noResearch ? undefined : await writeResearchArtifacts(songOut, descriptor, result.report);
    const alignment = await writeRoundtripAlignment(songOut, result.report);
    let sourceMetadata: Record<string, unknown> | undefined;
    try {
      sourceMetadata = record(JSON.parse(await readFile(join(songOut, "source-metadata.json"), "utf8")));
    } catch {
      sourceMetadata = undefined;
    }
    return { descriptor, result, research, alignment, sourceMetadata };
  } catch (error) {
    await writeScoreCorpusJson(join(songOut, "batch-error.json"), {
      schemaVersion: 1,
      status: "FAILED",
      reason: safeError(error),
    }, songOut);
    return { descriptor, result: null, error: safeError(error) };
  }
}

function emptyListeningPack(
  seed: string,
  reason: string,
  options: Pick<ScoreCorpusBatchOptions, "targetSeconds" | "minSeconds" | "maxSeconds">,
): ScoreListeningPack {
  return {
    schemaVersion: SCORE_LISTENING_PACK_SCHEMA_VERSION,
    kind: "score-rotating-listening-pack",
    packId: `score-pack-${slugify(seed)}`,
    seed,
    targetSeconds: options.targetSeconds,
    minSeconds: options.minSeconds,
    maxSeconds: options.maxSeconds,
    totalSeconds: 0,
    status: "insufficient",
    songs: [],
    excerpts: [],
    warnings: [reason],
  };
}

async function buildBatch(options: ScoreCorpusBatchOptions): Promise<Record<string, unknown>> {
  const output = resolve(options.out);
  await assertSafeOutputPath(output, output, "output directory");
  await mkdir(output, { recursive: true });
  await assertSafeOutputPath(output, output, "output directory");
  const pdfPaths = await expandPdfInputs(options);
  const descriptors = pdfPaths.map(describePdf).sort((left, right) => compareText(left.id, right.id));
  const results: BatchScoreResult[] = [];
  for (const descriptor of descriptors) {
    // Deliberately sequential: Audiveris and FluidSynth are CPU/memory heavy,
    // and a batch should not change the machine's resource profile by default.
    results.push(await runOne(output, descriptor, options));
  }

  const corpusSongs = (await Promise.all(results
    .filter((entry): entry is BatchScoreResult & { result: ScoreBenchmarkResult } => entry.result !== null)
    .map((entry) => corpusEntry(entry.descriptor, entry.result, entry.sourceMetadata))))
    .filter((entry): entry is BenchmarkCorpusSong => entry !== null)
    .sort((left, right) => compareText(left.id, right.id));
  const corpus = createBenchmarkCorpusManifest({ songs: corpusSongs });
  await writeScoreCorpusJson(join(output, "benchmark-corpus.json"), JSON.parse(`${canonicalBenchmarkCorpusJson(corpus)}\n`), output);
  const summary = {
    schemaVersion: SCORE_BENCHMARK_SCHEMA_VERSION,
    status: results.every((entry) => entry.result?.status === "PASS" || entry.result?.status === "PASS_WITH_WARNINGS") ? "complete" : "review-required",
    corpusManifestSha256: scoreCorpusManifestHash(corpus),
    scores: results.map((entry) => ({
      id: entry.descriptor.id,
      artist: entry.descriptor.artist,
      title: entry.descriptor.title,
      status: entry.result?.status ?? "FAILED",
      sourceSha256: entry.result?.report.source.sha256 ?? null,
      report: `scores/${entry.descriptor.id}/validation/report.json`,
      alignment: entry.alignment ? { status: entry.alignment.status, confidence: entry.alignment.confidence } : { status: "unavailable" },
      error: entry.error ?? null,
      warnings: entry.result?.report.warnings.map((warning) => `${warning.code}: ${warning.message}`) ?? [],
    })).sort((left, right) => compareText(left.id, right.id)),
    nonClaims: [
      "OMR output is not ground truth; no score was manually corrected in this batch.",
      "Recording research was metadata-only and no-network; no original recording was selected or fetched.",
      "Roundtrip alignment is diagnostic-only and is not evidence of musical correctness.",
      "All paths in this manifest are logical local-corpus references; source PDFs remain outside the repository.",
    ],
  };
  await writeScoreCorpusJson(join(output, "corpus-summary.json"), summary, output);

  const listeningSongs = results
    .filter((entry): entry is BatchScoreResult & { result: ScoreBenchmarkResult } => entry.result !== null)
    .map((entry) => listeningSong(entry.descriptor, entry.result.report))
    .filter((entry): entry is ScoreCorpusSong => entry !== null)
    .sort((left, right) => compareText(left.id, right.id));
  await writeScoreCorpusJson(join(output, "listening-pack-input.json"), {
    schemaVersion: 1,
    selection: {
      seed: options.seed,
      targetSeconds: options.targetSeconds,
      minSeconds: options.minSeconds,
      maxSeconds: options.maxSeconds,
      includeReviewRequired: options.includeReview,
    },
    songs: listeningSongs,
  }, output);
  let pack: ScoreListeningPack;
  try {
    pack = selectRotatingScoreListeningPack(listeningSongs, {
      seed: options.seed,
      targetSeconds: options.targetSeconds,
      minSeconds: options.minSeconds,
      maxSeconds: options.maxSeconds,
      includeReviewRequired: options.includeReview,
    });
  } catch (error) {
    pack = emptyListeningPack(options.seed, safeError(error, "not enough usable score sections for a listening pack"), options);
  }
  await assertSafeOutputPath(join(output, "listening-pack"), output, "listening-pack output directory");
  await writeRotatingScoreListeningPackManifest(join(output, "listening-pack"), pack);
  await assertSafeOutputPath(join(output, "listening-pack"), output, "listening-pack output directory");

  const roundtrips = results.map((entry) => ({
    id: entry.descriptor.id,
    status: entry.alignment ? "diagnostic-only" : "unavailable",
    alignmentStatus: entry.alignment?.status ?? null,
    confidence: entry.alignment?.confidence ?? null,
  })).sort((left, right) => compareText(left.id, right.id));
  await writeScoreCorpusJson(join(output, "alignment", "coverage-summary.json"), {
    schemaVersion: 1,
    referenceStatus: "alignment-required",
    referenceReason: "No trusted external symbolic reference and no explicit beat/bar anchors were supplied to this batch.",
    roundtrips,
  }, output);
  return {
    status: summary.status,
    output,
    corpusManifest: "benchmark-corpus.json",
    listeningPack: "listening-pack/manifest.json",
    scoreCount: descriptors.length,
    reviewRequiredCount: results.filter((entry) => entry.result?.status === "REVIEW_REQUIRED").length,
    failedCount: results.filter((entry) => !entry.result || entry.result.status === "FAILED").length,
  };
}

export async function runScoreCorpusBatch(argv: readonly string[]): Promise<number> {
  let options: ScoreCorpusBatchOptions;
  try {
    options = parseBatchArgs(argv);
  } catch (error) {
    process.stderr.write(`${safeError(error, usage())}\n`);
    return 2;
  }
  try {
    const result = await buildBatch(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.failedCount === 0 ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${safeError(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && (process.argv[1].endsWith("build-score-corpus.ts") || process.argv[1].endsWith("build-score-corpus.js"))) {
  void runScoreCorpusBatch(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
