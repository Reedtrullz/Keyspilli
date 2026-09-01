#!/usr/bin/env node
/**
 * Local-only, pre-registered Guitar-TECHS GAPS tie-breaker.
 *
 * The model, audio, truth MIDI, and route MIDI files are external inputs. This
 * command parses them and calls the shared upstream evaluator; it never
 * downloads data, runs the production worker, or uploads anything.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parseMidi } from "@keyspilli/midi";
import {
  assembleGapsAttributionReport,
  canonicalGapsEvaluation,
  normalizeGapsBeatTimeline,
  normalizeGapsRouteCandidate,
  type GapsDecisionThresholds,
  type GapsDecision,
  type GapsMetricItemInput,
  type GapsParsedMidiNote,
  type GapsProvenance,
} from "../src/gaps-attribution.js";
import {
  evaluateUpstreamRoute,
  normalizeUpstreamTruth,
  type UpstreamCandidateNoteInput,
  type UpstreamRouteMetrics,
  type UpstreamTruth,
} from "../src/upstream-attribution.js";
import { upstreamManifestSha256, type UpstreamAttributionManifest } from "../src/upstream-attribution-manifest.js";

interface ManifestItem {
  id: string;
  performanceId?: string;
  techniques?: string[];
  truthMetadata?: { durationBeats?: number; tempoBpm?: number };
  files?: { truth?: { sha256?: string }; di?: { sha256?: string }; ampMic?: { sha256?: string } };
}

interface FrozenManifest {
  schemaVersion: number;
  dataset: Record<string, unknown>;
  selection?: { itemIds?: string[]; count?: number };
  items: ManifestItem[];
}

interface PreRegistration {
  schemaVersion: number;
  backend?: Record<string, unknown>;
  dependency?: Record<string, unknown>;
  checkpoint?: Record<string, unknown>;
  inference?: Record<string, unknown>;
  evaluation?: Record<string, unknown>;
  successCriteria?: Record<string, unknown>;
}

interface BaselineItem {
  id: string;
  routes?: UpstreamRouteMetrics[];
}

interface BaselineReport {
  schemaVersion: number;
  manifestSha256?: string;
  items: BaselineItem[];
  aggregate?: { routes?: UpstreamRouteMetrics[] };
}

interface CliOptions {
  manifest: string;
  baselineReport: string;
  gapsRoot: string;
  truthRoot?: string;
  preregistration: string;
  out?: string;
  help: boolean;
}

const GAPS_WRITER_TEMPO_BPM = 120;
const AGGREGATE_SEPARATOR_BEATS = 8;
const SHA256 = /^[0-9a-f]{64}$/i;
const FROZEN_SELECTION_DIGEST = "fa354513c6b57ec07c223b57b85c5a64eed548b0fb770d09323af3053f6d1062";
const FROZEN_PREREGISTRATION_SHA256 = "d821ec8dd829e6d1a90af5b337afbbbe7e49c661df34b6a4d4fd56cd0c8d49e4";
const FROZEN_GAPS_ITEM_IDS = [
  "p1-singlenotes-all",
  "p2-singlenotes-all",
  "p1-scale-c",
  "p2-scale-gb",
  "p1-tech-palm-mute",
  "p2-tech-palm-mute",
  "p1-tech-harmonics",
  "p2-tech-harmonics",
  "p1-tech-pinch",
  "p2-tech-pinch",
  "p1-chord-set1-major",
  "p2-chord-drop3-7",
  "p3-music-12",
  "p3-music-08",
] as const;

function usage(): string {
  return [
    "Usage: evaluate-gaps-guitar.ts --manifest /private/tmp/.../guitar-techs-manifest.json --baseline-report /private/tmp/.../upstream-attribution-report.json --gaps-root /private/tmp/.../gaps-routes --preregistration /private/tmp/.../gaps-pre-registration.json [--truth-root /private/tmp/.../data] [--out /private/tmp/.../gaps-report.json]",
    "",
    "The baseline report is frozen and hashed; only fresh GAPS MIDI files are",
    "evaluated. Inputs are local and no network, production, or upload path runs.",
  ].join("\n");
}

function localPath(value: string, flag: string): string {
  if (!value || !isAbsolute(value) || /^(?:https?|ftp):\/\//i.test(value) || /[\0\r\n]/.test(value)) throw new Error(`${flag} must be an absolute local path`);
  return resolve(value);
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { manifest: "", baselineReport: "", gapsRoot: "", preregistration: "", help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equals = arg.indexOf("=");
    const flag = equals >= 0 ? arg.slice(0, equals) : arg;
    const inline = equals >= 0 ? arg.slice(equals + 1) : undefined;
    const value = (): string => {
      const next = inline ?? argv[++index];
      if (!next || next.startsWith("--")) throw new Error(`${flag} requires a value`);
      return next;
    };
    if (flag === "--manifest") options.manifest = localPath(value(), "--manifest");
    else if (flag === "--baseline-report") options.baselineReport = localPath(value(), "--baseline-report");
    else if (flag === "--gaps-root") options.gapsRoot = localPath(value(), "--gaps-root");
    else if (flag === "--truth-root") options.truthRoot = localPath(value(), "--truth-root");
    else if (flag === "--preregistration") options.preregistration = localPath(value(), "--preregistration");
    else if (flag === "--out") options.out = localPath(value(), "--out");
    else if (flag === "--help" || flag === "-h") options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (!options.help && (!options.manifest || !options.baselineReport || !options.gapsRoot || !options.preregistration)) throw new Error(`--manifest, --baseline-report, --gaps-root, and --preregistration are required\n\n${usage()}`);
  return options;
}

async function regularFile(path: string, label: string): Promise<string> {
  const resolved = await realpath(path).catch(() => { throw new Error(`${label} does not exist`); });
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`${label} must be a regular file`);
  return resolved;
}

async function regularDirectory(path: string, label: string): Promise<string> {
  const resolved = await realpath(path).catch(() => { throw new Error(`${label} does not exist`); });
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error(`${label} must be a directory`);
  return resolved;
}

function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

function baselineManifest(manifest: FrozenManifest): UpstreamAttributionManifest {
  const modality = (kind: "midi" | "di" | "amp", hash: unknown) => typeof hash === "string" && SHA256.test(hash)
    ? { kind, status: "available" as const, sha256: hash.toLowerCase() }
    : { kind, status: "unavailable" as const, reason: "missing verified file hash" };
  return {
    schemaVersion: 1,
    dataset: {
      name: "Guitar-TECHS",
      version: String(manifest.dataset.version ?? "unknown"),
      license: { spdx: "CC-BY-4.0", url: String((manifest.dataset.license as { url?: unknown } | undefined)?.url ?? "https://creativecommons.org/licenses/by/4.0/") },
    },
    items: manifest.items.map((item) => ({
      id: item.id,
      performance: [item.performanceId ?? item.id],
      modalities: [
        modality("midi", item.files?.truth?.sha256),
        modality("di", item.files?.di?.sha256),
        modality("amp", item.files?.ampMic?.sha256),
      ],
    })),
  };
}

async function readJson(path: string, label: string): Promise<unknown> {
  const resolved = await regularFile(path, label);
  try { return JSON.parse(await readFile(resolved, "utf8")) as unknown; }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function positive(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

async function readManifest(path: string): Promise<FrozenManifest> {
  const manifest = object(await readJson(path, "manifest"), "manifest") as unknown as FrozenManifest;
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.items) || manifest.items.length !== FROZEN_GAPS_ITEM_IDS.length) throw new Error(`manifest must contain the frozen ${FROZEN_GAPS_ITEM_IDS.length}-item selection`);
  const ids = manifest.items.map((item) => item?.id);
  if (ids.some((id) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length) throw new Error("manifest item IDs must be unique strings");
  if (JSON.stringify(ids) !== JSON.stringify(FROZEN_GAPS_ITEM_IDS)) throw new Error("manifest items do not match the frozen item identity/order");
  if (!Array.isArray(manifest.selection?.itemIds) || JSON.stringify(manifest.selection.itemIds) !== JSON.stringify(FROZEN_GAPS_ITEM_IDS)) throw new Error("manifest selection.itemIds does not match the frozen item identity/order");
  if (manifest.selection.count !== FROZEN_GAPS_ITEM_IDS.length) throw new Error("manifest selection.count does not match the frozen selection");
  return manifest;
}

function techniques(manifest: FrozenManifest): string[] {
  return [...new Set(manifest.items.flatMap((item) => item.techniques ?? ["unknown"]))].sort();
}

function provenanceFor(manifest: FrozenManifest, prereg: PreRegistration, preregistrationSha256: string): GapsProvenance {
  const backend = object(prereg.backend, "preregistration.backend");
  const checkpoint = object(prereg.checkpoint, "preregistration.checkpoint");
  const inference = object(prereg.inference, "preregistration.inference");
  const evaluation = object(prereg.evaluation, "preregistration.evaluation");
  const checkpointSha = checkpoint.sha256;
  if (typeof checkpointSha !== "string" || !SHA256.test(checkpointSha)) throw new Error("preregistration checkpoint SHA256 is invalid");
  const sizeBytes = positive(checkpoint.bytes, "preregistration.checkpoint.bytes");
  const repository = typeof backend.repository === "string" ? backend.repository : "unknown";
  const revision = typeof checkpoint.revision === "string" ? checkpoint.revision : "unknown";
  const filename = typeof checkpoint.filename === "string" ? checkpoint.filename : "guitar-gaps.pth";
  const commit = typeof backend.commit === "string" ? backend.commit : "unknown";
  return {
    schemaVersion: 1,
    backend: {
      id: "gaps",
      version: commit,
      checkpoint: { id: `${repository}@${revision}/${filename}`, sha256: checkpointSha.toLowerCase(), sizeBytes },
      config: {
        device: typeof inference.device === "string" ? inference.device : null,
        sampleRateHz: typeof inference.sampleRateHz === "number" ? inference.sampleRateHz : null,
        batchSize: typeof inference.batchSize === "number" ? inference.batchSize : null,
        segmentSeconds: typeof inference.segmentSeconds === "number" ? inference.segmentSeconds : null,
        segmentOverlap: typeof inference.segmentOverlap === "number" ? inference.segmentOverlap : null,
        onsetThreshold: typeof inference.onsetThreshold === "number" ? inference.onsetThreshold : null,
        offsetThreshold: typeof inference.offsetThreshold === "number" ? inference.offsetThreshold : null,
        frameThreshold: typeof inference.frameThreshold === "number" ? inference.frameThreshold : null,
        pedalOffsetThreshold: typeof inference.pedalOffsetThreshold === "number" ? inference.pedalOffsetThreshold : null,
        writerTempoBpm: GAPS_WRITER_TEMPO_BPM,
        preregistrationSha256,
        frozenSelectionDigest: typeof evaluation.frozenSelectionDigest === "string" ? evaluation.frozenSelectionDigest : null,
        basicPitchBaselineReportSha256: typeof evaluation.basicPitchBaselineReportSha256 === "string" ? evaluation.basicPitchBaselineReportSha256 : null,
        invocation: typeof backend.invocation === "string" ? backend.invocation : null,
        dependency: prereg.dependency ? JSON.stringify(prereg.dependency) : null,
      },
    },
    preRegistration: {
      dataset: `${String(manifest.dataset.name ?? "Guitar-TECHS")}@${String(manifest.dataset.version ?? "unknown")}`,
      itemIds: [...manifest.selection!.itemIds!],
      techniques: techniques(manifest),
    },
  };
}

function thresholdsFor(manifest: FrozenManifest, prereg: PreRegistration): GapsDecisionThresholds {
  const criteria = object(prereg.successCriteria, "preregistration.successCriteria");
  const number = (key: string, fallback?: number): number => {
    const value = criteria[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (fallback !== undefined) return fallback;
    throw new Error(`preregistration.successCriteria.${key} must be finite`);
  };
  const techniqueExactGain = number("techniqueExactGainMinimum");
  const techniquePcGain = criteria.techniquePcGainMinimum;
  if (techniquePcGain !== undefined && (typeof techniquePcGain !== "number" || !Number.isFinite(techniquePcGain))) throw new Error("preregistration.successCriteria.techniquePcGainMinimum must be finite");
  return {
    minItems: manifest.items.length,
    materialExactGain: number("aggregateExactF1GainMinimum"),
    materialPcGain: number("aggregatePitchClassF1GainMinimum"),
    techniqueExactGain,
    // The frozen preregistration specifies one per-technique exact threshold;
    // its paired PC criterion is intentionally the same threshold.
    techniquePcGain: techniquePcGain ?? techniqueExactGain,
    requiredTechniqueGains: number("techniqueFamiliesWithExactGainMinimum"),
    maxUnsupportedRateIncrease: 0.1,
    maxUnsupportedRateMultiplier: 1.25,
    minCurrentExactF1: 0.2,
    minCurrentPcF1: 0.2,
  };
}

async function findTruthMidi(root: string, item: ManifestItem): Promise<string> {
  const directory = await regularDirectory(join(root, item.id), `${item.id} truth directory`);
  const files = (await readdir(directory)).filter((name) => name.toLowerCase().endsWith(".mid"));
  if (files.length !== 1) throw new Error(`${item.id} truth directory must contain exactly one MIDI file`);
  return join(directory, files[0]!);
}

function noteInputs(parsed: ReturnType<typeof parseMidi>): GapsParsedMidiNote[] {
  return parsed.notes.map((note) => ({ midi: note.midi, start: note.start, dur: note.dur }));
}

function endBeat(notes: readonly GapsParsedMidiNote[]): number {
  return notes.reduce((max, note) => Math.max(max, (typeof note.start === "number" ? note.start : 0) + (typeof note.dur === "number" ? note.dur : 0)), 0);
}

async function truthFor(root: string, item: ManifestItem): Promise<{ truth: UpstreamTruth; tempoBpm: number }> {
  const path = await findTruthMidi(root, item);
  const bytes = new Uint8Array(await readFile(path));
  const digest = sha256(bytes);
  const expected = item.files?.truth?.sha256;
  if (typeof expected === "string" && SHA256.test(expected) && digest !== expected.toLowerCase()) throw new Error(`${item.id} truth SHA256 does not match manifest`);
  const parsed = parseMidi(bytes);
  const notes = noteInputs(parsed);
  const tempoBpm = positive(item.truthMetadata?.tempoBpm ?? parsed.tempoBpm, `${item.id} truth tempo`);
  const durationBeats = item.truthMetadata?.durationBeats ?? endBeat(notes);
  return { truth: normalizeUpstreamTruth(notes, { performanceId: item.performanceId ?? item.id, technique: (item.techniques ?? ["unknown"]).join("+"), durationBeats, tempoBpm, sourceHash: digest }), tempoBpm };
}

async function gapsRoute(path: string, tempoBpm: number, item: string, kind: string) {
  const resolved = await regularFile(path, `${item}/${kind} GAPS MIDI`);
  const bytes = new Uint8Array(await readFile(resolved));
  const parsed = parseMidi(bytes);
  if (Math.abs(parsed.tempoBpm - GAPS_WRITER_TEMPO_BPM) > 1e-6) throw new Error(`${item}/${kind} GAPS MIDI tempo ${parsed.tempoBpm} is not the pinned ${GAPS_WRITER_TEMPO_BPM} BPM writer tempo`);
  const notes = normalizeGapsBeatTimeline(noteInputs(parsed), tempoBpm, GAPS_WRITER_TEMPO_BPM);
  const durationBeats = endBeat(notes);
  return normalizeGapsRouteCandidate("gaps", notes, { durationBeats: Math.max(durationBeats, 1e-9), durationSeconds: durationBeats * 60 / tempoBpm, tempoBpm, sourceHash: sha256(bytes) });
}

function baselineRoute(report: BaselineReport, itemId: string, routeName: string): UpstreamRouteMetrics {
  const item = report.items.find((candidate) => candidate.id === itemId);
  const route = item?.routes?.find((candidate) => candidate.route === routeName);
  if (!route) throw new Error(`baseline report is missing ${routeName} metrics for ${itemId}`);
  return { ...route, route: "current-guitar-amt" };
}

function aggregateBaseline(report: BaselineReport, routeName: string): UpstreamRouteMetrics {
  const route = report.aggregate?.routes?.find((candidate) => candidate.route === routeName);
  if (!route) throw new Error(`baseline report is missing aggregate ${routeName} metrics`);
  return { ...route, route: "current-guitar-amt" };
}

function offsetNotes(notes: readonly UpstreamCandidateNoteInput[], offset: number): UpstreamCandidateNoteInput[] {
  return notes.map((note) => {
    const start = note.start ?? note.onset;
    return typeof start === "number" && Number.isFinite(start) ? { ...note, start: start + offset, onset: undefined } : { ...note };
  });
}

function overallDecision(reports: readonly { decision: GapsDecision }[], quality: readonly { passed: boolean }[]): GapsDecision {
  if (reports.length !== 2 || quality.length !== 2) return "CURRENT_GUITAR_AMT_INSUFFICIENT";
  if (reports.some(({ decision }) => decision === "GAPS_BACKEND_NOT_EVALUATED")) return "GAPS_BACKEND_NOT_EVALUATED";
  if (quality.some(({ passed }) => !passed)) return "GUITAR_SPECIFIC_AMT_MIXED";
  if (reports.every(({ decision }) => decision === "GUITAR_SPECIFIC_AMT_VALIDATED")) return "GUITAR_SPECIFIC_AMT_VALIDATED";
  if (reports.some(({ decision }) => decision === "GUITAR_SPECIFIC_AMT_MIXED")) return "GUITAR_SPECIFIC_AMT_MIXED";
  return "CURRENT_GUITAR_AMT_INSUFFICIENT";
}

async function modality(manifest: FrozenManifest, truthRoot: string, gapsRoot: string, baseline: BaselineReport, baselineRouteName: string, kind: "di" | "ampMic", evaluation: { onsetToleranceBeats: number; durationToleranceBeats: number }): Promise<{ items: GapsMetricItemInput[]; aggregate: { current: UpstreamRouteMetrics; gaps: UpstreamRouteMetrics } }> {
  const items: GapsMetricItemInput[] = [];
  const aggregateTruth: UpstreamCandidateNoteInput[] = [];
  const aggregateGaps: UpstreamCandidateNoteInput[] = [];
  let offset = 0;
  let aggregateDurationSeconds = 0;
  for (const item of manifest.items) {
    const { truth, tempoBpm } = await truthFor(truthRoot, item);
    const gaps = await gapsRoute(join(gapsRoot, item.id, kind, "candidate.mid"), tempoBpm, item.id, kind);
    const gapsMetrics = evaluateUpstreamRoute(truth, gaps, evaluation);
    items.push({ id: item.id, techniques: item.techniques ?? ["unknown"], current: baselineRoute(baseline, item.id, baselineRouteName), gaps: { ...gapsMetrics, route: "gaps" } });
    aggregateTruth.push(...offsetNotes(truth.notes, offset));
    aggregateGaps.push(...offsetNotes(gaps.notes ?? [], offset));
    offset += Math.max(truth.durationBeats, 1) + AGGREGATE_SEPARATOR_BEATS;
    aggregateDurationSeconds += (Math.max(truth.durationBeats, 1) + AGGREGATE_SEPARATOR_BEATS) * 60 / tempoBpm;
  }
  const aggregateTruthInput = normalizeUpstreamTruth(aggregateTruth, { durationBeats: offset });
  const gaps = evaluateUpstreamRoute(aggregateTruthInput, { route: "gaps", notes: aggregateGaps, durationBeats: offset, durationSeconds: aggregateDurationSeconds }, evaluation);
  return { items, aggregate: { current: aggregateBaseline(baseline, baselineRouteName), gaps: { ...gaps, route: "gaps" } } };
}

async function run(argv: readonly string[], io = { stdout: (value: string) => process.stdout.write(value), stderr: (value: string) => process.stderr.write(value) }): Promise<number> {
  let options: CliOptions;
  try { options = parseArgs(argv); } catch (error) { io.stderr(`${error instanceof Error ? error.message : String(error)}\n`); return 2; }
  if (options.help) { io.stdout(`${usage()}\n`); return 0; }
  try {
    const [manifest, baselineBytes, preregistration, gapsRoot] = await Promise.all([
      readManifest(options.manifest),
      (async () => { const path = await regularFile(options.baselineReport, "baseline report"); return new Uint8Array(await readFile(path)); })(),
      (async () => { const path = await regularFile(options.preregistration, "pre-registration"); const bytes = new Uint8Array(await readFile(path)); try { return { bytes, value: JSON.parse(new TextDecoder().decode(bytes)) as unknown }; } catch (error) { throw new Error(`pre-registration is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); } })(),
      regularDirectory(options.gapsRoot, "GAPS route root"),
    ]);
    const baseline = object(JSON.parse(new TextDecoder().decode(baselineBytes)) as unknown, "baseline report") as unknown as BaselineReport;
    if (baseline.schemaVersion !== 1 || !Array.isArray(baseline.items) || !Array.isArray(baseline.aggregate?.routes)) throw new Error("baseline report schema is invalid");
    const preregistrationBytes = preregistration.bytes;
    const prereg = object(preregistration.value, "pre-registration") as unknown as PreRegistration;
    if (prereg.schemaVersion !== 1) throw new Error("pre-registration schema is invalid");
    const baselineHash = sha256(baselineBytes);
    const preregHash = sha256(preregistrationBytes);
    if (preregHash !== FROZEN_PREREGISTRATION_SHA256) throw new Error("pre-registration SHA256 does not match the frozen experiment");
    const expectedBaselineHash = prereg.evaluation?.basicPitchBaselineReportSha256;
    if (typeof expectedBaselineHash !== "string" || !SHA256.test(expectedBaselineHash) || baselineHash !== expectedBaselineHash.toLowerCase()) throw new Error("baseline report SHA256 does not match pre-registration");
    const selectionIds = manifest.selection!.itemIds!;
    const baselineIds = baseline.items.map((item) => item.id);
    if (baselineIds.length !== selectionIds.length || new Set(baselineIds).size !== baselineIds.length || selectionIds.some((id) => !baselineIds.includes(id))) throw new Error("baseline report does not cover the frozen selection");
    const expectedManifestHash = baselineManifest(manifest);
    if (typeof baseline.manifestSha256 !== "string" || !SHA256.test(baseline.manifestSha256) || baseline.manifestSha256.toLowerCase() !== upstreamManifestSha256(expectedManifestHash)) throw new Error("baseline report manifest identity is not comparable to the frozen manifest");
    const expectedSelectionDigest = prereg.evaluation?.frozenSelectionDigest;
    if (typeof expectedSelectionDigest !== "string" || expectedSelectionDigest.toLowerCase() !== FROZEN_SELECTION_DIGEST) throw new Error("pre-registration selection digest is not the frozen experiment");
    const truthRoot = await regularDirectory(options.truthRoot ?? resolve(dirname(gapsRoot), "data"), "truth root");
    const provenance = provenanceFor(manifest, prereg, preregHash);
    const thresholds = thresholdsFor(manifest, prereg);
    const evaluation = {
      onsetToleranceBeats: typeof prereg.evaluation?.onsetToleranceBeats === "number" ? prereg.evaluation.onsetToleranceBeats : 0.05,
      durationToleranceBeats: typeof prereg.evaluation?.durationToleranceBeats === "number" ? prereg.evaluation.durationToleranceBeats : 0.25,
    };
    const [di, ampMic] = await Promise.all([
      modality(manifest, truthRoot, gapsRoot, baseline, "di-basic-pitch", "di", evaluation),
      modality(manifest, truthRoot, gapsRoot, baseline, "amp-mic-basic-pitch", "ampMic", evaluation),
    ]);
    const diReport = assembleGapsAttributionReport({ provenance, items: di.items, aggregate: di.aggregate, thresholds });
    const ampReport = assembleGapsAttributionReport({ provenance, items: ampMic.items, aggregate: ampMic.aggregate, thresholds });
    const quality = [diReport, ampReport].map((report) => {
      const current = report.aggregate.routes["current-guitar-amt"];
      const gaps = report.aggregate.routes.gaps;
      const unsupportedPerSecond = gaps.unsupportedPerSecond;
      const octaveRegression = current.octaveFlips.rate !== null && gaps.octaveFlips.rate !== null ? gaps.octaveFlips.rate - current.octaveFlips.rate : null;
      const unsupportedMax = typeof prereg.successCriteria?.unsupportedPerSecondMax === "number" ? prereg.successCriteria.unsupportedPerSecondMax : 0.5;
      const octaveMax = typeof prereg.successCriteria?.octaveErrorRateRegressionMaximum === "number" ? prereg.successCriteria.octaveErrorRateRegressionMaximum : 0.05;
      return { modality: report === diReport ? "di" : "ampMic", unsupportedPerSecond, unsupportedPerSecondMax: unsupportedMax, octaveRegression, octaveRegressionMax: octaveMax, passed: unsupportedPerSecond !== null && octaveRegression !== null && unsupportedPerSecond <= unsupportedMax && octaveRegression <= octaveMax };
    });
    const decision = overallDecision([diReport, ampReport], quality);
    const envelope = {
      schemaVersion: 1,
      kind: "guitar-techs-gaps-tiebreaker",
      decision,
      decisions: [decision],
      baseline: { reportSha256: baselineHash, manifestSha256: baseline.manifestSha256 ?? null, routeNames: ["di-basic-pitch", "amp-mic-basic-pitch"] },
      provenance,
      preRegistration: { sha256: preregHash, successCriteria: prereg.successCriteria ?? null },
      normalization: { gapsWriterTempoBpm: GAPS_WRITER_TEMPO_BPM, truthTempoSource: "manifest.truthMetadata.tempoBpm", beatScale: "truthTempoBpm divided by gapsWriterTempoBpm", aggregateSeparatorBeats: AGGREGATE_SEPARATOR_BEATS },
      frozenSelection: { itemIds: [...selectionIds], digest: FROZEN_SELECTION_DIGEST },
      modalities: { di: diReport, ampMic: ampReport },
      qualityGates: quality,
      canonicalSha256: "",
    };
    envelope.canonicalSha256 = sha256(new TextEncoder().encode(canonicalGapsEvaluation({ ...envelope, canonicalSha256: undefined })));
    const output = `${JSON.stringify(JSON.parse(canonicalGapsEvaluation(envelope)), null, 2)}\n`;
    if (options.out) {
      const parent = dirname(options.out);
      if (!(await stat(parent).catch(() => null))?.isDirectory()) throw new Error("--out parent does not exist");
      await writeFile(options.out, output, "utf8");
    }
    io.stdout(output);
    return 0;
  } catch (error) { io.stderr(`${error instanceof Error ? error.message : String(error)}\n`); return 2; }
}

export const runEvaluateGapsGuitar = run;

if (process.argv[1] && import.meta.url.endsWith(`/${basename(process.argv[1])}`)) run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
