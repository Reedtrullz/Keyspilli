/** Offline evidence only: pinned intent, PCM estimates and saved model claims. */
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { AUDIO_REVIEW_LIMITS, inspectPcm16Wav, parseAntiLiveStdout, readPinnedAudioBytes, stableJson, type AudioFilePin, type WavInfo } from "./audio-review.js";

type Pin = { path: string; sha256: string };
type Clip = { id: string; mode: "original" | "chords" | "control"; audio: AudioFilePin; sourceEvents?: Pin; antiObservation?: Pin };
type Manifest = { schemaVersion: 1; kind: "keyspilli-local-audio-evidence-manifest"; clips: Clip[] };
type RenderEvent = { midi: number; startSeconds: number; durationSeconds: number };
type Observation = { id: "A"; content: "music" | "speech" | "silence" | "unknown"; words: string; pitchDirection: "ascending" | "descending" | "steady" | "mixed" | "unknown"; attacks: number | null };
type SourceIntent = {
  status: "available" | "unavailable";
  evidence: Pin | null;
  noteOnEventCount: number | null;
  distinctStartTimeCount: number | null;
  overlappingEvents: Array<{ midi: number; assetStartSeconds: number; clipStartSeconds: number; durationSeconds: number }> | null;
};
type Advisory = {
  status: "not-provided" | "observed" | "missing-claim" | "unusable-claim";
  evidence: Pin | null;
  helperModel: string | null;
  observation: Observation | null;
  listeningAttestation: "unverified";
};
type Disagreement =
  | { kind: "advisory-source-start-count"; sourceCount: number; advisoryCount: number }
  | { kind: "advisory-pcm-onset-count"; estimateCount: number; advisoryCount: number }
  | { kind: "digital-silence-with-authored-starts"; sourceCount: number }
  | { kind: "advisory-attachment-claim"; reported: "missing" | "unusable"; localMedia: "available" };
export interface LocalAudioEvidenceReport {
  schemaVersion: 1;
  kind: "keyspilli-local-audio-evidence";
  manifestSha256: string;
  providerCalls: 0;
  musicalAcceptance: "not-established";
  calibrated: false;
  clips: Array<{
    id: string; mode: Clip["mode"]; media: AudioFilePin;
    localInputStatus: "available" | "digital-silence";
    sourceIntent: SourceIntent; pcm: WavInfo;
    acousticPitch: { status: "unavailable"; pitches: null };
    advisory: Advisory; disagreements: Disagreement[];
  }>;
  limitations: string[];
}
const MAX_JSON_BYTES = 1024 * 1024;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function pin(value: unknown): asserts value is Pin {
  check(record(value) && typeof value.path === "string" && isAbsolute(value.path) && typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256), "evidence requires an absolute path and SHA-256 pin");
}

/** Bounded regular-file read with identity/change checks, also used for the manifest. */
export async function readLocalEvidenceJson(path: string, expectedSha256?: string): Promise<unknown> {
  check(isAbsolute(path), "JSON evidence path must be absolute");
  const handle = await open(path, "r");
  try {
    const before = await handle.stat({ bigint: true });
    check(before.isFile() && before.size > 0n && before.size <= BigInt(MAX_JSON_BYTES), "JSON evidence is not a bounded regular file");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const next = await handle.read(bytes, length, bytes.length - length, length);
      if (!next.bytesRead) break;
      length += next.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    check(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs && length === Number(before.size), "JSON evidence bytes changed during read");
    const captured = bytes.subarray(0, length);
    check(expectedSha256 === undefined || hash(captured) === expectedSha256, "JSON evidence hash pin changed");
    return JSON.parse(captured.toString("utf8")) as unknown;
  } finally { await handle.close(); }
}

