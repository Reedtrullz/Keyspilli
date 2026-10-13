import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  auditExactInputs, parseExactInputRegistry, exactObjectPath,
  compareExactInputAudit, goldenInputRegistry,
} from "../src/exact-input-evidence.js";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const permission = { basis: "self-authored", scopes: ["audit", "review"], evidence: "Original test fixture; freely distributable." };
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "keyspilli-exact-")); dirs.push(root);
  const bytes = "An authored source fixture.\n";
  await writeFile(join(root, "source.txt"), bytes);
  const manifest = {
    schemaVersion: 1, kind: "keyspilli-exact-input-registry",
    assets: [{ id: "source", sha256: hash(bytes), bytes: Buffer.byteLength(bytes), role: "source",
      permission: permission as typeof permission | null, locations: [{ rootId: "local", path: "source.txt" }],
      snapshots: [] as Array<{ snapshotId: string; member: string }>,
      transformation: null as null | { inputs: string[]; code: string; config: string; renderer: string | null } }],
    snapshots: [] as Array<{ id: string; manifestSha256: string; members: Array<{ path: string; sha256: string }> }>,
  };
  return { root, bytes, manifest };
}

it("resolves exact supplied bytes deterministically and keeps content-addressed locations portable", async () => {
  const { root, manifest, bytes } = await fixture();
  const objectPath = exactObjectPath(hash(bytes));
  expect(objectPath).toBe(`sha256/${hash(bytes).slice(0, 2)}/${hash(bytes)}`);
  await mkdir(join(root, "sha256", hash(bytes).slice(0, 2)), { recursive: true });
  await writeFile(join(root, objectPath), bytes);
  manifest.assets[0]!.locations.push({ rootId: "local", path: objectPath });
  const first = await auditExactInputs(manifest, { local: root }, "audit");
  expect(first.assets[0]).toMatchObject({ id: "source", status: "available", sha256: hash(bytes) });
  expect(first.reproducible).toBe(true);
  expect(await auditExactInputs(manifest, { local: root }, "audit")).toEqual(first);
  expect(JSON.stringify(first)).not.toContain(root);
});

it("records unavailable and changed bytes separately without replacing the requested hash", async () => {
  const { root, manifest } = await fixture();
  const before = JSON.stringify(manifest);
  await writeFile(join(root, "source.txt"), "changed");
  const changed = await auditExactInputs(manifest, { local: root }, "audit");
  expect(changed.assets[0]).toMatchObject({ status: "mismatch", sha256: manifest.assets[0]!.sha256 });
  await rm(join(root, "source.txt"));
  expect((await auditExactInputs(manifest, { local: root }, "audit")).assets[0]!.status).toBe("unavailable");
  expect(JSON.stringify(manifest)).toBe(before);
});

it("reports conflicting supplied locations as ambiguous instead of preferring one exact match", async () => {
  const { root, manifest } = await fixture();
  await writeFile(join(root, "other.txt"), "different version");
  manifest.assets[0]!.locations.push({ rootId: "local", path: "other.txt" });
  expect((await auditExactInputs(manifest, { local: root }, "audit")).assets[0]!.status).toBe("ambiguous");
});

it("withholds reads for absent or insufficient permission, including audit-only evidence in review", async () => {
  const { root, manifest } = await fixture();
  manifest.assets[0]!.permission = null;
  expect((await auditExactInputs(manifest, { local: root }, "audit")).assets[0]).toMatchObject({ status: "permission-blocked", observed: [] });
  manifest.assets[0]!.permission = { ...permission, scopes: ["audit"] };
  expect((await auditExactInputs(manifest, { local: root }, "review")).assets[0]!.status).toBe("permission-blocked");
});

it("treats an omitted permission as individually blocked and rejects an empty inventory", async () => {
  const { root, manifest } = await fixture();
  const { permission: _permission, ...asset } = manifest.assets[0]!;
  expect((await auditExactInputs({ ...manifest, assets: [asset] }, { local: root }, "audit")).assets[0]!.status).toBe("permission-blocked");
  expect(() => parseExactInputRegistry({ ...manifest, assets: [] })).toThrow(/inventory|asset/);
});

it("requires code/config/renderer references to identify those asset roles", async () => {
  const { manifest } = await fixture();
  manifest.assets.push({ ...manifest.assets[0]!, id: "derived", transformation: { inputs: ["source"], code: "source", config: "source", renderer: null } });
  expect(() => parseExactInputRegistry(manifest)).toThrow(/code|config|role/);
});

