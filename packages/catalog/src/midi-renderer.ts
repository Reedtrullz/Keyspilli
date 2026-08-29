/**
 * Optional, local-only MIDI-to-WAV rendering through FluidSynth.
 *
 * This module deliberately has no effect on normal catalog/transcription
 * startup.  It is evaluation tooling: the caller supplies a MIDI path and a
 * SoundFont (or configures KEYSPILLI_SOUNDFONT), and FluidSynth is invoked via
 * execFile so paths and arguments are never interpreted by a shell.
 */
import { execFile as execFileCallback, type ExecFileException, type ExecFileOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { parseMidi, type ParsedMidi } from "@keyspilli/midi";

const execFileDefault = promisify(execFileCallback) as unknown as ExecFilePromise;
const MAX_EXEC_OUTPUT = 16 * 1024 * 1024;
const DEFAULT_SAMPLE_RATE = 44_100;
const DEFAULT_GAIN = 1;
const DEFAULT_TARGET_PEAK = 0.95;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_DURATION_TOLERANCE_SECONDS = 2;
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 192_000;

/** Promise-shaped execFile function, exported only to make command tests safe. */
export type ExecFilePromise = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

export type MidiRendererErrorCode =
  | "INVALID_INPUT"
  | "MIDI_UNAVAILABLE"
  | "SOUNDFONT_UNAVAILABLE"
  | "OUTPUT_UNAVAILABLE"
  | "BACKEND_UNAVAILABLE"
  | "RENDER_FAILED"
  | "INVALID_WAV"
  | "DURATION_MISMATCH";

/** An actionable, machine-readable renderer failure. */
export class MidiRendererError extends Error {
  readonly code: MidiRendererErrorCode;
  readonly cause?: unknown;

  constructor(code: MidiRendererErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "MidiRendererError";
    this.code = code;
    this.cause = cause;
  }
}

export interface MidiRenderInput {
  midiPath: string;
  outputPath: string;
  soundfontPath?: string;
  sampleRate?: number;
  gain?: number;
}

export interface MidiRendererOptions {
  /** Optional process environment override, useful for hermetic callers/tests. */
  env?: NodeJS.ProcessEnv;
  /** Explicit FluidSynth executable, otherwise KEYSPILLI_FLUIDSYNTH or PATH. */
  executable?: string;
  /** Default SoundFont for this renderer instance. */
  soundfontPath?: string;
  sampleRate?: number;
  gain?: number;
  /** Fixed peak target for the canonical PCM16 output. */
  targetPeak?: number;
  timeoutMs?: number;
  /** Dependency injection keeps unit tests independent from FluidSynth. */
  execFile?: ExecFilePromise;
}

export interface FluidSynthConfig {
  executable: string;
  soundfontPath?: string;
  sampleRate: number;
  gain: number;
  targetPeak: number;
  timeoutMs: number;
}

export interface WavMetrics {
  sampleRate: number;
  channels: number;
  bitsPerSample: 16;
  frameCount: number;
  sampleCount: number;
  durationSeconds: number;
  /** Absolute PCM peak in the range 0..1. */
  peak: number;
  /** Root-mean-square PCM level in the range 0..1. */
  rms: number;
  silenceRatio: number;
  clippingCount: number;
  sha256: string;
}

export interface MidiDurationValidation {
  expectedSeconds: number;
  renderedSeconds: number;
  deltaSeconds: number;
  toleranceSeconds: number;
  status: "pass" | "warning" | "fail";
}

export interface MidiRenderResult {
  renderer: {
    id: "fluidsynth";
    version: "pcm16-v1";
    executable: string;
    sampleRate: number;
    gain: number;
    targetPeak: number;
  };
  midi: {
    path: string;
    sha256: string;
    tempoBpm: number;
    durationBeats: number;
    expectedSeconds: number;
  };
  soundfont: {
    path: string;
    bytes: number;
    sha256: string;
  };
  wav: {
    path: string;
    bytes: number;
  } & WavMetrics;
  duration: MidiDurationValidation;
}

export interface MidiAudioRenderer {
  readonly id: "fluidsynth";
  readonly version: "pcm16-v1";
  render(input: MidiRenderInput): Promise<MidiRenderResult>;
}

interface WavPcmData {
  sampleRate: number;
  channels: number;
  samples: number[];
}

interface FileBytes {
  bytes: Uint8Array;
  size: number;
  sha256: string;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function configuredNumber(value: number | undefined, fallback: number, label: string, valid: (n: number) => boolean): number {
  const candidate = value ?? fallback;
  if (!finite(candidate) || !valid(candidate)) throw new MidiRendererError("INVALID_INPUT", `Invalid ${label}: ${String(value)}`);
  return candidate;
}

function pathValue(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (!value.trim() || value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    throw new MidiRendererError("INVALID_INPUT", `Invalid ${label}: path must be a non-empty single-line path`);
  }
  return value;
}

/** Resolve renderer defaults without probing or starting an external process. */
export function resolveFluidSynthConfig(options: MidiRendererOptions = {}, env: NodeJS.ProcessEnv = options.env ?? process.env): FluidSynthConfig {
  const executable = pathValue(options.executable ?? env.KEYSPILLI_FLUIDSYNTH, "FluidSynth executable") ?? "fluidsynth";
  const soundfontPath = pathValue(options.soundfontPath ?? env.KEYSPILLI_SOUNDFONT, "SoundFont")
    ?? undefined;
  return {
    executable,
    ...(soundfontPath ? { soundfontPath } : {}),
    sampleRate: configuredNumber(options.sampleRate, DEFAULT_SAMPLE_RATE, "sample rate", (n) => Number.isInteger(n) && n >= MIN_SAMPLE_RATE && n <= MAX_SAMPLE_RATE),
    gain: configuredNumber(options.gain, DEFAULT_GAIN, "gain", (n) => n > 0 && n <= 10),
    targetPeak: configuredNumber(options.targetPeak, DEFAULT_TARGET_PEAK, "target peak", (n) => n > 0 && n <= 1),
    timeoutMs: configuredNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeout", (n) => Number.isInteger(n) && n > 0 && n <= 24 * 60 * 60 * 1000),
  };
}

/** Construct the only external command used by the renderer. */
export function buildFluidSynthArgs(input: Required<Pick<MidiRenderInput, "midiPath" | "outputPath" | "soundfontPath">> & Pick<MidiRenderInput, "sampleRate" | "gain">): string[] {
  const sampleRate = configuredNumber(input.sampleRate, DEFAULT_SAMPLE_RATE, "sample rate", (n) => Number.isInteger(n) && n >= MIN_SAMPLE_RATE && n <= MAX_SAMPLE_RATE);
  const gain = configuredNumber(input.gain, DEFAULT_GAIN, "gain", (n) => n > 0 && n <= 10);
  return [
    "-ni",
    "-q",
    "-T", "wav",
    "-r", String(sampleRate),
    "-g", String(gain),
    "-F", input.outputPath,
    input.soundfontPath,
    input.midiPath,
  ];
}

async function regularFile(path: string, label: string, allowEmpty = false): Promise<FileBytes> {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`${label} is not a regular file`);
    if (!allowEmpty && info.size <= 0) throw new Error(`${label} is empty`);
    const bytes = new Uint8Array(await readFile(path));
    return { bytes, size: bytes.byteLength, sha256: hashBytes(bytes) };
  } catch (error) {
    if (error instanceof MidiRendererError) throw error;
    const code = label === "MIDI" ? "MIDI_UNAVAILABLE" : "SOUNDFONT_UNAVAILABLE";
    const suffix = label === "SoundFont"
      ? " Set KEYSPILLI_SOUNDFONT or pass soundfontPath."
      : " Pass a readable MIDI file path.";
    throw new MidiRendererError(code, `${label} unavailable: ${path}.${suffix}`, error);
  }
}

