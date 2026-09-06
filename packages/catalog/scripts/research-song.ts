import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runResearch, type HumanAcceptanceInput, type LocalSymbolicInput } from "../src/research-report.js";

interface CliArgs {
  url?: string;
  artist?: string;
  title?: string;
  duration?: number;
  version?: string;
  candidates: string[];
  reference?: string;
  limit: number;
  noNetwork: boolean;
  humanAcceptance?: HumanAcceptanceInput;
  out?: string;
  metadataLimited?: boolean;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function usage(): string {
  return [
    "Usage: npm run research:song -w @keyspilli/catalog -- [options]",
    "  --url URL | --artist ARTIST --title TITLE",
    "  --candidate FILE   repeatable local MIDI/MusicXML input",
    "  --reference FILE   local reference MIDI/MusicXML",
    "  --duration SEC     source duration metadata",
    "  --version LABEL    source/version metadata",
    "  --limit N          search results per query (1..20)",
    "  --no-network       skip YouTube discovery",
    "  --human-verdict accept|reject --human-note TEXT",
    "  --out FILE         write only this explicitly requested report file",
  ].join("\n");
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(flag + " requires a value");
  return value;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { candidates: [], limit: 8, noNetwork: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    switch (flag) {
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
        break;
      case "--url":
        parsed.url = requiredValue(argv, index, flag); index += 1; break;
      case "--artist":
        parsed.artist = requiredValue(argv, index, flag); index += 1; break;
      case "--title":
        parsed.title = requiredValue(argv, index, flag); index += 1; break;
      case "--duration": {
        const value = Number(requiredValue(argv, index, flag));
        if (!Number.isFinite(value) || value <= 0) throw new Error("--duration requires a positive number");
        parsed.duration = value; index += 1; break;
      }
      case "--version":
        parsed.version = requiredValue(argv, index, flag); index += 1; break;
      case "--candidate":
        parsed.candidates.push(requiredValue(argv, index, flag)); index += 1; break;
      case "--reference":
        parsed.reference = requiredValue(argv, index, flag); index += 1; break;
      case "--limit": {
        const value = Number(requiredValue(argv, index, flag));
        if (!Number.isInteger(value) || value < 1 || value > 20) throw new Error("--limit requires an integer between 1 and 20");
        parsed.limit = value; index += 1; break;
      }
      case "--no-network":
        parsed.noNetwork = true; break;
      case "--human-verdict": {
        const value = requiredValue(argv, index, flag);
        if (value !== "accept" && value !== "reject") throw new Error("--human-verdict must be accept or reject");
        parsed.humanAcceptance = { verdict: value }; index += 1; break;
      }
      case "--human-note": {
        const note = requiredValue(argv, index, flag);
        parsed.humanAcceptance = { ...(parsed.humanAcceptance ?? { verdict: "reject" }), note };
        index += 1; break;
      }
      case "--out":
        parsed.out = requiredValue(argv, index, flag); index += 1; break;
      default:
        if (flag.startsWith("--")) throw new Error("unknown option " + flag);
        if (!parsed.url) parsed.url = flag;
        else throw new Error("unexpected positional argument " + flag);
    }
  }
  if (!parsed.title && !parsed.url) throw new Error("provide --url or --artist/--title");
  if (!parsed.title && parsed.url) {
    parsed.title = "Submitted YouTube source";
    parsed.artist = "Unknown artist";
    parsed.metadataLimited = true;
  }
  if ((parsed.artist && !parsed.title) || (!parsed.artist && parsed.title)) throw new Error("--artist and --title must be supplied together");
  return parsed;
}

function formatForPath(path: string): LocalSymbolicInput["format"] {
  const extension = extname(path).toLowerCase();
  if (extension === ".mid" || extension === ".midi") return "midi";
  if (extension === ".xml" || extension === ".musicxml") return "musicxml";
  if (extension === ".mxl") return "mxl";
  return "unknown";
}

async function regularFile(path: string, label: string): Promise<string> {
  let resolved: string;
  try {
    resolved = await realpath(resolve(path));
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error("not a regular file");
  } catch {
    throw new Error(`could not read local ${label}`);
  }
  return resolved;
}

async function readRegularFile(path: string, label: string): Promise<{ path: string; bytes: Uint8Array }> {
  const resolved = await regularFile(path, label);
  try {
    return { path: resolved, bytes: new Uint8Array(await readFile(resolved)) };
  } catch {
    throw new Error(`could not read local ${label}`);
  }
}

function rejectReferenceInsideRepo(path: string): void {
  const repoRelative = relative(REPO_ROOT, path);
  if (repoRelative === "" || (!repoRelative.startsWith(`..${sep}`) && repoRelative !== ".." && !isAbsolute(repoRelative))) {
    throw new Error("reference must be outside the repository; keep copyrighted reference files local-only");
  }
}

async function loadLocalCandidate(path: string): Promise<LocalSymbolicInput> {
  const loaded = await readRegularFile(path, "candidate");
  return { bytes: loaded.bytes, format: formatForPath(path) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const localCandidates = await Promise.all(args.candidates.map(loadLocalCandidate));
  let reference: { bytes: Uint8Array; format: LocalSymbolicInput["format"] } | undefined;
  if (args.reference) {
    const loaded = await readRegularFile(args.reference, "reference");
    rejectReferenceInsideRepo(loaded.path);
    reference = { bytes: loaded.bytes, format: formatForPath(args.reference) };
  }
  const result = await runResearch({
    song: {
      title: args.title!,
      artist: args.artist!,
      sourceYoutubeUrl: args.url ?? null,
      durationSeconds: args.duration ?? null,
      version: args.version ?? null,
    },
    localCandidates,
    reference,
    limit: args.limit,
    noNetwork: args.noNetwork || args.metadataLimited,
    metadataLimited: args.metadataLimited,
    ...(args.metadataLimited ? { discoveryErrors: ["song metadata is required for source discovery; provide --artist and --title"] } : {}),
    humanAcceptance: args.humanAcceptance,
  });
  if (args.out) {
    await writeFile(args.out, result.json, { encoding: "utf8", flag: "wx" }).catch(async (error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      throw new Error("refusing to overwrite existing report: " + args.out);
    });
  } else {
    process.stdout.write(result.json);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "research command failed");
  console.error(usage());
  process.exitCode = 1;
});
