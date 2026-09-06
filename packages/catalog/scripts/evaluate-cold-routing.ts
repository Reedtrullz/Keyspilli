#!/usr/bin/env node
/** Evaluate the frozen Basic Pitch/GAPS outputs through texture routing. */
import { createHash } from "node:crypto";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMidi } from "@keyspilli/midi";
import {
  buildTextureRoutingPlan,
  canonicalTextureRouting,
  evaluateTextureRouting,
  type TextureRoutingPlanInput,
} from "../src/texture-amt-routing.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SHA256 = /^[a-f0-9]{64}$/i;

type Artifact = { status?: "available" | "unavailable"; path?: string; sha256?: string; logicalId?: string };
type Song = { id: string; stem: Artifact; basicPitch: Artifact; gaps: Artifact; reference: Artifact };
type Cli = { routing: string; evaluation: string; out?: string; planOut?: string; help: boolean };

function usage(): string { return "Usage: evaluate-cold-routing.ts --routing-manifest FILE --evaluation-manifest FILE [--plan-out FILE] [--out FILE]"; }
function args(argv: readonly string[]): Cli {
  const out: Cli = { routing: "", evaluation: "", help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!; const eq = arg.indexOf("="); const flag = eq < 0 ? arg : arg.slice(0, eq); const inline = eq < 0 ? undefined : arg.slice(eq + 1);
    const value = () => { const value = inline ?? argv[++i]; if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value\n${usage()}`); return value; };
    if (flag === "--routing-manifest" || flag === "--routing") out.routing = value();
    else if (flag === "--evaluation-manifest" || flag === "--evaluation") out.evaluation = value();
    else if (flag === "--plan-out") out.planOut = value();
    else if (flag === "--out") out.out = value();
    else if (flag === "--help" || flag === "-h") out.help = true;
    else throw new Error(`unknown option: ${arg}\n${usage()}`);
  }
  if (!out.help && (!out.routing || !out.evaluation)) throw new Error(`both manifests are required\n${usage()}`);
  return out;
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function outside(path: string, label: string): void {
  const rel = relative(ROOT, path);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) throw new Error(`${label} must be outside the repository`);
}
async function frozen(path: string, label: string): Promise<{ bytes: Uint8Array; sha256: string }> {
  if (!isAbsolute(path)) throw new Error(`${label}.path must be absolute`);
  const resolved = await realpath(path).catch(() => { throw new Error(`${label} is unavailable`); });
  outside(resolved, label); if (!(await stat(resolved)).isFile()) throw new Error(`${label} must be a regular file`);
  const bytes = new Uint8Array(await readFile(resolved));
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}
function artifact(value: unknown, label: string): Artifact {
  const row = record(value, label); const status = row.status ?? (row.path ? "available" : "unavailable");
  if (status !== "available" && status !== "unavailable") throw new Error(`${label}.status is invalid`);
  if (status === "unavailable") return { status, logicalId: typeof row.logicalId === "string" ? row.logicalId : undefined };
  if (typeof row.path !== "string" || !isAbsolute(row.path) || typeof row.sha256 !== "string" || !SHA256.test(row.sha256)) throw new Error(`${label} requires absolute path and SHA-256`);
  return { status, path: row.path, sha256: row.sha256.toLowerCase(), logicalId: typeof row.logicalId === "string" ? row.logicalId : undefined };
}
function midi(bytes: Uint8Array): { notes: { midi: number; start: number; dur: number }[]; duration: number } {
  const parsed = parseMidi(bytes); const scale = 60 / parsed.tempoBpm;
  return { notes: parsed.notes.map((note) => ({ midi: note.midi, start: note.start * scale, dur: note.dur * scale })), duration: parsed.durationBeats * scale };
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
async function main(argv = process.argv.slice(2), io = { stdout: (s: string) => process.stdout.write(s), stderr: (s: string) => process.stderr.write(s) }): Promise<number> {
  let options: Cli;
  try { options = args(argv); } catch (error) { io.stderr(`${error instanceof Error ? error.message : String(error)}\n`); return 2; }
  if (options.help) { io.stdout(`${usage()}\n`); return 0; }
  try {
    // Freeze policy identity before any evaluation artifact or reference is read.
    const routingFile = await frozen(options.routing, "routing manifest");
    const routingRaw = record(JSON.parse(new TextDecoder().decode(routingFile.bytes)), "routing manifest");
    if (routingRaw.schemaVersion !== 1 || routingRaw.kind !== "cold-metal-texture-routing-preregistration") throw new Error("routing manifest kind/schema is invalid");
    const evalFile = await frozen(options.evaluation, "evaluation manifest");
    const evalRaw = record(JSON.parse(new TextDecoder().decode(evalFile.bytes)), "evaluation manifest");
    if (evalRaw.schemaVersion !== 1 || !Array.isArray(evalRaw.songs) || evalRaw.songs.length !== 3) throw new Error("evaluation manifest must contain exactly three songs");
    const songs = evalRaw.songs.map((raw, index) => { const row = record(raw, `evaluation songs[${index}]`); return { id: String(row.id), stem: artifact(row.stem, `${row.id}.stem`), basicPitch: artifact(row.basicPitch, `${row.id}.basicPitch`), gaps: artifact(row.gaps, `${row.id}.gaps`), reference: artifact(row.reference, `${row.id}.reference`) }; }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const verified: Record<string, unknown> = {};
    const ready: Array<{ song: Song; basic: ReturnType<typeof midi>; gaps: ReturnType<typeof midi> }> = [];
    for (const song of songs) {
      const stem = song.stem.status === "available" ? await frozen(song.stem.path!, `${song.id} stem`) : null;
      const basic = song.basicPitch.status === "available" ? await frozen(song.basicPitch.path!, `${song.id} Basic Pitch`) : null;
      const gaps = song.gaps.status === "available" ? await frozen(song.gaps.path!, `${song.id} GAPS`) : null;
      if (!stem || !basic || !gaps || basic.sha256 !== song.basicPitch.sha256 || gaps.sha256 !== song.gaps.sha256 || stem.sha256 !== song.stem.sha256) throw new Error(`frozen artifact hash/status mismatch for ${song.id}`);
      ready.push({ song, basic: midi(basic.bytes), gaps: midi(gaps.bytes) });
      verified[song.id] = { stem: stem.sha256, basicPitch: basic.sha256, gaps: gaps.sha256 };
    }
    const planInput: TextureRoutingPlanInput = { timebase: "seconds", onsetTolerance: Number((routingRaw.window as Record<string, unknown>)?.onsetTolerance ?? 0.08), windowSize: Number((routingRaw.window as Record<string, unknown>)?.size ?? 4), songs: ready.map((item) => ({ id: item.song.id, duration: Math.max(item.basic.duration, item.gaps.duration), basic: item.basic.notes, gaps: item.gaps.notes })) };
    const plan = buildTextureRoutingPlan(planInput);
    const routingPlanSha256 = createHash("sha256").update(canonicalTextureRouting(plan), "utf8").digest("hex");
    if (options.planOut) { if (!isAbsolute(options.planOut)) throw new Error("--plan-out must be absolute"); outside(resolve(options.planOut), "routing plan"); await writeFile(options.planOut, `${JSON.stringify(plan, null, 2)}\n`, "utf8"); }
    // References are deliberately opened only after every candidate is frozen and verified and the plan is frozen.
    const truth = [];
    for (const item of ready) {
      if (item.song.reference.status !== "available") throw new Error(`reference unavailable for ${item.song.id}`);
      const reference = await frozen(item.song.reference.path!, `${item.song.id} reference`);
      if (reference.sha256 !== item.song.reference.sha256) throw new Error(`reference hash mismatch for ${item.song.id}`);
      const parsed = midi(reference.bytes); truth.push({ id: item.song.id, notes: parsed.notes });
      (verified[item.song.id] as Record<string, unknown>).reference = reference.sha256;
    }
    const report = evaluateTextureRouting({ plan, truth, materialGain: Number((routingRaw.oracle as Record<string, unknown>)?.materialGain ?? 0.03) });
    const result = { ...report, experimentId: routingRaw.experimentId ?? null, routingManifestSha256: routingFile.sha256, evaluationManifestSha256: evalFile.sha256, routingPlanSha256, verifiedArtifacts: verified, determinism: { canonicalSha256: createHash("sha256").update(canonicalTextureRouting(report)).digest("hex") } };
    const output = `${stable(result)}\n`;
    if (options.out) { if (!isAbsolute(options.out)) throw new Error("--out must be absolute"); outside(resolve(options.out), "report"); await writeFile(options.out, `${JSON.stringify(result, null, 2)}\n`, "utf8"); }
    io.stdout(output); return 0;
  } catch (error) { io.stderr(`evaluate-cold-routing: ${error instanceof Error ? error.message : String(error)}\n`); return 2; }
}
if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) process.exitCode = await main();