async function validateOutputPath(path: string, midiPath: string): Promise<void> {
  if (!path.trim() || path.includes("\0") || path.includes("\n") || path.includes("\r")) {
    throw new MidiRendererError("INVALID_INPUT", "Invalid output path: path must be a non-empty single-line path");
  }
  if (resolve(path) === resolve(midiPath)) {
    throw new MidiRendererError("INVALID_INPUT", "MIDI input and WAV output must be different files");
  }
  try {
    const info = await stat(dirname(path));
    if (!info.isDirectory()) throw new Error("output parent is not a directory");
  } catch (error) {
    throw new MidiRendererError("OUTPUT_UNAVAILABLE", `Output directory unavailable: ${dirname(path)}`, error);
  }
}

function midiExpectedDuration(parsed: ParsedMidi): number {
  if (!finite(parsed.tempoBpm) || parsed.tempoBpm <= 0 || !finite(parsed.durationBeats) || parsed.durationBeats < 0) {
    throw new MidiRendererError("INVALID_INPUT", "MIDI contains invalid tempo or duration metadata");
  }
  return parsed.durationBeats * 60 / parsed.tempoBpm;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index++) value += String.fromCharCode(view.getUint8(offset + index));
  return value;
}

function findWavChunk(view: DataView, wanted: string): { offset: number; length: number } {
  if (view.byteLength < 12 || readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new MidiRendererError("INVALID_WAV", "FluidSynth did not produce a RIFF/WAVE file");
  }
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + length > view.byteLength) throw new MidiRendererError("INVALID_WAV", `Truncated WAV ${id} chunk`);
    if (id === wanted) return { offset: dataOffset, length };
    offset = dataOffset + length + (length & 1);
  }
  throw new MidiRendererError("INVALID_WAV", `WAV is missing ${wanted} chunk`);
}

