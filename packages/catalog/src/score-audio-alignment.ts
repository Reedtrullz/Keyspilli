import { stat } from "node:fs/promises";
import type { RunnerExecFile, RunnerExecFileOptions } from "./upstream-attribution-runner.js";

export const SCORE_AUDIO_ALIGNMENT_SCHEMA_VERSION = 1 as const;
export const SCORE_AUDIO_ALIGNMENT_CANDIDATE_ID = "PRODUCTION_SCORE_ALIGNMENT_CANDIDATE_V2" as const;
export const SCORE_AUDIO_ALIGNMENT_MAX_SCORE_BYTES = 16 * 1024 * 1024;
export const SCORE_AUDIO_ALIGNMENT_MAX_AUDIO_BYTES = 2 * 1024 * 1024 * 1024;

export type ScoreAudioAlignmentConfidence = "ALIGNED_HIGH_CONFIDENCE" | "ALIGNED_PARTIAL" | "ALIGNMENT_REJECTED";

export interface ScoreAudioAlignmentAnchor {
  beat: number;
  audioSeconds: number;
}

export interface ScoreAudioAlignmentReport {
  schemaVersion: typeof SCORE_AUDIO_ALIGNMENT_SCHEMA_VERSION;
  candidate: {
    id: typeof SCORE_AUDIO_ALIGNMENT_CANDIDATE_ID;
    fingerprint: string;
    config: Record<string, unknown>;
  };
  score: {
    sha256: string;
    bytes: number;
    format: number;
    division: number;
    trackCount: number;
    noteCount: number;
    durationBeats: number;
    durationSeconds: number;
  };
  audio: {
    sha256: string;
    bytes: number;
    sampleRate: number;
    frameCount: number;
    durationSeconds: number;
  };
  mapping: {
    method: string;
    anchors: readonly ScoreAudioAlignmentAnchor[];
    segmentCount: number;
    rawPathFrames: number;
    rawScoreFrames: number;
    compactApproximationErrorSeconds: number;
    dtwCost: number;
    coarseEvaluatedCells?: number;
    coarseDenseEquivalentCells?: number;
    fineEvaluatedCells?: number;
    fineDenseEquivalentCells?: number;
    fineReductionRatio?: number;
    corridorEdgePressure?: number;
    regionalWeakZoneCount?: number;
    expansionPasses?: number;
    peakActiveCells?: number;
    estimatedDenseBytes?: number;
  };
  confidence: {
    state: ScoreAudioAlignmentConfidence;
    score: number;
    coverage: number;
    signals: readonly string[];
  };
  runtimeSeconds?: number;
  determinismSha256: string;
}

export interface ScoreAudioAlignmentConfig {
  python: string;
  script: string;
  timeoutMs?: number;
  maxBuffer?: number;
  maxScoreBytes?: number;
  maxAudioBytes?: number;
}

export interface ScoreAudioAlignmentDependencies {
  execFile?: RunnerExecFile;
}

export interface ScoreAudioAlignmentRun {
  status: "aligned" | "partial" | "rejected" | "failed";
  report: ScoreAudioAlignmentReport | null;
  diagnostics: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;

function localPath(value: string, label: string): string | null {
  if (!value || /^(?:https?|ftp):\/\//i.test(value) || /[\0\r\n]/.test(value)) return `${label} must be a local path`;
  return null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateReport(value: unknown): value is ScoreAudioAlignmentReport {
  if (!record(value) || value.schemaVersion !== SCORE_AUDIO_ALIGNMENT_SCHEMA_VERSION
    || !record(value.candidate) || value.candidate.id !== SCORE_AUDIO_ALIGNMENT_CANDIDATE_ID
    || typeof value.candidate.fingerprint !== "string" || !record(value.candidate.config)
    || !record(value.mapping) || !Array.isArray(value.mapping.anchors)
    || !record(value.confidence) || !["ALIGNED_HIGH_CONFIDENCE", "ALIGNED_PARTIAL", "ALIGNMENT_REJECTED"].includes(value.confidence.state as string)
    || typeof value.determinismSha256 !== "string") return false;
  return value.mapping.anchors.every((anchor) => record(anchor) && finite(anchor.beat) && finite(anchor.audioSeconds));
}

function defaultRunner(): RunnerExecFile {
  return async (file, args, options: RunnerExecFileOptions) => {
    const { execFile } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      execFile(file, [...args], { shell: false, timeout: options.timeout, maxBuffer: options.maxBuffer }, (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stdout, stderr });
          reject(error);
        } else resolve({ stdout, stderr });
      });
    });
  };
}

