#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const baselinePath = join(repoRoot, "docs/superpowers/evidence/2026-09-17-chords-v2-baseline.json");
const captureManifestPath = join(repoRoot, "docs/superpowers/evidence/2026-09-17-chords-v2-oops-phrase-captures.json");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const captureManifest = JSON.parse(readFileSync(captureManifestPath, "utf8"));
const failures = [];
const checked = [];

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function checkFile(path, expected, label) {
  if (!existsSync(path)) {
    failures.push(`${label}: missing ${path}`);
    return;
  }
  const actual = sha256(path);
  checked.push(label);
  if (!/^[a-f0-9]{64}$/.test(expected)) failures.push(`${label}: expected SHA-256 is not 64 hex characters`);
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

function checkFixture(root, item, label) {
  for (const file of ["notes.json", "manifest.json", "song.json"]) {
    checkFile(join(repoRoot, root, item.baseId, file === "notes.json" ? "a/notes.json" : file), item.fixtureFilesSha256[file], `${label}/${file}`);
  }
}

for (const item of baseline.productionFixtures) checkFixture("docs/superpowers/evidence/2026-09-17-chords-v2-fixtures", item, `production/${item.baseId}`);
for (const item of baseline.evaluationReservation) checkFixture("docs/superpowers/evidence/2026-09-17-chords-v2-evaluation-fixtures", item, `evaluation/${item.baseId}`);

if (captureManifest.entries.length !== 19) failures.push(`capture manifest: expected 19 entries, got ${captureManifest.entries.length}`);
for (const entry of captureManifest.entries) {
  const audioPath = existsSync(entry.audioPath) ? entry.audioPath : resolve(repoRoot, entry.audioPath);
  const metadataPath = existsSync(entry.metadataPath) ? entry.metadataPath : resolve(repoRoot, entry.metadataPath);
  checkFile(audioPath, entry.sha256, `capture/${entry.mode}/${entry.window.id}/audio`);
  if (existsSync(audioPath) && statSync(audioPath).size !== entry.bytes) failures.push(`capture/${entry.mode}/${entry.window.id}: byte count mismatch`);
  if (!existsSync(metadataPath)) failures.push(`capture/${entry.mode}/${entry.window.id}: missing metadata ${metadataPath}`);
  else JSON.parse(readFileSync(metadataPath, "utf8"));
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`T1 evidence hashes valid: ${checked.length} files; ${captureManifest.entries.length} captures`);