function manifest(value: unknown): Manifest {
  check(record(value) && value.schemaVersion === 1 && value.kind === "keyspilli-local-audio-evidence-manifest", "local evidence manifest requires schemaVersion 1 and its own kind");
  check(Array.isArray(value.clips) && value.clips.length > 0 && value.clips.length <= AUDIO_REVIEW_LIMITS.maxJobs, "local evidence clip inventory is empty or exceeds its bound");
  const ids = new Set<string>();
  for (const clip of value.clips) {
    check(record(clip) && typeof clip.id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(clip.id), "clip needs a safe ID");
    check(!ids.has(clip.id), "duplicate clip ID"); ids.add(clip.id);
    check(["original", "chords", "control"].includes(String(clip.mode)), "clip mode must be explicit");
    pin(clip.audio);
    const audio = clip.audio as unknown as Record<string, unknown>;
    check(typeof audio.bytes === "number" && Number.isSafeInteger(audio.bytes) && audio.bytes >= 44 && audio.bytes <= AUDIO_REVIEW_LIMITS.maxClipBytes, "WAV byte pin exceeds its bound");
    check(audio.channels === 1 && audio.bitsPerSample === 16 && [32_000, 44_100].includes(Number(audio.sampleRate)), "audio must be mono PCM16 at 32 or 44.1 kHz");
    check(finite(audio.durationSeconds) && audio.durationSeconds > 0 && audio.durationSeconds <= AUDIO_REVIEW_LIMITS.maxClipSeconds && finite(audio.assetStartSeconds) && audio.assetStartSeconds >= 0, "clip duration or asset clock is invalid");
    if (clip.sourceEvents !== undefined) pin(clip.sourceEvents);
    if (clip.antiObservation !== undefined) pin(clip.antiObservation);
  }
  return value as unknown as Manifest;
}

async function sourceIntent(clip: Clip, measuredDurationSeconds: number): Promise<SourceIntent> {
  if (!clip.sourceEvents) return { status: "unavailable", evidence: null, noteOnEventCount: null, distinctStartTimeCount: null, overlappingEvents: null };
  const value = await readLocalEvidenceJson(clip.sourceEvents.path, clip.sourceEvents.sha256);
  check(record(value) && value.schemaVersion === 1 && value.kind === "keyspilli-render-events" && value.clock === "asset-seconds", "render event schema or clock is invalid");
  check(value.clipSha256 === clip.audio.sha256 && value.assetStartSeconds === clip.audio.assetStartSeconds, "render event clip/clock binding mismatch");
  check(Array.isArray(value.events) && value.events.length <= 20_000, "render event inventory exceeds its bound");
  for (const event of value.events) {
    check(record(event) && typeof event.midi === "number" && Number.isInteger(event.midi) && event.midi >= 0 && event.midi <= 127, "render event MIDI pitch is invalid");
    check(finite(event.startSeconds) && event.startSeconds >= 0 && finite(event.durationSeconds) && event.durationSeconds > 0 && Number.isFinite(event.startSeconds + event.durationSeconds), "render event time/duration is invalid");
  }
  const events = value.events as RenderEvent[];
  const start = clip.audio.assetStartSeconds, end = start + measuredDurationSeconds;
  const starts = events.filter(event => event.startSeconds >= start && event.startSeconds < end);
  return {
    status: "available", evidence: clip.sourceEvents,
    noteOnEventCount: starts.length,
    distinctStartTimeCount: new Set(starts.map(event => event.startSeconds)).size,
    overlappingEvents: events.filter(event => event.startSeconds < end && event.startSeconds + event.durationSeconds > start)
      .sort((a, b) => a.startSeconds - b.startSeconds || a.midi - b.midi)
      .map(event => ({ midi: event.midi, assetStartSeconds: event.startSeconds, clipStartSeconds: event.startSeconds - start, durationSeconds: event.durationSeconds })),
  };
}