async function boundedFile(path: string, label: string, maxBytes: number): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size <= 0) return `${label} must be a non-empty regular file`;
    if (info.size > maxBytes) return `${label} exceeds the ${maxBytes}-byte alignment limit`;
    return null;
  } catch {
    return `${label} is not readable`;
  }
}

/** Run the one frozen score→recording candidate through the existing Python runtime seam. */
export async function runScoreAudioAlignment(
  scorePath: string,
  audioPath: string,
  config: ScoreAudioAlignmentConfig,
  dependencies: ScoreAudioAlignmentDependencies = {},
): Promise<ScoreAudioAlignmentRun> {
  const diagnostics: string[] = [];
  for (const [path, label] of [[scorePath, "scorePath"], [audioPath, "audioPath"], [config.python, "python"], [config.script, "script"]] as const) {
    const reason = localPath(path, label);
    if (reason) diagnostics.push(reason);
  }
  if (diagnostics.length) return { status: "failed", report: null, diagnostics };
  const scoreLimit = config.maxScoreBytes ?? SCORE_AUDIO_ALIGNMENT_MAX_SCORE_BYTES;
  const audioLimit = config.maxAudioBytes ?? SCORE_AUDIO_ALIGNMENT_MAX_AUDIO_BYTES;
  if (!Number.isInteger(scoreLimit) || scoreLimit <= 0 || scoreLimit > SCORE_AUDIO_ALIGNMENT_MAX_SCORE_BYTES) diagnostics.push("score byte limit is invalid");
  if (!Number.isInteger(audioLimit) || audioLimit <= 0 || audioLimit > SCORE_AUDIO_ALIGNMENT_MAX_AUDIO_BYTES) diagnostics.push("audio byte limit is invalid");
  if (diagnostics.length) return { status: "failed", report: null, diagnostics };
  const scoreError = await boundedFile(scorePath, "scorePath", scoreLimit);
  const audioError = await boundedFile(audioPath, "audioPath", audioLimit);
  if (scoreError) diagnostics.push(scoreError);
  if (audioError) diagnostics.push(audioError);
  if (diagnostics.length) return { status: "failed", report: null, diagnostics };
  try {
    const runner = dependencies.execFile ?? defaultRunner();
    const result = await runner(config.python, [config.script, "--production", "--midi", scorePath, "--audio", audioPath], {
      shell: false,
      timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: config.maxBuffer ?? DEFAULT_MAX_BUFFER,
    });
    const parsed: unknown = JSON.parse(result.stdout.trim());
    if (!validateReport(parsed)) return { status: "failed", report: null, diagnostics: ["alignment runner returned an invalid report"] };
    const state = parsed.confidence.state;
    return { status: state === "ALIGNED_HIGH_CONFIDENCE" ? "aligned" : state === "ALIGNED_PARTIAL" ? "partial" : "rejected", report: parsed, diagnostics: parsed.confidence.signals };
  } catch (error) {
    const message = error instanceof Error ? error.message : "alignment runner failed";
    return { status: "failed", report: null, diagnostics: [message] };
  }
}

export function mapScoreBeatToAudioSeconds(report: ScoreAudioAlignmentReport, beat: number): number | null {
  if (!finite(beat) || !report.mapping.anchors.length) return null;
  const anchors = report.mapping.anchors;
  if (beat <= anchors[0]!.beat) return anchors[0]!.audioSeconds;
  for (const [left, right] of anchors.slice(1).map((right, index) => [anchors[index]!, right] as const)) {
    if (beat <= right.beat) {
      const span = right.beat - left.beat;
      return span > 0 ? left.audioSeconds + (right.audioSeconds - left.audioSeconds) * ((beat - left.beat) / span) : right.audioSeconds;
    }
  }
  return anchors.at(-1)!.audioSeconds;
}
