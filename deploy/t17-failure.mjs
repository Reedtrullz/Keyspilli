import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [caseId, baselineDir, candidateDir, harnessDir, outputDir] = process.argv.slice(2);
if (!caseId || !baselineDir || !candidateDir || !harnessDir || !outputDir) throw new Error("usage: t17-failure.mjs <case> <baseline> <candidate> <harness> <output>");
const output = join(outputDir, caseId);
mkdirSync(output, { recursive: true });
const definition = JSON.parse(readFileSync(join(harnessDir, "work/portfolio-performance/cases", `${caseId}.json`), "utf8"));
const baselineRevision = { ...definition.sourceRevisions.baseline, dir: baselineDir, phase: "baseline" };
const candidateRevision = { ...definition.sourceRevisions.candidate, dir: candidateDir, phase: "candidate" };

function sha(value) { return createHash("sha256").update(value).digest("hex"); }

function run(argv, { cwd, env, timeout = 1_800_000 }) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const child = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, timeout);
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const result = { argv, code, signal, elapsedMs: Number(process.hrtime.bigint() - started) / 1e6, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
      code === 0 ? resolve(result) : reject(new Error(`${argv[0]} failed (${code}/${signal}): ${result.stderr.slice(-4096)}`));
    });
  });
}

function walk(root) {
  return readdirSync(root).flatMap(name => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

async function verify(source) {
  const rev = await run(["git", "-C", source.dir, "rev-parse", "HEAD", "HEAD^{tree}"], { cwd: harnessDir, env: { PATH: process.env.PATH, LANG: "C" } });
  const [head, tree] = rev.stdout.trim().split("\n");
  if (head !== source.head || tree !== source.tree) throw new Error(`revision mismatch: ${source.phase}`);
  const dirty = await run(["git", "-C", source.dir, "status", "--porcelain", "--untracked-files=no"], { cwd: harnessDir, env: { PATH: process.env.PATH, LANG: "C" } });
  if (dirty.stdout.trim()) throw new Error(`dirty source: ${source.phase}`);
}

async function measure(source) {
  await verify(source);
  mkdirSync(join(output, source.phase), { recursive: true });
  const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  const install = await run(["pnpm", "install", "--frozen-lockfile"], { cwd: source.dir, env });
  const build = await run(["pnpm", "run", "build"], { cwd: source.dir, env });
  writeFileSync(join(output, source.phase, "install.log"), install.stdout + install.stderr);
  writeFileSync(join(output, source.phase, "build.log"), build.stdout + build.stderr);
  copyFileSync(join(harnessDir, "deploy/t17-failure.spec.ts"), join(source.dir, "apps/web/e2e/performance-baseline.spec.ts"));
  const browser = await run(["pnpm", "exec", "playwright", "install", "--with-deps", "chromium"], { cwd: join(source.dir, "apps/web"), env });
  const testOutput = join(output, source.phase, "playwright");
  mkdirSync(testOutput, { recursive: true });
  const testEnv = {
    ...process.env, KEYSPILLI_PERF_BASELINE: "1", KEYSPILLI_PERF_VIEWPORT: definition.shape.viewport,
    KEYSPILLI_T17_SHAPE: definition.shape.id, NEXT_TELEMETRY_DISABLED: "1",
  };
  if (definition.shape.stress) testEnv.KEYSPILLI_PERF_STRESS = definition.shape.stress;
  const tested = await run(["pnpm", "exec", "playwright", "test", "--config", "playwright.roadmap.config.ts", "--workers=1", "--reporter=line", `--output=${testOutput}`], { cwd: join(source.dir, "apps/web"), env: testEnv, timeout: 600_000 });
  const matches = walk(testOutput).filter(path => path.endsWith("t17-failure.json"));
  if (matches.length !== 1) throw new Error(`missing/duplicate failure receipt: ${source.phase}`);
  const receiptBytes = readFileSync(matches[0]);
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  return { source, install, build, browser, tested, receipt, receiptSha256: sha(receiptBytes) };
}

async function main() {
  if (definition.schema !== "keyspilli-task17-case/v1" || definition.id !== caseId) throw new Error("invalid Task 17 case");
  const baseline = await measure(baselineRevision);
  const candidate = await measure(candidateRevision);
  const semantic = receipt => ({ shape: receipt.shape, viewport: receipt.viewport, fixtureSha256: receipt.fixtureSha256, scenarios: receipt.scenarios });
  if (JSON.stringify(semantic(baseline.receipt)) !== JSON.stringify(semantic(candidate.receipt))) throw new Error("failure semantics diverged");
  writeFileSync(join(output, "result.json"), JSON.stringify({
    schema: "keyspilli-task17-failure-pair/v1", case: caseId, status: "passed",
    baseline: { head: baseline.source.head, tree: baseline.source.tree, receiptSha256: baseline.receiptSha256, elapsedMs: baseline.tested.elapsedMs },
    candidate: { head: candidate.source.head, tree: candidate.source.tree, receiptSha256: candidate.receiptSha256, elapsedMs: candidate.tested.elapsedMs },
    semantic: semantic(candidate.receipt),
  }, null, 2) + "\n");
  console.log(JSON.stringify({ case: caseId, status: "passed", scenarios: candidate.receipt.scenarios.map(row => row.name) }));
}

main().catch(error => {
  writeFileSync(join(output, "error.json"), JSON.stringify({ schema: "keyspilli-task17-failure-pair/v1", case: caseId, status: "failed", error: String(error) }, null, 2) + "\n");
  console.error(error);
  process.exitCode = 1;
});
