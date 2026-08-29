#!/usr/bin/env node
/**
 * Build a local, deterministic listening bundle from already-generated MIDI.
 *
 * This is evaluation tooling only: it reads explicit local MIDI files,
 * renders them through the optional FluidSynth adapter, and writes WAVs and a
 * path-safe manifest.  It never reads or mutates catalog state.
 */
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  createFluidSynthRenderer,
  type MidiRenderResult,
} from "../src/midi-renderer.js";
import {
  canonicalListeningManifestJson,
  createBlindAliases,
  createBlankListeningWorksheet,
  createListeningManifest,
  renderListeningWorksheetMarkdown,
  type ListeningAudioDiagnostics,
  type ListeningCandidateInput,
  type ListeningExcerptRecord,
  type ListeningManifest,
} from "../src/listening-manifest.js";

const execFile = promisify(execFileCallback);
const DEFAULT_SAMPLE_RATE = 44_100;
const DEFAULT_GAIN = 1;
const DEFAULT_TARGET_PEAK = 10 ** (-1 / 20); // fixed -1 dBFS peak

interface CliOptions {
  out: string;
  metalDir: string;
  pianoRoot?: string;
  soundfont?: string;
  executable?: string;
  sampleRate: number;
  gain: number;
  targetPeak: number;
}

interface SourceCandidate {
  id: string;
  label: string;
  sourceType: string;
  midiPath: string;
  midiRelative: string;
  group: string;
  name: string;
}

interface RenderedCandidate extends SourceCandidate {
  wavPath: string;
  wavRelative: string;
  result: MidiRenderResult;
}

interface ExcerptSpec {
  id: string;
  label: string;
  startSeconds: number;
  endSeconds: number;
}

const EXCERPTS: readonly ExcerptSpec[] = [
  { id: "opening", label: "Opening", startSeconds: 0, endSeconds: 30 },
  { id: "chorus", label: "Main section / chorus", startSeconds: 80, endSeconds: 110 },
  { id: "solo", label: "Solo / lead-heavy section", startSeconds: 176, endSeconds: 192 },
  { id: "full", label: "Common full-song window", startSeconds: 0, endSeconds: 225 },
];

function usage(): string {
  return [
    "Usage: build-listening-bundle.ts --out DIR --metal-dir DIR [options]",
    "  --out DIR              Local output directory",
    "  --metal-dir DIR        Existing arrangement MIDI directory",
    "  --piano-root DIR       Existing piano preview root (youtube-* subdirs)",
    "  --soundfont FILE       SoundFont path (or KEYSPILLI_SOUNDFONT)",
    "  --executable FILE      FluidSynth executable (or KEYSPILLI_FLUIDSYNTH)",
    "  --sample-rate N        Output sample rate (default 44100)",
    "  --gain N               Fixed FluidSynth gain (default 1)",
    "  --target-peak N        PCM peak target 0..1 (default -1 dBFS)",
  ].join("\n");
}

function nextValue(argv: readonly string[], index: number, option: string): [string, number] {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value\n${usage()}`);
  return [value, index + 1];
}

function finiteNumber(value: string, option: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${option} must be finite: ${value}`);
  return number;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let out: string | undefined;
  let metalDir: string | undefined;
  let pianoRoot: string | undefined;
  let soundfont: string | undefined;
  let executable: string | undefined;
  let sampleRate = DEFAULT_SAMPLE_RATE;
  let gain = DEFAULT_GAIN;
  let targetPeak = DEFAULT_TARGET_PEAK;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const equal = arg.indexOf("=");
    const option = equal >= 0 ? arg.slice(0, equal) : arg;
    const inline = equal >= 0 ? arg.slice(equal + 1) : undefined;
    const value = (): string => {
      if (inline !== undefined) return inline;
      const next = nextValue(argv, index, option);
      index = next[1];
      return next[0];
    };
    switch (option) {
      case "--out": out = value(); break;
      case "--metal-dir": metalDir = value(); break;
      case "--piano-root": pianoRoot = value(); break;
      case "--soundfont": soundfont = value(); break;
      case "--executable": executable = value(); break;
      case "--sample-rate": sampleRate = finiteNumber(value(), option); break;
      case "--gain": gain = finiteNumber(value(), option); break;
      case "--target-peak": targetPeak = finiteNumber(value(), option); break;
      case "--help": case "-h": throw new Error(usage());
      default: throw new Error(`unknown option: ${arg}\n${usage()}`);
    }
  }
  if (!out || !metalDir) throw new Error("--out and --metal-dir are required\n" + usage());
  return { out: resolve(out), metalDir: resolve(metalDir), ...(pianoRoot ? { pianoRoot: resolve(pianoRoot) } : {}), ...(soundfont ? { soundfont: resolve(soundfont) } : {}), ...(executable ? { executable } : {}), sampleRate, gain, targetPeak };
}

