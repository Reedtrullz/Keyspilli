import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

export const AUDIO_REVIEW_SCHEMA_VERSION = 2 as const;
export const AUDIO_REVIEW_LIMITS = Object.freeze({
  maxClipBytes: 2 * 1024 * 1024,
  maxPairBytes: 4 * 1024 * 1024,
  maxClipSeconds: 30,
  maxOutputTokens: 2048,
  maxProviderCallsPerJob: 1,
  maxJobs: 300,
});

export const REVIEW_AREAS = ["melody", "harmony", "timing", "balance", "phrasing", "articulation", "render", "other"] as const;
export type ReviewArea = typeof REVIEW_AREAS[number];
export type ReviewMode = "original" | "chords";
export type ReviewProfile = "legacy" | "evidence-v2";
export type ComparisonStatus = "compared" | "abstained";
export type AttachmentName = "reference" | "candidate";
export type FindingClassification = "defect" | "uncertain" | "observation";
export type FindingSeverity = "low" | "moderate" | "high";
export type Uncertainty = "low" | "medium" | "high";

export interface AudioFilePin {
  path: string;
  sha256: string;
  bytes: number;
  sampleRate: 44_100 | 32_000;
  channels: 1;
  bitsPerSample: 16;
  durationSeconds: number;
  /** Start of this excerpt in its full reference/output WAV clock. */
  assetStartSeconds: number;
}

export interface SourceBeatAnchor {
  assetSeconds: number;
  sourceBeat: number;
}

export interface ReviewJob {
  id: string;
  mode: ReviewMode;
  phraseId: string;
  referenceClip: AudioFilePin;
  candidateClip: AudioFilePin;
  alignment: {
    status: "verified" | "unverified";
    method: "same-clock" | "anchors" | "fixture";
    evidence: { path: string; sha256: string };
    referenceAnchors: SourceBeatAnchor[];
    candidateAnchors: SourceBeatAnchor[];
  };
  /** Optional explicit link from a targeted post-repair recheck. */
  rechecksFindingId?: string;
}

export interface ReviewFinding {
  attachment: AttachmentName;
  startSeconds: number;
  endSeconds: number;
  area: ReviewArea;
  classification: FindingClassification;
  severity: FindingSeverity;
  uncertainty: Uncertainty;
  evidence: string;
  proposedRepair: string;
}

export interface DomainReview {
  summary: string;
  uncertainty: Uncertainty;
  findings: ReviewFinding[];
}

export interface EvidenceV2Review extends DomainReview {
  schemaVersion: 2;
  comparisonStatus: ComparisonStatus;
  attachments: Record<AttachmentName, {
    content: "music" | "speech" | "silence" | "unavailable" | "uncertain";
    evidence: string;
  }>;
  limitations: string[];
}

export interface ReviewManifest {
  schemaVersion: typeof AUDIO_REVIEW_SCHEMA_VERSION;
  kind: "keyspilli-audio-review-manifest";
  source: { path: string; sha256: string; format: "midi" | "musicxml" | "mxl" };
  reference: {
    asset: { path: string; sha256: string; durationSeconds: number };
    identity: { title: string; evidence: string };
  };
  phraseInventory: Array<{ id: string; kind: "opening" | "section" | "transition" | "ending" | "diagnosed"; startBeat: number; endBeat: number }>;
  replays: Record<ReviewMode, {
    difficulty: string;
    resolvedVariantId: string;
    asset: { path: string; sha256: string; durationSeconds: number };
    replaySnapshot: { path: string; sha256: string };
    noteEvents: { path: string; sha256: string };
    tempoMapSha256: string;
    sustainSha256: string;
    playbackSettingsSha256: string;
    renderer: {
      backend: string;
      version: string;
      sampleRate: number;
      channels: 1 | 2;
      gain: number;
      settingsSha256: string;
      instrument: { name: string; bankPath: string; bankSha256: string };
      evidenceClass: "sampled-piano" | "player-sampler-capture" | "synthetic-control";
    };
    symbolicChecks: {
      exactNotes: { status: "passed" | "failed" | "not-run"; path?: string; sha256?: string; reason?: string };
      playability: { status: "passed" | "failed" | "not-run"; path?: string; sha256?: string; reason?: string };
    };
  }>;
  jobs: ReviewJob[];
}

export interface AntiListenEnvelope {
  schemaVersion: 1;
  runStatus: string;
  mode: string;
  model: string;
  metadata: Record<string, unknown>;
  output_text: string;
}

export interface ValidatedListenResult {
  envelope: AntiListenEnvelope;
  review: DomainReview | EvidenceV2Review;
  findings: ReviewFinding[];
  comparisonStatus?: ComparisonStatus;
  /** The ordered receipt reports an audio submission attempt; provider listening remains unverified. */
  listeningAttestation: "unverified";
}

