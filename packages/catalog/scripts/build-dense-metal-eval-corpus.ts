#!/usr/bin/env node

/** Build the frozen, project-owned dense-metal AMT corpus outside the repo. */
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeMidi, type Note } from "@keyspilli/midi";

type Role = "rhythm-guitar" | "bass" | "lead" | "harmony" | "drums";

export interface DenseMetalEvent {
  role: Role;
  midi: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
}

export interface DenseMetalFixture {
  id: "METAL_A_TIGHT_RIFF" | "METAL_B_DENSE_EXTREME" | "METAL_C_LAYERED_MELODIC";
  texture: "tight-riff-chug" | "dense-extreme-rapid" | "layered-melodic-harmonic";
  bpm: number;
  meter: [4, 4];
  durationBeats: number;
  events: DenseMetalEvent[];
}

export interface DenseMetalCorpusManifest {
  schemaVersion: 1;
  corpusId: "dense-metal-amt-eval-corpus-v1";
  evidenceClass: "SYNTHETIC_DENSE_METAL_FULL_REFERENCE";
  alignmentAuthority: "SYMBOLIC_RENDER_NATIVE_ALIGNMENT";
  rights: { composition: "PROJECT_OWNED"; renderer: "PROJECT_OWNED_PROCEDURAL_SYNTH"; thirdPartyAssets: false };
  firewall: { classification: "EVAL_ONLY"; generation: false; training: false; tuning: false };
  renderer: { id: "keyspilli-procedural-metal-v1"; sampleRate: number; channels: 2; bitsPerSample: 16; targetPeak: 0.92; externalAssets: [] };
  fixtures: Array<{
    id: DenseMetalFixture["id"];
    texture: DenseMetalFixture["texture"];
    bpm: number;
    meter: [4, 4];
    durationBeats: number;
    durationSeconds: number;
    roles: Role[];
    noteCount: number;
    metrics: { medianIoiBeats: number; p10IoiBeats: number; maxSimultaneousPitchedNotes: number; notesPerSecond: number; roleCount: number };
    artifacts: {
      canonicalEvents: { logicalRef: string; sha256: string };
      midi: { logicalRef: string; sha256: string; bytes: number };
      fullMix: { logicalRef: string; sha256: string; canonicalPcmSha256: string; bytes: number };
    };
  }>;
  determinism: { canonicalSha256: string };
}

export interface BuildDenseMetalCorpusOptions {
  out: string;
  sampleRate?: number;
}

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ROLE_ORDER: Role[] = ["rhythm-guitar", "bass", "lead", "harmony", "drums"];
const TRACK: Record<Role, { name: string; channel: number; program?: number; percussion?: boolean }> = {
  "rhythm-guitar": { name: "Rhythm Guitar", channel: 1, program: 30 },
  bass: { name: "Electric Bass", channel: 2, program: 34 },
  lead: { name: "Lead", channel: 3, program: 81 },
  harmony: { name: "Harmony", channel: 4, program: 48 },
  drums: { name: "Drums", channel: 9, percussion: true },
};

const round = (value: number, digits = 6): number => Number(value.toFixed(digits));
const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function event(role: Role, midi: number, startBeat: number, durationBeats: number, velocity: number): DenseMetalEvent {
  return { role, midi, startBeat: round(startBeat), durationBeats: round(durationBeats), velocity };
}

function power(events: DenseMetalEvent[], root: number, start: number, duration: number, velocity: number, octave = false): void {
  events.push(event("rhythm-guitar", root, start, duration, velocity), event("rhythm-guitar", root + 7, start, duration, velocity - 4));
  if (octave) events.push(event("rhythm-guitar", root + 12, start, duration, velocity - 8));
}

function drums(events: DenseMetalEvent[], durationBeats: number, step: number, blast = false): void {
  for (let start = 0; start < durationBeats; start += step) {
    const index = Math.round(start / step);
    events.push(event("drums", index % 16 === 15 ? 49 : 42, start, Math.min(step * 0.8, 0.15), index % 4 === 0 ? 104 : 82));
    if (index % (blast ? 2 : 4) === 0) events.push(event("drums", 36, start, 0.12, 116));
    if (index % (blast ? 2 : 8) === (blast ? 1 : 4)) events.push(event("drums", 38, start, 0.12, 112));
  }
}