async function exists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function requireDirectory(path: string, label: string): Promise<void> {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) throw new Error(`${label} is not a directory: ${path}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${label} is not a directory`)) throw error;
    throw new Error(`${label} is unavailable: ${path}`);
  }
}

function safeName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "candidate";
}

function pianoSlug(directory: string): string {
  const id = basename(directory);
  if (/1A1wtcNuql8/i.test(id)) return "gabi";
  if (/MEkDK7PtnwE/i.test(id)) return "pianopaul";
  if (/yq6US1oEsgk/i.test(id)) return "posle";
  return safeName(id.replace(/^youtube[-_]?/i, ""));
}

function pianoLabel(slug: string): string {
  return slug === "gabi" ? "Piano cover — Gabi"
    : slug === "pianopaul" ? "Piano cover — PianoPaul05"
      : slug === "posle" ? "Piano cover — Pøsle The Goat"
        : `Piano preview — ${slug}`;
}

async function discoverSources(options: CliOptions): Promise<SourceCandidate[]> {
  await requireDirectory(options.metalDir, "metal MIDI directory");
  const sources: SourceCandidate[] = [];
  const metalNames: Array<[string, string, string]> = [
    ["arrangement", "Direct metal — canonical arrangement", "direct-metal"],
    ["easy", "Direct metal — Easy", "direct-metal"],
    ["medium", "Direct metal — Medium", "direct-metal"],
    ["advanced", "Direct metal — Advanced", "direct-metal"],
  ];
  for (const [name, label, sourceType] of metalNames) {
    const midiPath = join(options.metalDir, `${name}.mid`);
    if (await exists(midiPath)) sources.push({
      id: `direct-metal-${name}`,
      label,
      sourceType,
      midiPath,
      midiRelative: `source/metal/${name}.mid`,
      group: "direct-metal",
      name,
    });
  }
  if (options.pianoRoot) {
    await requireDirectory(options.pianoRoot, "piano preview root");
    const directories = (await readdir(options.pianoRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(options.pianoRoot!, entry.name))
      .sort();
    for (const directory of directories) {
      const slug = pianoSlug(directory);
      const label = pianoLabel(slug);
      const names = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /\.(?:mid|midi)$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
      for (const file of names) {
        const stem = file.replace(/\.(?:mid|midi)$/i, "").toLowerCase();
        const level = stem === "easy" ? "easy" : stem === "medium" ? "medium" : stem;
        const id = `${slug}-${level}`;
        sources.push({
          id,
          label: `${label} — ${file.replace(/\.(?:mid|midi)$/i, "")}`,
          sourceType: "piano-cover-video",
          midiPath: join(directory, file),
          midiRelative: `source/${safeName(slug)}/${file}`,
          group: slug,
          name: level,
        });
      }
    }
  }
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function findChunk(view: DataView, wanted: string): { offset: number; length: number } {
  if (view.byteLength < 12 || String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== "RIFF"
    || String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)) !== "WAVE") {
    throw new Error("rendered file is not a RIFF/WAVE file");
  }
  for (let offset = 12; offset + 8 <= view.byteLength;) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const length = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + length > view.byteLength) throw new Error(`truncated WAV ${id} chunk`);
    if (id === wanted) return { offset: dataOffset, length };
    offset = dataOffset + length + (length & 1);
  }
  throw new Error(`WAV is missing ${wanted} chunk`);
}

