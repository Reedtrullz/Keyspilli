/** Portable exact-artifact bundle. install/rollback target an isolated local catalog, never a running service.
 * pack BASE_ID PREPARED_DIR BUNDLE_DIR (KEYSPILLI_DATA_DIR identifies the source)
 * install BUNDLE_DIR NEW_DATA_DIR | verify BUNDLE_DIR DATA_DIR | rollback BUNDLE_DIR DATA_DIR
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const [mode, ...args] = process.argv.slice(2);
const levels = ["a", "b", "e", "m", "ve", "vb"];
const artifactFiles = ["manifest.json", ...levels.flatMap(l => ["notes.json", "variant.mid", "variant.xml"].map(f => `${l}/${f}`))];
const required = [...artifactFiles.map(f => `artifacts/${f}`), "rows.json", "timeline.json", "playback.json", "chords.mid", "chords.musicxml"];
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const json = (path: string, value: unknown) => { writeFileSync(path + ".tmp", JSON.stringify(value, null, 2) + "\n"); renameSync(path + ".tmp", path); };
const copy = (from: string, to: string) => { assert(lstatSync(from).isFile(), `not a regular file: ${from}`); mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); };
const inside = (path: string) => { const rel = relative(process.cwd(), path); assert(rel && rel !== ".." && !rel.startsWith("../"), "data directory must be inside the capable checkout"); return rel; };
const canonical = (value: unknown) => JSON.parse(JSON.stringify(value));
assert(["pack", "install", "verify", "rollback"].includes(mode ?? ""), "usage: song-bundle.mts pack|install|verify|rollback ...");
if (mode === "pack") {
  const [baseId, preparedArg, bundleArg] = args;
  assert(baseId && /^[a-z0-9][a-z0-9-]{0,119}$/.test(baseId) && preparedArg && bundleArg && process.env.KEYSPILLI_DATA_DIR, "pack BASE_ID PREPARED_DIR BUNDLE_DIR with KEYSPILLI_DATA_DIR");
  const prepared = resolve(preparedArg), bundle = resolve(bundleArg), receipt = read(join(prepared, baseId, "receipt.json"));
  assert(!existsSync(bundle), "bundle output already exists");
  for (const [file, digest] of Object.entries(receipt.files)) {
    assert(!file.includes("/") && !file.includes("\\") && file !== "..", "invalid receipt path");
    assert.equal(hash(readFileSync(join(prepared, baseId, file))), digest, `stale prepared ${file}`);
  }
  process.env.KEYSPILLI_CHORD_SOURCE_MAP = join(prepared, "chord-sources.json");
  const { getSongsByBase } = await import("../../../packages/catalog/src/db.js");
  const { parseChordTimeline } = await import("../../../packages/catalog/src/chord-timeline.js");
  const rows = getSongsByBase(baseId);
  assert(rows.length === 6, "requires a complete six-level publication");
  const playback = read(join(prepared, baseId, "playback.json"));
  const { getSongDetail } = await import("../src/lib/catalog-api.js");
  const { replayChordsBacking } = await import("../src/components/player/chords-backing.js");
  const { snapshotChordsBacking } = await import("../src/lib/chords-evaluation.js");
  const detail = await getSongDetail(`${baseId}-a`);
  assert(detail?.data && !detail.chordUnavailableReason, "source is unavailable");
  const data = detail.chordData ?? detail.data, replay = replayChordsBacking(data);
  assert.deepEqual(canonical(snapshotChordsBacking(data, replay)), playback.snapshot, "stale preparation: regenerate before packaging");
  const map = read(join(prepared, "chord-sources.json"));
  const source = map.entries.find((e: any) => e.baseId === baseId)?.sources.find((s: any) => s.artifactPath && s.sourceRef === replay.selected.source?.provenanceInfo?.sourceRef);
  assert(source?.artifactPath, "missing backing artifact");
  const timeline = parseChordTimeline(read(resolve(source.artifactPath)));
  assert.equal(timeline.baseId, baseId);
  mkdirSync(bundle, { recursive: true });
  for (const file of artifactFiles) copy(join(process.env.KEYSPILLI_DATA_DIR, "artifacts", baseId, file), join(bundle, "artifacts", file));
  for (const file of ["playback.json", "chords.mid", "chords.musicxml"]) copy(join(prepared, baseId, file), join(bundle, file));
  json(join(bundle, "rows.json"), rows); json(join(bundle, "timeline.json"), timeline);
  json(join(bundle, "bundle.json"), { schemaVersion: 1, baseId, status: receipt.status, assessment: receipt.assessment,
    requiredCapability: "prepared-source-fingerprint-and-phrase-rests-v1", files: Object.fromEntries(required.map(f => [f, hash(readFileSync(join(bundle, f)))])) });
  console.log(`Packaged ${baseId}: exact Original publication plus Chords; verify by installing in a second directory.`);
} else {
  assert(args.length === 2, "install|verify|rollback BUNDLE_DIR DATA_DIR");
  const bundle = resolve(args[0]!), target = resolve(args[1]!); inside(target);
  const manifest = read(join(bundle, "bundle.json")), digest = hash(readFileSync(join(bundle, "bundle.json")));
  assert.equal(manifest.schemaVersion, 1); assert(/^[a-z0-9][a-z0-9-]{0,119}$/.test(manifest.baseId));
  assert.deepEqual(Object.keys(manifest.files).sort(), [...required].sort(), "unexpected bundle files");
  for (const file of mode === "rollback" ? [] : required) {
    assert(lstatSync(join(bundle, file)).isFile(), "bundle symlink/directory refused");
    assert.equal(hash(readFileSync(join(bundle, file))), manifest.files[file], `hash mismatch: ${file}`);
  }
  const marker = join(target, "bundle-install.json"), mapPath = join(target, "chord-sources.json");
  const verify = () => execFileSync(process.execPath, ["--import", "tsx", new URL(import.meta.url).pathname, "verify", bundle, target], {
    env: { ...process.env, KEYSPILLI_DATA_DIR: target, KEYSPILLI_CHORD_SOURCE_MAP: mapPath }, stdio: "inherit",
  });
  if (mode === "rollback") {
    assert.equal(read(marker).bundleHash, digest, "target belongs to another package");
    // A newer engine can reject an old bundle; rollback must still preserve and remove that installation.
    const backup = target + ".rollback-" + digest.slice(0, 12);
    assert(!existsSync(backup), "rollback destination exists");
    renameSync(target, backup);
    console.log(`Removed isolated installation; all bytes preserved at ${backup}`);
  } else if (mode === "install" && existsSync(marker)) {
    assert.equal(read(marker).bundleHash, digest, "conflicting existing installation");
    verify(); console.log("Identical bundle already installed; musical data unchanged.");
  } else {
    process.env.KEYSPILLI_DATA_DIR = target; process.env.KEYSPILLI_CHORD_SOURCE_MAP = mapPath;
    if (mode === "install") assert(!existsSync(target) || readdirSync(target).length === 0, "install requires an empty isolated catalog; existing content is preserved");
    const { getSongDetail } = await import("../src/lib/catalog-api.js");
    const { replayChordsBacking } = await import("../src/components/player/chords-backing.js");
    const { snapshotChordsBacking } = await import("../src/lib/chords-evaluation.js");
    const { getDb } = await import("../../../packages/catalog/src/db.js");
    const { parseChordTimeline } = await import("../../../packages/catalog/src/chord-timeline.js");
    const timeline = parseChordTimeline(read(join(bundle, "timeline.json")));
    assert.equal(timeline.baseId, manifest.baseId);
    if (mode === "install") {
      const { publishBaseArtifact } = await import("../../../packages/catalog/src/publish.js");
      const { commitCatalogPublication } = await import("../../../packages/catalog/src/reconcile.js");
      mkdirSync(target, { recursive: true });
      json(marker, { bundleHash: digest, baseId: manifest.baseId, status: "pending-verification" });
      const publication = { baseId: manifest.baseId, rows: read(join(bundle, "rows.json")) };
      await publishBaseArtifact(manifest.baseId, stage => {
        for (const file of artifactFiles) copy(join(bundle, "artifacts", file), join(stage, file));
      }, { artifactsRoot: join(target, "artifacts"), semanticValidation: "strict", recoveryData: publication,
        afterSwap: () => commitCatalogPublication(publication) });
      copy(join(bundle, "timeline.json"), join(target, "timeline.json"));
      json(mapPath, { schemaVersion: 1, entries: [{ baseId: manifest.baseId, canonicalTitle: timeline.title, canonicalArtist: timeline.artist,
        sources: [{ id: timeline.provenance.sourceId, provider: timeline.provenance.provider, kind: timeline.provenance.kind,
          sourceRef: timeline.provenance.sourceRef, artifactPath: inside(join(target, "timeline.json")), priority: 0 }] }] });
      getDb().close(); verify(); json(marker, { bundleHash: digest, baseId: manifest.baseId, status: "verified" });
    } else {
      assert.equal(read(marker).bundleHash, digest);
      assert.equal((getDb().prepare("SELECT COUNT(*) AS n FROM songs").get() as { n: number }).n, 6, "target contains unrelated catalog rows");
      for (const file of artifactFiles) assert.equal(hash(readFileSync(join(target, "artifacts", manifest.baseId, file))), manifest.files[`artifacts/${file}`], `changed installed ${file}`);
      const detail = await getSongDetail(`${manifest.baseId}-a`), expected = read(join(bundle, "playback.json"));
      assert(detail?.data && !detail.chordUnavailableReason, "loader rejected bundle");
      // The attached map changes harmony metadata on detail.data, not Original notes/clock.
      for (const field of ["notes", "tempoBpm", "timeSig", "timeSigEvents", "measures", "sourceFingerprint"] as const)
        assert.deepEqual(canonical({ value: detail.data[field] }), canonical({ value: expected.advanced[field] }), `Original ${field} changed`);
      const data = detail.chordData ?? detail.data;
      assert.deepEqual(canonical(snapshotChordsBacking(data, replayChordsBacking(data))), expected.snapshot, "installed Chords playback differs");
      getDb().close(); console.log(`Verified both modes for ${manifest.baseId}`);
    }
  }
}