function tightRiff(): DenseMetalFixture {
  const events: DenseMetalEvent[] = [];
  const roots = [40, 40, 43, 42, 40, 45, 43, 42];
  for (let start = 0; start < 64; start += 0.25) {
    const root = roots[Math.floor(start) % roots.length]!;
    power(events, root, start, 0.2, Math.round(start * 4) % 4 === 0 ? 112 : 96, Math.round(start * 4) % 8 === 0);
  }
  for (let start = 0; start < 64; start += 0.5) events.push(event("bass", roots[Math.floor(start) % roots.length]! - 12, start, 0.42, 104));
  const melody = [64, 67, 69, 67, 71, 69, 67, 64];
  for (let start = 32; start < 64; start += 1) events.push(event("lead", melody[(start - 32) % melody.length]!, start, 0.82, 102));
  drums(events, 64, 0.25);
  return { id: "METAL_A_TIGHT_RIFF", texture: "tight-riff-chug", bpm: 120, meter: [4, 4], durationBeats: 64, events };
}

function denseExtreme(): DenseMetalFixture {
  const events: DenseMetalEvent[] = [];
  const roots = [35, 36, 38, 35, 41, 40, 38, 36];
  for (let start = 0; start < 96; start += 0.25) power(events, roots[Math.floor(start * 2) % roots.length]!, start, 0.18, 108, true);
  for (let start = 0; start < 96; start += 0.5) events.push(event("bass", roots[Math.floor(start * 2) % roots.length]! - 12, start, 0.4, 108));
  const lead = [71, 74, 76, 79, 78, 76, 74, 71, 83, 81, 79, 76];
  for (let start = 24; start < 96; start += 0.5) events.push(event("lead", lead[Math.round((start - 24) * 2) % lead.length]!, start, 0.38, 104));
  drums(events, 96, 0.125, true);
  return { id: "METAL_B_DENSE_EXTREME", texture: "dense-extreme-rapid", bpm: 180, meter: [4, 4], durationBeats: 96, events };
}

function layeredMelodic(): DenseMetalFixture {
  const events: DenseMetalEvent[] = [];
  const roots = [38, 41, 45, 43, 38, 46, 45, 41];
  for (let start = 0; start < 80; start += 0.5) power(events, roots[Math.floor(start / 4) % roots.length]!, start, 0.42, 98, Math.round(start * 2) % 4 === 0);
  for (let start = 0; start < 80; start += 1) events.push(event("bass", roots[Math.floor(start / 4) % roots.length]! - 12, start, 0.85, 100));
  const melody = [69, 72, 74, 76, 74, 72, 69, 67, 69, 72, 77, 76, 74, 72, 71, 69];
  for (let start = 0; start < 80; start += 0.5) events.push(event("lead", melody[Math.round(start * 2) % melody.length]!, start, 0.44, 106));
  for (let start = 0; start < 80; start += 4) {
    const root = roots[Math.floor(start / 4) % roots.length]! + 24;
    events.push(event("harmony", root, start, 3.7, 72), event("harmony", root + 3, start, 3.7, 68), event("harmony", root + 7, start, 3.7, 68));
  }
  drums(events, 80, 0.25);
  return { id: "METAL_C_LAYERED_MELODIC", texture: "layered-melodic-harmonic", bpm: 150, meter: [4, 4], durationBeats: 80, events };
}

export function denseMetalFixtures(): DenseMetalFixture[] {
  return [tightRiff(), denseExtreme(), layeredMelodic()].map((fixture) => ({
    ...fixture,
    events: fixture.events.sort((left, right) => left.startBeat - right.startBeat || ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role) || left.midi - right.midi || left.durationBeats - right.durationBeats),
  }));
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return round(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower));
}

function fixtureMetrics(fixture: DenseMetalFixture): DenseMetalCorpusManifest["fixtures"][number]["metrics"] {
  const pitched = fixture.events.filter((item) => item.role !== "drums");
  const starts = [...new Set(pitched.map((item) => item.startBeat))].sort((a, b) => a - b);
  const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
  const boundaries = pitched.flatMap((item) => [{ beat: item.startBeat, change: 1 }, { beat: item.startBeat + item.durationBeats, change: -1 }])
    .sort((left, right) => left.beat - right.beat || left.change - right.change);
  let active = 0;
  let max = 0;
  for (const boundary of boundaries) {
    active += boundary.change;
    max = Math.max(max, active);
  }
  return {
    medianIoiBeats: quantile(gaps, 0.5),
    p10IoiBeats: quantile(gaps, 0.1),
    maxSimultaneousPitchedNotes: max,
    notesPerSecond: round(fixture.events.length / (fixture.durationBeats * 60 / fixture.bpm), 3),
    roleCount: new Set(fixture.events.map((item) => item.role)).size,
  };
}

function midiBytes(fixture: DenseMetalFixture): Uint8Array {
  const tracks = ROLE_ORDER.filter((role) => fixture.events.some((item) => item.role === role)).map((role) => {
    const config = TRACK[role];
    const notes: Note[] = fixture.events.filter((item) => item.role === role).map((item) => ({ midi: item.midi, start: item.startBeat, dur: item.durationBeats, vel: item.velocity }));
    return { ...config, notes };
  });
  return writeMidi(tracks.flatMap((track) => track.notes), { tempoBpm: fixture.bpm, timeSig: fixture.meter, title: fixture.id, tracks });
}