async function sliceWavFile(inputPath: string, outputPath: string, startSeconds: number, endSeconds: number): Promise<void> {
  const bytes = new Uint8Array(await readFile(inputPath));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fmt = findChunk(view, "fmt ");
  const format = view.getUint16(fmt.offset, true);
  const channels = view.getUint16(fmt.offset + 2, true);
  const sampleRate = view.getUint32(fmt.offset + 4, true);
  const bits = view.getUint16(fmt.offset + 14, true);
  const data = findChunk(view, "data");
  if (format !== 1 || bits !== 16 || ![1, 2].includes(channels) || !Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new Error("listening excerpts require canonical PCM16 WAV");
  }
  const bytesPerFrame = channels * 2;
  const totalFrames = Math.floor(data.length / bytesPerFrame);
  const startFrame = Math.max(0, Math.min(totalFrames, Math.floor(startSeconds * sampleRate)));
  const endFrame = Math.max(startFrame, Math.min(totalFrames, Math.ceil(endSeconds * sampleRate)));
  const payload = bytes.slice(data.offset + startFrame * bytesPerFrame, data.offset + endFrame * bytesPerFrame);
  const header = new ArrayBuffer(44);
  const h = new DataView(header);
  writeAscii(h, 0, "RIFF");
  h.setUint32(4, 36 + payload.length, true);
  writeAscii(h, 8, "WAVE");
  writeAscii(h, 12, "fmt ");
  h.setUint32(16, 16, true);
  h.setUint16(20, 1, true);
  h.setUint16(22, channels, true);
  h.setUint32(24, sampleRate, true);
  h.setUint32(28, sampleRate * bytesPerFrame, true);
  h.setUint16(32, bytesPerFrame, true);
  h.setUint16(34, 16, true);
  writeAscii(h, 36, "data");
  h.setUint32(40, payload.length, true);
  await mkdir(dirname(outputPath), { recursive: true });
  const output = new Uint8Array(44 + payload.length);
  output.set(new Uint8Array(header), 0);
  output.set(payload, 44);
  await writeFile(outputPath, output);
}

