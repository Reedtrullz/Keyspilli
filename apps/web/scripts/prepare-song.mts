/** Completed symbolic input -> both modes, portable bundle, fresh import and idempotence.
 * node --import tsx apps/web/scripts/prepare-song.mts INPUT.mid|INPUT.musicxml|INPUT.mxl NEW_RUN_DIR TITLE ARTIST [--phrase-plan FILE]
 * Acquisition/arranging happens before this command; output remains provisional until reviewed.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { PhrasePlanV1 } from "@keyspilli/midi";

const usage = `Usage: node --import tsx apps/web/scripts/prepare-song.mts INPUT NEW_RUN_DIR TITLE ARTIST [--phrase-plan FILE]

Prepare a local MIDI, MusicXML or compressed MXL source into both Player modes, a portable bundle,
and a fresh isolated installation. NEW_RUN_DIR must be new and inside this checkout.

  --phrase-plan FILE   Optional source-bound protection plan, at most 2 MiB.
                       Requires exact source bytes/clock and at least one explicitly required event.
  --source-backed-chords Use the plan's explicit backing roles with conservative harmony.
                       Requires --phrase-plan targeting Advanced; roles remain provisional.
  --previews           Also build a checked portable delivery in NEW_RUN_DIR/delivery.
  --soundfont FILE     Explicit local piano bank for --previews.
  --executable FILE    Explicit FluidSynth executable for --previews.
  --level LEVEL        Original preview tier for --previews (default a).
  --help, -h           Show this help.

Inspect source origins with phrase-plan.mts inspect before selecting protections. Role proposals
alone are not protection or musical approval. Preparation remains provisional until reviewed.`;
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const { values, positionals, tokens } = parseArgs({ allowPositionals: true, tokens: true, options: {
    "phrase-plan": { type: "string" }, "source-backed-chords": { type: "boolean" }, previews: {type: "boolean"}, soundfont: {type: "string"}, executable: {type: "string"}, level: {type: "string"}, help: { type: "boolean", short: "h" },
  } });
  if (values.help) { console.log(usage); return; }
  assert(tokens.filter(token => token.kind === "option" && token.name === "phrase-plan").length <= 1, "--phrase-plan may be supplied only once");
  for (const name of ["previews", "soundfont", "executable", "level", "source-backed-chords"])
    assert(tokens.filter(t => t.kind === "option" && t.name === name).length <= 1, `--${name} may be supplied only once`);
  assert(values.previews || (values.soundfont === undefined && values.executable === undefined && values.level === undefined), "renderer options require --previews");
  assert(!values["source-backed-chords"] || values["phrase-plan"] !== undefined, "source-backed Chords requires an explicit phrase plan");
  for (const value of [values.soundfont, values.executable]) assert(value === undefined || value.trim(), "renderer path must not be empty");
  assert(values.level === undefined || ["a", "m", "e", "ve", "b", "vb"].includes(values.level), "invalid Original preview tier");
  assert(positionals.length === 4 && positionals.every(value => value.trim()), usage);
  const [inputArg, runArg, title, artist] = positionals as [string, string, string, string];
  const run = resolve(runArg), rel = relative(process.cwd(), run);
  assert(rel && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel), "run directory must be inside checkout");
  assert(!existsSync(run), "run already exists; preserve existing work");
  let ancestor = dirname(run);
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  const physicalRun = resolve(realpathSync(ancestor), relative(ancestor, run));
  const physicalRelative = relative(realpathSync(process.cwd()), physicalRun);
  assert(physicalRelative && physicalRelative !== ".." && !physicalRelative.startsWith("../") && !isAbsolute(physicalRelative),
    "run directory must remain inside checkout after resolving parent symlinks");
  const input = resolve(inputArg), sourceInfo = statSync(input);
  assert(sourceInfo.isFile(), "input source must be a local file");
  assert(sourceInfo.size <= 16 * 1024 * 1024, "input source exceeds the 16 MiB symbolic upload limit");
  const buf = readFileSync(input);
  assert(buf.byteLength <= 16 * 1024 * 1024, "input source exceeds the 16 MiB symbolic upload limit");
  const sourceSha256 = hash(buf), baseId = "upload-" + sourceSha256;
  let phrasePlan: PhrasePlanV1 | undefined;
  let planBytes: Buffer | undefined;
  let phrasePlanPin: { schemaVersion: 1; path: string; sha256: string; fileSha256: string; sourceSha256: string } | undefined;
  if (values["phrase-plan"] !== undefined) {
    assert(values["phrase-plan"].trim(), "--phrase-plan requires a file path");
    const path = resolve(values["phrase-plan"]), info = statSync(path);
    assert(info.isFile(), "phrase plan must be a local JSON file");
    assert(info.size <= 2 * 1024 * 1024, "phrase plan exceeds 2 MiB");
    planBytes = readFileSync(path);
    assert(planBytes.byteLength <= 2 * 1024 * 1024, "phrase plan exceeds 2 MiB");
    try { phrasePlan = JSON.parse(planBytes.toString("utf8")) as PhrasePlanV1; }
    catch (error) { throw new Error(`cannot parse phrase plan JSON: ${(error as Error).message}`); }
    const { parseSymbolicUploadSource } = await import("../../../packages/catalog/src/ingest.js");
    const { canonicalPhrasePlan, compilePhrasePlan } = await import("@keyspilli/midi");
    // Refuse stale clocks/events and unselected proposals before creating any run output.
    compilePhrasePlan(parseSymbolicUploadSource(buf).parsed, phrasePlan, sourceSha256);
    assert(!values["source-backed-chords"] || phrasePlan.levels.includes("advanced"), "source-backed Chords requires Advanced phrase protection");
    const canonical = canonicalPhrasePlan(phrasePlan);
    assert(Buffer.byteLength(canonical) <= 2 * 1024 * 1024, "canonical phrase plan exceeds 2 MiB");
    phrasePlanPin = { schemaVersion: 1, path: join(run, "phrase-plan.json"), sha256: hash(canonical), fileSha256: hash(planBytes), sourceSha256 };
  }
  // Reserve the final run directory exclusively; never resume another run implicitly.
  mkdirSync(dirname(run), { recursive: true });
  mkdirSync(run);
  if (phrasePlanPin && planBytes) writeFileSync(phrasePlanPin.path, planBytes, { flag: "wx" });
  process.env.KEYSPILLI_DATA_DIR = join(run, "data");
  process.env.KEYSPILLI_CHORD_SOURCE_MAP = join(run, "empty-map.json");
  writeFileSync(process.env.KEYSPILLI_CHORD_SOURCE_MAP, JSON.stringify({ schemaVersion: 1, entries: [] }), { flag: "wx" });
  const { ingestSource } = await import("../../../packages/catalog/src/ingest.js");
  const result = await ingestSource({ buf, baseId, title, artist, contentType: "upload", acquiredVia: "upload", cleanTranscription: false, maxDurBeats: null, arrangementProfile: "source",
    ...(phrasePlan === undefined ? {} : { phrasePlan }) });
  assert(!result.error && result.songIds.length === 6, result.error ?? "incomplete import");
  const inventory = join(run, "inventory.json"), prepared = join(run, "prepared"), bundle = join(run, "bundle"), installed = join(run, "installed");
  writeFileSync(inventory, JSON.stringify([{ representative: { baseId, title, artist } }]), { flag: "wx" });
  const call = (script: string, args: string[], env = process.env) => execFileSync(process.execPath, ["--import", "tsx", `apps/web/scripts/${script}.mts`, ...args], { env, stdio: "inherit" });
  call("prepare-catalog-chords", [inventory, prepared, values["source-backed-chords"] ? "--source-backed" : "--repair"]);
  call("song-bundle", ["pack", baseId, prepared, bundle]);
  call("song-bundle", ["install", bundle, installed]);
  call("song-bundle", ["install", bundle, installed]);
  writeFileSync(join(run, "result.json"), JSON.stringify({ baseId, sourceSha256, bundle, installed,
    ...(phrasePlanPin ? { phrasePlan: phrasePlanPin } : {}),
    checks: { freshImport: true, musicalIdempotence: true }, status: "provisional", remaining: "reference/audio assessment; not automatically musically approved" }, null, 2), { flag: "wx" });
  console.log(`Prepared both modes for ${title}: ${bundle}`);
  if (values.previews) {
    const { deliverSong } = await import("../src/lib/song-delivery.js");
    const delivery = await deliverSong(run, join(run, "delivery"), values);
    console.log(`Preview delivery ${delivery.status}: ${join(run, "delivery/index.html")}`);
    if (delivery.status !== "complete-provisional") process.exitCode = 1;
  }
}

try { await main(); }
catch (error) { console.error(`prepare-song: ${(error as Error).message}`); process.exitCode = 1; }
