#!/usr/bin/env node
/**
 * Local-only cold metal transfer evaluator.
 *
 * This command consumes an already-frozen manifest and raw MIDI outputs. It
 * never invokes a separator, AMT model, arranger, catalog, or network. All
 * candidate hashes are verified before a reference file is opened; if any
 * exact frozen stem/output is unavailable, the report fails closed and keeps
 * references unread.
 */
import { createHash } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMidi } from "@keyspilli/midi";
import {
  evaluateColdMetalTransfer,
  hashCanonicalColdMetalTransfer,
  type ColdMetalTransferInput,
  type ColdTransferNoteInput,
} from "../src/cold-metal-transfer.js";

const SHA256 = /^[a-f0-9]{64}$/i;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const EXPERIMENT_SCHEMA_VERSION = 1 as const;

interface ArtifactSpec {
  status?: "available" | "unavailable";
  path?: string;
  sha256?: string;
  recordedSha256?: string;
  logicalId?: string;
}
interface SongSpec {
  id: string;
  stem: ArtifactSpec;
  basicPitch: ArtifactSpec;
  gaps: ArtifactSpec;
  reference: ArtifactSpec;
}
interface EvaluationSpec {
  timebase?: "absolute-seconds";
  matching?: "deterministic-maximum-cardinality-one-to-one";
  onsetToleranceSeconds?: number;
  materialGain?: number;
  catastrophicLoss?: number;
  meaningfulPrecisionGain?: number;
  autoAlignment?: false;
  transposition?: 0;
}
interface ExperimentManifest {
  schemaVersion: typeof EXPERIMENT_SCHEMA_VERSION;
  kind?: "metal-guitar-amt-transfer-preregistration";
  experimentId: string;
  git?: { revision?: string };
  evaluation?: EvaluationSpec;
  backends?: Record<string, unknown>;
  songs: SongSpec[];
}
interface CliOptions { manifest: string; out?: string; help: boolean }