export interface RunState {
  schemaVersion: 1;
  reviewProfile?: ReviewProfile;
  reviewSchemaVersion?: 1 | 2;
  manifestSha256: string;
  waveformEvidenceSha256?: string;
  fingerprint: string;
  gatewayCatalogSha256?: string;
  gatewayRouteContractSha256?: string;
  maxRequests: number;
  attemptsUsed: number;
  jobs: Record<string, {
    status: "planned" | "dry-run" | "submitted" | "ambiguous" | "complete";
    attempts: 0 | 1;
    envelopeSha256?: string;
    partialStdoutSha256?: string;
    partialStderrSha256?: string;
    resolvedModel?: string;
    preflightSha256?: string;
    allowedModelIds?: string[];
    comparisonStatus?: ComparisonStatus;
  }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const SHA = /^[0-9a-f]{64}$/i;

function invariant(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function checkPathPin(value: unknown, label: string): void {
  invariant(isRecord(value) && nonempty(value.path) && isAbsolute(value.path) && !/[\0\r\n]/.test(value.path), `${label} path must be absolute and local`);
  invariant(SHA.test(String(value.sha256)), `${label} requires a SHA-256 pin`);
}

function checkSourceAnchors(anchors: unknown, label: string): asserts anchors is SourceBeatAnchor[] {
  invariant(Array.isArray(anchors) && anchors.length >= 2, `${label} requires at least two source/output time anchors`);
  let previousTime = -Infinity;
  let previousBeat = -Infinity;
  for (const [index, anchor] of anchors.entries()) {
    invariant(isRecord(anchor) && finite(anchor.assetSeconds) && finite(anchor.sourceBeat), `${label}[${index}] has invalid clock values`);
    invariant(anchor.assetSeconds >= 0 && anchor.sourceBeat >= 0 && anchor.assetSeconds > previousTime && anchor.sourceBeat > previousBeat, `${label} anchors must increase strictly in both nonnegative clocks`);
    previousTime = anchor.assetSeconds;
    previousBeat = anchor.sourceBeat;
  }
}

function validateAudioPin(value: unknown, label: string): asserts value is AudioFilePin {
  invariant(isRecord(value), `${label} must be a pinned PCM16 WAV clip`);
  checkPathPin(value, label);
  invariant(Number.isInteger(value.bytes) && Number(value.bytes) > 0 && Number(value.bytes) <= AUDIO_REVIEW_LIMITS.maxClipBytes, `${label} exceeds the 2 MiB clip limit`);
  invariant(value.channels === 1 && value.bitsPerSample === 16, `${label} must be mono PCM16`);
  invariant(value.sampleRate === 44_100 || value.sampleRate === 32_000, `${label} must be 44.1 kHz or 32 kHz`);
  invariant(finite(value.durationSeconds) && value.durationSeconds > 0 && value.durationSeconds <= AUDIO_REVIEW_LIMITS.maxClipSeconds, `${label} must be at most 30 seconds`);
  invariant(finite(value.assetStartSeconds) && value.assetStartSeconds >= 0, `${label} requires a nonnegative full-asset start time`);
}

function validateReplay(value: unknown, mode: ReviewMode): asserts value is ReviewManifest["replays"][ReviewMode] {
  invariant(isRecord(value), `${mode} must pin its resolved replay and render settings`);
  invariant(nonempty(value.difficulty) && nonempty(value.resolvedVariantId), `${mode} must pin selected difficulty and resolved variant`);
  invariant(isRecord(value.asset), `${mode} replay audio pin is missing`);
  checkPathPin(value.asset, `${mode} replay audio`);
  invariant(finite(value.asset.durationSeconds) && value.asset.durationSeconds > 0, `${mode} replay audio requires a duration`);
  checkPathPin(value.replaySnapshot, `${mode} resolved replay snapshot`);
  checkPathPin(value.noteEvents, `${mode} note events`);
  for (const key of ["tempoMapSha256", "sustainSha256", "playbackSettingsSha256"] as const) invariant(SHA.test(String(value[key])), `${mode} must pin ${key}`);
  const renderer = value.renderer;
  invariant(isRecord(renderer) && nonempty(renderer.backend) && nonempty(renderer.version), `${mode} must identify the renderer and version`);
  invariant(finite(renderer.sampleRate) && [32_000, 44_100, 48_000].includes(renderer.sampleRate) && (renderer.channels === 1 || renderer.channels === 2), `${mode} has invalid renderer format`);
  invariant(finite(renderer.gain) && renderer.gain > 0 && renderer.gain <= 4 && SHA.test(String(renderer.settingsSha256)), `${mode} must pin gain and render settings`);
  invariant(isRecord(renderer.instrument) && nonempty(renderer.instrument.name) && nonempty(renderer.instrument.bankPath) && isAbsolute(renderer.instrument.bankPath) && SHA.test(String(renderer.instrument.bankSha256)), `${mode} must pin the actual instrument bank`);
  invariant(["sampled-piano", "player-sampler-capture", "synthetic-control"].includes(String(renderer.evidenceClass)), `${mode} renderer evidence class is invalid`);
  invariant(isRecord(value.symbolicChecks), `${mode} requires a separate symbolic-check lane`);
  for (const key of ["exactNotes", "playability"] as const) {
    const check = value.symbolicChecks[key];
    invariant(isRecord(check) && ["passed", "failed", "not-run"].includes(String(check.status)), `${mode} ${key} check has invalid status`);
    if (check.status === "passed" || check.status === "failed") {
      checkPathPin(check, `${mode} ${key} evidence`);
    }
  }
}

export function validateReviewManifest(value: unknown): ReviewManifest {
  invariant(isRecord(value) && value.schemaVersion === AUDIO_REVIEW_SCHEMA_VERSION && value.kind === "keyspilli-audio-review-manifest", "audio review requires schemaVersion 2 pairwise manifest");
  invariant(isRecord(value.source), "source arrangement pin is required");
  checkPathPin(value.source, "source arrangement");
  invariant(["midi", "musicxml", "mxl"].includes(String(value.source.format)), "source format must be MIDI or MusicXML");
  invariant(isRecord(value.reference) && isRecord(value.reference.asset) && isRecord(value.reference.identity), "reference asset identity and audio pin are required");
  checkPathPin(value.reference.asset, "reference audio asset");
  invariant(finite(value.reference.asset.durationSeconds) && value.reference.asset.durationSeconds > 0, "reference audio needs a valid duration");
  invariant(nonempty(value.reference.identity.title) && nonempty(value.reference.identity.evidence), "reference identity needs its source evidence");
  invariant(Array.isArray(value.phraseInventory) && value.phraseInventory.length > 0, "phrase inventory is required");
  const phrases = new Map<string, { startBeat: number; endBeat: number }>();
  for (const [index, phrase] of value.phraseInventory.entries()) {
    invariant(isRecord(phrase) && nonempty(phrase.id) && ["opening", "section", "transition", "ending", "diagnosed"].includes(String(phrase.kind)), `phraseInventory[${index}] is invalid`);
    invariant(finite(phrase.startBeat) && finite(phrase.endBeat) && phrase.startBeat >= 0 && phrase.endBeat > phrase.startBeat, `phraseInventory[${index}] needs an increasing beat interval`);
    invariant(!phrases.has(phrase.id), `duplicate phrase id ${phrase.id}`);
    phrases.set(phrase.id, { startBeat: phrase.startBeat, endBeat: phrase.endBeat });
  }
  invariant(isRecord(value.replays), "resolved Original and Chords replays are required");
  validateReplay(value.replays.original, "original");
  validateReplay(value.replays.chords, "chords");
  invariant(Array.isArray(value.jobs) && value.jobs.length > 0 && value.jobs.length <= AUDIO_REVIEW_LIMITS.maxJobs, "job inventory is empty or exceeds its limit");
  const ids = new Set<string>();
  const phraseModes = new Set<string>();
  for (const [index, candidate] of value.jobs.entries()) {
    invariant(isRecord(candidate) && nonempty(candidate.id) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(candidate.id) && (candidate.mode === "original" || candidate.mode === "chords"), `jobs[${index}] must have a safe id and name one mode`);
    invariant(!ids.has(candidate.id), `duplicate job id ${candidate.id}`);
    ids.add(candidate.id);
    invariant(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(candidate.phraseId)) && phrases.has(String(candidate.phraseId)), `job ${candidate.id} references an unknown or unsafe phrase`);
    const pairKey = `${candidate.mode}:${candidate.phraseId}`;
    invariant(!phraseModes.has(pairKey), `duplicate ${candidate.mode} coverage for phrase ${candidate.phraseId}`);
    phraseModes.add(pairKey);
    validateAudioPin(candidate.referenceClip, `job ${candidate.id} reference clip`);
    validateAudioPin(candidate.candidateClip, `job ${candidate.id} candidate clip`);
    invariant(candidate.referenceClip.bytes + candidate.candidateClip.bytes <= AUDIO_REVIEW_LIMITS.maxPairBytes, `job ${candidate.id} exceeds the 4 MiB pair limit`);
    invariant(isRecord(candidate.alignment) && ["verified", "unverified"].includes(String(candidate.alignment.status)) && ["same-clock", "anchors", "fixture"].includes(String(candidate.alignment.method)), `job ${candidate.id} alignment state is invalid`);
    checkPathPin(candidate.alignment.evidence, `job ${candidate.id} alignment receipt`);
    checkSourceAnchors(candidate.alignment.referenceAnchors, `job ${candidate.id} reference/source`);
    checkSourceAnchors(candidate.alignment.candidateAnchors, `job ${candidate.id} output/source`);
    for (const [attachment, clipValue, anchors] of [
      ["reference", candidate.referenceClip, candidate.alignment.referenceAnchors],
      ["candidate", candidate.candidateClip, candidate.alignment.candidateAnchors],
    ] as const) {
      const start = Number(clipValue.assetStartSeconds);
      const end = start + Number(clipValue.durationSeconds);
      invariant(anchors[0]!.assetSeconds <= start && anchors.at(-1)!.assetSeconds >= end, `job ${candidate.id} ${attachment} anchors must cover the complete clip`);
    }
    if (candidate.rechecksFindingId !== undefined) invariant(nonempty(candidate.rechecksFindingId), `job ${candidate.id} recheck finding id is invalid`);
  }
  return value as unknown as ReviewManifest;
}

export interface WavInfo {
  bytes: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationSeconds: number;
  sha256: string;
  rmsNormalized: number;
  peakNormalized: number;
  digitalSilence: boolean;
  nearSilence: boolean;
  clippedSampleCount: number;
  onsetEstimateSeconds: number[];
  lowLevelSpans: Array<{ startSeconds: number; endSeconds: number }>;
  config: typeof PCM_WAVEFORM_ANALYSIS_CONFIG;
  analysisConfigSha256: string;
}

export async function readPinnedAudioBytes(pin: AudioFilePin): Promise<Buffer> {
  const handle = await open(pin.path, "r");
  try {
    const before = await handle.stat({ bigint: true });
    invariant(before.isFile(), `pinned WAV is not a regular file: ${pin.path}`);
    invariant(before.size === BigInt(pin.bytes), `pinned WAV byte count changed: ${pin.path}`);
    const buffer = Buffer.alloc(pin.bytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    invariant(before.dev === after.dev && before.ino === after.ino && before.size === after.size
      && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs,
    `pinned WAV changed while it was being read: ${pin.path}`);
    invariant(offset === pin.bytes, `pinned WAV byte count changed while reading: ${pin.path}`);
    const bytes = buffer.subarray(0, pin.bytes);
    invariant(createHash("sha256").update(bytes).digest("hex") === pin.sha256.toLowerCase(), `pinned WAV hash changed: ${pin.path}`);
    return bytes;
  } finally { await handle.close(); }
}

export const PCM_WAVEFORM_ANALYSIS_CONFIG = Object.freeze({
  version: 1,
  normalizationDivisor: 32_768,
  nearSilenceRmsMax: 0.001,
  nearSilencePeakMax: 0.003,
  clippingRailSamples: [-32_768, 32_767] as const,
  frameMilliseconds: 20,
  hopMilliseconds: 10,
  lowLevelRmsThreshold: 0.001,
  onsetFloorRms: 0.0001,
  onsetRelativeThreshold: 0.2,
  onsetMinGapMilliseconds: 80,
  maxOnsets: 256,
  maxLowLevelSpans: 64,
});

function parsePcm16Wav(bytes: Uint8Array) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  invariant(data.length >= 44 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WAVE", "audio clip is not a RIFF/WAVE file");
  invariant(data.readUInt32LE(4) === data.length - 8, "WAV RIFF length does not match captured bytes");
  let offset = 12;
  let format: number | undefined;
  let channels: number | undefined;
  let sampleRate: number | undefined;
  let byteRate: number | undefined;
  let blockAlign: number | undefined;
  let bits: number | undefined;
  let dataOffset: number | undefined;
  let dataBytes: number | undefined;
  while (offset < data.length) {
    invariant(offset + 8 <= data.length, "WAV chunk header is truncated");
    const name = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const body = offset + 8;
    const next = body + size + (size % 2);
    invariant(body + size <= data.length && next <= data.length, `WAV ${name} chunk is truncated`);
    if (name === "fmt ") {
      invariant(format === undefined && size >= 16, "WAV fmt chunk is missing, duplicated, or too short");
      format = data.readUInt16LE(body);
      channels = data.readUInt16LE(body + 2);
      sampleRate = data.readUInt32LE(body + 4);
      byteRate = data.readUInt32LE(body + 8);
      blockAlign = data.readUInt16LE(body + 12);
      bits = data.readUInt16LE(body + 14);
    } else if (name === "data") {
      invariant(dataOffset === undefined, "WAV contains multiple data chunks");
      dataOffset = body;
      dataBytes = size;
    }
    offset = next;
  }
  invariant(format === 1 && channels === 1 && bits === 16 && (sampleRate === 44_100 || sampleRate === 32_000), "audio must be mono 16-bit PCM at 44.1 or 32 kHz");
  invariant(blockAlign === 2 && byteRate === sampleRate * blockAlign, "WAV PCM alignment or byte rate is invalid");
  invariant(dataOffset !== undefined && dataBytes !== undefined && dataBytes > 0 && dataBytes % blockAlign === 0, "WAV must contain aligned nonempty PCM data");
  return { data, sampleRate, channels, bits, blockAlign, dataOffset, dataBytes };
}

export function inspectPcm16Wav(bytes: Uint8Array): WavInfo {
  const parsed = parsePcm16Wav(bytes);
  const { data, sampleRate, blockAlign, dataOffset, dataBytes } = parsed;
  const sampleCount = dataBytes / blockAlign;
  const config = PCM_WAVEFORM_ANALYSIS_CONFIG;
  const frameSize = Math.max(1, Math.round(sampleRate * config.frameMilliseconds / 1_000));
  const hopSize = Math.max(1, Math.round(sampleRate * config.hopMilliseconds / 1_000));
  const sampleAt = (index: number) => data.readInt16LE(dataOffset + index * blockAlign);
  let squareSum = 0;
  let peak = 0;
  let clippedSampleCount = 0;
  let digitalSilence = true;
  for (let i = 0; i < sampleCount; i++) {
    const sample = sampleAt(i);
    const absolute = Math.abs(sample);
    digitalSilence &&= sample === 0;
    if (absolute > peak) peak = absolute;
    if (sample === config.clippingRailSamples[0] || sample === config.clippingRailSamples[1]) clippedSampleCount++;
    squareSum += sample * sample;
  }
  const rmsNormalized = Math.sqrt(squareSum / sampleCount) / config.normalizationDivisor;
  const peakNormalized = peak / config.normalizationDivisor;
  let frameSquares = 0;
  for (let i = 0; i < Math.min(frameSize, sampleCount); i++) frameSquares += sampleAt(i) ** 2;
  let maxFrameRms = 0;
  for (let start = 0; start < sampleCount; start += hopSize) {
    const end = Math.min(start + frameSize, sampleCount);
    const frameRms = Math.sqrt(frameSquares / (end - start)) / config.normalizationDivisor;
    if (frameRms > maxFrameRms) maxFrameRms = frameRms;
    const nextStart = start + hopSize;
    const nextEnd = Math.min(nextStart + frameSize, sampleCount);
    for (let i = start; i < Math.min(nextStart, sampleCount); i++) frameSquares -= sampleAt(i) ** 2;
    for (let i = end; i < nextEnd; i++) frameSquares += sampleAt(i) ** 2;
  }
  frameSquares = 0;
  for (let i = 0; i < Math.min(frameSize, sampleCount); i++) frameSquares += sampleAt(i) ** 2;
  const onsetThreshold = Math.max(config.onsetFloorRms, maxFrameRms * config.onsetRelativeThreshold);
  const onsetEstimateSeconds: number[] = [];
  const lowLevelSpans: Array<{ startSeconds: number; endSeconds: number }> = [];
  let previousAbove = false;
  let lowStart: number | null = null;
  const minGapSeconds = config.onsetMinGapMilliseconds / 1_000;
  for (let start = 0, frameIndex = 0; start < sampleCount; start += hopSize, frameIndex++) {
    const end = Math.min(start + frameSize, sampleCount);
    const frameRms = Math.sqrt(frameSquares / (end - start)) / config.normalizationDivisor;
    const above = frameRms >= onsetThreshold;
    if (above && !previousAbove && onsetEstimateSeconds.length < config.maxOnsets) {
      const estimate = frameIndex === 0 ? 0 : (start + Math.floor(frameSize / 2)) / sampleRate;
      if (!onsetEstimateSeconds.length || estimate - onsetEstimateSeconds.at(-1)! >= minGapSeconds) onsetEstimateSeconds.push(estimate);
    }
    previousAbove = above;
    const quiet = frameRms < config.lowLevelRmsThreshold;
    if (quiet && lowStart === null) lowStart = start / sampleRate;
    if (!quiet && lowStart !== null) {
      if (lowLevelSpans.length < config.maxLowLevelSpans) lowLevelSpans.push({ startSeconds: lowStart, endSeconds: start / sampleRate });
      lowStart = null;
    }
    const nextStart = start + hopSize;
    const nextEnd = Math.min(nextStart + frameSize, sampleCount);
    for (let i = start; i < Math.min(nextStart, sampleCount); i++) frameSquares -= sampleAt(i) ** 2;
    for (let i = end; i < nextEnd; i++) frameSquares += sampleAt(i) ** 2;
  }
  if (lowStart !== null && lowLevelSpans.length < config.maxLowLevelSpans) lowLevelSpans.push({ startSeconds: lowStart, endSeconds: sampleCount / sampleRate });
  const analysisConfigSha256 = sha256Text(stableJson(config));
  return {
    bytes: data.length, sampleRate, channels: parsed.channels, bitsPerSample: parsed.bits,
    durationSeconds: dataBytes / (sampleRate * parsed.channels * blockAlign),
    sha256: createHash("sha256").update(data).digest("hex"),
    rmsNormalized, peakNormalized, digitalSilence,
    nearSilence: rmsNormalized <= config.nearSilenceRmsMax && peakNormalized <= config.nearSilencePeakMax,
    clippedSampleCount, onsetEstimateSeconds, lowLevelSpans, config, analysisConfigSha256,
  };
}

async function sha256File(path: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", chunk => hash.update(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function validateManifestFiles(manifestValue: unknown): Promise<ReviewManifest> {
  const manifest = validateReviewManifest(manifestValue);
  const pins = new Map<string, string>();
  const add = (pin: { path: string; sha256: string }) => {
    const existing = pins.get(pin.path);
    invariant(existing === undefined || existing === pin.sha256, `conflicting hashes for ${pin.path}`);
    pins.set(pin.path, pin.sha256);
  };
  add(manifest.source);
  add(manifest.reference.asset);
  for (const mode of ["original", "chords"] as const) {
    const replay = manifest.replays[mode];
    add(replay.asset);
    add(replay.replaySnapshot);
    add(replay.noteEvents);
    add({ path: replay.renderer.instrument.bankPath, sha256: replay.renderer.instrument.bankSha256 });
    for (const check of [replay.symbolicChecks.exactNotes, replay.symbolicChecks.playability]) if (check.path && check.sha256) add({ path: check.path, sha256: check.sha256 });
  }
  for (const job of manifest.jobs) {
    add(job.referenceClip);
    add(job.candidateClip);
    add(job.alignment.evidence);
  }
  for (const [path, expected] of pins) {
    const info = await stat(path);
    invariant(info.isFile(), `${path} must be a regular file`);
    invariant((await sha256File(path)).toLowerCase() === expected.toLowerCase(), `stale pin: ${path} changed`);
  }
  const clips = new Map<string, AudioFilePin>();
  for (const job of manifest.jobs) {
    clips.set(job.referenceClip.path, job.referenceClip);
    clips.set(job.candidateClip.path, job.candidateClip);
  }
  for (const [path, clip] of clips) {
    const bytes = await readPinnedAudioBytes({ ...clip, path });
    const wav = inspectPcm16Wav(bytes);
    invariant(wav.bytes === clip.bytes && wav.sampleRate === clip.sampleRate && wav.channels === clip.channels && wav.bitsPerSample === clip.bitsPerSample, `WAV metadata pin mismatch: ${path}`);
    invariant(Math.abs(wav.durationSeconds - clip.durationSeconds) <= 0.002, `WAV duration pin mismatch: ${path}`);
  }
  return manifest;
}

export function buildReviewPrompt(job: ReviewJob): string {
  const focus = job.mode === "original"
    ? "Assess whether the candidate's main contour, phrase entrances, rests, bass support, rhythm, articulation, and ending remain coherent and recognizable against the reference."
    : "Assess whether candidate harmonic changes and bass support arrive usefully, attacks and releases leave room for singing, and any copied lead material crowds the backing. Do not label every non-chord tone a defect; passing notes and suspensions can be intentional."
  return [
    "Compare the two attached piano excerpts labeled REFERENCE and CANDIDATE. Treat attachment order and labels as the only identity information; do not infer correctness from filenames or outside context.",
    focus,
    "Return exactly one JSON object with keys summary, uncertainty, findings. uncertainty is low|medium|high. findings is an array of {attachment: reference|candidate, startSeconds, endSeconds, area: melody|harmony|timing|balance|phrasing|articulation|render|other, classification: defect|uncertain|observation, severity: low|moderate|high, uncertainty: low|medium|high, evidence, proposedRepair}. Timestamps are local to the named attached clip. Keep findings concise and specific. Do not guess exact notes or source timestamps. Say when evidence is unclear. Empty findings means only that no defect was detected in this pair; it is not approval.",
  ].join("\n\n");
}

export function buildEvidenceV2ReviewPrompt(job: ReviewJob): string {
  const focus = job.mode === "original"
    ? "After establishing that both attachments contain music, assess whether the candidate's main contour, phrase entrances, rests, bass support, rhythm, articulation, and ending remain coherent and recognizable against the reference."
    : "After establishing that both attachments contain music, assess whether candidate harmonic changes and bass support arrive usefully, attacks and releases leave room for singing, and any copied lead material crowds the backing. Do not label every non-chord tone a defect; passing notes and suspensions can be intentional.";
  return [
    "Inspect the audio actually present in the two ordered attachments labeled REFERENCE and CANDIDATE. Do not assume either attachment is available, audible, music, or piano. First characterize each attachment separately from directly observed content. Abstain when either input is missing, unavailable, uncertain, silence, speech, or otherwise insufficient for a musical comparison. Apply the mode-specific musical focus only after both attachments are observed to contain music.",
    focus,
    "Return exactly one JSON object with keys schemaVersion=2, comparisonStatus, attachments, summary, uncertainty, limitations, findings. Set comparisonStatus to compared|abstained. attachments has reference and candidate objects, each with content=music|speech|silence|unavailable|uncertain and concise evidence of directly observed content. Compared requires both attachments to contain music, nonempty evidence for each, and nonempty limitations. Abstained requires uncertainty=high, nonempty limitations, and findings=[]. Findings use {attachment: reference|candidate, startSeconds, endSeconds, area: melody|harmony|timing|balance|phrasing|articulation|render|other, classification: defect|uncertain|observation, severity: low|moderate|high, uncertainty: low|medium|high, evidence, proposedRepair}. Timestamps are local to the named attachment. Keep evidence concise and specific; do not guess exact notes or source timestamps. A provider self-report does not establish audio grounding or prove that it heard the audio. Empty findings do not imply comparison or approval.",
  ].join("\n\n");
}

export interface AntiCommandInput {
  python: string;
  antiScript: string;
  baseUrl: string;
  model: string;
  referenceAudio: string;
  candidateAudio: string;
  promptFile: string;
  dryRun: boolean;
}

export function buildAntiListenArgs(input: AntiCommandInput): string[] {
  for (const [path, label] of [[input.python, "Python"], [input.antiScript, "anti.py"], [input.referenceAudio, "reference audio"], [input.candidateAudio, "candidate audio"], [input.promptFile, "prompt"]] as const) {
    invariant(isAbsolute(path) && !/[\0\r\n]/.test(path), `${label} path must be absolute and local`);
  }
  invariant(nonempty(input.model), "an explicit Anti model is required");
  const base = new URL(input.baseUrl);
  invariant(["http:", "https:"].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash, "base URL must not embed credentials or query parameters");
  const args = [
    input.antiScript, "listen",
    "--base-url", input.baseUrl,
    "--model", input.model,
    "--audio", input.referenceAudio,
    "--audio", input.candidateAudio,
    "--probe-unverified-audio",
    "--max-calls", "1",
    "--retry", "0",
    "--fallback-policy", "never",
    "--max-output-tokens", String(AUDIO_REVIEW_LIMITS.maxOutputTokens),
    "--max-total-output-tokens", String(AUDIO_REVIEW_LIMITS.maxOutputTokens),
    "--run-timeout", "90",
    "--timeout", "90",
    "--no-pre-read",
    "--prompt-file", input.promptFile,
    "--save-output", "never",
    "--no-progress",
    "--json",
  ];
  if (input.dryRun) args.push("--dry-run");
  return args;
}

function extractFirstJson(stdout: string): { value: unknown; prefix: string; rest: string } {
  const start = stdout.indexOf("{");
  invariant(start >= 0, "Anti did not emit JSON on stdout");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < stdout.length; i++) {
    const char = stdout[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        let value: unknown;
        try { value = JSON.parse(stdout.slice(start, i + 1)); }
        catch { throw new Error("Anti emitted malformed JSON"); }
        return { value, prefix: stdout.slice(0, start), rest: stdout.slice(i + 1) };
      }
    }
  }
  throw new Error("Anti JSON output is truncated");
}