async function fluidSynthVersion(executable: string): Promise<string> {
  try {
    const result = await execFile(executable, ["--version"], { timeout: 30_000, maxBuffer: 1_000_000 });
    const text = `${result.stdout}\n${result.stderr}`;
    return text.match(/(?:FluidSynth|fluidsynth)[^\d]*(\d+\.\d+\.\d+)/i)?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

function audioDiagnostics(result: MidiRenderResult): ListeningAudioDiagnostics {
  return {
    bytes: result.wav.bytes,
    sampleRate: result.wav.sampleRate,
    channels: result.wav.channels === 1 ? 1 : 2,
    frameCount: result.wav.frameCount,
    sampleCount: result.wav.sampleCount,
    durationSeconds: result.wav.durationSeconds,
    peak: result.wav.peak,
    rms: result.wav.rms,
    silenceRatio: result.wav.silenceRatio,
    clippingCount: result.wav.clippingCount,
    sha256: result.wav.sha256,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function build(options: CliOptions): Promise<void> {
  const sources = await discoverSources(options);
  if (!sources.length) throw new Error("no MIDI candidates found in the supplied directories");
  await mkdir(options.out, { recursive: true });
  const soundfontPath = options.soundfont ?? process.env.KEYSPILLI_SOUNDFONT;
  if (!soundfontPath) throw new Error("SoundFont unavailable. Set KEYSPILLI_SOUNDFONT or pass --soundfont.");
  const executable = options.executable ?? process.env.KEYSPILLI_FLUIDSYNTH ?? "fluidsynth";
  const soundfontInfo = await stat(soundfontPath).catch(() => undefined);
  if (!soundfontInfo?.isFile()) throw new Error(`SoundFont unavailable: ${soundfontPath}`);
  const renderer = createFluidSynthRenderer({
    soundfontPath,
    executable,
    sampleRate: options.sampleRate,
    gain: options.gain,
    targetPeak: options.targetPeak,
  });
  const rendered: RenderedCandidate[] = [];
  const failures: Array<{ id: string; error: string }> = [];
  for (const source of sources) {
    const wavRelative = `descriptive/${safeName(source.group)}/${safeName(source.name)}.wav`;
    const wavPath = join(options.out, wavRelative);
    await mkdir(dirname(wavPath), { recursive: true });
    try {
      const result = await renderer.render({ midiPath: source.midiPath, outputPath: wavPath });
      rendered.push({ ...source, wavPath, wavRelative, result });
    } catch (error) {
      failures.push({ id: source.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!rendered.length) throw new Error(`all MIDI renders failed: ${failures.map((failure) => `${failure.id}: ${failure.error}`).join("; ")}`);

  const excerptArtifacts: Record<string, Record<string, string>> = {};
  for (const excerpt of EXCERPTS) {
    const directory = join(options.out, "excerpts", excerpt.id);
    await mkdir(directory, { recursive: true });
    excerptArtifacts[excerpt.id] = {};
    for (const candidate of rendered) {
      const path = join(directory, `${safeName(candidate.id)}.wav`);
      await sliceWavFile(candidate.wavPath, path, excerpt.startSeconds, excerpt.endSeconds);
      excerptArtifacts[excerpt.id]![candidate.id] = `excerpts/${excerpt.id}/${safeName(candidate.id)}.wav`;
    }
  }

  const blindSources = rendered.filter((candidate) => candidate.id.endsWith("-easy") && (
    candidate.id === "direct-metal-easy" || candidate.group === "gabi" || candidate.group === "pianopaul" || candidate.group === "posle"
  )).sort((a, b) => a.id.localeCompare(b.id));
  const blindAliases = createBlindAliases(blindSources.map((candidate) => candidate.id));
  const blindMap: Record<string, { candidateId: string; label: string }> = {};
  for (const alias of blindAliases) {
    const candidate = blindSources.find((item) => item.id === alias.candidateId)!;
    blindMap[alias.alias] = { candidateId: candidate.id, label: candidate.label };
    for (const excerpt of EXCERPTS) {
      const sourcePath = join(options.out, excerptArtifacts[excerpt.id]![candidate.id]!);
      const outputPath = join(options.out, "blind", excerpt.id, `${alias.alias}.wav`);
      await sliceWavFile(sourcePath, outputPath, 0, excerpt.endSeconds - excerpt.startSeconds);
    }
  }

  const backendVersion = await fluidSynthVersion(executable);
  const candidateInputs: ListeningCandidateInput[] = rendered.map((candidate) => ({
    id: candidate.id,
    label: candidate.label,
    sourceType: candidate.sourceType,
    midiPath: candidate.midiPath,
    wavPath: candidate.wavPath,
    midiRef: `${candidate.id}.mid`,
    wavRef: `${candidate.id}.wav`,
    expectedDurationSeconds: candidate.result.midi.expectedSeconds,
    renderedDurationSeconds: candidate.result.wav.durationSeconds,
    durationToleranceSeconds: 3,
    renderedSampleCount: candidate.result.wav.sampleCount,
    audio: audioDiagnostics(candidate.result),
  }));
  const manifest = createListeningManifest({
    renderer: {
      backend: "fluidsynth",
      version: backendVersion,
      implementation: "pcm16-v1",
      sampleRate: options.sampleRate,
      channels: rendered[0]!.result.wav.channels === 1 ? 1 : 2,
      gain: options.gain,
      soundfont: {
        identifier: basename(soundfontPath),
        sha256: rendered[0]!.result.soundfont.sha256,
        path: soundfontPath,
      },
    },
    normalization: {
      method: "peak",
      targetPeakDb: 20 * Math.log10(options.targetPeak),
      maxGainDb: 12,
      sampleRate: options.sampleRate,
      channels: rendered[0]!.result.wav.channels === 1 ? 1 : 2,
    },
    candidates: candidateInputs,
    excerpts: EXCERPTS,
    blind: false,
  });
  manifest.excerpts = manifest.excerpts.map((excerpt) => ({
    ...excerpt,
    artifacts: excerptArtifacts[excerpt.id],
  }));
  manifest.blind = { aliases: blindAliases };

  type DeterminismRecord = { status: "pending" } | { status: "pass" | "fail"; firstSha256: string; secondSha256: string };
  const localManifest = {
    ...manifest,
    generatedFrom: "explicit local MIDI inputs",
    failures,
    candidates: manifest.candidates.map((candidate) => ({
      ...candidate,
      midi: { ...candidate.midi, path: candidateInputs.find((input) => input.id === candidate.id)?.midiPath },
      wav: { ...candidate.wav, path: candidateInputs.find((input) => input.id === candidate.id)?.wavPath },
    })),
    excerpts: manifest.excerpts,
    determinism: { status: "pending" } as DeterminismRecord,
  };
  const first = rendered.find((candidate) => candidate.id === "direct-metal-easy") ?? rendered[0]!;
  const repeatPath = join(options.out, ".determinism-repeat.wav");
  let determinism: { status: "pass" | "fail"; firstSha256: string; secondSha256: string };
  try {
    const repeat = await renderer.render({ midiPath: first.midiPath, outputPath: repeatPath });
    determinism = { status: repeat.wav.sha256 === first.result.wav.sha256 ? "pass" : "fail", firstSha256: first.result.wav.sha256, secondSha256: repeat.wav.sha256 };
  } finally {
    await import("node:fs/promises").then(({ unlink }) => unlink(repeatPath).catch(() => undefined));
  }
  localManifest.determinism = determinism;
  const canonical = canonicalListeningManifestJson(manifest);
  await writeJson(join(options.out, "manifest.json"), { ...localManifest, canonicalSha256: createHash("sha256").update(canonical).digest("hex") });
  await writeFile(join(options.out, "manifest.canonical.json"), `${canonical}\n`, "utf8");
  await writeJson(join(options.out, "blind-map.json"), blindMap);
  await writeJson(join(options.out, "evidence-manifest.json"), {
    schemaVersion: 1,
    kind: "local-midi-listening-bundle",
    manifest: "manifest.json",
    canonicalManifest: "manifest.canonical.json",
    blindMap: "blind-map.json",
    renderer: localManifest.renderer,
    normalization: localManifest.normalization,
    candidates: localManifest.candidates,
    excerpts: localManifest.excerpts,
    determinism,
    failures,
  });

  const worksheet = createBlankListeningWorksheet(manifest.candidates.filter((candidate) => blindAliases.some((alias) => alias.candidateId === candidate.id)), {
    title: "Defence of Moscow — blind listening pass",
    aliases: blindAliases,
  });
  const markdown = [
    "# Keyspilli MIDI listening bundle",
    "",
    "This is a local, deterministic SoundFont render comparison. Do not infer recognizability from the automated metrics; fill in the worksheet after listening.",
    "",
    `Renderer: FluidSynth ${backendVersion} (${renderer.version}), ${options.sampleRate} Hz, fixed peak target ${options.targetPeak.toFixed(6)} (-1 dBFS).`,
    `SoundFont: ${basename(soundfontPath)} (sha256 ${rendered[0]!.result.soundfont.sha256}).`,
    "",
    "## Descriptive audio",
    ...rendered.map((candidate) => `- ${candidate.label}: [WAV](${candidate.wavPath})`),
    "",
    "## Blind audio",
    ...EXCERPTS.flatMap((excerpt) => [
      `### ${excerpt.label} (${excerpt.startSeconds}–${excerpt.endSeconds}s)`,
      ...blindAliases.map((alias) => `- ${alias.alias}: [WAV](${join(options.out, "blind", excerpt.id, `${alias.alias}.wav`)})`),
      "",
    ]),
    "## Automated diagnostics",
    "See [manifest.json](./manifest.json) and [manifest.canonical.json](./manifest.canonical.json). Duration, peak, RMS, silence, clipping, and render determinism are recorded; no audio similarity score is calculated.",
    "",
    renderListeningWorksheetMarkdown(worksheet),
    "Human listening acceptance: pending.",
  ].join("\n");
  await writeFile(join(options.out, "LISTENING.md"), markdown, "utf8");
  console.log(JSON.stringify({ out: options.out, rendered: rendered.length, failures, blindAliases, determinism }, null, 2));
}

const cliArgv = process.argv.slice(2);
if (cliArgv.includes("--help") || cliArgv.includes("-h")) {
  console.log(usage());
} else {
  try {
    await build(parseArgs(cliArgv));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