it("refuses escaping paths and withholds a symlink outside the explicit local root", async () => {
  const { root, manifest } = await fixture();
  manifest.assets[0]!.locations[0]!.path = "../private.txt";
  expect(() => parseExactInputRegistry(manifest)).toThrow(/relative|location|path/);
  manifest.assets[0]!.locations[0]!.path = "escape.txt";
  const outside = await mkdtemp(join(tmpdir(), "keyspilli-outside-")); dirs.push(outside);
  await writeFile(join(outside, "private.txt"), "private");
  await symlink(join(outside, "private.txt"), join(root, "escape.txt"));
  expect((await auditExactInputs(manifest, { local: root }, "audit")).assets[0]!.status).toBe("permission-blocked");
});

it("bounds file sizes before reading and reports non-regular files", async () => {
  const { root, manifest } = await fixture();
  expect((await auditExactInputs(manifest, { local: root }, "audit", { maxAssetBytes: 4 })).assets[0]!.status).toBe("unavailable");
  manifest.assets[0]!.locations[0]!.path = "directory";
  await mkdir(join(root, "directory"));
  expect((await auditExactInputs(manifest, { local: root }, "audit")).assets[0]!.status).toBe("unavailable");
});

it("checks declared historical membership without treating a different snapshot as current input", async () => {
  const { root, manifest } = await fixture();
  manifest.snapshots.push({ id: "september", manifestSha256: hash("historical index"), members: [{ path: "notes.json", sha256: hash("old notes") }] });
  manifest.assets[0]!.snapshots.push({ snapshotId: "september", member: "notes.json" });
  expect((await auditExactInputs(manifest, { local: root }, "audit")).assets[0]!.status).toBe("historical-mismatch");
});

it("rejects duplicate identities, dangling transformation inputs and cycles", async () => {
  const { manifest } = await fixture();
  expect(() => parseExactInputRegistry({ ...manifest, assets: [...manifest.assets, manifest.assets[0]] })).toThrow(/duplicate|unique/);
  manifest.assets[0]!.transformation = { inputs: ["missing"], code: "source", config: "source", renderer: null };
  expect(() => parseExactInputRegistry(manifest)).toThrow(/reference|input|cycle/);
});

it("invalidates a prior receipt when actual receipt bytes or the manifest permission change", async () => {
  const { root, manifest } = await fixture();
  manifest.assets[0]!.role = "receipt";
  const first = await auditExactInputs(manifest, { local: root }, "review");
  expect(compareExactInputAudit(first, first).status).toBe("unchanged");
  await writeFile(join(root, "source.txt"), "changed review receipt");
  expect(compareExactInputAudit(first, await auditExactInputs(manifest, { local: root }, "review")).status).toBe("invalidated");
  manifest.assets[0]!.permission = { ...permission, evidence: "Changed terms." };
  expect(compareExactInputAudit(first, await auditExactInputs(manifest, { local: root }, "review")).status).toBe("invalidated");
});

it("adapts all real current golden entries with explicit unavailable inputs and distinct historical pins", async () => {
  const corpus = JSON.parse(await readFile(new URL("../../../catalog/chord-golden-corpus.json", import.meta.url), "utf8"));
  const sources = JSON.parse(await readFile(new URL("../../../catalog/chord-sources.json", import.meta.url), "utf8"));
  const before = JSON.stringify(corpus);
  const historical = { archiveSha256: hash("september archive"), files: [{ name: `data/artifacts/${corpus.entries[0].baseId}/a/notes.json`, bytes: 10, sha256: hash("old notes") }] };
  const adapted = goldenInputRegistry(corpus, sources, { permission, historical });
  expect(adapted.entries).toHaveLength(12);
  expect(adapted.entries.every((e: { acceptedPlaybackSha256: string | null }) => e.acceptedPlaybackSha256 === null)).toBe(true);
  expect(adapted.entries[0]!.historical).toMatchObject({ status: "mismatch", sha256: hash("old notes") });
  const audit = await auditExactInputs(adapted.registry, {}, "audit");
  expect(audit.reproducible).toBe(false);
  expect(audit.assets.every((a: { status: string }) => a.status === "unavailable")).toBe(true);
  expect(JSON.stringify(corpus)).toBe(before);
});
