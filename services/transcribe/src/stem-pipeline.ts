import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { writeMidi } from "@keyspilli/midi";

const execFileP = promisify(execFile);

export type StemImportMode = "auto" | "legacy" | "metal";
export type StemMidiRole = "vocals" | "bass" | "guitar" | "other" | "drums";
type PitchedStemMidiRole = Exclude<StemMidiRole, "drums">;

export interface StemPipelineConfig {
  mode: StemImportMode;
  python: string;
  basicPitch: string;
  separatorScript: string;
  drumOnsetScript: string;
  demucsModel: string;
  demucsDevice: "cpu" | "cuda" | "mps";
  separatorTimeoutMs: number;
  basicPitchTimeoutMs: number;
  minFreeBytes: number;
  onsetThreshold: number;
  frameThreshold: number;
  modelSerialization: string;
}

export interface StemMidi {
  role: StemMidiRole;
  midi: Uint8Array;
  noteSource: "vocals" | "bass" | "guitar" | "other" | "drums";
}

export interface StemPipelineReport {
  schemaVersion: 1;
  strategy: "demucs-role-stem-basic-pitch";
  separator: {
    engine: "demucs";
    version: string;
    model: string;
    device: StemPipelineConfig["demucsDevice"];
  };
  transcriber: {
    engine: "basic-pitch";
    version: string;
    serialization: string;
    onsetThreshold: number;
    frameThreshold: number;
    // Four-source fallback has no dedicated `other` transcription; report only
    // the roles that actually ran rather than fabricating a threshold entry.
    roleThresholds: Partial<Record<PitchedStemMidiRole, {
      onsetThreshold: number;
      frameThreshold: number;
    }>>;
  };
  stems: Array<{
    role: StemMidiRole;
    sourceStem: "vocals" | "bass" | "guitar" | "other" | "drums";
    midiFile: string;
    midiBytes: number;
  }>;
}

export interface StemPipelineResult {
  stems: StemMidi[];
  report: StemPipelineReport;
  artifactDir: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

export type StemCommandRunner = (
  command: string,
  args: readonly string[],
  options: { timeoutMs: number },
) => Promise<CommandResult>;

export interface StemPipelineDependencies {
  run?: StemCommandRunner;
  freeBytes?: (path: string) => Promise<number>;
  demucsVersion?: string;
  basicPitchVersion?: string;
}

const DEFAULT_SEPARATOR_TIMEOUT_MS = 2_700_000;
const DEFAULT_BASIC_PITCH_TIMEOUT_MS = 900_000;
const DEFAULT_MIN_FREE_GIB = 6;

function thresholdsForRole(
  role: PitchedStemMidiRole,
  config: StemPipelineConfig,
): { onsetThreshold: number; frameThreshold: number } {
  if (role === "guitar" || role === "other") {
    return {
      onsetThreshold: config.onsetThreshold === 0.65 ? 0.45 : config.onsetThreshold,
      frameThreshold: config.frameThreshold === 0.45 ? 0.3 : config.frameThreshold,
    };
  }
  if (role === "vocals") {
    return {
      onsetThreshold: config.onsetThreshold === 0.65 ? 0.5 : config.onsetThreshold,
      frameThreshold: config.frameThreshold === 0.45 ? 0.3 : config.frameThreshold,
    };
  }
  return { onsetThreshold: config.onsetThreshold, frameThreshold: config.frameThreshold };
}

function finiteNumber(name: string, raw: string, opts: { min: number; max?: number }): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < opts.min || (opts.max !== undefined && value > opts.max)) {
    const range = opts.max === undefined ? `>= ${opts.min}` : `between ${opts.min} and ${opts.max}`;
    throw new Error(`${name} must be ${range}, got "${raw}"`);
  }
  return value;
}

export function stemPipelineConfigFromEnv(
  env: NodeJS.ProcessEnv,
  paths: { root: string; python: string; basicPitch: string },
): StemPipelineConfig {
  const mode = env.KEYSPILLI_IMPORT_MODE ?? "auto";
  if (mode !== "auto" && mode !== "legacy" && mode !== "metal") {
    throw new Error(`KEYSPILLI_IMPORT_MODE must be auto, legacy, or metal, got "${mode}"`);
  }
  const device = env.KEYSPILLI_DEMUCS_DEVICE ?? "cpu";
  if (device !== "cpu" && device !== "cuda" && device !== "mps") {
    throw new Error(`KEYSPILLI_DEMUCS_DEVICE must be cpu, cuda, or mps, got "${device}"`);
  }
  return {
    mode,
    python: paths.python,
    basicPitch: paths.basicPitch,
    separatorScript: join(paths.root, "services", "transcribe", "src", "separate_stems.py"),
    drumOnsetScript: join(paths.root, "services", "transcribe", "src", "audio_onsets.py"),
    demucsModel: env.KEYSPILLI_DEMUCS_MODEL?.trim() || "htdemucs_6s",
    demucsDevice: device,
    separatorTimeoutMs: finiteNumber(
      "KEYSPILLI_DEMUCS_TIMEOUT_MS",
      env.KEYSPILLI_DEMUCS_TIMEOUT_MS ?? String(DEFAULT_SEPARATOR_TIMEOUT_MS),
      { min: 1_000 },
    ),
    basicPitchTimeoutMs: finiteNumber(
      "KEYSPILLI_BP_TIMEOUT_MS",
      env.KEYSPILLI_BP_TIMEOUT_MS ?? String(DEFAULT_BASIC_PITCH_TIMEOUT_MS),
      { min: 1_000 },
    ),
    minFreeBytes: finiteNumber(
      "KEYSPILLI_STEM_MIN_FREE_GIB",
      env.KEYSPILLI_STEM_MIN_FREE_GIB ?? String(DEFAULT_MIN_FREE_GIB),
      { min: 0 },
    ) * 1024 ** 3,
    onsetThreshold: finiteNumber("KEYSPILLI_ONSET", env.KEYSPILLI_ONSET ?? "0.65", { min: 0, max: 1 }),
    frameThreshold: finiteNumber("KEYSPILLI_FRAME", env.KEYSPILLI_FRAME ?? "0.45", { min: 0, max: 1 }),
    modelSerialization: env.KEYSPILLI_BP_SERIALIZATION?.trim() || "",
  };
}

