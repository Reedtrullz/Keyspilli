/** Exact local symbolic source inspection; proposals remain unrequired and unvalidated. */
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { suggestPhrasePlan, SOURCE_GAP_BRIDGE_CAPABILITY } from "@keyspilli/midi";

const usage = `Usage: node --import tsx apps/web/scripts/phrase-plan.mts inspect INPUT NEW_PLAN_JSON --composition-id ID --performance-id ID
       node --import tsx apps/web/scripts/phrase-plan.mts capabilities

Inspect exact local MIDI, MusicXML or compressed MXL bytes and write a new phrase-plan JSON file.
The output includes source SHA-256, native clock and real origin IDs. Role proposals are uncertain;
all events remain unrequired and no validation or musical approval is claimed.

  --composition-id ID   Explicit composition identity (required)
  --performance-id ID   Explicit performance/source occurrence identity (required)
  --help, -h            Show this help

Review the source, roles, target levels and legal transformations before selecting required events.
The output file must be new; existing review evidence is never overwritten. No catalog is opened.`;

async function main() {
  const { values, positionals, tokens } = parseArgs({ allowPositionals: true, tokens: true, options: {
    "composition-id": { type: "string" }, "performance-id": { type: "string" }, help: { type: "boolean", short: "h" },
  } });
  if (values.help) { console.log(usage); return; }
  if (positionals.length === 1 && positionals[0] === "capabilities") {
    if (tokens.some(token => token.kind === "option")) throw new Error("capabilities accepts no options");
    console.log(JSON.stringify(SOURCE_GAP_BRIDGE_CAPABILITY)); return;
  }
  for (const name of ["composition-id", "performance-id"]) {
    if (tokens.filter(token => token.kind === "option" && token.name === name).length > 1) throw new Error(`--${name} may be supplied only once`);
  }
  if (positionals.length !== 3 || positionals[0] !== "inspect") throw new Error(usage);
  const compositionId = values["composition-id"]?.trim(), performanceId = values["performance-id"]?.trim();
  if (!compositionId || !performanceId) throw new Error("--composition-id and --performance-id are required; source identities are not guessed");
  const input = resolve(positionals[1]!), output = resolve(positionals[2]!);
  const info = statSync(input);
  if (!info.isFile()) throw new Error("input source must be a local file");
  if (info.size > 16 * 1024 * 1024) throw new Error("input source exceeds the 16 MiB symbolic upload limit");
  const bytes = readFileSync(input);
  if (bytes.byteLength > 16 * 1024 * 1024) throw new Error("input source exceeds the 16 MiB symbolic upload limit");
  const { parseSymbolicUploadSource } = await import("../../../packages/catalog/src/ingest.js");
  let source;
  try { source = parseSymbolicUploadSource(bytes); }
  catch (error) { throw new Error(`cannot parse symbolic source: ${(error as Error).message}`); }
  const plan = suggestPhrasePlan(source.parsed, { sha256: createHash("sha256").update(bytes).digest("hex"), compositionId, performanceId });
  const serialized = JSON.stringify(plan, null, 2) + "\n";
  if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) throw new Error("inspection plan exceeds 2 MiB; inspect a smaller bounded source fragment");
  // Exclusive create also refuses an existing symlink, even a dangling one.
  try { writeFileSync(output, serialized, { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("output already exists; preserve existing review evidence and choose a new file");
    throw error;
  }
  console.log(`Wrote ${source.parsed.notes.length} unrequired role proposals from ${source.format}: ${output}`);
  console.log("Review and explicitly select protections before preparation; this plan is not validation or musical approval.");
}

try { await main(); }
catch (error) { console.error(`phrase-plan: ${(error as Error).message}`); process.exitCode = 1; }