export function parseAntiLiveStdout(stdout: string): unknown {
  const extracted = extractFirstJson(stdout);
  invariant(!extracted.prefix.trim() && !extracted.rest.trim(), "Anti live stdout must contain exactly one JSON envelope and whitespace");
  return extracted.value;
}

export function parseAntiDryRunStdout(stdout: string, expectedPrompt: string): unknown {
  const extracted = extractFirstJson(stdout);
  invariant(!extracted.prefix.trim(), "Anti dry-run stdout contains text before its JSON receipt");
  invariant(extracted.rest.trim() === expectedPrompt.trim(), "Anti dry-run stdout may append only the exact submitted prompt after its JSON receipt");
  return extracted.value;
}

export interface GatewayAudioRoutePin {
  routeContractSha256: string;
  canonicalModel: string;
  backendAttemptLimit: 1;
  allowedModelIds: string[];
}

const GATEWAY_AUDIO_CONTRACT_FIELDS = [
  "version", "transport_supported", "format", "content_type", "backend_acceptance",
  "requires_probe_opt_in", "streaming", "backend_attempt_limit", "max_files",
  "max_file_bytes", "max_total_bytes", "max_duration_seconds",
] as const;

/** Hash only stable route semantics from the full catalog; omit generated timestamps and display metadata. */
export function gatewayAudioRouteCatalogContractSha256(value: unknown): string {
  invariant(isRecord(value), "gateway model catalog is malformed");
  const models = Array.isArray(value.models) ? value.models : Array.isArray(value.data) ? value.data : null;
  invariant(models && models.length > 0, "gateway model catalog has no model inventory");
  const projection = models.map(candidate => {
    invariant(isRecord(candidate), "gateway model catalog contains a malformed model row");
    const capabilities = isRecord(candidate.capabilities) ? candidate.capabilities : {};
    const identity = [candidate.id, candidate.slug, candidate.canonical_id]
      .filter((item): item is string => typeof item === "string" && item.length > 0);
    invariant(identity.length > 0, "gateway model catalog row has no stable model identity");
    const aliases = [...new Set([
      candidate.alias_of,
      ...(Array.isArray(candidate.aliases) ? candidate.aliases : []),
      ...(Array.isArray(capabilities.aliases) ? capabilities.aliases : []),
    ].filter((item): item is string => typeof item === "string" && item.length > 0))].sort();
    const routingIdentity = capabilities.routing_identity;
    const audio = isRecord(capabilities.audio_input) ? capabilities.audio_input : null;
    return {
      id: typeof candidate.id === "string" ? candidate.id : null,
      slug: typeof candidate.slug === "string" ? candidate.slug : null,
      canonicalModel: typeof capabilities.canonical_id === "string" ? capabilities.canonical_id
        : typeof candidate.canonical_id === "string" ? candidate.canonical_id : null,
      backendModel: typeof capabilities.backend_id === "string" ? capabilities.backend_id : null,
      aliases,
      audioInput: audio ? Object.fromEntries(GATEWAY_AUDIO_CONTRACT_FIELDS.map(key => [key, audio[key]])) : null,
      routingIdentity: isRecord(routingIdentity) ? {
        version: routingIdentity.version ?? null,
        sha256: routingIdentity.sha256 ?? null,
      } : null,
    };
  }).sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  return sha256Text(stableJson({ models: projection }));
}

