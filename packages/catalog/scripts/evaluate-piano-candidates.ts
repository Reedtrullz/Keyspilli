/**
 * Read-only symbolic piano candidate evaluator.
 *
 * Usage:
 *   npx tsx packages/catalog/scripts/evaluate-piano-candidates.ts \
 *     --candidate candidate.mid --reference reference.mid --out ./piano-previews
 *
 * Candidate and reference files are read and parsed locally. The command does
 * not open the catalog, publish artifacts, call a backend, or mutate a DB.
 */
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parseMidi, type Note } from "@keyspilli/midi";
import {
  canonicalPianoEvaluationJson,
  evaluatePianoCandidates,
  writePianoPreviews,
  type PianoCandidateInput,
  type PianoEvaluationReport,
} from "../src/piano-evaluation.js";

export interface PianoCliIo {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

interface PianoCliOptions {
  candidates: Array<{ id?: string; path: string }>;
  reference?: string;
  outputDir?: string;
  metadata?: unknown;
}

function redactCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const roots = "(?:Users|private|tmp|var|home|root|opt|mnt|workspace|etc|srv|data|app)";
  return message
    .replace(new RegExp(`file:///?${roots}(?:/[^\\s"'<>;,)]*)?`, "gi"), "[redacted-path]")
    .replace(new RegExp(`(^|[\\s(\"'=,;\\[\\]])/${roots}(?:/[^\\s\"'<>;,)]*)?`, "gi"), "$1[redacted-path]")
    .replace(/(^|[\s(\"'=,;\[\]])\/(?:[A-Za-z0-9._-]+\/)+[^\s"'<>;,)]*/g, "$1[redacted-path]")
    .replace(/(^|[\s(\"'=,;\[\]])[A-Za-z]:[\\/][^\s"'<>;,)]*/g, "$1[redacted-path]")
    .replace(/(^|\s)(?!(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/)(\.\.?\/|[^\s/]+\/)[^\s"']+\.(?:mid|midi|json|wav|mp3)(?=$|[\s"'])/gi, "$1[redacted-path]");
}

function usage(): string {
  return [
    "Usage: evaluate-piano-candidates.ts --candidate [id=]PATH [--candidate [id=]PATH ...] [options]",
    "Options:",
    "  --reference PATH    Optional symbolic reference MIDI or JSON score",
    "  --out DIR           Write raw/aligned/Easy/Medium local MIDI previews",
    "  --metadata JSON     Metadata object or path to a JSON metadata file",
    "  --json              Accepted for explicit machine-readable output",
  ].join("\n");
}

function parseOptions(argv: string[]): PianoCliOptions {
  const options: PianoCliOptions = { candidates: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--candidate" || arg === "-c") {
      const value = argv[++index];
      if (!value) throw new Error("--candidate requires a path");
      const separator = value.indexOf("=");
      options.candidates.push(separator > 0 ? { id: value.slice(0, separator), path: value.slice(separator + 1) } : { path: value });
    } else if (arg === "--reference" || arg === "-r") {
      options.reference = argv[++index];
      if (!options.reference) throw new Error("--reference requires a path");
    } else if (arg === "--out" || arg === "--preview") {
      options.outputDir = argv[++index];
      if (!options.outputDir) throw new Error(`${arg} requires a directory`);
    } else if (arg === "--metadata") {
      const value = argv[++index];
      if (!value) throw new Error("--metadata requires JSON or a path");
      options.metadata = value;
    } else if (arg === "--json") {
      // JSON is always the only stdout format; retain the flag for scripts.
    } else if (arg === "--help" || arg === "-h") {
      throw new Error(usage());
    } else if (!arg.startsWith("-")) {
      options.candidates.push({ path: arg });
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  if (!options.candidates.length) throw new Error(usage());
  return options;
}

async function parseMetadata(value: unknown): Promise<unknown> {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { /* value may be a JSON file */ }
  try { return JSON.parse(await readFile(value, "utf8")); } catch (error) {
    throw new Error(`metadata unavailable: ${redactCliError(error)}`);
  }
}

async function readSymbolic(path: string, id: string, metadata: unknown): Promise<PianoCandidateInput> {
  try {
    const bytes = new Uint8Array(await readFile(path));
    if (extname(path).toLowerCase() === ".json") {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { notes?: Note[]; [key: string]: unknown };
      return { ...parsed, id, selector: path, metadata: parsed.metadata ?? metadata } as PianoCandidateInput;
    }
    return { id, selector: path, bytes, metadata };
  } catch (error) {
    return {
      id,
      selector: path,
      mediaAvailable: false,
      metadata,
      unavailableReason: `media unavailable: ${redactCliError(error)}`,
    };
  }
}

async function readReference(path: string, metadata: unknown): Promise<PianoCandidateInput> {
  try {
    const bytes = new Uint8Array(await readFile(path));
    if (extname(path).toLowerCase() === ".json") {
      try {
        return { ...(JSON.parse(new TextDecoder().decode(bytes)) as object), id: "reference", selector: path, metadata } as PianoCandidateInput;
      } catch {
        return { id: "reference", selector: path, mediaAvailable: true, metadata, notes: [], unavailableReason: "reference invalid" };
      }
    }
    return { id: "reference", selector: path, bytes, metadata };
  } catch {
    // A missing reference is equivalent to no reference evidence; candidate
    // reports stay usable and state their missing-reference boundary below.
    return { id: "reference", selector: path, mediaAvailable: false, metadata, unavailableReason: "reference unavailable" };
  }
}

/** Execute the CLI contract without calling process.exit, useful in tests. */
export async function runPianoEvaluationCli(argv: string[], io: PianoCliIo = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
}): Promise<number> {
  let options: PianoCliOptions;
  try { options = parseOptions(argv); } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  let metadata: unknown;
  try { metadata = await parseMetadata(options.metadata); } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const inputs = await Promise.all(options.candidates.map(({ id, path }) => readSymbolic(path, id ?? path, metadata)));
  const reference = options.reference ? await readReference(options.reference, metadata) : undefined;
  if (reference?.mediaAvailable === false) io.stderr("reference unavailable\n");
  else if (reference?.unavailableReason === "reference invalid") io.stderr("reference invalid\n");
  const report = evaluatePianoCandidates({ candidates: inputs, reference });
  const previewSummary: Record<string, { raw: string; aligned: string; easy: string; medium: string }> = {};
  if (options.outputDir) {
    for (const evaluation of report.candidates) {
      if (evaluation.status !== "available") continue;
      try {
        const previews = await writePianoPreviews(evaluation, options.outputDir);
        previewSummary[evaluation.id] = previews.files;
      } catch (error) {
        io.stderr(`${evaluation.id}: preview unavailable: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  }
  const output = JSON.parse(canonicalPianoEvaluationJson(report)) as PianoEvaluationReport & { previews?: unknown };
  if (Object.keys(previewSummary).length) {
    output.previews = Object.fromEntries(Object.keys(previewSummary).sort().map((id) => [id, { raw: "[local]", aligned: "[local]", easy: "[local]", medium: "[local]" }]));
  }
  io.stdout(`${JSON.stringify(output, null, 2)}\n`);
  return 0;
}

/* istanbul ignore next -- process entry point */
if (import.meta.url === `file://${process.argv[1]}`) {
  runPianoEvaluationCli(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
