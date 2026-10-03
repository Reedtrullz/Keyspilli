import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const run = resolve(process.argv[2] ?? process.env.KEYSPILLI_PLAYER_CORPUS_RUN ?? join(root, "output/song-prep/player-qualification-20261003"));
const casesPath = join(run, "model-facing/cases.json");
const outputPath = join(run, "model-facing/preview.html");
const manifest = JSON.parse(readFileSync(casesPath, "utf8"));
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const assetUrl = (path, expectedHash) => {
  if (!path || !expectedHash) return null;
  const absolute = resolve(run, "model-facing", path);
  const bytes = readFileSync(absolute);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== expectedHash) throw new Error(`Audio hash mismatch for ${path}: expected ${expectedHash}, got ${actualHash}`);
  const relativePath = join("..", "model-facing", path).replaceAll("\\", "/");
  return { url: relativePath.split("/").map(encodeURIComponent).join("/"), bytes: bytes.length };
};

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.cases) || manifest.cases.length !== 24)
  throw new Error("Expected a schemaVersion 1 Player qualification manifest with 24 pairwise cases");
const cards = manifest.cases.map((item, index) => {
  const reference = assetUrl(item.reference?.path, item.reference?.sha256);
  const candidate = assetUrl(item.candidate?.path, item.candidate?.sha256);
  const missingAudio = !reference || !candidate;
  const player = (label, asset) => asset
    ? `<audio controls preload="none" aria-label="${label} audio for pair ${index + 1}" src="${escapeHtml(asset.url)}"></audio><small>${(asset.bytes / 1024).toFixed(0)} KiB · SHA-256 ${escapeHtml((label === "Reference" ? item.reference.sha256 : item.candidate.sha256).slice(0, 12))}…</small>`
    : `<p class="empty">No audio attached</p>`;
  return `<article class="pair"><header><h2>Pair ${String(index + 1).padStart(2, "0")}</h2><span>${escapeHtml(item.mode === "chords" ? "Chords" : "Original")}</span></header><div class="players"><section><h3>Reference</h3>${player("Reference", reference)}</section><section><h3>Candidate</h3>${player("Candidate", candidate)}</section></div>${missingAudio ? "<p class=\"empty\">This mandatory negative control intentionally has no audio.</p>" : ""}</article>`;
}).join("\n");
const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Keyspilli Player audio pilot — offline preview</title>
<style>
:root{color-scheme:light dark;font:16px/1.5 system-ui,sans-serif}body{max-width:980px;margin:2rem auto;padding:0 1rem}h1{line-height:1.15}.notice{padding:1rem;border:1px solid #8888;border-radius:.7rem;background:color-mix(in srgb,Canvas 92%,#d9aa22)}.pair{margin:1.2rem 0;padding:1rem;border:1px solid #8886;border-radius:.7rem}.pair header{display:flex;align-items:center;justify-content:space-between}.pair header span{font-size:.85rem;opacity:.75}.players{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.players section{min-width:0}audio{width:100%}small{display:block;overflow-wrap:anywhere;opacity:.7}.empty{opacity:.75}@media(max-width:650px){.players{grid-template-columns:1fr}}
</style>
<main><h1>Keyspilli Player audio pilot</h1><p>Offline preview of the actual sampled-piano Player captures. Use the paired controls to compare each reference and candidate at your own pace.</p><p class="notice"><strong>Study status:</strong> the provider qualification study stopped at its first mandatory missing-audio control. This page is for offline human comparison of the captured audio; it is not a provider result, route qualification, or musical approval. Case labels and the evaluator key are intentionally omitted.</p>${cards}<footer><p>Audio is hash-checked against the model-facing manifest when this page is generated. Source and Player capture receipts remain in the local ignored output directory.</p></footer></main></html>
`;
writeFileSync(outputPath, html);
console.log(JSON.stringify({ output: outputPath, cases: manifest.cases.length, audioHashChecks: manifest.cases.reduce((n, item) => n + Number(Boolean(item.reference?.path)) + Number(Boolean(item.candidate?.path)), 0) }, null, 2));
