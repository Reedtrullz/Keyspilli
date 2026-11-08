import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [cohort, rawPair, baselineDir, candidateDir, outputDir] = process.argv.slice(2);
if (!["cold", "cold-scored", "steady", "steady-scored", "warmup"].includes(cohort)
    || !/^\d+$/.test(rawPair ?? "") || !baselineDir || !candidateDir || !outputDir) {
  throw new Error("usage: t18-pair.mjs <cohort> <pair> <baseline> <candidate> <output>");
}

const baseline = "edb7d0c7b56d9f7a0e020893cf363a05b18a681d";
const candidate = "39fbc14cfa6192c250f87fcac9d3869c51dba9c2";
const pair = Number(rawPair);
const output = join(outputDir, `${cohort}-${pair}`);
mkdirSync(output, { recursive: true });

function run(argv, { cwd, log }) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_BUILDKIT: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code, signal) => {
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      writeFileSync(join(output, `${log}.log`), stdout + stderr);
      resolve({ argv, code, signal, elapsedMs, stdoutSha256: createHash("sha256").update(stdout).digest("hex"),
        stderrSha256: createHash("sha256").update(stderr).digest("hex"), stderrTail: stderr.slice(-4096) });
    });
  });
}

function assertRevision(dir, expected) {
  const child = spawn("git", ["-C", dir, "rev-parse", "HEAD", "HEAD^{tree}"], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => code === 0
      ? resolve({ head: stdout.split("\n")[0], tree: stdout.split("\n")[1] })
      : reject(new Error(`cannot read ${dir}: ${stderr}`)));
  });
}

async function execute() {
const baselineRevision = await assertRevision(baselineDir, baseline);
const candidateRevision = await assertRevision(candidateDir, candidate);
if (baselineRevision.head !== baseline || candidateRevision.head !== candidate) {
  throw new Error("checked-out revision mismatch");
}

const contexts = {
  baseline: { dir: baselineDir, revision: baselineRevision },
  candidate: { dir: candidateDir, revision: candidateRevision },
};
const cold = cohort.startsWith("cold");
const pilot = cohort === "cold" || cohort === "steady";
const order = pair % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"];
const rounds = pilot ? ["baseline", "baseline"] : order;
const baseImage = "docker.io/library/node:22.22.3-bookworm-slim@sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752";

const preflight = await run(["docker", "pull", baseImage], { cwd: baselineDir, log: "pull" });
if (preflight.code !== 0) throw new Error("base image pull failed");

const warm = [];
if (!cold) {
  for (const label of ["baseline", "candidate"]) {
    const phase = contexts[label];
    const result = await run([
      "docker", "buildx", "build", "--platform", "linux/amd64", "--progress=plain",
      "--output=type=cacheonly", "--file", "apps/web/Dockerfile",
      "--build-arg", `VERSION=${phase.revision.head}`, phase.dir,
    ], { cwd: phase.dir, log: `warm-${label}` });
    warm.push({ label, ...result });
    if (result.code !== 0) throw new Error(`warm build failed: ${label}`);
  }
}

const builds = [];
for (const [index, label] of rounds.entries()) {
  const phase = contexts[label];
  const argv = [
    "docker", "buildx", "build", "--platform", "linux/amd64", "--progress=plain",
    "--output=type=cacheonly", "--file", "apps/web/Dockerfile",
    "--build-arg", `VERSION=${phase.revision.head}`, phase.dir,
  ];
  if (cold) argv.splice(3, 0, "--no-cache");
  const result = await run(argv, { cwd: phase.dir, log: `${index}-${label}` });
  builds.push({ index, label, revision: phase.revision, ...result });
  if (result.code !== 0) throw new Error(`measured build failed: ${label}`);
}

const receipt = {
  schema: "keyspilli-t18-timing-pair/v1",
  cohort,
  pair,
  pilot,
  order: rounds,
  baseline: baselineRevision,
  candidate: candidateRevision,
  warm,
  builds,
  docker: (await run(["docker", "version", "--format", "{{json .}}"], { cwd: baselineDir, log: "docker-version" })).stdoutSha256,
};
writeFileSync(join(output, "result.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ cohort, pair, builds: builds.map(({ label, elapsedMs }) => ({ label, elapsedMs })) }));
}
execute().catch((error) => {
  if (!existsSync(join(output, "result.json"))) {
    writeFileSync(join(output, "result.json"), JSON.stringify({ schema: "keyspilli-t18-timing-pair/v1", cohort, pair, status: "failed", error: String(error) }, null, 2) + "\n");
  }
  console.error(error);
  process.exitCode = 1;
});
