/** Structural audio-delivery checks, not listening or musical approval. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { midiBeatToNativeSeconds, parseMidi } from "@keyspilli/midi";
import { validateMidiRenderDuration, type MidiRenderResult } from "../../../../packages/catalog/src/midi-renderer.js";

export const previewHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The maintained renderer emits this exact 44-byte canonical PCM16 header. */
export function inspectPreviewPcm(bytes: Uint8Array) {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(b.length >= 44 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 16) === "WAVEfmt "
    && b.toString("ascii", 36, 40) === "data", "preview must be canonical PCM16 WAV");
  const channels = b.readUInt16LE(22), sampleRate = b.readUInt32LE(24), dataBytes = b.readUInt32LE(40);
  assert(b.readUInt32LE(4) === b.length - 8 && b.readUInt32LE(16) === 16 && b.readUInt16LE(20) === 1
    && b.readUInt16LE(34) === 16 && channels >= 1 && channels <= 32 && sampleRate >= 8000 && sampleRate <= 192000
    && b.readUInt16LE(32) === channels * 2 && b.readUInt32LE(28) === sampleRate * channels * 2
    && dataBytes === b.length - 44 && dataBytes > 0 && dataBytes % (channels * 2) === 0, "invalid or empty preview PCM framing");
  let sum = 0, peak = 0, clippingCount = 0;
  for (let i = 44; i < b.length; i += 2) {
    const sample = Math.abs(b.readInt16LE(i)); peak = Math.max(peak, sample / 32768);
    sum += (sample / 32768) ** 2; if (sample >= 32767) clippingCount++;
  }
  const frameCount = dataBytes / (2 * channels);
  return { sampleRate, channels, frameCount, durationSeconds: frameCount / sampleRate,
    rms: Math.sqrt(sum / (dataBytes / 2)), peak, clippingCount };
}

export function validatePreview(result: MidiRenderResult, midi: Uint8Array, wav: Uint8Array): string[] {
  const parsed = parseMidi(midi), pcm = inspectPreviewPcm(wav);
  assert(parsed.notes.length > 0, "source MIDI contains no piano notes");
  const expected = midiBeatToNativeSeconds(parsed, parsed.durationBeats);
  assert(Number.isFinite(expected) && expected > 0, "invalid source MIDI duration");
  assert(result.midi.sha256 === previewHash(midi) && Math.abs(result.midi.expectedSeconds - expected) < 1e-6, "rendered MIDI identity or clock differs");
  assert(result.wav.sha256 === previewHash(wav) && result.wav.bytes === wav.byteLength, "preview bytes differ from renderer receipt");
  assert(result.wav.frameCount === pcm.frameCount && result.wav.channels === pcm.channels && result.wav.sampleRate === pcm.sampleRate
    && Math.abs(result.wav.durationSeconds - pcm.durationSeconds) < 1e-6, "preview PCM differs from reported duration");
  assert(pcm.rms > 0 && pcm.clippingCount === 0 && result.wav.clippingCount === 0 && result.wav.rawClippingCount === 0,
    "silent or clipped preview audio");
  const duration = validateMidiRenderDuration(expected, result.wav.durationSeconds);
  assert.deepEqual(result.duration, duration, "preview duration receipt differs from actual clocks");
  assert(duration.status !== "fail", "preview duration failed: truncated source or excessive tail");
  return duration.status === "warning" ? [`Duration warning: ${duration.deltaSeconds}s extra release tail requires review.`] : [];
}
