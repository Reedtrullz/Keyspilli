/**
 * Read-only baseline diagnostics for local piano candidates.
 *
 * Every input is an explicit local MIDI path.  The report contains logical
 * stage labels and metrics only; file paths are never copied into JSON.
 *
 * Usage:
 *   pnpm --filter @keyspilli/catalog exec tsx scripts/diagnose-piano-candidates.ts \
 *     --id piano-paul --raw raw.mid --aligned aligned.mid \
 *     --easy Easy.mid --medium Medium.mid \
 *     --window intro:0:64 --out /private/tmp/keyspilli-piano-section-baseline/report.json
 */
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { parseMidi } from "@keyspilli/midi";
import {
  canonicalPianoCandidateDiagnosticsJson,
  diagnosePianoCandidates,
  PIANO_DIAGNOSTIC_STAGES,
  validatePianoDiagnosticWindows,
  type PianoCandidateDiagnosticsInput,
  type PianoDiagnosticStage,
  type PianoDiagnosticWindow,
} from "../src/piano-candidate-diagnostics.js";

export interface PianoDiagnosticsCliIo {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

interface CliOptions {
  id: string;
  paths: Partial<Record<PianoDiagnosticStage, string>>;
  windows: PianoDiagnosticWindow[];
  out?: string;
}

const STAGES = new Set<string>(PIANO_DIAGNOSTIC_STAGES);

function usage(): string {
  return [
    "Usage: diagnose-piano-candidates.ts --id ID (--raw PATH | --aligned PATH | --easy PATH | --medium PATH | --stage STAGE=PATH)+ [options]",
    "Options:",
    "  --id ID                 Logical candidate id (path components are removed)",
    "  --raw PATH              Explicit raw MIDI path",
    "  --aligned PATH          Explicit aligned MIDI path",
    "  --easy PATH             Explicit Easy MIDI path",
    "  --medium PATH           Explicit Medium MIDI path",
    "  --stage STAGE=PATH      Repeatable form of the stage flags",
    "  --window ID:START:END   Explicit beat window (repeatable; no automatic alignment)",
    "  --out PATH              Write the same JSON to PATH as well as stdout",
    "  --json                  Accepted for machine-readable output (the default)",
  ].join("\n");
}

function logicalId(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  const leaf = normalized.split("/").filter(Boolean).pop() ?? "candidate";
  const withoutExtension = leaf.replace(/\.(?:mid|midi)$/i, "");
  return withoutExtension || "candidate";
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const roots = "(?:Users|private|tmp|var|home|root|opt|mnt|workspace|etc|srv|data|app)";
  return message
    .replace(new RegExp(`file:///?${roots}(?:/[^\\s"'<>;,)]*)?`, "gi"), "[redacted-path]")
    .replace(new RegExp(`(^|[\\s(\"'=,;\\[\\]])/${roots}(?:/[^\\s\"'<>;,)]*)?`, "gi"), "$1[redacted-path]")
    .replace(/(^|[\s("'=,;\[\]])[A-Za-z]:[\\/][^\s"'<>;,)]*/g, "$1[redacted-path]")
    .replace(/(^|[\s("'=,;\[\]])(?:\.\.?\/|[^\s/]+\/)[^\s"']+\.(?:mid|midi|json|wav|mp3)(?=$|[\s"'])/gi, "$1[redacted-path]");
}

function parseWindow(value: string): PianoDiagnosticWindow {
  const pieces = value.split(":");
  if (pieces.length !== 3 || !pieces[0]) throw new Error(`invalid --window (expected ID:START:END): ${value}`);
  const startBeat = Number(pieces[1]);
  const endBeat = Number(pieces[2]);
  if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || startBeat < 0 || endBeat <= startBeat) {
    throw new Error(`invalid --window bounds: ${value}`);
  }
  return { id: pieces[0], startBeat, endBeat };
}

function parseStageAssignment(value: string): { stage: PianoDiagnosticStage; path: string } {
  const separator = value.indexOf("=");
  const colon = value.indexOf(":");
  const splitAt = separator > 0 ? separator : colon > 0 ? colon : -1;
  if (splitAt <= 0) throw new Error(`invalid --stage (expected STAGE=PATH): ${value}`);
  const stage = value.slice(0, splitAt);
  const path = value.slice(splitAt + 1);
  if (!STAGES.has(stage) || !path) throw new Error(`invalid --stage: ${value}`);
  return { stage: stage as PianoDiagnosticStage, path };
}

function parseOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = { id: "candidate", paths: {}, windows: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = (): string => {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === "--id") options.id = next();
    else if (arg === "--raw" || arg === "--aligned" || arg === "--easy" || arg === "--medium") {
      options.paths[arg.slice(2) as PianoDiagnosticStage] = next();
    } else if (arg === "--stage") {
      const assignment = parseStageAssignment(next());
      options.paths[assignment.stage] = assignment.path;
    } else if (arg === "--window") options.windows.push(parseWindow(next()));
    else if (arg === "--out") options.out = next();
    else if (arg === "--json") { /* JSON is always the output format. */ }
    else if (arg === "--help" || arg === "-h") throw new Error(usage());
    else throw new Error(`unknown option: ${arg}`);
  }
  if (!Object.keys(options.paths).length) throw new Error("at least one stage path is required\n\n" + usage());
  // Validate before reading any MIDI so malformed section definitions cannot
  // be masked by a missing stage file or silently omitted from the report.
  options.windows = validatePianoDiagnosticWindows(options.windows);
  return options;
}

async function readStage(path: string) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error("stage path is not a regular file");
  const bytes = new Uint8Array(await readFile(path));
  if (!bytes.length) throw new Error("stage MIDI file is empty");
  if (!/\.m(?:id|idi)$/i.test(extname(path))) throw new Error("stage path must have a .mid or .midi extension");
  return parseMidi(bytes);
}

/** Execute the CLI contract without calling process.exit, for tests/embedding. */
export async function runPianoDiagnosticsCli(
  argv: readonly string[],
  io: PianoDiagnosticsCliIo = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  let options: CliOptions;
  try {
    options = parseOptions(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === usage()) io.stdout(`${message}\n`);
    else io.stderr(`${safeError(message)}\n`);
    return message === usage() ? 0 : 2;
  }
  const parsed: Partial<Record<PianoDiagnosticStage, ReturnType<typeof parseMidi>>> = {};
  for (const stage of PIANO_DIAGNOSTIC_STAGES) {
    const path = options.paths[stage];
    if (!path) continue;
    try {
      parsed[stage] = await readStage(path);
    } catch (error) {
      io.stderr(`${stage}: ${safeError(error)}\n`);
      return 2;
    }
  }
  const input: PianoCandidateDiagnosticsInput = {
    id: logicalId(options.id),
    stages: parsed,
    windows: options.windows,
  };
  let report;
  try {
    report = diagnosePianoCandidates(input);
  } catch (error) {
    io.stderr(`${safeError(error)}\n`);
    return 2;
  }
  const json = canonicalPianoCandidateDiagnosticsJson(report);
  if (options.out) {
    try {
      await writeFile(options.out, `${JSON.stringify(JSON.parse(json), null, 2)}\n`, "utf8");
    } catch (error) {
      io.stderr(`output: ${safeError(error)}\n`);
      return 2;
    }
  }
  io.stdout(`${JSON.stringify(JSON.parse(json), null, 2)}\n`);
  return 0;
}

/* istanbul ignore next -- process entry point */
if (process.argv[1] && import.meta.url.endsWith(`/${basename(process.argv[1])}`)) {
  runPianoDiagnosticsCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
