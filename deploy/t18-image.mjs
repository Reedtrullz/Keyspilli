import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arch, release } from "node:os";

const [label, sourceDir, harnessDir, outputDir] = process.argv.slice(2);
if (!["baseline", "candidate"].includes(label) || !sourceDir || !harnessDir || !outputDir) {
  throw new Error("usage: t18-image.mjs <baseline|candidate> <source> <harness> <output>");
}
const commits = {
  baseline: "edb7d0c7b56d9f7a0e020893cf363a05b18a681d",
  candidate: "39fbc14cfa6192c250f87fcac9d3869c51dba9c2",
};
const revision = commits[label];
const output = join(outputDir, label);
mkdirSync(output, { recursive: true });

function run(argv, { cwd = sourceDir, log, timeoutMs = 1200000, quiet = false } = {}) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_BUILDKIT: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      writeFileSync(join(output, `${log}.log`), stdout + stderr);
      const result = { argv, code, signal, elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
        stdout, stderr, stdoutSha256: createHash("sha256").update(stdout).digest("hex") };
      resolve(result);
      if (!quiet) console.error(`${log}: exit=${code} ms=${result.elapsedMs.toFixed(0)}`);
    });
  });
}

function checked(result, message) {
  if (result.code !== 0) throw new Error(`${message}: ${result.stderr.slice(-4096)}`);
  return result;
}

function compressedDigest(tag, log) {
  return new Promise((resolve, reject) => {
    const save = spawn("docker", ["image", "save", tag], { stdio: ["ignore", "pipe", "pipe"] });
    const gzip = spawn("gzip", ["-n", "-1"], { stdio: ["pipe", "pipe", "pipe"] });
    const hash = createHash("sha256");
    let bytes = 0;
    let stderr = "";
    save.stdout.pipe(gzip.stdin);
    gzip.stdout.on("data", (chunk) => { bytes += chunk.length; hash.update(chunk); });
    save.stderr.on("data", (chunk) => { stderr += chunk; });
    gzip.stderr.on("data", (chunk) => { stderr += chunk; });
    gzip.on("close", (code) => {
      if (code !== 0) reject(new Error(`compressed image failed: ${stderr.slice(-4096)}`));
      else resolve({ bytes, sha256: hash.digest("hex") });
    });
    save.on("error", reject);
    gzip.on("error", reject);
    setTimeout(() => { save.kill("SIGKILL"); gzip.kill("SIGKILL"); reject(new Error(`compressed image timeout: ${log}`)); }, 600000).unref();
  });
}