export function validateGatewayAudioRouteCatalog(
  value: unknown,
  expected: { model: string; resolvedModel: string; audioBytes: readonly [number, number]; audioDurations: readonly [number, number] },
): GatewayAudioRoutePin {
  invariant(isRecord(value), "gateway model catalog is malformed");
  const models = Array.isArray(value.models) ? value.models : Array.isArray(value.data) ? value.data : null;
  invariant(models && models.length > 0, "gateway model catalog has no model inventory");
  const selected = models.find(candidate => {
    if (!isRecord(candidate)) return false;
    const capabilities = isRecord(candidate.capabilities) ? candidate.capabilities : {};
    const names = [candidate.id, candidate.slug, candidate.canonical_id, candidate.alias_of, capabilities.canonical_id, capabilities.backend_id,
      ...(Array.isArray(candidate.aliases) ? candidate.aliases : []), ...(Array.isArray(capabilities.aliases) ? capabilities.aliases : [])];
    return names.includes(expected.resolvedModel);
  });
  invariant(isRecord(selected), `gateway catalog does not resolve the selected route ${expected.resolvedModel}`);
  const capabilities = isRecord(selected.capabilities) ? selected.capabilities : {};
  const audio = capabilities.audio_input;
  invariant(isRecord(audio)
    && audio.version === 1
    && audio.transport_supported === true
    && audio.format === "pcm_wav"
    && audio.content_type === "antigravity_audio"
    && audio.backend_acceptance === "unverified"
    && audio.requires_probe_opt_in === true
    && audio.streaming === false,
  "gateway route does not declare the supported experimental PCM-WAV listen contract");
  invariant(Number.isInteger(audio.backend_attempt_limit) && audio.backend_attempt_limit === 1, "gateway route must enforce a single backend attempt");
  const requiredBytes = Math.max(...expected.audioBytes);
  const requiredTotalBytes = expected.audioBytes[0] + expected.audioBytes[1];
  const requiredDuration = Math.max(...expected.audioDurations);
  invariant(typeof audio.max_files === "number" && Number.isInteger(audio.max_files) && audio.max_files >= 2
    && typeof audio.max_file_bytes === "number" && Number.isInteger(audio.max_file_bytes) && audio.max_file_bytes >= requiredBytes
    && typeof audio.max_total_bytes === "number" && Number.isInteger(audio.max_total_bytes) && audio.max_total_bytes >= requiredTotalBytes
    && finite(audio.max_duration_seconds) && audio.max_duration_seconds >= requiredDuration,
  "gateway route audio limits do not cover the pinned two-clip job");
  const canonicalModel = typeof capabilities.canonical_id === "string" ? capabilities.canonical_id
    : typeof selected.canonical_id === "string" ? selected.canonical_id : expected.resolvedModel;
  const allowedModelIds = [...new Set([
    selected.id, selected.slug, selected.canonical_id, selected.alias_of,
    capabilities.canonical_id, capabilities.backend_id,
    ...(Array.isArray(selected.aliases) ? selected.aliases : []),
    ...(Array.isArray(capabilities.aliases) ? capabilities.aliases : []),
  ].filter((item): item is string => typeof item === "string" && item.length > 0))];
  invariant(allowedModelIds.includes(expected.resolvedModel), "gateway model identity does not include the locally resolved explicit route");
  invariant(allowedModelIds.includes(expected.model), "gateway selected route does not include the explicitly requested model");
  invariant(allowedModelIds.includes(canonicalModel), "gateway canonical model id is absent from its own alias set");
  const routingIdentity = capabilities.routing_identity;
  const routeProjection = {
    selectedModel: expected.resolvedModel,
    id: typeof selected.id === "string" ? selected.id : null,
    slug: typeof selected.slug === "string" ? selected.slug : null,
    modelCanonicalId: typeof selected.canonical_id === "string" ? selected.canonical_id : null,
    aliasOf: typeof selected.alias_of === "string" ? selected.alias_of : null,
    canonicalModel,
    backendModel: typeof capabilities.backend_id === "string" ? capabilities.backend_id : null,
    aliases: allowedModelIds.filter(item => item !== canonicalModel && item !== capabilities.backend_id).sort(),
    routingIdentity: isRecord(routingIdentity) ? {
      version: routingIdentity.version ?? null,
      sha256: routingIdentity.sha256 ?? null,
    } : null,
    audioInput: Object.fromEntries(GATEWAY_AUDIO_CONTRACT_FIELDS.map(key => [key, audio[key]])),
  };
  return { routeContractSha256: sha256Text(stableJson(routeProjection)), canonicalModel, backendAttemptLimit: 1, allowedModelIds };
}