function decodeWav(bytes: Uint8Array): WavPcmData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fmt = findWavChunk(view, "fmt ");
  if (fmt.length < 16) throw new MidiRendererError("INVALID_WAV", "WAV fmt chunk is too short");
  const format = view.getUint16(fmt.offset, true);
  const channels = view.getUint16(fmt.offset + 2, true);
  const sampleRate = view.getUint32(fmt.offset + 4, true);
  const bits = view.getUint16(fmt.offset + 14, true);
  const data = findWavChunk(view, "data");
  if (!Number.isInteger(channels) || channels < 1 || channels > 32 || !Number.isInteger(sampleRate) || sampleRate < 1) {
    throw new MidiRendererError("INVALID_WAV", "WAV has invalid channel or sample-rate metadata");
  }
  const bytesPerSample = bits / 8;
  if (![8, 16, 24, 32, 64].includes(bits) || !Number.isInteger(bytesPerSample) || data.length % (channels * bytesPerSample) !== 0) {
    throw new MidiRendererError("INVALID_WAV", `Unsupported or truncated WAV PCM format: ${format}/${bits}bit`);
  }
  const samples: number[] = [];
  const readSample = (offset: number): number => {
    if (format === 3 && bits === 32) return Math.max(-1, Math.min(1, view.getFloat32(offset, true)));
    if (format === 3 && bits === 64) return Math.max(-1, Math.min(1, view.getFloat64(offset, true)));
    if (format !== 1) throw new MidiRendererError("INVALID_WAV", `Unsupported WAV audio format: ${format}`);
    if (bits === 8) return (view.getUint8(offset) - 128) / 128;
    if (bits === 16) return view.getInt16(offset, true) / 32768;
    if (bits === 24) {
      const value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
      return (value & 0x800000 ? value - 0x1000000 : value) / 8388608;
    }
    return view.getInt32(offset, true) / 2147483648;
  };
  for (let offset = data.offset; offset < data.offset + data.length; offset += bytesPerSample) samples.push(readSample(offset));
  return { sampleRate, channels, samples };
}

function canonicalPcm16Wav(data: WavPcmData, targetPeak: number): { bytes: Uint8Array; metrics: Omit<WavMetrics, "sha256"> } {
  let peak = 0;
  for (const sample of data.samples) peak = Math.max(peak, Math.abs(sample));
  const scale = peak > 0 ? targetPeak / peak : 1;
  const pcm = new Int16Array(data.samples.length);
  let canonicalPeak = 0;
  let sumSquares = 0;
  let silence = 0;
  let clipping = 0;
  for (let index = 0; index < data.samples.length; index++) {
    const value = Math.max(-32768, Math.min(32767, Math.round(data.samples[index]! * scale * 32767)));
    pcm[index] = value;
    const normalized = Math.abs(value) / 32768;
    canonicalPeak = Math.max(canonicalPeak, normalized);
    sumSquares += normalized * normalized;
    if (Math.abs(value) <= 32) silence++;
    if (Math.abs(value) >= 32767) clipping++;
  }
  const payloadBytes = pcm.byteLength;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + payloadBytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, data.channels, true);
  view.setUint32(24, data.sampleRate, true);
  view.setUint32(28, data.sampleRate * data.channels * 2, true);
  view.setUint16(32, data.channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, payloadBytes, true);
  const bytes = new Uint8Array(44 + payloadBytes);
  bytes.set(new Uint8Array(header), 0);
  bytes.set(new Uint8Array(pcm.buffer), 44);
  const frameCount = data.channels ? data.samples.length / data.channels : 0;
  const durationSeconds = data.sampleRate > 0 ? frameCount / data.sampleRate : 0;
  return {
    bytes,
    metrics: {
      sampleRate: data.sampleRate,
      channels: data.channels,
      bitsPerSample: 16,
      frameCount,
      sampleCount: data.samples.length,
      durationSeconds: round(durationSeconds),
      peak: round(canonicalPeak),
      rms: round(data.samples.length ? Math.sqrt(sumSquares / data.samples.length) : 0),
      silenceRatio: round(data.samples.length ? silence / data.samples.length : 0),
      clippingCount: clipping,
    },
  };
}

function durationValidation(expectedSeconds: number, renderedSeconds: number): MidiDurationValidation {
  const deltaSeconds = renderedSeconds - expectedSeconds;
  const toleranceSeconds = Math.max(DEFAULT_DURATION_TOLERANCE_SECONDS, expectedSeconds * 0.05);
  const absolute = Math.abs(deltaSeconds);
  return {
    expectedSeconds: round(expectedSeconds),
    renderedSeconds: round(renderedSeconds),
    deltaSeconds: round(deltaSeconds),
    toleranceSeconds: round(toleranceSeconds),
    status: absolute <= toleranceSeconds ? "pass" : absolute <= toleranceSeconds * 2 ? "warning" : "fail",
  };
}

function backendMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown FluidSynth error";
  const value = error as { code?: unknown; stderr?: unknown; message?: unknown };
  const stderr = typeof value.stderr === "string" ? value.stderr.trim().split(/\r?\n/).slice(-1)[0] : undefined;
  return stderr || (typeof value.message === "string" ? value.message : "unknown FluidSynth error");
}

function isMissingExecutable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as ExecFileException & { code?: string | number }).code;
  return code === "ENOENT" || code === "ENOTDIR" || code === 127;
}

function assertOutputWav(bytes: Uint8Array): void {
  if (bytes.length < 44) throw new MidiRendererError("INVALID_WAV", "FluidSynth produced an empty or truncated WAV");
}

export function createFluidSynthRenderer(options: MidiRendererOptions = {}): MidiAudioRenderer {
  const config = resolveFluidSynthConfig(options);
  const execFile = options.execFile ?? execFileDefault;
  return {
    id: "fluidsynth",
    version: "pcm16-v1",
    async render(input: MidiRenderInput): Promise<MidiRenderResult> {
      const midiPath = pathValue(input.midiPath, "MIDI")!;
      const outputPath = pathValue(input.outputPath, "output")!;
      await validateOutputPath(outputPath, midiPath);
      const soundfontPath = pathValue(input.soundfontPath ?? config.soundfontPath, "SoundFont");
      if (!soundfontPath) {
        throw new MidiRendererError("SOUNDFONT_UNAVAILABLE", "SoundFont unavailable. Set KEYSPILLI_SOUNDFONT or pass soundfontPath.");
      }
      const sampleRate = configuredNumber(input.sampleRate, config.sampleRate, "sample rate", (n) => Number.isInteger(n) && n >= MIN_SAMPLE_RATE && n <= MAX_SAMPLE_RATE);
      const gain = configuredNumber(input.gain, config.gain, "gain", (n) => n > 0 && n <= 10);
      const midi = await regularFile(midiPath, "MIDI");
      const soundfont = await regularFile(soundfontPath, "SoundFont");
      let parsed: ParsedMidi;
      try {
        parsed = parseMidi(midi.bytes);
      } catch (error) {
        throw new MidiRendererError("INVALID_INPUT", `Invalid MIDI file: ${midiPath}`, error);
      }
      const expectedSeconds = midiExpectedDuration(parsed);
      const args = buildFluidSynthArgs({ midiPath, outputPath, soundfontPath, sampleRate, gain });
      try {
        await unlink(outputPath).catch(() => undefined);
        await execFile(config.executable, args, {
          shell: false,
          timeout: config.timeoutMs,
          maxBuffer: MAX_EXEC_OUTPUT,
          windowsHide: true,
        });
      } catch (error) {
        if (isMissingExecutable(error)) {
          throw new MidiRendererError("BACKEND_UNAVAILABLE", "FluidSynth unavailable. Install FluidSynth or set KEYSPILLI_FLUIDSYNTH.", error);
        }
        throw new MidiRendererError("RENDER_FAILED", `FluidSynth render failed: ${backendMessage(error)}`, error);
      }
      let rendered: FileBytes;
      try {
        rendered = await regularFile(outputPath, "Rendered WAV");
      } catch (error) {
        throw new MidiRendererError("INVALID_WAV", `FluidSynth did not create a readable WAV at ${outputPath}`, error);
      }
      assertOutputWav(rendered.bytes);
      const decoded = decodeWav(rendered.bytes);
      const canonical = canonicalPcm16Wav(decoded, config.targetPeak);
      await writeFile(outputPath, canonical.bytes);
      const wavSha = hashBytes(canonical.bytes);
      const wavInfo = {
        path: outputPath,
        bytes: canonical.bytes.byteLength,
        ...canonical.metrics,
        sha256: wavSha,
      };
      return {
        renderer: {
          id: "fluidsynth",
          version: "pcm16-v1",
          executable: config.executable,
          sampleRate,
          gain,
          targetPeak: config.targetPeak,
        },
        midi: {
          path: midiPath,
          sha256: midi.sha256,
          tempoBpm: parsed.tempoBpm,
          durationBeats: parsed.durationBeats,
          expectedSeconds,
        },
        soundfont: { path: soundfontPath, bytes: soundfont.size, sha256: soundfont.sha256 },
        wav: wavInfo,
        duration: durationValidation(expectedSeconds, canonical.metrics.durationSeconds),
      };
    },
  };
}

/** Convenience one-shot API for scripts that do not need a renderer object. */
export function renderMidiToWav(input: MidiRenderInput, options: MidiRendererOptions = {}): Promise<MidiRenderResult> {
  return createFluidSynthRenderer(options).render(input);
}
