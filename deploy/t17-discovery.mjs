import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [source, harness, output] = process.argv.slice(2);
if (!source || !harness || !output) throw new Error("usage: t17-discovery.mjs <source> <harness> <output>");
mkdirSync(output, { recursive: true });

const cases = [
  { shape: "small", viewport: "390x844", env: {}, notes: 640, measures: 160, samples: 3 },
  { shape: "small", viewport: "1280x800", env: {}, notes: 640, measures: 160, samples: 3 },
  { shape: "span", viewport: "390x844", env: { KEYSPILLI_PERF_STRESS: "span" }, notes: 4096, measures: 2048, samples: 6 },
  { shape: "span", viewport: "1280x800", env: { KEYSPILLI_PERF_STRESS: "span" }, notes: 4096, measures: 2048, samples: 6 },
  { shape: "stress", viewport: "390x844", env: { KEYSPILLI_PERF_STRESS: "1" }, notes: 20000, measures: 500, samples: 6 },
  { shape: "stress", viewport: "1280x800", env: { KEYSPILLI_PERF_STRESS: "1" }, notes: 20000, measures: 500, samples: 6 },
];

function run(argv, env, log) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn(argv[0], argv.slice(1), { cwd: join(source, "apps/web"), env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code, signal) => {
      writeFileSync(join(output, `${log}.stdout`), stdout);
      writeFileSync(join(output, `${log}.stderr`), stderr);
      resolve({ argv, code, signal, elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
        stdoutSha256: createHash("sha256").update(stdout).digest("hex"), stderrSha256: createHash("sha256").update(stderr).digest("hex") });
    });
  });
}

const results = [];
for (const entry of cases) {
  const id = `${entry.shape}-${entry.viewport}`;
  const caseOutput = join(output, id);
  mkdirSync(caseOutput, { recursive: true });
  const env = {
    ...process.env,
    KEYSPILLI_PERF_BASELINE: "1",
    KEYSPILLI_PERF_VIEWPORT: entry.viewport,
    ...entry.env,
  };
  delete env.KEYSPILLI_PERF_STRESS;
  Object.assign(env, entry.env);
  const result = await run(["pnpm", "exec", "playwright", "test", "--config", "playwright.roadmap.config.ts", "--workers=1", "--reporter=line", `--output=${caseOutput}`], env, id);
  const files = readdirSync(caseOutput, { recursive: true })
    .map((name) => join(caseOutput, String(name)))
    .filter((name) => /performance-(baseline|span|stress)\.json$/.test(name));
  if (result.code !== 0 || files.length !== 1) {
    results.push({ id, status: "failed", ...entry, result, attachments: files });
    break;
  }
  const raw = JSON.parse(readFileSync(files[0], "utf8"));
  if (raw.viewport?.width !== Number(entry.viewport.split("x")[0])
      || raw.viewport?.height !== Number(entry.viewport.split("x")[1])
      || raw.fixture?.notes !== entry.notes || raw.fixture?.measures !== entry.measures
      || raw.samples?.length !== entry.samples) {
    results.push({ id, status: "rejected", ...entry, result, attachments: files, observed: { viewport: raw.viewport, fixture: raw.fixture, samples: raw.samples?.length } });
    break;
  }
  results.push({ id, status: "complete", ...entry, attachment: files[0], attachmentSha256: createHash("sha256").update(readFileSync(files[0])).digest("hex"), fixture: raw.fixture, runtime: raw.runtime, browser: raw.browser, samples: raw.samples, result });
  console.log(JSON.stringify({ id, status: "complete", samples: raw.samples.length, elapsedMs: result.elapsedMs }));
}

const receipt = { schema: "keyspilli-task17-discovery/v1", sourceCommit: "edb7d0c7b56d9f7a0e020893cf363a05b18a681d", status: results.length === cases.length && results.every((row) => row.status === "complete") ? "complete" : "failed", cases: results };
writeFileSync(join(output, "discovery.json"), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ status: receipt.status, cases: results.map((row) => [row.id, row.status]) }));
process.exitCode = receipt.status === "complete" ? 0 : 1;
