/**
 * Local-only metal arrangement evaluator.
 *
 * This command deliberately has no catalog/database/network integration.  It
 * accepts a directory of separated MIDI stems or an already-rendered MIDI
 * candidate, and emits a deterministic, path-redacted JSON report.  A
 * reference is never compared without explicit candidate/reference windows.
 *
 * Examples:
 *   npm run evaluate-metal -w @keyspilli/catalog -- \
 *     --stems /private/tmp/stems --fixture-id local-metal \
 *     --out /private/tmp/metal-report.json
 *   npm run evaluate-metal -w @keyspilli/catalog -- \
 *     --candidate /private/tmp/arrangement.mid \
 *     --reference /Users/me/reference.mid \
 *     --window solo=352,384,248,280
 */
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMetalArrangement,
  buildVariants,
  parseMidi,
  writeMidi,
  type MetalArrangementTraceEvent,
  type MetalStem,
  type Note,
  type ParsedMidi,
  type SongMeta,
} from "@keyspilli/midi";
import {
  canonicalEvaluationJson,
  evaluateArrangement,
  type ArrangementEvaluationCandidate,
  type ArrangementEvaluationInput,
  type EvaluationWindow,
  type ProvenanceTraceEvent,
} from "../src/arrangement-evaluation.js";

interface CliOptions {
  stems?: string;
  candidate?: string;
  reference?: string;
  out?: string;
  fixtureId: string;
  label?: string;
  revision?: string;
  mode: "structural" | "reference" | "human";
  expectedDurationBeats?: number;
  windows: EvaluationWindow[];
  traceWindows: Array<{ id: string; startBeat: number; endBeat: number }>;
  traceOut?: string;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const STEM_ROLES = ["vocals", "bass", "guitar", "other", "drums"] as const;

function usage(): string {
  return [
    "Usage: evaluate-metal.ts (--stems DIR | --candidate FILE) [options]",
    "  --stems DIR             local directory containing vocals/bass/guitar/other/drums.mid",
    "  --candidate FILE        local candidate MIDI; without this, build from --stems",
    "  --reference FILE        local reference MIDI (requires explicit --window values)",
    "  --window ID=C0,C1,R0,R1 explicit candidate/reference beat bounds (repeatable)",
    "  --fixture-id ID         logical fixture id (default: local-metal)",
    "  --label TEXT            optional human label",
    "  --revision TEXT         optional candidate revision label",
    "  --mode structural|reference|human",
    "  --expected-duration N   optional candidate duration expectation in beats",
    "  --trace-window ID=S,E   explicit arranger trace window (repeatable; --window candidate bounds also work)",
    "  --trace-out FILE        write the deterministic local arranger lineage trace (requires --stems)",
    "  --out FILE              write report here; otherwise print JSON to stdout",
  ].join("\n");
}

function nextValue(args: string[], index: number, option: string): [string, number] {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value\n${usage()}`);
  return [value, index + 1];
}

function parseNumber(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a finite non-negative number: ${value}`);
  return number;
}

function parseBounds(value: string, label: string): [number, number] {
  const parts = value.split(",");
  if (parts.length !== 2) throw new Error(`${label} must have the form start,end: ${value}`);
  const bounds: [number, number] = [parseNumber(parts[0]!, `${label} start`), parseNumber(parts[1]!, `${label} end` )];
  if (bounds[1] <= bounds[0]) throw new Error(`${label} end must be greater than start: ${value}`);
  return bounds;
}

function parseWindow(value: string): EvaluationWindow {
  const equal = value.indexOf("=");
  if (equal <= 0) throw new Error(`--window must be ID=start,end,start,end: ${value}`);
  const id = value.slice(0, equal).trim();
  const parts = value.slice(equal + 1).split(",");
  if (!id || parts.length !== 4) throw new Error(`--window must be ID=start,end,start,end: ${value}`);
  const numbers = parts.map((part, index) => parseNumber(part!, `window ${id} bound ${index + 1}`));
  const candidate: [number, number] = [numbers[0]!, numbers[1]!];
  const reference: [number, number] = [numbers[2]!, numbers[3]!];
  if (candidate[1] <= candidate[0] || reference[1] <= reference[0]) throw new Error(`window ${id} has invalid bounds`);
  return { id, candidate, reference };
}

function parseTraceWindow(value: string): { id: string; startBeat: number; endBeat: number } {
  const equal = value.indexOf("=");
  if (equal <= 0) throw new Error(`--trace-window must be ID=start,end: ${value}`);
  const id = value.slice(0, equal).trim();
  const bounds = parseBounds(value.slice(equal + 1), `trace window ${id}`);
  if (!id) throw new Error(`--trace-window requires a non-empty ID: ${value}`);
  return { id, startBeat: bounds[0], endBeat: bounds[1] };
}

