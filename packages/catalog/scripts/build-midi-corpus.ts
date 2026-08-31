#!/usr/bin/env node
/**
 * Build a local-only, path-redacted MIDI reference corpus.
 *
 * The input MIDI files are never copied into the repository or sent to a
 * service.  Only normalized copies (when needed), canonical JSON, reports,
 * and optional FluidSynth renders are written beneath the caller's external
 * output directory.
 */
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  auditMidiBytes,
  normalizeMidiBytes,
  MIDI_CORPUS_NORMALIZER_VERSION,
  type MidiCorpusResult,
} from "../src/midi-corpus.js";
import {
  buildMidiCorpusReport,
  buildMidiCorpusSongReport,
  computeMidiCorpusDefectClusters,
  canonicalMidiCorpusReportJson,
  type MidiCorpusReport,
  type MidiCorpusComparisonInput,
  type MidiCorpusReferenceKind,
  type MidiCorpusSongReport,
} from "../src/midi-corpus-report.js";
import { renderMidiToWav, slicePcm16WavFile, type MidiRenderResult } from "../src/midi-renderer.js";

export interface MidiCorpusInputSource {
  id: string;
  artist?: string;
  title?: string;
  file: string;
  referenceKind?: MidiCorpusReferenceKind;
  evaluationModes?: string[];
  trustedRoles?: string[];
}

export interface MidiCorpusInputManifest {
  schemaVersion: 1;
  corpusId: string;
  sources: MidiCorpusInputSource[];
}

export interface BuildMidiCorpusOptions {
  manifest: string;
  out: string;
  repositoryRoot?: string;
  render?: boolean;
  requireRender?: boolean;
  soundfont?: string;
  executable?: string;
  sampleRate?: number;
  gain?: number;
  targetPeak?: number;
  timeoutMs?: number;
  pairs?: string;
  requireSeven?: boolean;
  help?: boolean;
}

export interface BuildMidiCorpusResult {
  status: "ready" | "review-required" | "partial" | "failed";
  output: string;
  report: string;
  sourceCount: number;
  normalizedCount: number;
  failedCount: number;
  renderedCount: number;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SOURCE_COUNT = 7;
const SOURCE_SANITY_EXCERPT_SECONDS = 24;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const KIND_VALUES = new Set<MidiCorpusReferenceKind>(["piano-target", "semantic-full-band", "mixed", "unknown", "direct-piano", "multitrack-piano", "semantic-band"]);
const KIND_ALIASES: Record<string, MidiCorpusReferenceKind> = {
  PIANO_TARGET: "piano-target",
  SEMANTIC_FULL_BAND: "semantic-full-band",
  SEMANTIC_BAND: "semantic-band",
  DIRECT_PIANO: "direct-piano",
  MULTITRACK_PIANO: "multitrack-piano",
};

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function usage(): string {
  return [
    "Usage: build-midi-corpus.ts --manifest FILE --out DIR [options]",
    "  --render                 Render source sanity WAVs with FluidSynth",
    "  --require-render         Fail if rendering is not requested or fails",
    "  --soundfont FILE         SoundFont path (or KEYSPILLI_SOUNDFONT)",
    "  --executable FILE        FluidSynth executable",
    "  --sample-rate N          Renderer sample rate",
    "  --gain N                 Renderer gain",
    "  --target-peak N          PCM peak target",
    "  --timeout-ms N           Renderer timeout",
    "  --pairs FILE             Optional path-bearing baseline/current sidecar",
    "  --repository-root DIR   Repository safety boundary",
    "  --allow-fewer            Test/development mode; do not require seven inputs",
  ].join("\n");
}

function required(argv: readonly string[], index: number, option: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value\n${usage()}`);
  return [value, index + 1];
}

function numberValue(value: string, option: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${option} must be finite`);
  return number;
}

