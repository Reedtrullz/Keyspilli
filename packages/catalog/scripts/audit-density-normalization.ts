/**
 * Deterministic, report-only authoritative-symbolic density experiment.
 *
 * The input is supplied explicitly because the real Lane A source is private.
 * No source bytes or absolute paths are written to the report, and no
 * candidate is wired into buildVariants by this command.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sha256Hex } from "../src/fixture-evidence.js";
import { ROOT } from "../src/paths.js";
import {
  laneAStages,
  syntheticControls,
  tempoSensitivity,
  trustedControls,
} from "./audit-playability.js";

interface CliOptions {
  laneA: string;
  out?: string;
  revision: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function parseArgs(argv: readonly string[]): CliOptions {
  let laneA = "";
  let out: string | undefined;
  let revision = "current";
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    const [option, inline] = token.split("=", 2);
    const value = inline ?? argv[++index];
    if (option === "--lane-a-midi") laneA = value ?? "";
    else if (option === "--out") out = value;
    else if (option === "--revision") revision = value ?? revision;
    else if (option === "--help" || option === "-h") throw new Error("Usage: audit-density-normalization.ts --lane-a-midi FILE [--out FILE] [--revision LABEL]");
    else throw new Error(`unknown option: ${token}`);
  }
  if (!laneA) throw new Error("--lane-a-midi is required");
  return { laneA, out, revision };
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const info = await stat(options.laneA);
  if (!info.isFile()) throw new Error("--lane-a-midi must be a regular file");
  const laneA = await laneAStages(options.laneA, true);
  const density = laneA.densityNormalization as Record<string, unknown>;
  const laneABase = Object.fromEntries(Object.entries(laneA).filter(([key]) => key !== "densityNormalization"));
  const reportWithoutDigest = {
    schemaVersion: 1,
    kind: "authoritative-symbolic-density-normalization",
    mission: "AUTHORITATIVE_SYMBOLIC_DENSITY_NORMALIZATION",
    revision: options.revision,
    scope: {
      validatorLimitsChanged: false,
      retimingAllowed: false,
      newEventsAllowed: false,
      laneASpecificLogic: false,
      benchmarkMaterialUsed: false,
      alignmentResearch: false,
      productionReplay: false,
      deployment: "NOT_DEPLOYED",
      catalogPersistence: false,
      humanListening: "NOT_REQUESTED_NOT_REQUIRED_BY_DEFAULT",
    },
    laneA: laneABase,
    diagnostics: {
      densityNormalization: density,
      trustedControls: await trustedControls(),
      syntheticControls: syntheticControls(),
      tempoSensitivity: tempoSensitivity(),
    },
    decisions: {
      densityNormalization: "NO_GENERIC_DENSITY_TRANSFORM_JUSTIFIED",
      timedSymbolicMvp: "TIMED_SYMBOLIC_MVP_CONDITIONAL",
      realSymbolicAlignment: "REAL_SYMBOLIC_ALIGNMENT_PARTIAL",
      realShadow: "REAL_SHADOW_BLOCKED_AT_DIFFICULTIES",
      musicalQuality: "MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED",
      humanListening: "NOT_REQUESTED_NOT_REQUIRED_BY_DEFAULT",
      deployment: "NOT_DEPLOYED",
    },
    implementation: {
      behaviorChange: false,
      productionTransform: null,
      candidateA: "diagnostic-only",
      candidateB: "not-evaluated",
      candidateC: "causal-baseline-only",
      retainedEventsRetimed: 0,
      newEventsCreated: 0,
    },
    nextTask: "LEVEL_CONTRACT_REVIEW_FOR_AUTHORITATIVE_DENSITY",
  };
  const canonicalSha256 = sha256Hex(new TextEncoder().encode(stableJson(reportWithoutDigest)));
  const report = { ...reportWithoutDigest, determinism: { canonicalSha256 } };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) {
    const outputPath = resolve(ROOT, options.out);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, text, "utf8");
  } else process.stdout.write(text);
}

if (process.argv[1]?.endsWith("audit-density-normalization.ts")) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`audit-density-normalization: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