export function validateAudioMediaReceipt(
  value: unknown,
  expected: { audioHashes: readonly [string, string]; audioBytes?: readonly [number, number]; gatewayAttempts: 0 | 1 },
) {
  invariant(isRecord(value) && value.kind === "audio", "Anti media receipt must identify kind=audio");
  invariant(value.captured_count === 2, "Anti media receipt must attest exactly two captured clips");
  invariant(value.gateway_attempts === expected.gatewayAttempts, `Anti media receipt must attest ${expected.gatewayAttempts} gateway attempt(s)`);
  invariant(value.status === (expected.gatewayAttempts === 0 ? "not_sent" : "attempted"), "Anti media receipt has a missing or contradictory submission status");
  invariant(value.provider_audio_acceptance === "unverified" && value.listening_verification === "not_run", "Anti media receipt must leave provider listening unverified");
  invariant(Array.isArray(value.audio) && value.audio.length === 2, "Anti media receipt must contain exactly two ordered audio descriptors");
  for (const [index, descriptorValue] of value.audio.entries()) {
    invariant(isRecord(descriptorValue) && descriptorValue.index === index + 1 && descriptorValue.sha256 === expected.audioHashes[index], `Anti media receipt clip ${index + 1} is missing, reordered, or has a different SHA-256`);
    invariant(!expected.audioBytes || descriptorValue.bytes === expected.audioBytes[index], `Anti media receipt clip ${index + 1} byte count does not match the pinned WAV`);
  }
  return value;
}