function parseArgs(argv: string[]): CliOptions {
  const result: CliOptions = { fixtureId: "local-metal", mode: "structural", windows: [], traceWindows: [] };
  for (let index = 0; index < argv.length; index++) {
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
      case "--stems": result.stems = value(); break;
      case "--candidate": result.candidate = value(); break;
      case "--reference": result.reference = value(); break;
      case "--out": result.out = value(); break;
      case "--fixture-id": result.fixtureId = value(); break;
      case "--label": result.label = value(); break;
      case "--revision": result.revision = value(); break;
      case "--expected-duration": result.expectedDurationBeats = parseNumber(value(), "--expected-duration"); break;
      case "--trace-window": result.traceWindows.push(parseTraceWindow(value())); break;
      case "--trace-out": result.traceOut = value(); break;
      case "--mode": {
        const mode = value();
        if (mode !== "structural" && mode !== "reference" && mode !== "human") throw new Error(`unsupported --mode: ${mode}`);
        result.mode = mode;
        break;
      }
      case "--window": result.windows.push(parseWindow(value())); break;
      case "--help": case "-h": console.log(usage()); process.exit(0); break;
      default: throw new Error(`unknown option: ${arg}\n${usage()}`);
    }
  }
  if (!result.stems && !result.candidate) throw new Error("one of --stems or --candidate is required\n" + usage());
  if (result.mode === "reference" && !result.reference) throw new Error("--mode=reference requires --reference");
  if (result.traceOut && !result.stems) throw new Error("--trace-out requires --stems; serialized candidates have no private lineage");
  if (result.traceWindows.length && !result.stems) throw new Error("--trace-window requires --stems; serialized candidates have no private lineage");
  if (result.traceOut && !result.traceWindows.length && !result.windows.length) {
    throw new Error("--trace-out requires at least one --trace-window or --window candidate range");
  }
  return result;
}

async function regularFile(path: string, label: string): Promise<string> {
  const resolved = await realpath(resolve(path));
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error(`${label} is not a regular file: ${path}`);
  return resolved;
}

async function midiFile(path: string, label: string): Promise<{ path: string; bytes: Uint8Array; parsed: ParsedMidi }> {
  const resolved = await regularFile(path, label);
  return midiFileResolved(resolved, label);
}

async function midiFileResolved(resolved: string, _label: string): Promise<{ path: string; bytes: Uint8Array; parsed: ParsedMidi }> {
  const bytes = new Uint8Array(await readFile(resolved));
  return { path: resolved, bytes, parsed: parseMidi(bytes) };
}

async function loadStems(directory: string): Promise<MetalStem[]> {
  const resolved = resolve(directory);
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error(`--stems is not a directory: ${directory}`);
  const stems: MetalStem[] = [];
  for (const role of STEM_ROLES) {
    const path = join(resolved, `${role}.mid`);
    try {
      const loaded = await midiFile(path, `${role} stem`);
      stems.push({ role, midi: loaded.parsed });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
      if (code === "ENOENT") continue;
      throw error;
    }
  }
  if (!stems.length) throw new Error(`--stems contains no recognized MIDI stems (expected ${STEM_ROLES.map((role) => `${role}.mid`).join(", ")})`);
  return stems;
}

function generatedBytes(parsed: ParsedMidi): Uint8Array {
  const sourceName = (source: Note["identitySource"]): string => source === "vocals"
    ? "Vocals" : source === "guitar" ? "Guitar" : source === "other" ? "Other" : "Unlabeled";
  const tracks: Array<{ name: string; notes: Note[] }> = [];
  for (const hand of ["R", "L"] as const) {
    for (const source of ["vocals", "guitar", "other", undefined] as const) {
      const notes = parsed.notes.filter((note) => (note.hand === "L" ? "L" : "R") === hand && note.identitySource === source);
      if (notes.length) tracks.push({ name: `${hand === "R" ? "RH" : "LH"} ${sourceName(source)}`, notes });
    }
  }
  return writeMidi([], {
    tempoBpm: parsed.tempoBpm,
    timeSig: parsed.timeSig,
    keySig: parsed.keySig,
    keyMode: parsed.keyMode,
    title: parsed.title,
    tracks,
  });
}

function metaFor(parsed: ParsedMidi, fixtureId: string): SongMeta {
  return { title: parsed.title ?? fixtureId, artist: "Local evaluator", style: "metal", tempo: parsed.tempoBpm };
}

function rejectReferenceInsideRepo(path: string): void {
  const repoRelative = relative(REPO_ROOT, path);
  if (repoRelative === "" || (!repoRelative.startsWith(`..${sep}`) && repoRelative !== ".." && !isAbsolute(repoRelative))) {
    throw new Error("reference must be outside the repository; keep copyrighted reference files local-only");
  }
}