export function parseBuildMidiCorpusArgs(argv: readonly string[]): BuildMidiCorpusOptions {
  let manifest: string | undefined;
  let out: string | undefined;
  const options: Omit<BuildMidiCorpusOptions, "manifest" | "out"> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equal = arg.indexOf("=");
    const option = equal >= 0 ? arg.slice(0, equal) : arg;
    const inline = equal >= 0 ? arg.slice(equal + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const next = required(argv, index, option);
      index = next[1];
      return next[0];
    };
    switch (option) {
      case "--manifest": manifest = value(); break;
      case "--out": out = value(); break;
      case "--repository-root": options.repositoryRoot = value(); break;
      case "--render": options.render = true; break;
      case "--require-render": options.requireRender = true; break;
      case "--soundfont": options.soundfont = value(); break;
      case "--executable": options.executable = value(); break;
      case "--sample-rate": options.sampleRate = numberValue(value(), option); break;
      case "--gain": options.gain = numberValue(value(), option); break;
      case "--target-peak": options.targetPeak = numberValue(value(), option); break;
      case "--timeout-ms": options.timeoutMs = numberValue(value(), option); break;
      case "--pairs": options.pairs = value(); break;
      case "--allow-fewer": options.requireSeven = false; break;
      case "--help": case "-h": return { manifest: manifest ?? "", out: out ?? "", ...options, help: true };
      default: throw new Error(`unknown option: ${arg}\n${usage()}`);
    }
  }
  if (!manifest || !out) throw new Error("--manifest and --out are required\n" + usage());
  return { manifest, out, requireSeven: options.requireSeven ?? true, ...options };
}

function inside(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function realpathExistingAncestor(value: string): Promise<string | null> {
  let candidate = value;
  while (true) {
    try {
      return await realpath(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) return null;
      candidate = parent;
    }
  }
}

async function externalPath(value: string, label: string, repositoryRoot = ROOT): Promise<string> {
  if (!isAbsolute(value) || value.includes("\0") || value.includes("\n") || value.includes("\r")) throw new Error(`${label} must be an absolute, single-line path`);
  const resolved = resolve(value);
  const safetyRoot = await realpathExistingAncestor(resolve(repositoryRoot)) ?? resolve(repositoryRoot);
  if (inside(resolved, safetyRoot)) throw new Error(`${label} must be outside the repository`);
  // A path outside the repository can still be a symlink into it.  Resolve
  // existing targets before admitting them; missing output directories remain
  // valid and are created by the caller.
  const canonical = await realpathExistingAncestor(resolved);
  if (canonical && inside(canonical, safetyRoot)) throw new Error(`${label} must be outside the repository`);
  return resolved;
}

async function regularInput(value: string, repositoryRoot = ROOT): Promise<{ path: string; bytes: Uint8Array }> {
  const path = await externalPath(value, "MIDI source", repositoryRoot);
  const canonical = await realpath(path);
  const info = await stat(canonical);
  if (!info.isFile() || info.size <= 0) throw new Error("MIDI source is not a non-empty regular file");
  return { path: canonical, bytes: new Uint8Array(await readFile(canonical)) };
}

function pathFreeString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.includes("/") || normalized.includes("\\") || /^file:/i.test(normalized)) throw new Error(`${field} must be a logical path-free value`);
  return normalized.slice(0, 240);
}

export function parseMidiCorpusManifest(value: unknown, requireSeven = true): MidiCorpusInputManifest {
  if (!value || typeof value !== "object") throw new Error("MIDI corpus manifest must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) throw new Error("MIDI corpus manifest schemaVersion must be 1");
  const corpusId = pathFreeString(raw.corpusId, "corpusId");
  if (!Array.isArray(raw.sources)) throw new Error("MIDI corpus manifest sources must be an array");
  if (requireSeven && raw.sources.length !== SOURCE_COUNT) throw new Error(`MIDI corpus manifest requires exactly ${SOURCE_COUNT} sources`);
  const ids = new Set<string>();
  const sources: MidiCorpusInputSource[] = raw.sources.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`source ${index} must be an object`);
    const item = entry as Record<string, unknown>;
    const id = pathFreeString(item.id, `source ${index} id`);
    if (!SAFE_ID.test(id)) throw new Error(`source ${index} id is not a stable identifier`);
    if (ids.has(id)) throw new Error(`duplicate MIDI corpus source id: ${id}`);
    ids.add(id);
    const file = item.file;
    if (typeof file !== "string") throw new Error(`source ${id} file must be a path`);
    const rawReferenceKind = item.referenceKind === undefined ? "unknown" : item.referenceKind;
    const referenceKind = typeof rawReferenceKind === "string" ? KIND_ALIASES[rawReferenceKind] ?? rawReferenceKind : rawReferenceKind;
    if (!KIND_VALUES.has(referenceKind as MidiCorpusReferenceKind)) throw new Error(`source ${id} has an unsupported referenceKind`);
    const evaluationModes = Array.isArray(item.evaluationModes) ? item.evaluationModes.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean).sort(compareText) : undefined;
    const trustedRoles = Array.isArray(item.trustedRoles) ? item.trustedRoles.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean).sort(compareText) : undefined;
    return {
      id,
      artist: typeof item.artist === "string" ? item.artist : undefined,
      title: typeof item.title === "string" ? item.title : undefined,
      file,
      referenceKind: referenceKind as MidiCorpusReferenceKind,
      ...(evaluationModes?.length ? { evaluationModes } : {}),
      ...(trustedRoles?.length ? { trustedRoles } : {}),
    };
  });
  return { schemaVersion: 1, corpusId, sources };
}