function validFinding(value: unknown, durations: Record<AttachmentName, number>, index: number): asserts value is ReviewFinding {
  invariant(isRecord(value), `finding ${index} must be an object`);
  invariant(value.attachment === "reference" || value.attachment === "candidate", `finding ${index} has invalid attachment`);
  invariant(finite(value.startSeconds) && finite(value.endSeconds) && value.startSeconds >= 0 && value.endSeconds > value.startSeconds && value.endSeconds <= durations[value.attachment], `finding ${index} has an invalid timestamp interval`);
  invariant(REVIEW_AREAS.includes(value.area as ReviewArea), `finding ${index} has an invalid area`);
  invariant(["defect", "uncertain", "observation"].includes(String(value.classification)), `finding ${index} has an invalid classification`);
  invariant(["low", "moderate", "high"].includes(String(value.severity)), `finding ${index} has an invalid severity`);
  invariant(["low", "medium", "high"].includes(String(value.uncertainty)), `finding ${index} has invalid uncertainty`);
  invariant(nonempty(value.evidence) && nonempty(value.proposedRepair), `finding ${index} must include audible evidence and a small repair/check suggestion`);
}

function parseDomainReviewOutput(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```json[ \t]*\r?\n([\s\S]*?)\r?\n```$/);
  const source = fenced ? fenced[1]!.trim() : trimmed;
  try { return JSON.parse(source); }
  catch { throw new Error("Anti output_text must be bare JSON or one complete json code fence"); }
}

