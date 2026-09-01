import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const DEFAULT_BASIC_PITCH_TIMEOUT_MS = 900_000;
const DEFAULT_DEMUCS_TIMEOUT_MS = 2_700_000;
const DEFAULT_DEMUCS_MODEL = "htdemucs_6s";

// These are the role-specific thresholds used by the production guitar/other
// stem path, rather than Basic Pitch's generic CLI defaults.
export const BASIC_PITCH_DEFAULTS = { onsetThreshold: 0.45, frameThreshold: 0.3 } as const;
export const DEMUCS_DEFAULTS = { model: DEFAULT_DEMUCS_MODEL, device: "cpu" as const };

export interface RunnerCommand {
  file: string;
  args: string[];
}

export interface RunnerExecFileOptions {
  shell: false;
  timeout: number;
  timeoutMs: number;
  maxBuffer: number;
}

export type RunnerExecFile = (
  file: string,
  args: readonly string[],
  options: RunnerExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface RunnerDependencies {
  execFile?: RunnerExecFile;
}

export interface ControlledMixtureInput {
  id: string;
  path: string;
  sha256?: string;
  gainDb?: number;
}

export interface ControlledMixtureRecipe {
  outputPath: string;
  sampleRate: number;
  channels: 1 | 2;
  durationSeconds?: number;
  gainsDb?: Record<string, number>;
}

export interface MixtureArtifact {
  path: string;
  outputPath: string;
  recipeHash: string;
  inputHashes: Record<string, string>;
  sampleRate: number;
  channels: 1 | 2;
  outputHash?: string;
}

export interface BasicPitchRouteConfig {
  executable: string;
  outputDir: string;
  midiPath?: string;
  onsetThreshold?: number;
  frameThreshold?: number;
  timeoutMs?: number;
}

export interface DemucsRouteConfig {
  python: string;
  separatorScript: string;
  outputDir: string;
  model?: string;
  device?: "cpu" | "cuda" | "mps";
  timeoutMs?: number;
  basicPitch?: BasicPitchRouteConfig;
}

export interface RouteOutput {
  route: "basic-pitch" | "demucs" | "bs-roformer";
  status: "available" | "unavailable" | "failed";
  inputPath?: string;
  midiPath?: string;
  midiHash?: string;
  configHash?: string;
  stems?: Record<string, string>;
  separatorVersion?: string;
  error?: string;
}

export type MixtureReference = Pick<MixtureArtifact, "path"> & Partial<Omit<MixtureArtifact, "path">>;

export interface BsRoformerRouteConfig {
  /** Must be explicitly enabled by a caller with an already verified local route. */
  enabled?: boolean;
  executable?: string;
  checkpoint?: string;
  outputDir?: string;
}

function assertLocalPath(path: string, label: string): void {
  if (!path || /^(?:https?|ftp):\/\//i.test(path) || /[\0\r\n]/.test(path)) {
    throw new Error(`${label} must be a local path`);
  }
}

function assertFinite(value: number, label: string, min: number, max?: number): void {
  if (!Number.isFinite(value) || value < min || (max !== undefined && value > max)) {
    throw new Error(`${label} must be ${max === undefined ? `>= ${min}` : `between ${min} and ${max}`}`);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function configHash(value: unknown): string {
  return hashText(canonical(value));
}

async function fileHash(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function defaultExecFile(): RunnerExecFile {
  // Imported lazily so tests can inject a command runner without spawning a process.
  return async (file, args, options) => {
    const { execFile } = await import("node:child_process");
    return new Promise((resolveResult, reject) => {
      execFile(file, [...args], {
        shell: options.shell,
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
      }, (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stdout, stderr });
          reject(error);
        } else resolveResult({ stdout, stderr });
      });
    });
  };
}

async function hashesForInputs(inputs: readonly ControlledMixtureInput[], gainsDb: Readonly<Record<string, number>>): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const input of [...inputs].sort((left, right) => left.id.localeCompare(right.id))) {
    assertLocalPath(input.path, `input ${input.id}`);
    if (!input.id.trim()) throw new Error("mixture input id must be non-empty");
    const gainDb = input.gainDb ?? gainsDb[input.id] ?? 0;
    assertFinite(gainDb, `input ${input.id} gainDb`, -120, 120);
    hashes[input.id] = (input.sha256 ?? await fileHash(input.path)).toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(hashes[input.id]!)) {
      throw new Error(`input ${input.id} sha256 must be a SHA-256 hex digest`);
    }
  }
  return hashes;
}