function normalizationStatus(result: MidiCorpusResult): "NOT_REQUIRED" | "RECOVERED" | "MANUAL_VALIDATION_REQUIRED" | "FAILED" {
  if (result.status === "valid") return "NOT_REQUIRED";
  if (result.status === "invalid") return "FAILED";
  // A very large salvage indicates an unknown/unbounded source change.  It is
  // reported but not silently admitted to an automatic benchmark.
  return result.normalization.droppedEvents > 32 ? "MANUAL_VALIDATION_REQUIRED" : "RECOVERED";
}

function sourceReport(
  source: MidiCorpusInputSource,
  strict: MidiCorpusResult,
  effective: MidiCorpusResult,
  artifacts?: { normalizedMidi?: string; canonicalJson?: string; fullReferenceWav?: string; excerptReferenceWav?: string },
  canonicalOverride?: MidiCorpusResult["canonical"],
): MidiCorpusSongReport {
  const canonical = canonicalOverride ?? effective.canonical;
  if (!canonical) return buildMidiCorpusSongReport({ id: source.id, label: source.title, artist: source.artist, title: source.title, referenceKind: source.referenceKind, result: effective, strictResult: strict });
  return buildMidiCorpusSongReport({
    id: source.id,
    label: source.title,
    artist: source.artist,
    title: source.title,
    referenceKind: source.referenceKind,
    evaluationModes: source.evaluationModes as never,
    trustedRoles: source.trustedRoles as never,
    result: effective,
    strictResult: strict,
    canonical,
    ...(artifacts ? { artifacts } : {}),
  });
}

