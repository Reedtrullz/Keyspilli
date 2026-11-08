import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EVIDENCE_CAP } from "./t17-evidence.mjs";

const [rawCase, jobId, baselineDir, candidateDir, harnessDir, outputDir] = process.argv.slice(2);
if (!rawCase || !jobId || !baselineDir || !candidateDir || !harnessDir || !outputDir) {
  throw new Error("usage: t17-pair.mjs <case-id> <job-id> <baseline> <candidate> <harness> <output>");
}

const output = join(outputDir, jobId.replaceAll(":", "-"));
mkdirSync(output, { recursive: true });
const processStarted = process.hrtime.bigint();
const casePath = join(harnessDir, "work/portfolio-performance/cases", `${rawCase}.json`);
const caseBytes = readFileSync(casePath);
const definition = JSON.parse(caseBytes.toString("utf8"));
const jobsBytes = readFileSync(join(harnessDir, "work/portfolio-performance/cases/T17-jobs.json"));
const jobs = JSON.parse(jobsBytes.toString("utf8"));
const sizing = jobId === "sizing";
const job = sizing
  ? { id: "sizing", case: "T17-stress-desktop", stage: "scored", pairs: [{ pair: 0, order: ["baseline", "candidate"] }] }
  : jobs.jobs.find(candidate => candidate.id === jobId);
if (!job || job.case !== rawCase) throw new Error("unknown or mismatched frozen job");

function sha(value) { return createHash("sha256").update(value).digest("hex"); }

function command(argv, options) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const child = spawn(argv[0], argv.slice(1), { ...options, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const result = { argv, code, signal, elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
        stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
      resolve(result);
    });
  });
}

async function required(argv, options) {
  const result = await command(argv, options);
  if (result.code !== 0) throw new Error(`${argv[0]} failed (${result.code}/${result.signal}): ${(result.stdout + result.stderr).slice(-4096)}`);
  return result;
}

async function revision(dir, expected) {
  const result = await required(["git", "-C", dir, "rev-parse", "HEAD", "HEAD^{tree}"], { cwd: harnessDir, env: { PATH: process.env.PATH, LANG: "C" } });
  const [head, tree] = result.stdout.trim().split("\n");
  if (head !== expected.head || tree !== expected.tree) throw new Error(`revision mismatch for ${dir}`);
  const clean = await required(["git", "-C", dir, "status", "--porcelain", "--untracked-files=no"], { cwd: harnessDir, env: { PATH: process.env.PATH, LANG: "C" } });
  if (clean.stdout.trim()) throw new Error(`dirty source checkout: ${dir}`);
  return { dir, head, tree };
}