async function advisory(clip: Clip): Promise<Advisory> {
  const unavailable: Advisory = { status: "not-provided", evidence: null, helperModel: null, observation: null, listeningAttestation: "unverified" };
  if (!clip.antiObservation) return unavailable;
  const value = await readLocalEvidenceJson(clip.antiObservation.path, clip.antiObservation.sha256);
  check(record(value) && value.schemaVersion === 1 && value.runStatus === "success" && value.mode === "listen" && typeof value.model === "string" && value.model.length > 0 && record(value.metadata), "saved Anti envelope is not a complete listen result");
  const metadata = value.metadata;
  check(metadata.result_quality === "complete" && metadata.requested_model === value.model && metadata.actual_model === value.model && metadata.fallback_used === false, "saved Anti model/completeness evidence is invalid");
  const incompleteStatuses = new Set(["partial", "incomplete", "failed", "error", "truncated", "interrupted"]);
  for (const status of [value.scopeStatus, metadata.status, metadata.runStatus, metadata.scopeStatus, metadata.scope_status]) {
    check(typeof status !== "string" || !incompleteStatuses.has(status.toLowerCase()), "saved Anti evidence has a contradictory incomplete status");
  }
  for (const key of ["fallback_used", "fallbackUsed", "fallback_attempted", "fallbackAttempted"]) {
    check(metadata[key] !== true, "saved Anti evidence reports fallback");
  }
  for (const key of ["fallback_chain", "fallbackChain"]) {
    const chain = metadata[key];
    check(chain === undefined || (Array.isArray(chain) && chain.length <= 1 && chain.every(model => model === value.model)), "saved Anti evidence reports an unexpected fallback/model chain");
  }
  const media = metadata.media_coverage;
  check(record(media) && media.kind === "audio" && media.captured_count === 1 && media.gateway_attempts === 1 && media.status === "attempted" && media.provider_audio_acceptance === "unverified" && media.listening_verification === "not_run", "saved Anti media receipt must leave hearing unverified and bind one clip attempt");
  check(Array.isArray(media.audio) && media.audio.length === 1 && record(media.audio[0]) && media.audio[0].index === 1 && media.audio[0].sha256 === clip.audio.sha256 && media.audio[0].bytes === clip.audio.bytes, "saved Anti media SHA/byte pin does not match this clip");
  check(typeof value.output_text === "string" && value.output_text.length <= 12_000, "saved observation text is missing or oversized");
  const text = value.output_text.trim();
  const fenced = /^```json\r?\n([\s\S]*?)\r?\n```$/.exec(text);
  const output = parseAntiLiveStdout(fenced ? fenced[1]! : text);
  check(record(output) && Object.keys(output).sort().join(",") === "attachmentStatus,clips" && ["received", "missing", "unusable"].includes(String(output.attachmentStatus)) && Array.isArray(output.clips), "saved single-clip observation schema is invalid");
  const base = { ...unavailable, evidence: clip.antiObservation, helperModel: value.model };
  if (output.attachmentStatus !== "received") {
    check(output.clips.length === 0, "missing/unusable observation cannot contain clips");
    return { ...base, status: output.attachmentStatus === "missing" ? "missing-claim" : "unusable-claim" };
  }
  check(output.clips.length === 1 && record(output.clips[0]), "single-clip observation must contain exactly A");
  const observation = output.clips[0];
  check(Object.keys(observation).sort().join(",") === "attacks,content,id,pitchDirection,words" && observation.id === "A" && ["music", "speech", "silence", "unknown"].includes(String(observation.content)), "single-clip observation fields are invalid");
  check(["ascending", "descending", "steady", "mixed", "unknown"].includes(String(observation.pitchDirection)) && (observation.attacks === null || (typeof observation.attacks === "number" && Number.isInteger(observation.attacks) && observation.attacks >= 0 && observation.attacks <= 32)), "single-clip count/direction is invalid");
  check(typeof observation.words === "string" && observation.words.length <= 200 && observation.words.trim().split(/\s+/).filter(Boolean).length <= 12 && (observation.content === "speech" || observation.words === ""), "single-clip speech evidence is invalid");
  check(observation.content === "music" || (observation.attacks === null && observation.pitchDirection === "unknown"), "non-music observations cannot claim piano attacks/pitch");
  return { ...base, status: "observed", observation: observation as Observation };
}