async function defaultRun(
  command: string,
  args: readonly string[],
  options: { timeoutMs: number },
): Promise<CommandResult> {
  const result = await execFileP(command, [...args], {
    timeout: options.timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      // Avoid a CPU-only separator consuming every VPS core and starving the
      // web container. The worker processes one song at a time, so small
      // thread pools provide predictable latency without parallel-job spikes.
      OMP_NUM_THREADS: process.env.OMP_NUM_THREADS ?? "2",
      MKL_NUM_THREADS: process.env.MKL_NUM_THREADS ?? "2",
      OPENBLAS_NUM_THREADS: process.env.OPENBLAS_NUM_THREADS ?? "2",
    },
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function defaultFreeBytes(path: string): Promise<number> {
  const info = await statfs(path);
  return info.bavail * info.bsize;
}

async function findBasicPitchMidi(dir: string): Promise<string> {
  const candidates = (await readdir(dir))
    .filter((name) => !name.startsWith("._") && name.endsWith("_basic_pitch.mid"))
    .sort((left, right) => left.localeCompare(right));
  if (candidates.length !== 1) {
    throw new Error(`expected one Basic Pitch MIDI in ${dir}, found ${candidates.length}`);
  }
  const path = join(dir, candidates[0]!);
  const info = await stat(path);
  if (!info.isFile() || info.size === 0) throw new Error(`Basic Pitch produced an empty MIDI for ${basename(dir)}`);
  return path;
}

async function publishStemMidis(
  jobDir: string,
  stems: StemMidi[],
  report: StemPipelineReport,
): Promise<string> {
  const finalDir = join(jobDir, "stem-midi");
  const stageDir = join(jobDir, `.stem-midi.staging-${randomUUID()}`);
  const backupDir = join(jobDir, `.stem-midi.backup-${randomUUID()}`);
  await mkdir(stageDir, { recursive: true });
  try {
    for (const stem of stems) await writeFile(join(stageDir, `${stem.role}.mid`), stem.midi);
    await writeFile(join(stageDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    let movedOld = false;
    try {
      await rename(finalDir, backupDir);
      movedOld = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(stageDir, finalDir);
    } catch (error) {
      if (movedOld) await rename(backupDir, finalDir).catch(() => undefined);
      throw error;
    }
    await rm(backupDir, { recursive: true, force: true });
    return finalDir;
  } catch (error) {
    await rm(stageDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Separate one full-band recording and run Basic Pitch on musical-role stems.
 *
 * WAV stems live only in a bounded, run-local directory. Persisting four
 * decoded 10-minute stems can consume hundreds of megabytes per job; the
 * worker instead retains the compressed source audio, small stem MIDIs, and
 * a reproducibility report. The source audio is enough to repeat separation.
 */
export async function transcribePitchedStems(
  audioPath: string,
  jobDir: string,
  config: StemPipelineConfig,
  options: { tempo?: number } = {},
  dependencies: StemPipelineDependencies = {},
): Promise<StemPipelineResult> {
  const run = dependencies.run ?? defaultRun;
  const freeBytes = await (dependencies.freeBytes ?? defaultFreeBytes)(jobDir);
  if (freeBytes < config.minFreeBytes) {
    throw new Error(
      `stem separation requires at least ${(config.minFreeBytes / 1024 ** 3).toFixed(1)} GiB free; `
      + `${(freeBytes / 1024 ** 3).toFixed(1)} GiB available`,
    );
  }

  const scratch = await mkdtemp(join(jobDir, ".stems-work-"));
  try {
    const separatedDir = join(scratch, "separated");
    await mkdir(separatedDir, { recursive: true });
    const separation = await run(config.python, [
      config.separatorScript,
      "--input", audioPath,
      "--output", separatedDir,
      "--model", config.demucsModel,
      "--device", config.demucsDevice,
    ], { timeoutMs: config.separatorTimeoutMs });
    const reportLine = separation.stdout
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.startsWith("KEYSPILLI_STEMS_JSON:"));
    if (!reportLine) throw new Error("Demucs completed without a Keyspilli stem report");
    const parsedSeparation = JSON.parse(reportLine.slice("KEYSPILLI_STEMS_JSON:".length)) as {
      version?: string;
      stems?: Partial<Record<"vocals" | "bass" | "drums" | "guitar" | "other", string>>;
    };
    const stemPaths = parsedSeparation.stems;
    if (!stemPaths?.vocals || !stemPaths.bass || !stemPaths.other || !stemPaths.drums) {
      throw new Error("Demucs did not report a complete vocals/bass/drums/other stem set");
    }

    const requested: Array<{
      role: PitchedStemMidiRole;
      source: "vocals" | "bass" | "guitar" | "other";
      audio: string;
    }> = [
      { role: "vocals" as const, source: "vocals" as const, audio: stemPaths.vocals },
      { role: "bass" as const, source: "bass" as const, audio: stemPaths.bass },
      // Six-source models expose a dedicated guitar stem. Four-source models
      // remain supported by falling back to the mixed guitar/keys residual.
      ...(stemPaths.guitar
        ? [
          { role: "guitar" as const, source: "guitar" as const, audio: stemPaths.guitar },
          // The residual six-source stem often contains keyboards, lead
          // fragments, and upper-band material that is useful for melody.
          // Keep it separate so the arranger can compare it with guitar
          // rather than silently discarding it.
          { role: "other" as const, source: "other" as const, audio: stemPaths.other },
        ]
        : [{ role: "guitar" as const, source: "other" as const, audio: stemPaths.other }]),
    ];
    const stems: StemMidi[] = [];
    const reportStems: StemPipelineReport["stems"] = [];
    const roleThresholds = {} as StemPipelineReport["transcriber"]["roleThresholds"];
    for (const item of requested) {
      const outDir = join(scratch, `basic-pitch-${item.role}`);
      await mkdir(outDir, { recursive: true });
      const thresholds = thresholdsForRole(item.role, config);
      roleThresholds[item.role] = thresholds;
      const args = [
        outDir,
        item.audio,
        "--save-midi",
        "--onset-threshold", String(thresholds.onsetThreshold),
        "--frame-threshold", String(thresholds.frameThreshold),
      ];
      if (options.tempo !== undefined) args.push("--midi-tempo", String(options.tempo));
      if (config.modelSerialization) args.push("--model-serialization", config.modelSerialization);
      await run(config.basicPitch, args, { timeoutMs: config.basicPitchTimeoutMs });
      const midiPath = await findBasicPitchMidi(outDir);
      const midi = new Uint8Array(await readFile(midiPath));
      stems.push({ role: item.role, midi, noteSource: item.source });
      reportStems.push({
        role: item.role,
        sourceStem: item.source,
        midiFile: `${item.role}.mid`,
        midiBytes: midi.byteLength,
      });
    }

    // Drums are a timing source, never a pitch source. Reuse the lightweight
    // onset detector instead of asking Basic Pitch to hallucinate pitched
    // drum notes, then encode those attacks on GM kick solely so the shared
    // arranger can consume a normal ParsedMidi timing lane.
    const drumOnsetsResult = await run(config.python, [config.drumOnsetScript, stemPaths.drums], {
      timeoutMs: Math.min(config.basicPitchTimeoutMs, 180_000),
    });
    const drumOnsets = (JSON.parse(drumOnsetsResult.stdout) as unknown[])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
    const drumTempo = options.tempo ?? 120;
    const secondsPerBeat = 60 / drumTempo;
    const drumMidi = writeMidi(drumOnsets.map((seconds) => ({
      midi: 36,
      start: seconds / secondsPerBeat,
      dur: 0.125,
      vel: 80,
    })), { tempoBpm: drumTempo, timeSig: [4, 4], keySig: 0, keyMode: 1 });
    stems.push({ role: "drums", midi: drumMidi, noteSource: "drums" });
    reportStems.push({
      role: "drums",
      sourceStem: "drums",
      midiFile: "drums.mid",
      midiBytes: drumMidi.byteLength,
    });

    const report: StemPipelineReport = {
      schemaVersion: 1,
      strategy: "demucs-role-stem-basic-pitch",
      separator: {
        engine: "demucs",
        version: parsedSeparation.version || dependencies.demucsVersion || "unknown",
        model: config.demucsModel,
        device: config.demucsDevice,
      },
      transcriber: {
        engine: "basic-pitch",
        version: dependencies.basicPitchVersion || "unknown",
        serialization: config.modelSerialization || "default",
        onsetThreshold: config.onsetThreshold,
        frameThreshold: config.frameThreshold,
        roleThresholds,
      },
      stems: reportStems,
    };
    const artifactDir = await publishStemMidis(jobDir, stems, report);
    return { stems, report, artifactDir };
  } finally {
    // This also runs when Demucs/Basic Pitch times out. Never leave decoded
    // WAV stems behind for the next retry or nightly backup to archive.
    await rm(scratch, { recursive: true, force: true });
  }
}