async function execute() {
const sourceHead = checked(await run(["git", "-C", sourceDir, "rev-parse", "HEAD"], { log: "revision", quiet: true }), "revision").stdout.trim();
const sourceTree = checked(await run(["git", "-C", sourceDir, "rev-parse", "HEAD^{tree}"], { log: "tree", quiet: true }), "tree").stdout.trim();
if (sourceHead !== revision) throw new Error(`source head mismatch: ${sourceHead}`);

const images = {};
for (const [name, dockerfile, target] of [
  ["web", "apps/web/Dockerfile", []],
  ["worker", "services/transcribe/Dockerfile.tutorial", ["--target", "worker"]],
]) {
  const tag = `keyspilli-t18-${label}-${name}:measure`;
  const build = await run([
    "docker", "buildx", "build", "--platform", "linux/amd64", "--no-cache", "--load",
    "--progress=plain", "--file", dockerfile, ...target,
    "--build-arg", `VERSION=${revision}`, "--tag", tag, sourceDir,
  ], { log: `build-${name}`, timeoutMs: 1800000 });
  checked(build, `${name} build`);
  const inspect = checked(await run(["docker", "image", "inspect", tag], { log: `inspect-${name}`, quiet: true }), `${name} inspect`);
  const history = checked(await run(["docker", "history", "--no-trunc", "--format", "{{json .}}", tag], { log: `history-${name}`, quiet: true }), `${name} history`);
  const image = JSON.parse(inspect.stdout)[0];
  images[name] = {
    build: { elapsedMs: build.elapsedMs, stdoutSha256: build.stdoutSha256 },
    id: image.Id,
    parent: image.Parent,
    architecture: image.Architecture,
    os: image.Os,
    user: image.Config.User,
    entrypoint: image.Config.Entrypoint,
    cmd: image.Config.Cmd,
    env: image.Config.Env,
    layers: image.RootFS.Layers,
    history: history.stdout.trim().split("\n").filter(Boolean).map(JSON.parse),
    compressed: await compressedDigest(tag, `save-${name}`),
  };
  if (image.Os !== "linux" || image.Architecture !== "amd64") throw new Error(`${name} platform mismatch`);
}

const base = ["docker", "run", "--rm", "--platform=linux/amd64", "--network", "none", "--read-only",
  "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--cpus", "1.5", "--memory", "1g", "--pids-limit", "128"];
const capability = {
  web: checked(await run([...base, "--user", "node", "--tmpfs", "/tmp:rw,nosuid,nodev,size=32m",
    "--entrypoint", "node", "keyspilli-t18-" + label + "-web:measure", "-e",
    "console.log(JSON.stringify({node:process.version,arch:process.arch,uid:process.getuid(),gid:process.getgid()}))"],
  { log: "capability-web", quiet: true }), "web capability").stdout.trim(),
  webChromium: checked(await run([...base, "--user", "node", "--entrypoint", "/bin/sh",
    `keyspilli-t18-${label}-web:measure`, "-c",
    "found=0; for p in $(find /ms-playwright -maxdepth 5 -type f \\( -name chrome -o -name headless_shell -o -name chrome-headless-shell \\) -print); do \"$p\" --version; found=1; done; test \"$found\" = 1"],
  { log: "capability-web-chromium", quiet: true }), "web Chromium capability").stdout.trim(),
  worker: checked(await run([...base, "--user", "65532:65532", "--tmpfs", "/tmp:rw,nosuid,nodev,size=32m,uid=65532,gid=65532,mode=0700",
    "--tmpfs", "/data:rw,nosuid,nodev,size=32m,uid=65532,gid=65532,mode=0700",
    "--entrypoint", "/usr/local/bin/python", `keyspilli-t18-${label}-worker:measure`, "-c",
    "import json,os,platform,shutil,subprocess; print(json.dumps({'python':platform.python_version(),'uid':os.getuid(),'gid':os.getgid(),'ffmpeg':subprocess.check_output(['/usr/bin/ffmpeg','-version'],text=True).splitlines()[0],'fluidsynth':shutil.which('fluidsynth')}))"],
  { log: "capability-worker", quiet: true }), "worker capability").stdout.trim(),
};

const tests = ["acoustic-analyzer.test.ts", "automatic-symbolic.test.ts", "worker-native.test.ts", "worker-runtime.test.ts", "tutorial-cache.test.ts"];
const offline = [];
for (const [index, test] of tests.entries()) {
  const name = `t18-${label}-offline-${index + 1}`;
  const args = ["docker", "run", "-d", "--name", name, "--platform=linux/amd64", "--network", "none", "--read-only",
    "--user", "65532:65532", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--cpus", "1.5", "--memory", "1g", "--pids-limit", "128",
    "--tmpfs", "/tmp:rw,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700",
    "--tmpfs", "/data:rw,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700",
    "--tmpfs", "/app/services/transcribe/node_modules/.vite-temp:rw,nosuid,nodev,size=2m,uid=65532,gid=65532,mode=0700",
    "--tmpfs", "/app/services/transcribe/node_modules/.vite:rw,nosuid,nodev,size=2m,uid=65532,gid=65532,mode=0700",
    "-e", "KEYSPILLI_DATA_DIR=/data", "-e", "HOME=/tmp", `keyspilli-t18-${label}-worker:measure`,
    "--import", "tsx", "services/transcribe/node_modules/vitest/vitest.mjs", "run",
    "--root", "services/transcribe", "--reporter=json", "--outputFile=/data/vitest.json", "test/" + test];
  const start = checked(await run(args, { log: `offline-${index + 1}-start`, quiet: true }), "offline start");
  const container = start.stdout.trim();
  let peakBytes = 0;
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const state = await run(["docker", "inspect", "--format", "{{json .State}}", container], { log: `offline-${index + 1}-state`, quiet: true });
    if (state.code !== 0) break;
    const value = JSON.parse(state.stdout);
    const usage = await run(["docker", "exec", container, "sh", "-c", "du -sb /tmp /data 2>/dev/null | awk '{s+=$1} END{print s+0}'"], { log: `offline-${index + 1}-scratch`, quiet: true });
    if (usage.code === 0 && /^\d+$/.test(usage.stdout.trim())) peakBytes = Math.max(peakBytes, Number(usage.stdout.trim()));
    if (value.Status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const logs = await run(["docker", "logs", container], { log: `offline-${index + 1}`, quiet: true, timeoutMs: 30000 });
  const inspect = await run(["docker", "inspect", "--format", "{{json .State}}", container], { log: `offline-${index + 1}-terminal`, quiet: true });
  const report = await run(["docker", "cp", `${container}:/data/vitest.json`, join(output, `offline-${index + 1}.json`)], { log: `offline-${index + 1}-copy`, quiet: true, timeoutMs: 30000 });
  await run(["docker", "rm", "-f", container], { log: `offline-${index + 1}-remove`, quiet: true, timeoutMs: 30000 });
  const terminal = inspect.code === 0 ? JSON.parse(inspect.stdout) : { ExitCode: -1 };
  let semantic = null;
  if (report.code === 0) {
    const parsed = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(join(output, `offline-${index + 1}.json`), "utf8")));
    semantic = (parsed.testResults ?? []).map((file) => ({
      name: file.name,
      assertions: (file.assertionResults ?? []).map((assertion) => ({ fullName: assertion.fullName, status: assertion.status })),
    }));
  }
  const semanticSha256 = semantic === null ? null : createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
  offline.push({ test, exitCode: terminal.ExitCode, peakScratchBytes: peakBytes,
    reportCopied: report.code === 0, semanticSha256,
    stdoutSha256: logs.stdoutSha256, stderrSha256: logs.stderrSha256, terminal });
  if (terminal.ExitCode !== 0) throw new Error(`offline job failed: ${test}`);
  if (report.code !== 0) throw new Error(`offline report missing: ${test}`);
}