export async function collectLocalAudioEvidence(value: unknown): Promise<LocalAudioEvidenceReport> {
  const input = structuredClone(manifest(value));
  const clips: LocalAudioEvidenceReport["clips"] = [];
  for (const clip of input.clips) {
    const pcm = inspectPcm16Wav(await readPinnedAudioBytes(clip.audio));
    check(pcm.sampleRate === clip.audio.sampleRate && Math.abs(pcm.durationSeconds - clip.audio.durationSeconds) <= 0.002, "measured WAV duration/sample rate disagrees with its pin");
    const source = await sourceIntent(clip, pcm.durationSeconds), anti = await advisory(clip);
    const disagreements: Disagreement[] = [];
    if (anti.status === "missing-claim" || anti.status === "unusable-claim") disagreements.push({ kind: "advisory-attachment-claim", reported: anti.status === "missing-claim" ? "missing" : "unusable", localMedia: "available" });
    const count = anti.observation?.attacks;
    if (typeof count === "number") {
      if (source.distinctStartTimeCount !== null && source.distinctStartTimeCount !== count) disagreements.push({ kind: "advisory-source-start-count", sourceCount: source.distinctStartTimeCount, advisoryCount: count });
      if (pcm.onsetEstimateSeconds.length !== count) disagreements.push({ kind: "advisory-pcm-onset-count", estimateCount: pcm.onsetEstimateSeconds.length, advisoryCount: count });
    }
    if (pcm.digitalSilence && source.distinctStartTimeCount !== null && source.distinctStartTimeCount > 0) disagreements.push({ kind: "digital-silence-with-authored-starts", sourceCount: source.distinctStartTimeCount });
    clips.push({ id: clip.id, mode: clip.mode, media: clip.audio, localInputStatus: pcm.digitalSilence ? "digital-silence" : "available", sourceIntent: source, pcm, acousticPitch: { status: "unavailable", pitches: null }, advisory: anti, disagreements });
  }
  return {
    schemaVersion: 1, kind: "keyspilli-local-audio-evidence", manifestSha256: hash(stableJson(input)), providerCalls: 0, musicalAcceptance: "not-established", calibrated: false, clips,
    limitations: [
      "Authored render events establish pinned intent, not independently heard acoustic notes or source correctness.",
      "PCM onset timestamps are clip-local energy estimates; counts can miss or add attacks and saturate at the configured cap.",
      "Exact authored start times group simultaneous notes; near-simultaneous events are not automatically merged or classified.",
      "Saved Anti claims remain advisory; submission receipts do not prove provider hearing. No new provider requests are made.",
      "Acoustic pitch is unavailable. Silence, quiet levels, count agreement and absent disagreements do not establish musical acceptance or authorize repair.",
    ],
  };
}

export function renderLocalAudioEvidence(report: LocalAudioEvidenceReport): string {
  const lines = ["# Local audio evidence", "", "Musical acceptance: not established. Calibration: false. Provider calls: 0.", "",
    "Authored start times, PCM energy crossings and model attack claims measure different things. Disagreements request inspection; they are not defect or repair decisions.", "",
    "| Clip / mode | Authored note-ons / distinct starts | PCM onset estimates | Saved Anti attacks | Local input |",
    "|---|---|---|---|---|"];
  for (const clip of report.clips) {
    lines.push(`| ${clip.id} / ${clip.mode} | ${clip.sourceIntent.noteOnEventCount ?? "unavailable"} / ${clip.sourceIntent.distinctStartTimeCount ?? "unavailable"} | ${clip.pcm.onsetEstimateSeconds.length} | ${clip.advisory.observation?.attacks ?? "unknown"} | ${clip.localInputStatus} |`);
  }
  for (const clip of report.clips) {
    lines.push("", `## ${clip.id}`, "", `- Clip SHA-256: ${clip.media.sha256}`, `- PCM config SHA-256: ${clip.pcm.analysisConfigSha256}`, `- Excerpt starts at ${clip.media.assetStartSeconds} asset seconds; onset estimates use clip seconds.`, `- Energy onset estimates: ${clip.pcm.onsetEstimateSeconds.join(", ") || "none"}.`, `- Acoustic pitch: unavailable. Saved Anti: ${clip.advisory.status}; listening unverified.`, `- Count/input disagreements: ${JSON.stringify(clip.disagreements)}.`);
  }
  lines.push("", "## Limits", "", ...report.limitations.map(line => `- ${line}`), "");
  return lines.join("\n");
}