function xorshift(value: number): number {
  let next = value | 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next | 0;
}

function envelope(time: number, duration: number, release = 0.03): number {
  return Math.min(1, time / 0.004) * Math.min(1, Math.max(0, duration - time) / release);
}

function renderFixture(fixture: DenseMetalFixture, sampleRate: number): { wav: Uint8Array; pcmSha256: string } {
  const durationSeconds = fixture.durationBeats * 60 / fixture.bpm;
  const frames = Math.round(durationSeconds * sampleRate);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  fixture.events.forEach((item, eventIndex) => {
    const start = Math.round(item.startBeat * 60 / fixture.bpm * sampleRate);
    const duration = item.durationBeats * 60 / fixture.bpm;
    const count = Math.min(frames - start, Math.max(1, Math.round(duration * sampleRate)));
    const frequency = 440 * 2 ** ((item.midi - 69) / 12);
    let noise = (eventIndex + 1) * 0x9e3779b1;
    for (let index = 0; index < count; index += 1) {
      const time = index / sampleRate;
      const env = envelope(time, duration, item.role === "harmony" ? 0.16 : 0.035);
      let sample = 0;
      let pan = 0;
      if (item.role === "rhythm-guitar") {
        const raw = Math.sin(2 * Math.PI * frequency * time) + 0.55 * Math.sin(4 * Math.PI * frequency * time) + 0.3 * Math.sin(6 * Math.PI * frequency * time);
        sample = Math.tanh(raw * 3.2) * env * 0.22;
        pan = item.midi % 2 ? -0.28 : 0.28;
      } else if (item.role === "bass") {
        sample = (0.75 * Math.sin(2 * Math.PI * frequency * time) + 0.25 * Math.sin(4 * Math.PI * frequency * time)) * env * Math.exp(-time * 0.7) * 0.38;
      } else if (item.role === "lead") {
        const vibrato = 1 + 0.003 * Math.sin(2 * Math.PI * 5.5 * time);
        sample = Math.tanh((Math.sin(2 * Math.PI * frequency * vibrato * time) + 0.35 * Math.sin(4 * Math.PI * frequency * time)) * 1.8) * env * 0.25;
        pan = 0.18;
      } else if (item.role === "harmony") {
        sample = (Math.sin(2 * Math.PI * frequency * time) + 0.22 * Math.sin(4 * Math.PI * frequency * time)) * env * 0.11;
        pan = -0.12;
      } else {
        noise = xorshift(noise);
        const white = noise / 0x80000000;
        const decay = Math.exp(-time * (item.midi === 49 ? 8 : item.midi === 42 ? 25 : 16));
        if (item.midi === 36) sample = Math.sin(2 * Math.PI * (58 - 20 * time) * time) * Math.exp(-time * 22) * 0.65;
        else if (item.midi === 38) sample = (white * 0.7 + Math.sin(2 * Math.PI * 180 * time) * 0.3) * decay * 0.42;
        else sample = white * decay * (item.midi === 49 ? 0.28 : 0.18);
        pan = item.midi === 42 ? 0.32 : item.midi === 49 ? -0.32 : 0;
      }
      const velocity = item.velocity / 127;
      left[start + index]! += sample * velocity * (1 - pan);
      right[start + index]! += sample * velocity * (1 + pan);
    }
  });
  let peak = 0;
  for (let index = 0; index < frames; index += 1) peak = Math.max(peak, Math.abs(left[index]!), Math.abs(right[index]!));
  const scale = peak > 0 ? 0.92 / peak : 1;
  const pcm = new Uint8Array(frames * 4);
  const pcmView = new DataView(pcm.buffer);
  for (let index = 0; index < frames; index += 1) {
    pcmView.setInt16(index * 4, Math.round(Math.max(-1, Math.min(1, left[index]! * scale)) * 32767), true);
    pcmView.setInt16(index * 4 + 2, Math.round(Math.max(-1, Math.min(1, right[index]! * scale)) * 32767), true);
  }
  const wav = new Uint8Array(44 + pcm.length);
  const view = new DataView(wav.buffer);
  const ascii = (offset: number, value: string): void => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, wav.length - 8, true); ascii(8, "WAVE"); ascii(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); ascii(36, "data"); view.setUint32(40, pcm.length, true);
  wav.set(pcm, 44);
  return { wav, pcmSha256: sha256(pcm) };
}