/** Create a reproducible local ffmpeg mixture; inputs are sorted by logical ID. */
export async function buildControlledMixture(
  inputs: readonly ControlledMixtureInput[],
  recipe: ControlledMixtureRecipe,
  dependencies: RunnerDependencies = {},
): Promise<MixtureArtifact> {
  if (inputs.length === 0) throw new Error("controlled mixture requires at least one input");
  assertLocalPath(recipe.outputPath, "mixture outputPath");
  if (recipe.channels !== 1 && recipe.channels !== 2) throw new Error("mixture channels must be 1 or 2");
  assertFinite(recipe.sampleRate, "mixture sampleRate", 8_000, 192_000);
  if (!Number.isInteger(recipe.sampleRate)) throw new Error("mixture sampleRate must be an integer");
  if (recipe.durationSeconds !== undefined) assertFinite(recipe.durationSeconds, "mixture durationSeconds", 0);
  const sorted = [...inputs].sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(sorted.map((input) => input.id)).size !== sorted.length) throw new Error("mixture input IDs must be unique");
  const gainsDb = recipe.gainsDb ?? {};
  const inputHashes = await hashesForInputs(sorted, gainsDb);
  const recipeHash = hashText(canonical({
    channels: recipe.channels,
    durationSeconds: recipe.durationSeconds ?? null,
    inputs: sorted.map((input) => ({ gainDb: input.gainDb ?? gainsDb[input.id] ?? 0, id: input.id, sha256: inputHashes[input.id] })),
    sampleRate: recipe.sampleRate,
  }));
  const filterInputs = sorted.map((input, index) => `[${index}:a]volume=${input.gainDb ?? gainsDb[input.id] ?? 0}dB[a${index}]`).join(";");
  const labels = sorted.map((_input, index) => `[a${index}]`).join("");
  const filter = `${filterInputs};${labels}amix=inputs=${sorted.length}:duration=longest:normalize=0,aresample=${recipe.sampleRate}`;
  const args = sorted.flatMap((input) => ["-i", input.path]);
  args.push("-filter_complex", filter, "-ac", String(recipe.channels), "-ar", String(recipe.sampleRate));
  if (recipe.durationSeconds !== undefined) args.push("-t", String(recipe.durationSeconds));
  args.push("-y", recipe.outputPath);
  await (dependencies.execFile ?? defaultExecFile())("ffmpeg", args, {
    shell: false,
    timeout: 120_000,
    timeoutMs: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  let outputHash: string | undefined;
  try { outputHash = await fileHash(recipe.outputPath); } catch { /* mocked/local command may not materialize output */ }
  return {
    path: recipe.outputPath,
    outputPath: recipe.outputPath,
    recipeHash,
    inputHashes,
    sampleRate: recipe.sampleRate,
    channels: recipe.channels,
    outputHash,
  };
}

function basicPitchArgs(audioPath: string, config: BasicPitchRouteConfig): string[] {
  return [
    config.outputDir,
    audioPath,
    "--save-midi",
    "--onset-threshold", String(config.onsetThreshold ?? BASIC_PITCH_DEFAULTS.onsetThreshold),
    "--frame-threshold", String(config.frameThreshold ?? BASIC_PITCH_DEFAULTS.frameThreshold),
  ];
}

export async function runBasicPitchRoute(
  audioPath: string,
  config: BasicPitchRouteConfig,
  dependencies: RunnerDependencies = {},
): Promise<RouteOutput> {
  assertLocalPath(audioPath, "Basic Pitch input");
  assertLocalPath(config.executable, "Basic Pitch executable");
  assertLocalPath(config.outputDir, "Basic Pitch outputDir");
  assertFinite(config.onsetThreshold ?? BASIC_PITCH_DEFAULTS.onsetThreshold, "Basic Pitch onsetThreshold", 0, 1);
  assertFinite(config.frameThreshold ?? BASIC_PITCH_DEFAULTS.frameThreshold, "Basic Pitch frameThreshold", 0, 1);
  const midiPath = config.midiPath;
  if (midiPath) assertLocalPath(midiPath, "Basic Pitch midiPath");
  try {
    await (dependencies.execFile ?? defaultExecFile())(config.executable, basicPitchArgs(audioPath, config), {
      shell: false,
      timeout: config.timeoutMs ?? DEFAULT_BASIC_PITCH_TIMEOUT_MS,
      timeoutMs: config.timeoutMs ?? DEFAULT_BASIC_PITCH_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    let midiHash: string | undefined;
    if (midiPath) {
      try { midiHash = await fileHash(midiPath); } catch { /* caller may inspect the path after a mocked run */ }
    }
    return {
      route: "basic-pitch", status: "available", inputPath: audioPath, midiPath, midiHash,
      configHash: configHash({
        frameThreshold: config.frameThreshold ?? BASIC_PITCH_DEFAULTS.frameThreshold,
        onsetThreshold: config.onsetThreshold ?? BASIC_PITCH_DEFAULTS.onsetThreshold,
      }),
    };
  } catch (error) {
    return { route: "basic-pitch", status: "failed", inputPath: audioPath, error: String((error as Error).message ?? error) };
  }
}

export async function runDemucsRoute(
  mixture: MixtureReference | string,
  config: DemucsRouteConfig,
  dependencies: RunnerDependencies = {},
): Promise<RouteOutput> {
  const inputPath = typeof mixture === "string" ? mixture : mixture.path;
  assertLocalPath(inputPath, "Demucs input");
  assertLocalPath(config.python, "Demucs python");
  assertLocalPath(config.separatorScript, "Demucs separatorScript");
  assertLocalPath(config.outputDir, "Demucs outputDir");
  const args = [
    config.separatorScript,
    "--input", inputPath,
    "--output", config.outputDir,
    "--model", config.model ?? DEMUCS_DEFAULTS.model,
    "--device", config.device ?? DEMUCS_DEFAULTS.device,
  ];
  try {
    const result = await (dependencies.execFile ?? defaultExecFile())(config.python, args, {
      shell: false,
      timeout: config.timeoutMs ?? DEFAULT_DEMUCS_TIMEOUT_MS,
      timeoutMs: config.timeoutMs ?? DEFAULT_DEMUCS_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });
    const line = result.stdout.split(/\r?\n/).reverse().find((value) => value.startsWith("KEYSPILLI_STEMS_JSON:"));
    let stems: Record<string, string> = {};
    let separatorVersion: string | undefined;
    if (line) {
      const report = JSON.parse(line.slice("KEYSPILLI_STEMS_JSON:".length)) as { version?: string; stems?: Record<string, string> };
      separatorVersion = report.version;
      stems = report.stems ?? {};
      for (const [role, path] of Object.entries(stems)) assertLocalPath(path, `Demucs ${role} stem`);
    } else {
      return { route: "demucs", status: "failed", inputPath, error: "Demucs completed without a Keyspilli stem report" };
    }
    const output: RouteOutput = {
      route: "demucs", status: "available", inputPath, stems, separatorVersion,
      configHash: configHash({
        device: config.device ?? DEMUCS_DEFAULTS.device,
        model: config.model ?? DEMUCS_DEFAULTS.model,
      }),
    };
    if (config.basicPitch && stems.guitar) {
      const pitched = await runBasicPitchRoute(stems.guitar, config.basicPitch, dependencies);
      output.midiPath = pitched.midiPath;
      output.midiHash = pitched.midiHash;
      if (pitched.status !== "available") output.status = pitched.status;
    }
    return output;
  } catch (error) {
    return { route: "demucs", status: "failed", inputPath, error: String((error as Error).message ?? error) };
  }
}

/** BS-RoFormer is opt-in only; no fallback, download, or network probe is attempted. */
export async function runExistingBsRoformerRoute(
  _mixture: MixtureReference | string,
  _config: BsRoformerRouteConfig | undefined,
  _dependencies: RunnerDependencies = {},
): Promise<RouteOutput> {
  return {
    route: "bs-roformer",
    status: "unavailable",
    error: "exact local BS-RoFormer checkpoint/config is unavailable; route not invoked",
  };
}