function usage(): string {
  return [
    "Usage: evaluate-cold-transfer.ts --manifest /private/.../manifest.json [--out /private/.../report.json]",
    "",
    "The manifest names frozen raw MIDI outputs and references. Inputs must be",
    "absolute files outside the repository. Candidate hashes are checked before",
    "references are read. Missing exact stems fail closed as CASE D.",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { manifest: "", help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const equals = arg.indexOf("=");
    const flag = equals >= 0 ? arg.slice(0, equals) : arg;
    const inline = equals >= 0 ? arg.slice(equals + 1) : undefined;
    const value = (): string => {
      const next = inline ?? argv[++i];
      if (!next || next.startsWith("--")) throw new Error(`${flag} requires a value\n${usage()}`);
      return next;
    };
    if (flag === "--manifest" || flag === "--preregistration") options.manifest = value();
    else if (flag === "--out") options.out = value();
    else if (flag === "--help" || flag === "-h") options.help = true;
    else throw new Error(`unknown option: ${arg}\n${usage()}`);
  }
  if (!options.help && !options.manifest) throw new Error(`--manifest is required\n${usage()}`);
  return options;
}

function outsideRepo(path: string, label: string): void {
  const repoRelative = relative(REPO_ROOT, path);
  if (repoRelative === "" || (!repoRelative.startsWith(`..${sep}`) && repoRelative !== ".." && !isAbsolute(repoRelative))) {
    throw new Error(`${label} must be outside the repository`);
  }
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || /[\0\r\n]/.test(value)) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function artifact(value: unknown, label: string): ArtifactSpec {
  const row = object(value, label);
  const status = row.status ?? (row.path ? "available" : "unavailable");
  if (status !== "available" && status !== "unavailable") throw new Error(`${label}.status is invalid`);
  const result: ArtifactSpec = { status };
  if (row.logicalId !== undefined) result.logicalId = text(row.logicalId, `${label}.logicalId`);
  if (row.recordedSha256 !== undefined) {
    result.recordedSha256 = text(row.recordedSha256, `${label}.recordedSha256`).toLowerCase();
    if (!SHA256.test(result.recordedSha256)) throw new Error(`${label}.recordedSha256 must be SHA-256`);
  }
  if (status === "available") {
    result.path = text(row.path, `${label}.path`);
    if (!isAbsolute(result.path)) throw new Error(`${label}.path must be absolute`);
    result.sha256 = text(row.sha256, `${label}.sha256`).toLowerCase();
    if (!SHA256.test(result.sha256)) throw new Error(`${label}.sha256 must be SHA-256`);
  } else if (row.path !== undefined || row.sha256 !== undefined) {
    throw new Error(`${label} unavailable entries cannot declare path/hash`);
  }
  return result;
}
function manifest(value: unknown): ExperimentManifest {
  const row = object(value, "manifest");
  if (row.schemaVersion !== EXPERIMENT_SCHEMA_VERSION) throw new Error("manifest.schemaVersion must be 1");
  const experimentId = text(row.experimentId, "manifest.experimentId");
  if (!Array.isArray(row.songs) || row.songs.length !== 3) throw new Error("manifest.songs must contain exactly three songs");
  const ids = new Set<string>();
  const songs = row.songs.map((raw, index) => {
    const song = object(raw, `manifest.songs[${index}]`);
    const id = text(song.id, `manifest.songs[${index}].id`);
    if (ids.has(id)) throw new Error(`duplicate song id: ${id}`);
    ids.add(id);
    return { id, stem: artifact(song.stem, `${id}.stem`), basicPitch: artifact(song.basicPitch, `${id}.basicPitch`), gaps: artifact(song.gaps, `${id}.gaps`), reference: artifact(song.reference, `${id}.reference`) };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (row.kind !== undefined && row.kind !== "metal-guitar-amt-transfer-preregistration") throw new Error("manifest.kind is invalid");
  const evaluation = row.evaluation && typeof row.evaluation === "object" && !Array.isArray(row.evaluation) ? row.evaluation as Record<string, unknown> : undefined;
  if (evaluation) {
    if (evaluation.timebase !== undefined && evaluation.timebase !== "absolute-seconds") throw new Error("manifest.evaluation.timebase is invalid");
    if (evaluation.matching !== undefined && evaluation.matching !== "deterministic-maximum-cardinality-one-to-one") throw new Error("manifest.evaluation.matching is invalid");
    if (evaluation.autoAlignment !== undefined && evaluation.autoAlignment !== false) throw new Error("manifest.evaluation.autoAlignment must be false");
    if (evaluation.transposition !== undefined && evaluation.transposition !== 0) throw new Error("manifest.evaluation.transposition must be zero");
    for (const key of ["onsetToleranceSeconds", "materialGain", "catastrophicLoss", "meaningfulPrecisionGain"] as const) {
      if (evaluation[key] !== undefined && (typeof evaluation[key] !== "number" || !Number.isFinite(evaluation[key]) || evaluation[key] < 0)) throw new Error(`manifest.evaluation.${key} must be finite and non-negative`);
    }
  }
  return {
    schemaVersion: 1,
    kind: typeof row.kind === "string" ? row.kind : undefined,
    experimentId,
    git: row.git && typeof row.git === "object" && !Array.isArray(row.git) ? row.git as ExperimentManifest["git"] : undefined,
    evaluation: evaluation as ExperimentManifest["evaluation"],
    backends: row.backends && typeof row.backends === "object" && !Array.isArray(row.backends) ? row.backends as Record<string, unknown> : undefined,
    songs,
  };
}

async function load(path: string, label: string): Promise<{ bytes: Uint8Array; sha256: string }> {
  if (!isAbsolute(path)) throw new Error(`${label}.path must be absolute`);
  const resolved = await realpath(path).catch(() => { throw new Error(`${label} is unavailable`); });
  outsideRepo(resolved, label);
  if (!(await stat(resolved)).isFile()) throw new Error(`${label} must be a regular file`);
  const bytes = new Uint8Array(await readFile(resolved));
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}
async function verify(spec: ArtifactSpec, label: string, onRead?: () => void): Promise<{ bytes: Uint8Array; sha256: string } | null> {
  if (spec.status !== "available") return null;
  try {
    const loaded = await load(spec.path!, label);
    onRead?.();
    return loaded.sha256 === spec.sha256 ? loaded : null;
  } catch {
    return null;
  }
}
function midiNotes(bytes: Uint8Array): { notes: ColdTransferNoteInput[]; durationSeconds: number } {
  const parsed = parseMidi(bytes);
  const scale = 60 / parsed.tempoBpm;
  return { notes: parsed.notes.map((note) => ({ midi: note.midi, start: note.start * scale, dur: note.dur * scale })), durationSeconds: parsed.durationBeats * scale };
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function redactText(value: string): string {
  return value
    .replace(/file:\/\/[^\s"'<>;,)]*/gi, "[redacted-path]")
    .replace(/(?:^|[\s(=,:])\/(?!\/)(?:[^\s"'<>;,)]*)/g, "$1[redacted-path]")
    .replace(/(?:^|[\s(=,:])(?:[A-Za-z]:[\\/])[^\s"'<>;,)]*/g, "$1[redacted-path]");
}
function redact(value: unknown, key = ""): unknown {
  if (/(?:path|file|directory|dir|executable|soundfont)/i.test(key)) return "[redacted-path]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((childKey) => [childKey, redact((value as Record<string, unknown>)[childKey], childKey)]));
}
async function safeOutputPath(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("--out must be absolute");
  const resolved = resolve(path);
  const canonical = await realpath(resolved).catch(async () => resolve(await realpath(dirname(resolved)), basename(resolved)));
  outsideRepo(canonical, "report");
  return canonical;
}
function unavailableReport(value: ExperimentManifest, reason: string, verified: Record<string, unknown>, preregistrationSha256: string, referencesRead = false): Record<string, unknown> {
  return { schemaVersion: 1, kind: "metal-guitar-amt-transfer", experimentId: value.experimentId, status: "unavailable", globalDecision: "GAPS_COLD_TRANSFER_UNAVAILABLE", architecture: "NO_PROMOTION", reason, inputs: verified, backends: value.backends ?? null, evaluation: value.evaluation ?? { timebase: "seconds", onsetToleranceSeconds: 0.08 }, preregistrationSha256, safety: { referencesRead, inferenceInvoked: false, downstreamInvoked: false, productionInvoked: false } };
}
async function evaluate(value: ExperimentManifest, preregistrationSha256: string): Promise<Record<string, unknown>> {
  const verified: Record<string, unknown> = {};
  const ready: Array<{ song: SongSpec; basic: { bytes: Uint8Array; sha256: string }; gaps: { bytes: Uint8Array; sha256: string } }> = [];
  let unavailableReason: string | undefined;
  for (const song of value.songs) {
    const stem = await verify(song.stem, `${song.id} exact guitar stem`);
    const basic = await verify(song.basicPitch, `${song.id} frozen Basic Pitch output`);
    const gaps = await verify(song.gaps, `${song.id} frozen GAPS output`);
    verified[song.id] = { stem: stem ? { logicalId: song.stem.logicalId ?? song.id, sha256: stem.sha256, bytes: stem.bytes.byteLength } : { status: "unavailable", logicalId: song.stem.logicalId ?? song.id }, basicPitch: basic ? { logicalId: song.basicPitch.logicalId ?? `${song.id}-basic`, sha256: basic.sha256, bytes: basic.bytes.byteLength } : { status: "unavailable", logicalId: song.basicPitch.logicalId ?? `${song.id}-basic`, recordedSha256: song.basicPitch.recordedSha256 ?? null }, gaps: gaps ? { logicalId: song.gaps.logicalId ?? `${song.id}-gaps`, sha256: gaps.sha256, bytes: gaps.bytes.byteLength } : { status: "unavailable", logicalId: song.gaps.logicalId ?? `${song.id}-gaps`, recordedSha256: song.gaps.recordedSha256 ?? null } };
    if (!stem || !basic || !gaps) unavailableReason ??= `exact frozen stem/output unavailable for ${song.id}`;
    else ready.push({ song, basic, gaps });
  }
  if (unavailableReason) return unavailableReport(value, unavailableReason, verified, preregistrationSha256);
  // Reference isolation boundary: all stems and both route outputs are now
  // verified/frozen. References are not touched before this point.
  const parsedReady: Array<(typeof ready)[number] & { basicMidi: ReturnType<typeof midiNotes>; gapsMidi: ReturnType<typeof midiNotes> }> = [];
  for (const item of ready) {
    try {
      parsedReady.push({ ...item, basicMidi: midiNotes(item.basic.bytes), gapsMidi: midiNotes(item.gaps.bytes) });
    } catch {
      return unavailableReport(value, `frozen MIDI output is malformed for ${item.song.id}`, verified, preregistrationSha256);
    }
  }
  const evaluatedSongs: Array<ColdMetalTransferInput["songs"][number]> = [];
  const references: Array<(typeof parsedReady)[number] & { reference: { bytes: Uint8Array; sha256: string } }> = [];
  let referencesRead = false;
  for (const item of parsedReady) {
    const reference = await verify(item.song.reference, `${item.song.id} evaluation reference`, () => { referencesRead = true; });
    if (!reference) return unavailableReport(value, `evaluation reference unavailable for ${item.song.id}`, verified, preregistrationSha256, referencesRead);
    references.push({ ...item, reference });
  }
  for (const item of references) {
    const truth = midiNotes(item.reference.bytes);
    evaluatedSongs.push({ id: item.song.id, duration: truth.durationSeconds, truth: truth.notes, basic: { notes: item.basicMidi.notes, duration: item.basicMidi.durationSeconds }, gaps: { notes: item.gapsMidi.notes, duration: item.gapsMidi.durationSeconds } });
    verified[item.song.id] = { ...(verified[item.song.id] as Record<string, unknown>), reference: { logicalId: item.song.reference.logicalId ?? `${item.song.id}-reference`, sha256: item.reference.sha256, bytes: item.reference.bytes.byteLength } };
  }
  const report = evaluateColdMetalTransfer({ songs: evaluatedSongs, timebase: "seconds", onsetTolerance: value.evaluation?.onsetToleranceSeconds ?? 0.08, materialGain: value.evaluation?.materialGain, catastrophicLoss: value.evaluation?.catastrophicLoss, meaningfulPrecisionGain: value.evaluation?.meaningfulPrecisionGain });
  return { ...report, experimentId: value.experimentId, inputs: verified, backends: value.backends ?? null, preregistrationSha256, determinism: { canonicalSha256: hashCanonicalColdMetalTransfer(report) }, safety: { referencesRead: true, inferenceInvoked: false, downstreamInvoked: false, productionInvoked: false } };
}

export async function main(argv = process.argv.slice(2), io = { stdout: (value: string) => process.stdout.write(value), stderr: (value: string) => process.stderr.write(value) }): Promise<number> {
  let options: CliOptions;
  try { options = parseArgs(argv); } catch (error) { io.stderr(`${error instanceof Error ? error.message : String(error)}\n`); return 2; }
  if (options.help) { io.stdout(`${usage()}\n`); return 0; }
  try {
    const preregPath = await realpath(options.manifest).catch(() => { throw new Error("manifest is unavailable"); });
    const parsed = manifest(JSON.parse(await readFile(preregPath, "utf8")));
    const preregistrationSha256 = createHash("sha256").update(await readFile(preregPath)).digest("hex");
    const report = await evaluate(parsed, preregistrationSha256);
    const output = `${stable(redact(report))}\n`;
    if (options.out) {
      await writeFile(await safeOutputPath(options.out), `${JSON.stringify(JSON.parse(output), null, 2)}\n`, "utf8");
    }
    io.stdout(output);
    return 0;
  } catch (error) { io.stderr(`evaluate-cold-transfer: ${error instanceof Error ? error.message : String(error)}\n`); return 2; }
}
if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) process.exitCode = await main();
