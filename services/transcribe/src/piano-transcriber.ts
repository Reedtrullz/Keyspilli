import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type { Note, ParsedMidi } from "@keyspilli/midi";

const execFileAsync = promisify(execFile);

export const PIANO_TRANSCRIPTION_UNAVAILABLE = "piano transcription backend unavailable";

export interface PianoTranscriptionRequest {
  mediaPath: string;
  mediaSha256: string;
  model: string;
  config?: Record<string, unknown>;
}

export interface PianoTranscriptionProvenance {
  backendId: string;
  backendVersion: string;
  model: string;
  mediaSha256: string;
  config: Record<string, unknown>;
  cacheKey: string;
}

export interface PianoTranscriptionEvidence {
  parsed: ParsedMidi;
  provenance: PianoTranscriptionProvenance;
}

export type PianoTranscriptionResult =
  | ({ status: "ok" } & PianoTranscriptionEvidence)
  | { status: "unavailable"; error: typeof PIANO_TRANSCRIPTION_UNAVAILABLE; provenance: PianoTranscriptionProvenance };

export interface PianoProcessResult {
  stdout: string;
  stderr: string;
}

export type PianoProcessRunner = (
  command: string,
  args: readonly string[],
  options: { timeout: number },
) => Promise<PianoProcessResult>;

export interface PianoTranscriptionAdapterOptions {
  command: string;
  backendId?: string;
  backendVersion?: string;
  timeoutMs?: number;
  enabled?: boolean;
  run?: PianoProcessRunner;
}

interface RawTranscription {
  notes?: unknown;
  tempoBpm?: unknown;
  keySig?: unknown;
  keyMode?: unknown;
  timeSig?: unknown;
  title?: unknown;
  trackNames?: unknown;
}

export interface PianoCacheKeyInput {
  mediaSha256: string;
  model: string;
  backendId: string;
  backendVersion: string;
  config?: Record<string, unknown>;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Cache identity is independent of object key insertion order. */
export function pianoTranscriptionCacheKey(input: PianoCacheKeyInput): string {
  return `piano-transcription:${createHash("sha256").update(stableJson({ mediaSha256: input.mediaSha256, model: input.model, backendId: input.backendId, backendVersion: input.backendVersion, config: input.config ?? {} })).digest("hex")}`;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function normalizePianoTranscription(raw: unknown, provenance: PianoTranscriptionProvenance): PianoTranscriptionEvidence {
  const input = raw && typeof raw === "object" ? raw as RawTranscription : {};
  const notes: Note[] = Array.isArray(input.notes)
    ? input.notes.flatMap((entry): Note[] => {
      if (!entry || typeof entry !== "object") return [];
      const n = entry as Record<string, unknown>;
      const midi = asNumber(n.midi), start = asNumber(n.start), dur = asNumber(n.dur), vel = asNumber(n.vel);
      if (midi === undefined || start === undefined || dur === undefined || vel === undefined || midi < 0 || midi > 127 || start < 0 || dur <= 0) return [];
      return [{
        midi: Math.round(midi),
        start,
        dur,
        vel: Math.max(0, Math.min(127, Math.round(vel))),
        ...(n.hand === "L" || n.hand === "R" ? { hand: n.hand } : {}),
        ...(n.identitySource === "vocals" || n.identitySource === "guitar" || n.identitySource === "other" ? { identitySource: n.identitySource } : {}),
        ...(typeof n.lyrics === "string" ? { lyrics: n.lyrics } : {}),
      }];
    }) : [];
  const tempoBpm = asNumber(input.tempoBpm) ?? 120;
  const durationBeats = notes.reduce((max, n) => Math.max(max, n.start + n.dur), 0);
  const parsed: ParsedMidi = {
    format: 1,
    division: 480,
    tempoBpm: tempoBpm > 0 ? tempoBpm : 120,
    keySig: asNumber(input.keySig) ?? 0,
    keyMode: input.keyMode === 1 ? 1 : 0,
    timeSig: Array.isArray(input.timeSig) && input.timeSig.length === 2 && typeof input.timeSig[0] === "number" && typeof input.timeSig[1] === "number" ? [input.timeSig[0], input.timeSig[1]] : [4, 4],
    notes,
    trackNames: Array.isArray(input.trackNames) ? input.trackNames.filter((v): v is string => typeof v === "string") : [provenance.backendId],
    durationBeats,
    ...(typeof input.title === "string" ? { title: input.title } : {}),
  };
  return { parsed, provenance };
}

const defaultRunner: PianoProcessRunner = async (command, args, options) => {
  const result = await execFileAsync(command, [...args], { timeout: options.timeout, maxBuffer: 16 * 1024 * 1024 });
  return { stdout: result.stdout, stderr: result.stderr };
};

export function createPianoTranscriptionAdapter(options: PianoTranscriptionAdapterOptions) {
  const backendId = options.backendId ?? "external-piano-transcriber";
  const backendVersion = options.backendVersion ?? "unknown";
  const run = options.run ?? defaultRunner;
  return {
    backendId,
    backendVersion,
    async transcribe(request: PianoTranscriptionRequest): Promise<PianoTranscriptionResult> {
      const config = request.config ?? {};
      const provenance = { backendId, backendVersion, model: request.model, mediaSha256: request.mediaSha256, config: { ...config }, cacheKey: pianoTranscriptionCacheKey({ mediaSha256: request.mediaSha256, model: request.model, backendId, backendVersion, config }) };
      if (options.enabled === false) return { status: "unavailable", error: PIANO_TRANSCRIPTION_UNAVAILABLE, provenance };
      try {
        const result = await run(options.command, ["--model", request.model, "--output-format", "json", ...(Object.keys(config).length ? ["--config-json", stableJson(config)] : []), request.mediaPath], { timeout: options.timeoutMs ?? 120_000 });
        return { status: "ok", ...normalizePianoTranscription(JSON.parse(result.stdout), provenance) };
      } catch {
        return { status: "unavailable", error: PIANO_TRANSCRIPTION_UNAVAILABLE, provenance };
      }
    },
  };
}