async function readPairs(path: string | undefined, repositoryRoot = ROOT): Promise<MidiCorpusComparisonInput[]> {
  if (!path) return [];
  const external = await externalPath(path, "comparison sidecar", repositoryRoot);
  const parsed: unknown = JSON.parse(await readFile(external, "utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error("comparison sidecar must be an object");
  const raw = parsed as Record<string, unknown>;
  if (!Array.isArray(raw.comparisons)) throw new Error("comparison sidecar comparisons must be an array");
  return raw.comparisons.map((value) => {
    if (!value || typeof value !== "object") throw new Error("comparison entry must be an object");
    const entry = value as Record<string, unknown>;
    if (typeof entry.songId !== "string") throw new Error("comparison songId must be a string");
    // The sidecar is allowed to contain paths for local resolution, but they
    // are never copied into the report.  This first slice accepts only already
    // evaluated snapshots, so a missing aligned status remains fail-closed.
    return {
      songId: pathFreeString(entry.songId, "comparison songId"),
      status: entry.status === "aligned" || entry.status === "failed" || entry.status === "not-requested" || entry.status === "insufficient-evidence" ? entry.status : "insufficient-evidence",
      comparable: entry.comparable === true,
      referenceRoles: Array.isArray(entry.referenceRoles) ? entry.referenceRoles.filter((item): item is string => typeof item === "string") : [],
      alignedDurationBeats: typeof entry.alignedDurationBeats === "number" && Number.isFinite(entry.alignedDurationBeats) ? entry.alignedDurationBeats : undefined,
      baseline: entry.baseline as MidiCorpusComparisonInput["baseline"],
      current: entry.current as MidiCorpusComparisonInput["current"],
    };
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, canonicalMidiCorpusReportJson(value) + "\n", { encoding: "utf8" });
}

function markdownReview(report: ReturnType<typeof buildMidiCorpusReport>): string {
  const lines = [
    "# Local MIDI reference corpus",
    "",
    `Corpus: ${report.corpusId}`,
    `Sources: ${report.sourceCount}`,
    `Corpus status: ${report.status.replaceAll("-", "_").toUpperCase()}`,
    "",
    "This document is path-free. Source binaries remain outside the repository and are not uploaded or cataloged.",
    "",
    "| Source | Kind | Notes | Tempo | Piano target | Melody | Harmony | Bass/root | Normalization |",
    "|---|---|---:|---:|---|---|---|---|---|",
  ];
  for (const source of report.sources) {
    lines.push(`| ${source.id} | ${source.referenceKind} | ${source.parser?.noteCount ?? "—"} | ${source.parser?.tempoBpm ?? "—"} | ${source.readiness.pianoTarget} | ${source.readiness.melody} | ${source.readiness.harmony} | ${source.readiness.bassRoot} | ${source.integrity.normalization?.status ?? "—"} |`);
  }
  lines.push("", "## Benchmark boundary", "", `Genuine baseline/current comparisons: ${report.benchmark.comparableSongCount}`, `Benchmark status: ${report.benchmark.status}`, `Minimum required for strict comparison: ${report.benchmark.minimumComparableSongs}`, "", "A blind baseline/current pack is not generated without genuine same-song baseline/current inputs. Human listening decisions are recorded separately.", "");
  return lines.join("\n");
}

export async function buildMidiCorpus(options: BuildMidiCorpusOptions): Promise<BuildMidiCorpusResult> {
  if (options.help) throw new Error(usage());
  const repositoryRoot = options.repositoryRoot === undefined
    ? ROOT
    : (() => {
      if (!isAbsolute(options.repositoryRoot!) || options.repositoryRoot!.includes("\0") || options.repositoryRoot!.includes("\n") || options.repositoryRoot!.includes("\r")) {
        throw new Error("repository root must be an absolute, single-line path");
      }
      return resolve(options.repositoryRoot!);
    })();
  const manifestPath = await externalPath(options.manifest, "corpus manifest", repositoryRoot);
  const output = await externalPath(options.out, "corpus output", repositoryRoot);
  const manifest = parseMidiCorpusManifest(JSON.parse(await readFile(manifestPath, "utf8")), options.requireSeven !== false);
  await mkdir(output, { recursive: true });
  const canonicalDir = resolve(output, "canonical");
  const normalizedDir = resolve(output, "normalized");
  const sanityDir = resolve(output, "source-sanity");
  await mkdir(canonicalDir, { recursive: true });
  await mkdir(normalizedDir, { recursive: true });
  await mkdir(sanityDir, { recursive: true });
  const reports: MidiCorpusSongReport[] = [];
  let normalizedCount = 0;
  let failedCount = 0;
  let renderedCount = 0;
  const sanityEntries: Array<Record<string, unknown>> = [];
  for (const source of [...manifest.sources].sort((left, right) => compareText(left.id, right.id))) {
    let failureCounted = false;
    try {
      const input = await regularInput(source.file, repositoryRoot);
      const strict = auditMidiBytes(input.bytes);
      const effective = strict.status === "valid" ? strict : normalizeMidiBytes(input.bytes);
      const normalization = normalizationStatus(effective);
      if (normalization === "FAILED" || normalization === "MANUAL_VALIDATION_REQUIRED") {
        failedCount += 1;
        failureCounted = true;
      }
      if (effective.status === "normalized") normalizedCount += 1;

      // Re-audit recovered bytes before reporting or rendering them.  A
      // normalizer is allowed to salvage only data that still passes strict
      // parsing after the rewrite.
      let effectiveCanonical = effective.canonical;
      let normalizedMidi: string | undefined;
      let renderMidi = input.path;
      if (effective.status === "normalized" && effective.normalizedBytes) {
        const reparsed = auditMidiBytes(effective.normalizedBytes);
        if (reparsed.status !== "valid" || !reparsed.canonical) throw new Error("normalized MIDI did not pass strict re-parse");
        effectiveCanonical = reparsed.canonical;
        const normalizedPath = resolve(normalizedDir, `${source.id}.mid`);
        await writeFile(normalizedPath, effective.normalizedBytes, { flag: "w" });
        normalizedMidi = `normalized/${source.id}.mid`;
        renderMidi = normalizedPath;
      }
      const canonicalJson = `canonical/${source.id}.json`;
      if (effectiveCanonical) await writeJson(resolve(output, canonicalJson), effectiveCanonical);
      let fullReferenceWav: string | undefined;
      let excerptReferenceWav: string | undefined;
      let renderError: string | undefined;
      let renderMetadata: Record<string, unknown> | undefined;
      if (options.render && effectiveCanonical) {
        const audioDir = resolve(sanityDir, "audio", source.id);
        await mkdir(audioDir, { recursive: true });
        const wavPath = resolve(audioDir, "full-reference.wav");
        try {
          const rendered: MidiRenderResult = await renderMidiToWav({ midiPath: renderMidi, outputPath: wavPath }, {
            ...(options.executable ? { executable: options.executable } : {}),
            ...(options.soundfont ? { soundfontPath: options.soundfont } : {}),
            ...(options.sampleRate !== undefined ? { sampleRate: options.sampleRate } : {}),
            ...(options.gain !== undefined ? { gain: options.gain } : {}),
            ...(options.targetPeak !== undefined ? { targetPeak: options.targetPeak } : {}),
            ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
          });
          fullReferenceWav = `source-sanity/audio/${source.id}/full-reference.wav`;
          let excerptMetadata: Record<string, unknown> | undefined;
          let excerptError: string | undefined;
          try {
            const excerptPath = resolve(audioDir, "excerpt.wav");
            const excerptEndSeconds = Math.min(SOURCE_SANITY_EXCERPT_SECONDS, rendered.wav.durationSeconds);
            const excerpt = await slicePcm16WavFile(wavPath, excerptPath, 0, excerptEndSeconds);
            excerptReferenceWav = `source-sanity/audio/${source.id}/excerpt.wav`;
            excerptMetadata = {
              startSeconds: 0,
              requestedDurationSeconds: SOURCE_SANITY_EXCERPT_SECONDS,
              durationSeconds: excerpt.durationSeconds,
              bytes: excerpt.bytes,
              sha256: excerpt.sha256,
            };
          } catch (error) {
            excerptError = redactedCliError(error);
            if (options.requireRender) throw new Error("source sanity excerpt failed");
          }
          renderMetadata = {
            renderer: {
              id: rendered.renderer.id,
              version: rendered.renderer.version,
              sampleRate: rendered.renderer.sampleRate,
              gain: rendered.renderer.gain,
              targetPeak: rendered.renderer.targetPeak,
            },
            soundfont: { bytes: rendered.soundfont.bytes, sha256: rendered.soundfont.sha256 },
            wav: {
              bytes: rendered.wav.bytes,
              sha256: rendered.wav.sha256,
              sampleRate: rendered.wav.sampleRate,
              channels: rendered.wav.channels,
              bitsPerSample: rendered.wav.bitsPerSample,
              durationSeconds: rendered.wav.durationSeconds,
              peak: rendered.wav.peak,
              rms: rendered.wav.rms,
              silenceRatio: rendered.wav.silenceRatio,
              clippingCount: rendered.wav.clippingCount,
            },
            duration: rendered.duration,
            ...(excerptMetadata ? { excerpt: excerptMetadata } : {}),
            ...(excerptError ? { excerptStatus: "failed", excerptError } : {}),
          };
          renderedCount += 1;
        } catch (error) {
          renderError = redactedCliError(error);
          if (options.requireRender) throw new Error("FluidSynth render failed");
        }
      } else if (options.requireRender) {
        throw new Error("rendering is required but unavailable");
      }
      const report = sourceReport(source, strict, effective, {
        ...(normalizedMidi ? { normalizedMidi } : {}),
        canonicalJson,
        ...(fullReferenceWav ? { fullReferenceWav } : {}),
        ...(excerptReferenceWav ? { excerptReferenceWav } : {}),
      }, effectiveCanonical);
      reports.push(report);
      sanityEntries.push({ id: source.id, title: report.title, artist: report.artist, referenceKind: report.referenceKind, bytes: input.bytes.byteLength, sha256: hash(input.bytes), strictStatus: report.integrity.strictParse, normalizationStatus: normalization, ...(fullReferenceWav ? { fullReferenceWav } : {}), ...(excerptReferenceWav ? { excerptReferenceWav } : {}), ...(renderMetadata ? { render: renderMetadata } : {}), ...(renderError ? { renderStatus: "failed", renderError } : options.render ? { renderStatus: "passed" } : {}) });
    } catch (error) {
      if (!failureCounted) failedCount += 1;
      const message = redactedCliError(error);
      const report = buildMidiCorpusSongReport({ id: source.id, label: source.title, artist: source.artist, title: source.title, referenceKind: source.referenceKind });
      reports.push(report);
      sanityEntries.push({ id: source.id, title: report.title, artist: report.artist, referenceKind: report.referenceKind, strictStatus: "failed", normalizationStatus: "FAILED", error: message });
    }
  }
  const comparisons = await readPairs(options.pairs, repositoryRoot);
  const shell = buildMidiCorpusReport({ corpusId: manifest.corpusId, sources: [], comparisons });
  const finalReport: MidiCorpusReport = {
    ...shell,
    status: failedCount === reports.length ? "failed" : failedCount > 0 ? "review-required" : reports.length < SOURCE_COUNT ? "partial" : "ready",
    sourceCount: reports.length,
    sources: reports.sort((left, right) => compareText(left.id, right.id)),
    defectClusters: computeMidiCorpusDefectClusters(reports),
    determinism: { canonicalSha256: "" },
  };
  // Hash the canonical report without the self-referential determinism field,
  // matching buildMidiCorpusReport's contract and keeping repeat runs stable.
  const { determinism: _determinism, ...reportForHash } = finalReport;
  finalReport.determinism = { canonicalSha256: hash(new TextEncoder().encode(canonicalMidiCorpusReportJson(reportForHash))) };
  const reportPath = resolve(output, "report.json");
  await writeJson(reportPath, finalReport);
  await writeJson(resolve(sanityDir, "manifest.json"), {
    schemaVersion: 1,
    kind: "midi-source-sanity",
    corpusId: manifest.corpusId,
    normalizerVersion: MIDI_CORPUS_NORMALIZER_VERSION,
    pathsRedacted: true,
    render: {
      requested: options.render === true,
      required: options.requireRender === true,
      renderer: "fluidsynth",
      sampleRate: options.sampleRate ?? 44_100,
      gain: options.gain ?? 1,
      targetPeak: options.targetPeak ?? 0.95,
      timeoutMs: options.timeoutMs ?? 600_000,
      executableConfigured: Boolean(options.executable ?? process.env.KEYSPILLI_FLUIDSYNTH),
      soundfontConfigured: Boolean(options.soundfont ?? process.env.KEYSPILLI_SOUNDFONT),
    },
    sources: sanityEntries.sort((left, right) => compareText(String(left.id), String(right.id))),
  });
  await writeFile(resolve(output, "SOURCE-REVIEW.md"), markdownReview(finalReport), "utf8");
  const status: BuildMidiCorpusResult["status"] = failedCount === reports.length ? "failed" : failedCount > 0 ? "review-required" : reports.length < SOURCE_COUNT ? "partial" : "ready";
  return { status, output, report: reportPath, sourceCount: reports.length, normalizedCount, failedCount, renderedCount };
}

function redactedCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Paths are useful while debugging locally, but they do not belong in a
  // copied CI log or the corpus review artifact.  The successful result still
  // returns the caller's output location so a local operator can open it.
  return message.replace(/(?:file:\/\/)?\/(?:[^"'`<>\n\r]|\\ )+/g, "[path]");
}

if (process.argv[1]?.endsWith("build-midi-corpus.ts") || process.argv[1]?.endsWith("build-midi-corpus.js")) {
  try {
    const options = parseBuildMidiCorpusArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
    } else {
      buildMidiCorpus(options).then((result) => {
        console.log(JSON.stringify(result, null, 2));
        if (result.status === "failed") process.exitCode = 1;
      }).catch((error: unknown) => {
        console.error(`build-midi-corpus: ${redactedCliError(error)}`);
        process.exitCode = 1;
      });
    }
  } catch (error) {
    console.error(`build-midi-corpus: ${redactedCliError(error)}`);
    process.exitCode = 1;
  }
}