export function validateListenEnvelope(
  raw: unknown,
  expected: { model: string; resolvedModel: string; allowedModelIds: readonly string[]; mode: ReviewMode; durations: Record<AttachmentName, number>; expectedAudioHashes: readonly [string, string]; expectedAudioBytes?: readonly [number, number]; reviewProfile?: ReviewProfile },
): ValidatedListenResult {
  invariant(isRecord(raw) && raw.schemaVersion === 1, "Anti returned an unsupported or malformed JSON envelope");
  invariant(raw.mode === "listen", "Anti response mode is not listen");
  invariant(raw.runStatus === "success", "Anti listen response is incomplete or unsuccessful");
  invariant(nonempty(raw.model), "Anti response does not identify the effective model");
  invariant(isRecord(raw.metadata), "Anti response metadata is missing");
  invariant(raw.metadata.result_quality === "complete", "Anti did not affirmatively mark the listen result complete");
  const incompleteStatuses = new Set(["partial", "incomplete", "failed", "error", "truncated", "interrupted"]);
  for (const [label, value] of [
    ["top-level scopeStatus", raw.scopeStatus],
    ["metadata status", raw.metadata.status],
    ["metadata runStatus", raw.metadata.runStatus],
    ["metadata scopeStatus", raw.metadata.scopeStatus],
    ["metadata scope_status", raw.metadata.scope_status],
  ] as const) invariant(typeof value !== "string" || !incompleteStatuses.has(value.toLowerCase()), `Anti marked the listen result ${label}=${value}`);
  const requested = raw.metadata.requested_model ?? raw.metadata.requestedModel;
  const actual = raw.metadata.actual_model ?? raw.metadata.actualModel;
  invariant(requested === undefined || requested === expected.model || requested === expected.resolvedModel, "Anti requested a model different from the explicit route and its resolved alias");
  invariant(expected.allowedModelIds.includes(expected.resolvedModel), "selected route is missing its gateway catalog allowlist");
  invariant(expected.allowedModelIds.includes(raw.model), "Anti effective model is outside the selected gateway route's canonical aliases");
  invariant(actual === undefined || (actual === raw.model && expected.allowedModelIds.includes(actual)), "Anti actual_model metadata disagrees with the selected route allowlist");
  for (const key of ["fallback_used", "fallbackUsed", "fallback_attempted", "fallbackAttempted"] as const) {
    invariant(raw.metadata[key] !== true, `Anti metadata reports ${key}; fallback is disabled for this adapter`);
  }
  const fallbackChain = raw.metadata.fallback_chain ?? raw.metadata.fallbackChain;
  if (fallbackChain !== undefined) {
    invariant(Array.isArray(fallbackChain) && fallbackChain.length <= 1 && fallbackChain.every(item => item === expected.model || item === expected.resolvedModel || expected.allowedModelIds.includes(String(item))), "Anti metadata reports an unexpected fallback/model chain");
  }
  const mediaCoverage = raw.metadata.media_coverage;
  validateAudioMediaReceipt(mediaCoverage, { audioHashes: expected.expectedAudioHashes, audioBytes: expected.expectedAudioBytes, gatewayAttempts: 1 });
  invariant(nonempty(raw.output_text) && raw.output_text.length <= 120_000, "Anti output_text is missing or exceeds the response limit");
  const decoded = parseDomainReviewOutput(raw.output_text);
  const profile = expected.reviewProfile ?? "legacy";
  invariant(profile === "legacy" || profile === "evidence-v2", `unsupported review profile ${String(profile)}`);
  if (profile === "evidence-v2") return validateEvidenceV2ListenResult(raw, decoded, expected);
  invariant(isRecord(decoded) && nonempty(decoded.summary) && ["low", "medium", "high"].includes(String(decoded.uncertainty)) && Array.isArray(decoded.findings), "musical review JSON is missing summary, uncertainty, or findings");
  invariant(decoded.findings.length <= 40, "musical review contains too many findings");
  for (const [index, finding] of decoded.findings.entries()) validFinding(finding, expected.durations, index);
  const review = decoded as unknown as DomainReview;
  return { envelope: raw as unknown as AntiListenEnvelope, review, findings: review.findings, listeningAttestation: "unverified" };
}

function validateEvidenceV2ListenResult(
  raw: Record<string, unknown>,
  decoded: unknown,
  expected: { durations: Record<AttachmentName, number> },
): ValidatedListenResult {
  invariant(isRecord(decoded) && decoded.schemaVersion === 2, "evidence-v2 requires domain schemaVersion 2");
  invariant(decoded.comparisonStatus === "compared" || decoded.comparisonStatus === "abstained", "evidence-v2 comparisonStatus must be compared or abstained");
  invariant(isRecord(decoded.attachments), "evidence-v2 requires observed evidence for both attachments");
  const attachments = decoded.attachments;
  const attachmentStates = ["music", "speech", "silence", "unavailable", "uncertain"] as const;
  for (const attachment of ["reference", "candidate"] as const) {
    const observed = attachments[attachment];
    invariant(isRecord(observed) && attachmentStates.includes(observed.content as typeof attachmentStates[number]), `evidence-v2 ${attachment} content status is invalid`);
    invariant(nonempty(observed.evidence) && observed.evidence.length <= 500, `evidence-v2 ${attachment} requires concise observed evidence`);
  }
  invariant(nonempty(decoded.summary) && decoded.summary.length <= 2_000, "evidence-v2 summary is missing or too long");
  invariant(["low", "medium", "high"].includes(String(decoded.uncertainty)), "evidence-v2 uncertainty is invalid");
  invariant(Array.isArray(decoded.limitations) && decoded.limitations.length > 0 && decoded.limitations.length <= 20
    && decoded.limitations.every(item => nonempty(item) && item.length <= 500), "evidence-v2 requires explicit concise limitations");
  invariant(Array.isArray(decoded.findings) && decoded.findings.length <= 40, "evidence-v2 findings must be an array of at most 40 items");
  for (const [index, finding] of decoded.findings.entries()) validFinding(finding, expected.durations, index);
  if (decoded.comparisonStatus === "abstained") {
    invariant(decoded.uncertainty === "high", "evidence-v2 abstention requires high uncertainty");
    invariant(decoded.findings.length === 0, "evidence-v2 abstention must not retain findings");
  } else {
    invariant((attachments.reference as Record<string, unknown>).content === "music" && (attachments.candidate as Record<string, unknown>).content === "music", "evidence-v2 compared status requires both attachments to contain available music");
  }
  const review = decoded as unknown as EvidenceV2Review;
  return {
    envelope: raw as unknown as AntiListenEnvelope,
    review,
    findings: review.findings,
    comparisonStatus: review.comparisonStatus,
    listeningAttestation: "unverified",
  };
}

function sourceBeatAt(anchors: readonly SourceBeatAnchor[], assetSeconds: number): number | null {
  if (assetSeconds < anchors[0]!.assetSeconds || assetSeconds > anchors.at(-1)!.assetSeconds) return null;
  for (let i = 1; i < anchors.length; i++) {
    const left = anchors[i - 1]!;
    const right = anchors[i]!;
    if (assetSeconds <= right.assetSeconds) {
      const ratio = (assetSeconds - left.assetSeconds) / (right.assetSeconds - left.assetSeconds);
      return left.sourceBeat + ratio * (right.sourceBeat - left.sourceBeat);
    }
  }
  return anchors.at(-1)!.sourceBeat;
}