async function main() {
  if (definition.schema !== "keyspilli-task17-case/v1" || definition.id !== rawCase || definition.task !== 17) throw new Error("invalid Task 17 case");
  if (definition.pairs.pilot !== 5 || definition.pairs.scored !== (definition.shape.id === "small" ? 10 : 5)) throw new Error("wrong frozen pair count");
  const specPath = join(harnessDir, "deploy/t17-performance.spec.ts");
  const evidencePath = join(harnessDir, "deploy/t17-evidence.mjs");
  const probePath = join(harnessDir, "work/portfolio-performance/tools/keyspilli_perf_probe.mjs");
  const harnessPaths = {
    measurementSpecSha256: "deploy/t17-performance.spec.ts", probeSha256: "work/portfolio-performance/tools/keyspilli_perf_probe.mjs",
    evidenceModuleSha256: "deploy/t17-evidence.mjs",
    pairSha256: "deploy/t17-pair.mjs", failureSpecSha256: "deploy/t17-failure.spec.ts",
    failureSha256: "deploy/t17-failure.mjs", compareSha256: "deploy/t17-compare.mjs",
    workflowSha256: ".github/workflows/t17-measurement.yml",
  };
  for (const [key, relative] of Object.entries(harnessPaths)) {
    if (sha(readFileSync(join(harnessDir, relative))) !== definition.harness[key]) throw new Error(`stale harness digest: ${key}`);
  }
  const baseline = await revision(baselineDir, definition.sourceRevisions.baseline);
  const candidate = await revision(candidateDir, definition.sourceRevisions.candidate);
  const sources = new Map([["baseline", baseline], ["candidate", candidate]]);
  const used = [...new Set(job.pairs.flatMap(pair => pair.order))];
  const buildLogs = [];
  for (const phase of used) {
    const source = sources.get(phase);
    copyFileSync(specPath, join(source.dir, "apps/web/e2e/performance-baseline.spec.ts"));
    copyFileSync(evidencePath, join(source.dir, "apps/web/e2e/t17-evidence.mjs"));
    const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
    for (const [name, argv] of [["install", ["pnpm", "install", "--frozen-lockfile"]], ["build", ["pnpm", "run", "build"]]]) {
      const result = await command(argv, { cwd: source.dir, env });
      writeFileSync(join(output, `${phase}-${name}.log`), result.stdout + result.stderr);
      buildLogs.push({ phase, name, result });
      if (result.code !== 0) throw new Error(`${phase} ${name} failed: ${(result.stdout + result.stderr).slice(-4096)}`);
    }
  }
  const browser = await required(["pnpm", "exec", "playwright", "install", "--with-deps", "chromium"], {
    cwd: join(baseline.dir, "apps/web"), env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  const invocations = [];
  for (const pair of job.pairs) {
    for (const [member, phase] of pair.order.entries()) {
      const source = sources.get(phase);
      const unit = `${job.stage}-pair-${pair.pair}-member-${member}-${phase}`;
      const scratch = join(output, "scratch", unit);
      const keep = join(output, "raw", unit);
      mkdirSync(scratch, { recursive: true });
      const request = {
        caseHash: sha(caseBytes), phase, unit, sample: pair.pair * 2 + member, scenario: "happy",
        revision: source.head, tree: source.tree, fixtureDigest: definition.fixtureDigest,
        harnessDigest: definition.harnessDigest,
        shape: sizing ? { ...definition.shape, trace: pair.pair === 0 && member === 0 && phase === "baseline" } : definition.shape,
        economicsDigest: definition.economicsDigest,
      };
      const env = {
        PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C", CI: "1", NEXT_TELEMETRY_DISABLED: "1",
        TMPDIR: scratch, NODE_COMPILE_CACHE: join(scratch, "node"), MEASURE_REQUEST: JSON.stringify(request),
        KEYSPILLI_PERF_KEEP: keep,
      };
      const result = await command([process.execPath, probePath], { cwd: source.dir, env });
      if (result.code !== 0) {
        writeFileSync(join(output, `${unit}.json`), JSON.stringify({ request, result }, null, 2) + "\n");
        throw new Error(`${unit} failed: ${(result.stdout + result.stderr).slice(-4096)}`);
      }
      const receipt = JSON.parse(result.stdout.trim());
      writeFileSync(join(output, `${unit}.json`), JSON.stringify({ request, result: { ...result, stdout: undefined }, receipt }, null, 2) + "\n");
      if (receipt.status !== "complete") throw new Error(`${unit} did not complete`);
      invocations.push({ unit, request, receipt });
    }
  }
  if (sizing && invocations.filter(row => row.request.shape.trace).length !== 1) throw new Error("expected exactly one sizing trace");
  writeFileSync(join(output, "job.json"), JSON.stringify({
    schema: "keyspilli-task17-pair-job/v1", id: jobId, case: rawCase, stage: job.stage, pairs: job.pairs,
    startedAt: new Date().toISOString(), caseSha256: sha(caseBytes), jobsSha256: sha(jobsBytes),
    harness: definition.harness, sources: { baseline, candidate },
    elapsedMs: Number(process.hrtime.bigint() - processStarted) / 1e6,
    builds: buildLogs.map(row => ({ phase: row.phase, name: row.name, elapsedMs: row.result.elapsedMs, stdoutSha256: sha(row.result.stdout), stderrSha256: sha(row.result.stderr) })),
    browserInstallMs: browser.elapsedMs, invocations: invocations.map(row => ({ unit: row.unit, semanticDigest: row.receipt.semanticDigest, metrics: row.receipt.metrics })),
  }, null, 2) + "\n");
  const elapsedMs = Number(process.hrtime.bigint() - processStarted) / 1e6;
  function filesUnder(path) {
    return readdirSync(path).flatMap(name => {
      const child = join(path, name);
      return statSync(child).isDirectory() ? filesUnder(child) : [child];
    });
  }
  writeFileSync(join(output, "evidence-size.json"), JSON.stringify({ bytes: 0, cap: EVIDENCE_CAP }, null, 2) + "\n");
  let evidenceBytes = filesUnder(output).reduce((sum, path) => sum + statSync(path).size, 0);
  writeFileSync(join(output, "evidence-size.json"), JSON.stringify({ bytes: evidenceBytes, cap: EVIDENCE_CAP }, null, 2) + "\n");
  evidenceBytes = filesUnder(output).reduce((sum, path) => sum + statSync(path).size, 0);
  if (evidenceBytes > EVIDENCE_CAP) {
    writeFileSync(join(output, "cap.json"), JSON.stringify({ bytes: evidenceBytes, cap: EVIDENCE_CAP }, null, 2) + "\n");
    throw new Error(`evidence exceeds cap: ${evidenceBytes} > ${EVIDENCE_CAP}`);
  }
  if (sizing && elapsedMs > 25 * 60_000) throw new Error(`sizing exceeded the 25-minute measured allowance: ${elapsedMs}ms`);
  console.log(JSON.stringify({ jobId, invocations: invocations.map(row => row.unit) }));
}

main().catch(error => {
  writeFileSync(join(output, "error.json"), JSON.stringify({ schema: "keyspilli-task17-pair-job/v1", id: jobId, status: "failed", error: String(error) }, null, 2) + "\n");
  console.error(error);
  process.exitCode = 1;
});
