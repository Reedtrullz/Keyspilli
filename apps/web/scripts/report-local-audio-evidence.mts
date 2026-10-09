#!/usr/bin/env node
/** No route, helper, upload, model invocation or automatic repair. */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { collectLocalAudioEvidence, readLocalEvidenceJson, renderLocalAudioEvidence } from "../src/lib/local-audio-evidence.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "capabilities") {
    console.log(JSON.stringify({ schemaVersion: 1, localOnly: true, providerCalls: 0, uploadsAudio: false, acceptsSavedAntiObservations: true, acousticTranscription: false, automaticRepairs: false, musicalAcceptance: "not-established" }));
    return;
  }
  if (args.length !== 2 || args.some(arg => arg.startsWith("--"))) throw new Error("Usage: report-local-audio-evidence.mts MANIFEST.json NEW_OUTPUT_DIR — local/offline only; no live flags");
  const manifestPath = resolve(args[0]!), outputDir = resolve(args[1]!);
  const report = await collectLocalAudioEvidence(await readLocalEvidenceJson(manifestPath));
  // Nonrecursive, exclusive directory creation preserves any existing output/WIP.
  await mkdir(outputDir, { mode: 0o700 });
  await writeFile(join(outputDir, "evidence.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await writeFile(join(outputDir, "evidence.md"), renderLocalAudioEvidence(report), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ report: join(outputDir, "evidence.json"), markdown: join(outputDir, "evidence.md"), providerCalls: 0, musicalAcceptance: "not-established" }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
