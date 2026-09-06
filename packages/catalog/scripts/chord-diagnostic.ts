/**
 * Chord diagnostic automation.
 *
 * For each base in the manifest, checks:
 *   - source map exists
 *   - timeline event count
 *   - chord symbol parseability
 *   - generated MIDI validity / beat alignment
 *
 * Outputs a JSON report with per-base status.
 *
 * Usage:
 *   npx tsx packages/catalog/scripts/chord-diagnostic.ts
 *   npx tsx packages/catalog/scripts/chord-diagnostic.ts --base=<id>
 */
import { readFile, readdir, access } from "node:fs/promises";
import { basename, join } from "node:path";
import { tryParseChordSymbol } from "@keyspilli/midi";
import { dataDir } from "../src/paths.js";

export interface BaseDiagnostic {
  baseId: string;
  sourceMapExists: boolean;
  timelineEventCount: number;
  parseableChords: number;
  unparseableChords: string[];
  variantCount: number;
  midiValid: boolean;
  beatAlignmentIssues: string[];
  status: "ok" | "warning" | "error";
}

export interface DiagnosticReport {
  summary: { totalBases: number; ok: number; warnings: number; errors: number };
  bases: BaseDiagnostic[];
}

const LEVELS = ["vb", "b", "ve", "e", "m", "a"] as const;

function chordSourceMapPath(baseId: string, root: string): string {
  return join(root, "artifacts", baseId, "chord-source-map.json");
}

function chordTimelinePath(baseId: string, root: string): string {
  return join(root, "artifacts", baseId, "chord-timeline.json");
}

function variantPath(baseId: string, level: string, root: string): string {
  return join(root, "artifacts", baseId, level, "notes.json");
}

export async function diagnoseBase(baseId: string, dataRoot: string): Promise<BaseDiagnostic> {
  const result: BaseDiagnostic = {
    baseId,
    sourceMapExists: false,
    timelineEventCount: 0,
    parseableChords: 0,
    unparseableChords: [],
    variantCount: 0,
    midiValid: true,
    beatAlignmentIssues: [],
    status: "ok",
  };

  // Check source map
  try {
    await access(chordSourceMapPath(baseId, dataRoot));
    result.sourceMapExists = true;
  } catch {
    result.sourceMapExists = false;
  }

  // Check timeline events
  try {
    const raw = await readFile(chordTimelinePath(baseId, dataRoot), "utf8");
    const timeline = JSON.parse(raw);
    const chords = timeline.chords ?? timeline ?? [];
    result.timelineEventCount = Array.isArray(chords) ? chords.length : 0;

    // Check chord symbol parseability
    for (const chord of chords) {
      const name: string | undefined = chord.name ?? chord.symbol;
      if (!name) continue;
      const parsed = tryParseChordSymbol(name);
      if (parsed) {
        result.parseableChords++;
      } else {
        result.unparseableChords.push(name);
      }
    }
  } catch {
    // No timeline file
  }

  // Check variants
  for (const level of LEVELS) {
    try {
      const raw = await readFile(variantPath(baseId, level, dataRoot), "utf8");
      const variant = JSON.parse(raw);
      result.variantCount++;

      // Basic MIDI validity: notes exist and have required fields
      const notes = variant.notes ?? [];
      for (const n of notes) {
        if (typeof n.midi !== "number" || typeof n.start !== "number" || typeof n.dur !== "number") {
          result.midiValid = false;
          result.beatAlignmentIssues.push(`${level}: note missing midi/start/dur`);
          break;
        }
        if (n.start < 0 || n.dur <= 0) {
          result.midiValid = false;
          result.beatAlignmentIssues.push(`${level}: note at start=${n.start} dur=${n.dur}`);
          break;
        }
      }

      // Beat alignment: check no note extends past durationBeats
      const durationBeats = variant.durationBeats ?? variant.spanBeats;
      if (typeof durationBeats === "number" && durationBeats > 0) {
        for (const n of notes) {
          if (n.start + n.dur > durationBeats + 1) {
            result.beatAlignmentIssues.push(
              `${level}: note extends past durationBeats (${n.start + n.dur} > ${durationBeats})`,
            );
            break;
          }
        }
      }
    } catch {
      // Variant file doesn't exist for this level
    }
  }

  // Determine overall status
  if (!result.midiValid || result.beatAlignmentIssues.length > 0) {
    result.status = "error";
  } else if (!result.sourceMapExists || result.unparseableChords.length > 0) {
    result.status = "warning";
  }

  return result;
}

export async function runDiagnostic(root: string, bases: string[]): Promise<DiagnosticReport> {
  const diagnostics: BaseDiagnostic[] = [];
  for (const base of bases) {
    diagnostics.push(await diagnoseBase(base, root));
  }
  return {
    summary: {
      totalBases: diagnostics.length,
      ok: diagnostics.filter((d) => d.status === "ok").length,
      warnings: diagnostics.filter((d) => d.status === "warning").length,
      errors: diagnostics.filter((d) => d.status === "error").length,
    },
    bases: diagnostics,
  };
}

/* istanbul ignore next -- only runs when executed as a script */
async function main() {
  const baseArg = process.argv.find((a) => a.startsWith("--base="))?.split("=")[1];
  const root = dataDir();

  let bases: string[];
  if (baseArg) {
    bases = [baseArg];
  } else {
    const manifestPath = join(root, "manifest.json");
    try {
      const raw = await readFile(manifestPath, "utf8");
      const manifest = JSON.parse(raw);
      bases = (manifest.songs ?? [])
        .map((s: { id?: string }) => s.id)
        .filter((id: string | undefined): id is string => typeof id === "string" && id.length > 0);
    } catch {
      // Fallback: scan artifacts directory
      const artifactsRoot = join(root, "artifacts");
      try {
        bases = await readdir(artifactsRoot);
      } catch {
        console.error("No manifest.json or artifacts/ directory found in", root);
        process.exit(1);
      }
    }
  }

  const report = await runDiagnostic(root, bases);
  console.log(JSON.stringify(report, null, 2));
  if (report.summary.errors > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(`/${basename(process.argv[1])}`)) await main();