function evaluationTraceEvent(event: MetalArrangementTraceEvent): ProvenanceTraceEvent {
  return {
    key: event.key,
    ...(event.windowId ? { windowId: event.windowId } : {}),
    stage: event.stage,
    source: event.source,
    selectionReason: event.selectionReason,
    ...(event.rawCandidateCount === undefined ? {} : { rawCandidateCount: event.rawCandidateCount }),
    selected: event.selected,
    traceRefs: [...event.traceRefs].sort(),
    ...(event.startBeat === undefined ? {} : { startBeat: event.startBeat }),
    ...(event.endBeat === undefined ? {} : { endBeat: event.endBeat }),
    ...(event.midi === undefined ? {} : { midi: event.midi }),
    ...(event.rawMidi === undefined ? {} : { rawMidi: event.rawMidi }),
    ...(event.dur === undefined ? {} : { dur: event.dur }),
    ...(event.hand === undefined ? {} : { hand: event.hand }),
  };
}

async function run(options: CliOptions): Promise<string> {
  // Resolve and validate the reference before any potentially expensive stem
  // arrangement work.  The content is not read until the repository guard has
  // accepted the real path.
  const referencePath = options.reference ? await regularFile(options.reference, "reference") : undefined;
  if (referencePath) rejectReferenceInsideRepo(referencePath);

  let candidate: ArrangementEvaluationCandidate;
  let variants;
  const traceEvents: MetalArrangementTraceEvent[] = [];
  const traceWindows = options.traceWindows.length
    ? options.traceWindows
    : options.windows.map((window) => ({ id: window.id, startBeat: window.candidate[0], endBeat: window.candidate[1] }));
  if (options.candidate) {
    const loaded = await midiFile(options.candidate, "candidate");
    candidate = { selector: loaded.path, bytes: loaded.bytes, parsed: loaded.parsed };
  } else {
    const stems = await loadStems(options.stems!);
    const arrangement = buildMetalArrangement({
      stems,
      title: options.fixtureId,
      ...((options.traceOut || options.traceWindows.length) && traceWindows.length
        ? { debug: { traceWindows, traceSink: (event: MetalArrangementTraceEvent): void => { traceEvents.push(event); } } }
        : {}),
    });
    const bytes = generatedBytes(arrangement.parsed);
    // Metrics must describe the exact bytes whose hash is reported.  MIDI
    // serialization quantizes beat positions and may alter track metadata, so
    // reparse the generated artifact instead of evaluating the pre-serialized
    // in-memory arrangement.
    const serialized = parseMidi(bytes);
    candidate = {
      selector: "generated-metal-arrangement.mid",
      bytes,
      parsed: serialized,
      // Keep both selector-stage and semantic-stage diagnostics in the local
      // report.  They are additive and never enter the public MIDI/IR shape.
      guitarHarmony: {
        ...(arrangement.stats.guitarLead ?? {}),
        ...(arrangement.stats.guitarHarmony ?? {}),
        ...(arrangement.stats.guitarLead ? {
          selectedLeadCount: arrangement.stats.guitarLead.selectedCount,
          recoveredCount: arrangement.stats.guitarLead.recoveredCount,
          rejectedCount: arrangement.stats.guitarLead.rejectedCount,
        } : {}),
      } as ArrangementEvaluationCandidate["guitarHarmony"],
    };
    variants = buildVariants(arrangement.parsed, metaFor(arrangement.parsed, options.fixtureId), {
      arrangementProfile: "metal",
      normalizeRange: false,
      chords: arrangement.chords,
    });
  }

  const reference = referencePath ? await midiFileResolved(referencePath, "reference") : undefined;
  const trace = traceEvents.length
    ? { status: "available" as const, events: traceEvents.map(evaluationTraceEvent) }
    : undefined;
  const input: ArrangementEvaluationInput = {
    fixture: { id: options.fixtureId, ...(options.label ? { label: options.label } : {}) },
    candidate: { ...candidate, ...(options.revision ? { revision: options.revision } : {}) },
    ...(reference ? { reference: { selector: reference.path, bytes: reference.bytes, parsed: reference.parsed, windows: options.windows } } : {}),
    windows: options.windows,
    variants,
    ...(trace ? { trace } : {}),
    mode: options.mode,
    expectedDurationBeats: options.expectedDurationBeats,
  };
  const report = evaluateArrangement(input);
  if (options.traceOut) {
    const out = resolve(options.traceOut);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify({
      schemaVersion: 1,
      status: report.trace.status,
      windowIds: traceWindows.map((window) => window.id).sort(),
      events: report.trace.events ?? [],
      ...(report.trace.windows ? { windows: report.trace.windows } : {}),
    }, null, 2) + "\n", "utf8");
  }
  return canonicalEvaluationJson(report);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    const options = parseArgs(argv);
    const output = await run(options);
    if (options.out) {
      const out = resolve(options.out);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, output + "\n", "utf8");
    } else {
      process.stdout.write(output + "\n");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`evaluate-metal: ${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("evaluate-metal.ts")) await main();
