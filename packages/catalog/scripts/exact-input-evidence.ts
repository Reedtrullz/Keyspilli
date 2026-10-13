/** Finite, offline recovery evidence. Never downloads, extracts or edits golden pins. */
import { constants } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { assertMusic, identityHash, stableIdentity } from "../src/acoustic-receipt.js";
import { auditExactInputs, compareExactInputAudit, goldenInputRegistry, parseExactInputRegistry, type ExactInputAudit, type ExactInputPermission, type ExactInputRegistry } from "../src/exact-input-evidence.js";
import { prepareFullOutputReview, type FullOutputReviewRequest, type FullOutputReviewPackage } from "../src/full-output-review.js";

const usage = "audit|resolve --manifest REGISTRY --purpose audit|review [--previous AUDIT] | review --manifest REGISTRY --request REQUEST | golden --golden CORPUS --sources SOURCE_MAP [--historical INDEX] [--archive-file FILE] [--permission PERMISSION_JSON] [--select BASE_ID (max 3)]. Every command: [--root ID=/absolute/root] --output NEW_DIRECTORY";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function main(): Promise<void> {
  const args = process.argv.slice(2), command = args.shift();
  if (command === "--help") { console.log(usage); return; }
  assertMusic(["audit", "resolve", "review", "golden"].includes(command ?? ""), usage);
  const common = ["--root", "--output"], allowed = [...common, ...(command === "golden" ? ["--golden", "--sources", "--historical", "--archive-file", "--permission", "--select"] : command === "review" ? ["--manifest", "--request"] : ["--manifest", "--purpose", "--previous"])];
  const options = new Map<string, string[]>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    assertMusic(allowed.includes(key) && value && !value.startsWith("--"), `unknown or incomplete option: ${key}`);
    assertMusic(!options.has(key) || ["--root", "--select"].includes(key), `duplicate option: ${key}`);
    options.set(key, [...(options.get(key) ?? []), value]);
  }
  const required = (key: string) => { const value = options.get(key)?.[0]; assertMusic(value, `${key} required`); return value; };
  const roots: Record<string, string> = {};
  for (const value of options.get("--root") ?? []) {
    const at = value.indexOf("="), id = value.slice(0, at), path = value.slice(at + 1);
    assertMusic(at > 0 && /^[a-z0-9][a-z0-9-]{0,125}$/.test(id) && !Object.hasOwn(roots, id) && isAbsolute(path), "unique ID=/absolute/root required"); roots[id] = path;
  }
  const output = resolve(required("--output")), files: Record<string, unknown> = {}, rawFiles: Record<string, string> = {}, inputs: Array<{ role: string; path: string; sha256: string; bytes: number }> = [];
  function reviewFiles(pack: FullOutputReviewPackage) {
    for (const piece of pack.pieces) for (const mode of piece.modes) {
      // These exact canonical bytes have the SHA-256 referenced by receipts.
      rawFiles[`${mode.binding.id}.json`] = stableIdentity(mode.binding.contents);
      if (mode.receiptTemplate) files[`pending-${mode.binding.id}.json`] = mode.receiptTemplate;
    }
  }
  async function readJson(path: string, role: string) {
    const absolute = resolve(path), f = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await f.stat(); assertMusic(before.isFile() && before.size <= 8 * 1024 * 1024, "bounded regular JSON input required");
      const b = Buffer.alloc(before.size + 1); let length = 0;
      while (length < b.length) { const r = await f.read(b, length, b.length - length, length); if (!r.bytesRead) break; length += r.bytesRead; }
      const after = await f.stat(); assertMusic(length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs, "JSON changed during read");
      const bytes = b.subarray(0, length); inputs.push({ role, path: absolute, sha256: hash(bytes), bytes: length }); return JSON.parse(bytes.toString("utf8")) as unknown;
    } finally { await f.close(); }
  }
  let exitCode = 0;
  if (command === "golden") {
    const corpus = await readJson(required("--golden"), "golden"), sources = await readJson(required("--sources"), "sources");
    const historical = options.has("--historical") ? await readJson(required("--historical"), "historical") : undefined;
    const permission = options.has("--permission") ? await readJson(required("--permission"), "permission") as ExactInputPermission : null;
    const adapted = goldenInputRegistry(corpus, sources, { permission, historical });
    if (options.has("--archive-file")) {
      assertMusic(historical && typeof historical === "object" && "archiveSha256" in historical, "archive file requires pinned historical index");
      const path = resolve(required("--archive-file")); assertMusic(!roots["archive-container"], "reserved archive-container root"); roots["archive-container"] = dirname(path);
      adapted.registry.assets.push({ id: "archive-container", sha256: String(historical.archiveSha256), bytes: null, role: "metadata", permission,
        locations: [{ rootId: "archive-container", path: basename(path) }], snapshots: [], transformation: null });
    }
    // Bind actual index/corpus bytes as well as the semantic historical member map.
    for (const input of inputs) {
      const rootId = `metadata-${input.role}`; assertMusic(!roots[rootId], "reserved metadata root"); roots[rootId] = dirname(input.path);
      adapted.registry.assets.push({ id: rootId, sha256: input.sha256, bytes: input.bytes, role: "metadata", permission,
        locations: [{ rootId, path: basename(input.path) }], snapshots: [], transformation: null });
    }
    const registry = parseExactInputRegistry(adapted.registry), audit = await auditExactInputs(registry, roots, "audit");
    const byId = new Map(audit.assets.map(a => [a.id, a]));
    const entries = adapted.entries.map(e => ({ ...e, currentNotes: byId.get(e.notesAssetId)!, currentTimeline: byId.get(e.timelineAssetId)!,
      historicalAvailability: e.historical.assetId ? byId.get(e.historical.assetId)! : null,
      currentInputsReproducible: [e.notesAssetId, e.timelineAssetId].every(id => byId.get(id)?.status === "available") }));
    const selected = options.get("--select") ?? entries.slice(0, 3).map(e => e.baseId);
    assertMusic(selected.length > 0 && selected.length <= 3 && new Set(selected).size === selected.length && selected.every(id => entries.some(e => e.baseId === id)), "select one to three distinct current golden compositions");
    const request: FullOutputReviewRequest = { schemaVersion: 1, kind: "keyspilli-full-output-review-request", registrySha256: identityHash(registry), pieces: selected.map(id => {
      const e = entries.find(e => e.baseId === id)!;
      return { id: e.baseId, compositionId: e.baseId, performanceId: null, classification: "real", sourceAssetId: e.notesAssetId, sourceClock: null, provenance: null,
        modes: (["Original", "Chords"] as const).map(mode => ({ mode, identity: null, outputClock: null,
          artifacts: { midi: null, musicxml: null, playerSnapshot: null, playerCapture: null, playerAudio: null, capturePlan: null }, receiptAssetIds: [] })) };
    }) };
    const review = await prepareFullOutputReview(request, registry, roots);
    reviewFiles(review);
    Object.assign(files, { "registry.json": registry, "audit.json": audit, "golden-report.json": { schemaVersion: 1, kind: "keyspilli-golden-input-inventory", entries,
      acceptedPlaybackCount: entries.filter(e => e.acceptedPlaybackSha256 !== null).length,
      reproducibleCurrentCount: entries.filter(e => e.currentInputsReproducible).length,
      historicalMismatchCount: entries.filter(e => e.historical.status === "mismatch").length,
      scope: "Declared historical membership and exact local availability are separate. An older snapshot mismatch is not a production regression. Existing backing/excerpt pins never supply full playback acceptance.", providerCalls: 0 },
      "review-request.json": request, "review-package.json": review });
    exitCode = entries.every(e => e.currentInputsReproducible) && review.status === "ready-for-independent-review" ? 0 : 2;
  } else {
    const registry: ExactInputRegistry = parseExactInputRegistry(await readJson(required("--manifest"), "registry")); files["registry.json"] = registry;
    if (command === "review") {
      const request = await readJson(required("--request"), "request"), pack = await prepareFullOutputReview(request, registry, roots);
      reviewFiles(pack);
      files["review-request.json"] = request; files["review-package.json"] = pack; exitCode = pack.status === "ready-for-independent-review" || pack.status === "synthetic-only" ? 0 : 2;
    } else {
      const purpose = required("--purpose"); assertMusic(purpose === "audit" || purpose === "review", "explicit audit or review purpose required");
      const audit = await auditExactInputs(registry, roots, purpose); files["audit.json"] = audit;
      if (options.has("--previous")) {
        const comparison = compareExactInputAudit(await readJson(required("--previous"), "previous-audit") as ExactInputAudit, audit); files["comparison.json"] = comparison;
        if (comparison.status !== "unchanged") exitCode = 2;
      }
      if (!audit.reproducible) exitCode = 2;
    }
  }
  files["input-files.json"] = inputs;
  files["local-roots.json"] = roots;
  await mkdir(output, { recursive: false, mode: 0o700 });
  for (const [name, value] of Object.entries(files)) await writeFile(join(output, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  for (const [name, value] of Object.entries(rawFiles)) await writeFile(join(output, name), value, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ output, files: [...Object.keys(files), ...Object.keys(rawFiles)], status: exitCode === 0 ? "prepared" : "blocked", providerCalls: 0, musicalAcceptance: "not-established" }));
  process.exitCode = exitCode;
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Exact input evidence failed"); process.exitCode = 1; });
