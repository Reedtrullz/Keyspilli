import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const exec = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/exact-input-evidence.ts", import.meta.url));
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function run(args: string[]) {
  try { const r = await exec(process.execPath, ["--import", "tsx", script, ...args], { cwd: repo, timeout: 15000 }); return { code: 0, ...r }; }
  catch (error) { const e = error as { code: number; stdout: string; stderr: string }; return { code: e.code, stdout: e.stdout, stderr: e.stderr }; }
}

it("runs exact resolution privately, verifies a prior audit and refuses to overwrite an output directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "keyspilli-exact-cli-")); dirs.push(root);
  await writeFile(join(root, "source"), "authored input");
  const manifest = { schemaVersion: 1, kind: "keyspilli-exact-input-registry", snapshots: [], assets: [{ id: "source", role: "source", sha256: createHash("sha256").update("authored input").digest("hex"), bytes: 14,
    permission: { basis: "self-authored", scopes: ["audit"], evidence: "Distributable fixture." }, locations: [{ rootId: "local", path: "source" }], snapshots: [], transformation: null }] };
  const path = join(root, "manifest.json"), output = join(root, "audit"); await writeFile(path, JSON.stringify(manifest));
  const args = ["resolve", "--manifest", path, "--root", `local=${root}`, "--purpose", "audit", "--output", output];
  expect((await run(args)).code).toBe(0);
  const bytes = await readFile(join(output, "audit.json"));
  expect(JSON.parse(bytes.toString()).assets[0].status).toBe("available");
  expect((await stat(output)).mode & 0o777).toBe(0o700);
  expect((await stat(join(output, "audit.json"))).mode & 0o777).toBe(0o600);
  expect((await run(args)).code).toBe(1);
  expect(await readFile(join(output, "audit.json"))).toEqual(bytes);
  await writeFile(join(root, "source"), "different bytes");
  const next = await run(["audit", "--manifest", path, "--root", `local=${root}`, "--purpose", "audit", "--previous", join(output, "audit.json"), "--output", join(root, "changed")]);
  expect(next.code).toBe(2);
  expect(JSON.parse(await readFile(join(root, "changed", "comparison.json"), "utf8")).status).toBe("invalidated");
});

it("executes the complete current golden inventory and a finite three-piece blocked review request", async () => {
  const root = await mkdtemp(join(tmpdir(), "keyspilli-golden-cli-")); dirs.push(root);
  const golden = join(repo, "catalog/chord-golden-corpus.json"), before = await readFile(golden);
  const result = await run(["golden", "--golden", golden, "--sources", join(repo, "catalog/chord-sources.json"), "--output", join(root, "inventory")]);
  expect(result.code).toBe(2);
  const report = JSON.parse(await readFile(join(root, "inventory/golden-report.json"), "utf8"));
  expect(report.entries).toHaveLength(12); expect(report.acceptedPlaybackCount).toBe(0);
  const review = JSON.parse(await readFile(join(root, "inventory/review-package.json"), "utf8"));
  expect(review.pieces).toHaveLength(3); expect(review.status).toBe("blocked");
  expect(review.pieces.every((p: { modes: unknown[] }) => p.modes.length === 2)).toBe(true);
  expect(review.musicalAcceptance).toBe("not-established");
  expect(await readFile(golden)).toEqual(before);
});

it("refuses unknown, duplicate or incomplete CLI options before creating output", async () => {
  expect((await run(["audit", "--download", "yes"])).code).toBe(1);
  expect((await run(["audit", "--manifest", "first", "--manifest", "second", "--output", "ignored"])).code).toBe(1);
  expect((await run(["audit", "--root", "relative=."])).code).toBe(1);
});

it("builds and audits the distributable synthetic package through the real CLI", async () => {
  const root = await mkdtemp(join(tmpdir(), "keyspilli-synthetic-cli-")); dirs.push(root);
  const input = join(root, "fixture"), output = join(root, "review");
  const generator = fileURLToPath(new URL("./fixtures/create-full-output-fixture.ts", import.meta.url));
  let generated = false;
  try { await exec(process.execPath, ["--import", "tsx", generator, input], { cwd: repo, timeout: 15000 }); generated = true; } catch { /* Expected RED before the generator exists. */ }
  expect(generated).toBe(true);
  const result = await run(["review", "--manifest", join(input, "registry.json"), "--request", join(input, "review-request.json"), "--root", `local=${input}`, "--output", output]);
  expect(result.code).toBe(0);
  const pack = JSON.parse(await readFile(join(output, "review-package.json"), "utf8"));
  expect(pack.status).toBe("synthetic-only"); expect(pack.audit.reproducible).toBe(true);
  expect(pack.pieces[0].modes.every((m: { evidenceCompleteness: string }) => m.evidenceCompleteness === "complete")).toBe(true);
  expect(pack.musicalAcceptance).toBe("not-established");
  const binding = pack.pieces[0].modes[0].binding;
  expect(createHash("sha256").update(await readFile(join(output, `${binding.id}.json`))).digest("hex")).toBe(binding.sha256);
  expect(JSON.parse(await readFile(join(output, "local-roots.json"), "utf8"))).toEqual({ local: input });
  expect(JSON.parse(await readFile(join(output, `pending-${binding.id}.json`), "utf8"))).toMatchObject({ kind: "musical-review-receipt", decision: "pending", reviewer: { id: null } });
});
