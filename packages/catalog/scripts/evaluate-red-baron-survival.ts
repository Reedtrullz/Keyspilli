/**
 * Opt-in, local-only Red Baron stage-survival evaluator.
 *
 * Every musical input must be named explicitly. This command performs no
 * discovery, download, conversion, upload, or decoder invocation.
 *
 * Usage:
 *   pnpm --filter @keyspilli/catalog exec tsx scripts/evaluate-red-baron-survival.ts \
 *     --stage raw=/private/tmp/raw.mid --stage decoder=/private/tmp/decoder.mid \
 *     --stage semantic=/private/tmp/semantic.mid --stage canonical=/private/tmp/canonical.mid \
 *     --stage easy=/private/tmp/easy.mid --reference=/private/tmp/reference.mid \
 *     --window main:0:64
 */

import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { parseMidi } from "@keyspilli/midi";
import {
  RED_BARON_SURVIVAL_STAGES,
  canonicalStageSurvivalJson,
  evaluateStageSurvival,
  redactStageSurvivalText,
  type RedBaronSurvivalStage,
  type StageInput,
  type StageSurvivalReport,
  type StageSurvivalWindowInput,
} from "../src/red-baron-survival.js";

export interface RedBaronSurvivalCliIo {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

interface CliOptions {
  stagePaths: Partial<Record<RedBaronSurvivalStage, string>>;
  referencePath?: string;
  windows: StageSurvivalWindowInput[];
  out?: string;
}

const STAGE_SET = new Set<string>(RED_BARON_SURVIVAL_STAGES);

function usage(): string {
  return [
    "Usage: evaluate-red-baron-survival.ts --stage STAGE=PATH ... --reference PATH --window ID:REF_START:REF_END[:STAGE_START:STAGE_END] ...",
    "Required:",
    "  --stage STAGE=PATH      Explicit local .mid/.midi/.json input; repeat for each stage",
    "  --reference PATH        Explicit local reference .mid/.midi/.json input",
    "  --window ID:START:END   Reference bounds; stage bounds default to the same domain",
    "  --window ID:R0:R1:S0:S1  Keep reference and common stage bounds separate",
    "Optional:",
    "  --out PATH              Write the same deterministic JSON to a local file",
    "  --json                  Accepted for machine-readable output (the default)",
  ].join("\n");
}

const redactPath = redactStageSurvivalText;

function parseFinite(value: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`invalid numeric window bound: ${value}`);
  return result;
}

function parseWindow(value: string): StageSurvivalWindowInput {
  const pieces = value.split(":");
  if (pieces.length !== 3 && pieces.length !== 5) throw new Error(`invalid --window (expected ID:R0:R1 or ID:R0:R1:S0:S1): ${value}`);
  const id = pieces[0]?.trim();
  if (!id) throw new Error(`invalid --window id: ${value}`);
  const reference = [parseFinite(pieces[1]!), parseFinite(pieces[2]!)] as [number, number];
  const stage = pieces.length === 5 ? [parseFinite(pieces[3]!), parseFinite(pieces[4]!)] as [number, number] : reference;
  if (reference[0] < 0 || reference[1] <= reference[0] || stage[0] < 0 || stage[1] <= stage[0]) throw new Error(`invalid --window bounds: ${value}`);
  return { id, reference, stage };
}

function parseStageAssignment(value: string): { stage: RedBaronSurvivalStage; path: string } {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) throw new Error(`invalid --stage (expected STAGE=PATH): ${value}`);
  const stage = value.slice(0, separator);
  const path = value.slice(separator + 1);
  if (!STAGE_SET.has(stage)) throw new Error(`unknown survival stage: ${stage}`);
  if (!path.trim()) throw new Error(`invalid --stage path: ${value}`);
  return { stage: stage as RedBaronSurvivalStage, path };
}

function parseOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = { stagePaths: {}, windows: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = (): string => {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === "--stage" || arg.startsWith("--stage=")) {
      const assignment = parseStageAssignment(arg.startsWith("--stage=") ? arg.slice("--stage=".length) : next());
      if (options.stagePaths[assignment.stage]) throw new Error(`duplicate --stage: ${assignment.stage}`);
      options.stagePaths[assignment.stage] = assignment.path;
    } else if (arg === "--reference" || arg.startsWith("--reference=")) {
      if (options.referencePath) throw new Error("duplicate --reference");
      options.referencePath = arg.startsWith("--reference=") ? arg.slice("--reference=".length) : next();
    } else if (arg === "--window" || arg.startsWith("--window=")) options.windows.push(parseWindow(arg.startsWith("--window=") ? arg.slice("--window=".length) : next()));
    else if (arg === "--out" || arg.startsWith("--out=")) options.out = arg.startsWith("--out=") ? arg.slice("--out=".length) : next();
    else if (arg === "--json") { /* JSON is always the output format. */ }
    else if (arg === "--help" || arg === "-h") throw new Error(usage());
    else throw new Error(`unknown option: ${arg}`);
  }
  if (!Object.keys(options.stagePaths).length) throw new Error(`at least one --stage is required\n\n${usage()}`);
  if (!options.referencePath) throw new Error(`--reference is required\n\n${usage()}`);
  if (!options.windows.length) throw new Error(`at least one --window is required\n\n${usage()}`);
  return options;
}

function assertLocalPath(path: string, label: string): void {
  const windowsDrivePath = /^[A-Za-z]:[\\/]/.test(path);
  if (!windowsDrivePath && /^[A-Za-z][A-Za-z0-9+.-]*:/i.test(path)) throw new Error(`${label} must be an explicit local path`);
  if (!path.trim()) throw new Error(`${label} path is empty`);
  if (!/\.(?:mid|midi|json)$/i.test(extname(path))) throw new Error(`${label} must have a .mid, .midi, or .json extension`);
}

async function readScore(path: string, label: string): Promise<StageInput> {
  assertLocalPath(path, label);
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${label} path is not a regular file`);
  const bytes = new Uint8Array(await readFile(path));
  if (!bytes.length) throw new Error(`${label} file is empty`);
  if (/\.json$/i.test(path)) {
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error(`${label} JSON is invalid`); }
    const notes = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { notes?: unknown }).notes) ? (value as { notes: unknown[] }).notes : null;
    if (!notes) throw new Error(`${label} JSON must be a note array or an object with notes`);
    return { status: "available", notes };
  }
  try {
    return { status: "available", notes: parseMidi(bytes).notes };
  } catch (error) {
    throw new Error(`${label} MIDI parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Execute the CLI contract without process.exit, for synthetic tests/embedding. */
export async function runRedBaronSurvivalCli(
  argv: readonly string[],
  io: RedBaronSurvivalCliIo = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  let options: CliOptions;
  try { options = parseOptions(argv); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === usage()) io.stdout(`${message}\n`);
    else io.stderr(`${redactPath(message)}\n`);
    return message === usage() ? 0 : 2;
  }
  const stages = {} as Partial<Record<RedBaronSurvivalStage, StageInput>>;
  for (const stage of RED_BARON_SURVIVAL_STAGES) {
    const path = options.stagePaths[stage];
    if (!path) continue;
    try { stages[stage] = await readScore(path, `${stage} stage`); }
    catch (error) { io.stderr(`${redactPath(error instanceof Error ? error.message : String(error))}\n`); return 2; }
  }
  let reference: StageInput;
  try { reference = await readScore(options.referencePath!, "reference"); }
  catch (error) { io.stderr(`${redactPath(error instanceof Error ? error.message : String(error))}\n`); return 2; }
  let report: StageSurvivalReport;
  try { report = evaluateStageSurvival(stages, reference, options.windows); }
  catch (error) { io.stderr(`${redactPath(error instanceof Error ? error.message : String(error))}\n`); return 2; }
  const json = canonicalStageSurvivalJson(report);
  const pretty = `${JSON.stringify(JSON.parse(json), null, 2)}\n`;
  if (options.out) {
    try { assertLocalPath(options.out, "--out"); await writeFile(options.out, pretty, "utf8"); }
    catch (error) { io.stderr(`${redactPath(error instanceof Error ? error.message : String(error))}\n`); return 2; }
  }
  io.stdout(pretty);
  return report.status === "ready" ? 0 : 2;
}

/* istanbul ignore next -- process entry point */
if (process.argv[1] && import.meta.url.endsWith(`/${basename(process.argv[1])}`)) {
  runRedBaronSurvivalCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