const failureProbes = [];
for (const [name, extra, script, expected] of [
  ["read-only-root", [],
    "const fs=require('node:fs');try{fs.writeFileSync('/app/t18-forbidden','x')}catch(e){console.log(JSON.stringify({code:e.code}));process.exit(0)}process.exit(7)", ["EROFS", "EACCES"]],
  ["unwritable-output", ["--tmpfs", "/data:rw,nosuid,nodev,size=1m,uid=65532,gid=65532,mode=0700"],
    "const fs=require('node:fs');fs.chmodSync('/data',0o500);try{fs.writeFileSync('/data/blocked','x')}catch(e){console.log(JSON.stringify({code:e.code}));process.exit(0)}process.exit(7)", ["EACCES"]],
  ["scratch-limit", ["--tmpfs", "/data:rw,nosuid,nodev,size=1m,uid=65532,gid=65532,mode=0700"],
    "const fs=require('node:fs');try{fs.writeFileSync('/data/too-large',Buffer.alloc(2*1024*1024))}catch(e){console.log(JSON.stringify({code:e.code}));process.exit(0)}process.exit(7)", ["ENOSPC"]],
]) {
  const result = await run([...base, "--user", "65532:65532", ...extra,
    "--entrypoint", "node", `keyspilli-t18-${label}-worker:measure`, "-e", script],
  { log: `failure-${name}`, quiet: true });
  const observed = result.code === 0 ? JSON.parse(result.stdout.trim()) : { code: null };
  failureProbes.push({ name, expected, exitCode: result.code, observed,
    stderrSha256: createHash("sha256").update(result.stderr).digest("hex") });
  if (result.code !== 0 || !expected.includes(observed.code)) throw new Error(`failure probe mismatch: ${name}`);
}

const receipt = {
  schema: "keyspilli-t18-image-offline/v1",
  label,
  source: { head: sourceHead, tree: sourceTree },
  runner: { platform: process.platform, arch: arch(), release: release() },
  images,
  capability,
  offline,
  failureProbes,
};
writeFileSync(join(output, "result.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ label, source: receipt.source, images: Object.keys(images), offline: offline.length }));
}
execute().catch((error) => {
  writeFileSync(join(output, "result.json"), JSON.stringify({ schema: "keyspilli-t18-image-offline/v1", label, status: "failed", error: String(error) }, null, 2) + "\n");
  console.error(error);
  process.exitCode = 1;
});