export function mapClipFindingToSource(job: ReviewJob, finding: ReviewFinding): {
  sourceBeatStart: number | null;
  sourceBeatEnd: number | null;
  alignmentStatus: "verified" | "unverified";
} {
  if (job.alignment.status !== "verified") return { sourceBeatStart: null, sourceBeatEnd: null, alignmentStatus: "unverified" };
  const clip = finding.attachment === "reference" ? job.referenceClip : job.candidateClip;
  const anchors = finding.attachment === "reference" ? job.alignment.referenceAnchors : job.alignment.candidateAnchors;
  return {
    sourceBeatStart: sourceBeatAt(anchors, clip.assetStartSeconds + finding.startSeconds),
    sourceBeatEnd: sourceBeatAt(anchors, clip.assetStartSeconds + finding.endSeconds),
    alignmentStatus: "verified",
  };
}

export function buildRepairQueue(job: ReviewJob, findings: readonly ReviewFinding[]) {
  return findings.filter(finding => finding.classification !== "observation").map((finding, index) => {
    const location = mapClipFindingToSource(job, finding);
    return {
      id: `${job.id}:finding-${index + 1}`,
      mode: job.mode,
      phraseId: job.phraseId,
      finding,
      ...location,
      status: finding.classification === "defect" ? "requires-symbolic-confirmation" as const : "uncertain-review" as const,
      acceptance: "Confirm against the pinned score/MIDI and difficulty; make the smallest reversible edit; rerender; recheck this span, its neighboring phrase and the ending with fresh pins.",
      canRepairPrecisely: location.sourceBeatStart !== null && location.sourceBeatEnd !== null,
    };
  });
}

export function planResumableJobs(state: RunState, manifest: ReviewManifest, manifestSha256: string, maxRequests: number) {
  invariant(state.schemaVersion === 1 && state.manifestSha256 === manifestSha256, "cannot resume: manifest or media pins changed");
  invariant(state.fingerprint.length === 64 && SHA.test(state.fingerprint), "cannot resume: run fingerprint is invalid");
  invariant(Number.isInteger(maxRequests) && maxRequests >= 0 && maxRequests === state.maxRequests, "resume must retain the original total request budget");
  invariant(Number.isInteger(state.attemptsUsed) && state.attemptsUsed >= 0 && state.attemptsUsed <= maxRequests, "resume would exceed the total request budget");
  const jobIds = new Set(manifest.jobs.map(job => job.id));
  invariant(Object.keys(state.jobs).length === jobIds.size && Object.keys(state.jobs).every(id => jobIds.has(id)), "cannot resume: job inventory changed");
  const completed: string[] = [];
  const pending: string[] = [];
  const ambiguous: string[] = [];
  for (const job of manifest.jobs) {
    const item = state.jobs[job.id];
    invariant(item, `cannot resume: checkpoint lacks ${job.id}`);
    if (item.status === "complete") { invariant(item.attempts === 1 && SHA.test(String(item.envelopeSha256)), `completed checkpoint ${job.id} lacks its single attempt and response pin`); completed.push(job.id); }
    else if (item.status === "planned") { invariant(item.attempts === 0, `planned checkpoint ${job.id} already records an attempt`); pending.push(job.id); }
    else if (item.status === "dry-run") { invariant(item.attempts === 0, `dry-run checkpoint ${job.id} cannot count a provider attempt`); pending.push(job.id); }
    else if (item.status === "submitted" || item.status === "ambiguous") { invariant(item.attempts === 1, `ambiguous checkpoint ${job.id} must reserve one attempt`); ambiguous.push(job.id); }
    else throw new Error(`cannot resume ${job.id}: unsupported checkpoint state`);
  }
  invariant(state.attemptsUsed === Object.values(state.jobs).reduce((total, item) => total + item.attempts, 0), "checkpoint attempt total does not match its job ledger");
  invariant(maxRequests > 0 || state.attemptsUsed === 0, "zero-request dry-run checkpoint contains a provider attempt");
  if (maxRequests > 0) invariant(state.attemptsUsed + pending.length <= maxRequests, "remaining jobs exceed the original total request budget");
  return { completed, pending, ambiguous };
}

export function buildAudioReviewCoverage(manifest: ReviewManifest, completeJobIds: ReadonlySet<string>, comparisonStatuses: ReadonlyMap<string, ComparisonStatus> = new Map()) {
  const byMode = Object.fromEntries((["original", "chords"] as const).map(mode => {
    const planned = manifest.jobs.filter(job => job.mode === mode);
    const complete = planned.filter(job => completeJobIds.has(job.id));
    const compared = complete.filter(job => comparisonStatuses.get(job.id) === "compared");
    const abstained = complete.filter(job => comparisonStatuses.get(job.id) === "abstained");
    return [mode, {
      jobsPlanned: planned.length,
      jobsComplete: complete.length,
      jobsCompared: compared.length,
      jobsAbstained: abstained.length,
      phrasesPlanned: [...new Set(planned.map(job => job.phraseId))],
      phrasesCompared: [...new Set(compared.map(job => job.phraseId))],
      phrasesReviewed: [...new Set(complete.filter(job => !comparisonStatuses.has(job.id) || comparisonStatuses.get(job.id) === "compared").map(job => job.phraseId))],
      phrasesAbstained: [...new Set(abstained.map(job => job.phraseId))],
      gaps: planned.filter(job => !completeJobIds.has(job.id) || comparisonStatuses.get(job.id) === "abstained").map(job => job.phraseId),
      disposition: "provisional" as const,
    }];
  })) as Record<ReviewMode, { jobsPlanned: number; jobsComplete: number; jobsCompared: number; jobsAbstained: number; phrasesPlanned: string[]; phrasesCompared: string[]; phrasesReviewed: string[]; phrasesAbstained: string[]; gaps: string[]; disposition: "provisional" }>;
  const byPhrase = Object.fromEntries(manifest.phraseInventory.map(phrase => [phrase.id, Object.fromEntries((["original", "chords"] as const).map(mode => {
    const job = manifest.jobs.find(item => item.mode === mode && item.phraseId === phrase.id);
    const status = job ? comparisonStatuses.get(job.id) : undefined;
    return [mode, !job ? "not-covered" : !completeJobIds.has(job.id) ? "not-reviewed" : status === "compared" ? "compared-excerpt" : status === "abstained" ? "abstained" : "reviewed-excerpt"];
  }))]));
  return {
    byMode,
    byPhrase,
    completeJobCount: completeJobIds.size,
    comparedJobCount: [...comparisonStatuses.values()].filter(status => status === "compared").length,
    abstainedJobCount: [...comparisonStatuses.values()].filter(status => status === "abstained").length,
    musicalAcceptance: "not-established" as const,
    calibrated: false,
  };
}

export function stableJson(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort) : isRecord(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])]))
    : item;
  return JSON.stringify(sort(value));
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function validateAudioReport(raw: unknown) {
  invariant(isRecord(raw) && raw.schemaVersion === 2 && raw.kind === "keyspilli-audio-review-report", "audio review report schema is invalid");
  invariant(typeof raw.musicalAcceptance === "string" && raw.musicalAcceptance === "not-established", "audio review cannot certify musical acceptance");
  invariant(isRecord(raw.coverage) && raw.coverage.calibrated === false, "audio review must preserve unqualified calibration status");
  return raw;
}