function canonicalFixtureJson(fixture: DenseMetalFixture): string {
  return `${JSON.stringify({ schemaVersion: 1, id: fixture.id, evidenceClass: "SYNTHETIC_DENSE_METAL_FULL_REFERENCE", bpm: fixture.bpm, meter: fixture.meter, durationBeats: fixture.durationBeats, events: fixture.events })}\n`;
}

function canonicalManifestJson(value: Omit<DenseMetalCorpusManifest, "determinism">): string {
  return JSON.stringify(value);
}

export async function buildDenseMetalEvalCorpus(options: BuildDenseMetalCorpusOptions): Promise<DenseMetalCorpusManifest> {
  if (!isAbsolute(options.out)) throw new Error("--out must be an absolute path");
  const sampleRate = options.sampleRate ?? 44_100;
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 96_000) throw new Error("sampleRate must be an integer from 8000 to 96000");
  await mkdir(options.out, { recursive: true });
  const output = await realpath(options.out);
  const child = relative(REPOSITORY_ROOT, output);
  if (child === "" || (!child.startsWith("..") && !isAbsolute(child))) throw new Error("--out must be outside the repository");
  const rows: DenseMetalCorpusManifest["fixtures"] = [];
  for (const fixture of denseMetalFixtures()) {
    const directory = resolve(output, fixture.id);
    await mkdir(directory, { recursive: true });
    const canonical = canonicalFixtureJson(fixture);
    const midi = midiBytes(fixture);
    const rendered = renderFixture(fixture, sampleRate);
    await writeFile(resolve(directory, "events.json"), canonical);
    await writeFile(resolve(directory, "ground-truth.mid"), midi);
    await writeFile(resolve(directory, "full-mix.wav"), rendered.wav);
    rows.push({
      id: fixture.id,
      texture: fixture.texture,
      bpm: fixture.bpm,
      meter: fixture.meter,
      durationBeats: fixture.durationBeats,
      durationSeconds: round(fixture.durationBeats * 60 / fixture.bpm, 3),
      roles: ROLE_ORDER.filter((role) => fixture.events.some((item) => item.role === role)),
      noteCount: fixture.events.length,
      metrics: fixtureMetrics(fixture),
      artifacts: {
        canonicalEvents: { logicalRef: `${fixture.id}/events.json`, sha256: sha256(canonical) },
        midi: { logicalRef: `${fixture.id}/ground-truth.mid`, sha256: sha256(midi), bytes: midi.byteLength },
        fullMix: { logicalRef: `${fixture.id}/full-mix.wav`, sha256: sha256(rendered.wav), canonicalPcmSha256: rendered.pcmSha256, bytes: rendered.wav.byteLength },
      },
    });
  }
  const base = {
    schemaVersion: 1 as const,
    corpusId: "dense-metal-amt-eval-corpus-v1" as const,
    evidenceClass: "SYNTHETIC_DENSE_METAL_FULL_REFERENCE" as const,
    alignmentAuthority: "SYMBOLIC_RENDER_NATIVE_ALIGNMENT" as const,
    rights: { composition: "PROJECT_OWNED" as const, renderer: "PROJECT_OWNED_PROCEDURAL_SYNTH" as const, thirdPartyAssets: false as const },
    firewall: { classification: "EVAL_ONLY" as const, generation: false as const, training: false as const, tuning: false as const },
    renderer: { id: "keyspilli-procedural-metal-v1" as const, sampleRate, channels: 2 as const, bitsPerSample: 16 as const, targetPeak: 0.92 as const, externalAssets: [] as [] },
    fixtures: rows,
  };
  const manifest: DenseMetalCorpusManifest = { ...base, determinism: { canonicalSha256: sha256(canonicalManifestJson(base)) } };
  await writeFile(resolve(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function usage(): string {
  return "Usage: build-dense-metal-eval-corpus.ts --out ABSOLUTE_DIRECTORY [--sample-rate N]";
}

function parseArgs(argv: readonly string[]): BuildDenseMetalCorpusOptions {
  let out = "";
  let sampleRate: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out") out = argv[++index] ?? "";
    else if (argv[index] === "--sample-rate") sampleRate = Number(argv[++index]);
    else if (argv[index] === "--help" || argv[index] === "-h") throw new Error(usage());
    else throw new Error(`unknown option: ${argv[index]}\n${usage()}`);
  }
  if (!out) throw new Error(usage());
  return { out, ...(sampleRate === undefined ? {} : { sampleRate }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildDenseMetalEvalCorpus(parseArgs(process.argv.slice(2)))
    .then((manifest) => process.stdout.write(`${JSON.stringify({ status: "ready", corpusId: manifest.corpusId, fixtures: manifest.fixtures.length, manifestSha256: manifest.determinism.canonicalSha256 })}\n`))
    .catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
