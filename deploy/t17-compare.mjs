import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [harnessDir, evidenceDir, output] = process.argv.slice(2);
if (!harnessDir || !evidenceDir || !output) throw new Error("usage: t17-compare.mjs <harness> <evidence> <output>");
const cases = readdirSync(join(harnessDir, "work/portfolio-performance/cases"))
  .filter(name => /^T17-.+\.json$/.test(name) && name !== "T17-jobs.json")
  .map(name => JSON.parse(readFileSync(join(harnessDir, "work/portfolio-performance/cases", name), "utf8")));
const jobs = JSON.parse(readFileSync(join(harnessDir, "work/portfolio-performance/cases/T17-jobs.json"), "utf8")).jobs;
const expected = new Map();
for (const job of jobs) for (const pair of job.pairs) for (const [member, phase] of pair.order.entries()) expected.set(`${job.id}:${pair.pair}:${member}`, { job, pair, member, phase });

function walk(root) {
  return readdirSync(root).flatMap(name => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const observed = new Map();
let invocationCount = 0;
for (const path of walk(evidenceDir).filter(path => path.endsWith(".json") && !path.endsWith("job.json") && !path.endsWith("error.json"))) {
  let row;
  try { row = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
  if (!row.request || !row.receipt || row.receipt.status !== "complete") continue;
  const parsed = parseUnit(path);
  if (!parsed) continue;
  const key = `${parsed.job}:${parsed.pair}:${parsed.member}`;
  if (observed.has(key)) throw new Error(`duplicate invocation ${key}`);
  observed.set(key, { ...parsed, ...row });
  invocationCount += 1;
}

function parseUnit(path) {
  const parts = path.split("/");
  const match = /^(?:pilot|scored)-pair-(\d+)-member-(\d+)-(baseline|candidate)\.json$/.exec(parts.at(-1));
  return match ? { job: parts.at(-2), pair: Number(match[1]), member: Number(match[2]) } : null;
}

if (observed.size !== expected.size || invocationCount !== expected.size) throw new Error(`missing or duplicate invocations: expected ${expected.size}, got ${observed.size}`);
for (const [key, expectedRow] of expected) {
  const row = observed.get(key);
  if (!row) throw new Error(`missing invocation ${key}`);
  if (row.request.phase !== expectedRow.phase) throw new Error(`wrong phase ${key}`);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function seedRandom(seed) {
  let value = seed >>> 0;
  return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function bootstrapLower(values) {
  const random = seedRandom(1127);
  const medians = Array.from({ length: 2000 }, () => median(Array.from({ length: values.length }, () => values[Math.floor(random() * values.length)])));
  return percentile(medians, 0.025);
}

function value(row, metric) {
  const spec = row.receipt.metrics[metric];
  if (!spec || !Array.isArray(spec.values) || spec.values.length !== 3) throw new Error(`invalid metric ${metric}`);
  return median(spec.values);
}

const results = [];
for (const definition of cases) {
  const caseJobs = jobs.filter(job => job.case === definition.id);
  const pilot = [];
  const scored = [];
  for (const job of caseJobs) for (const pair of job.pairs) {
    const members = pair.order.map((_, member) => observed.get(`${job.id}:${pair.pair}:${member}`));
    if (members.some(row => !row)) throw new Error(`missing row ${definition.id}/${pair.pair}`);
    if (job.stage === "pilot") {
      pilot.push({ a: value(members[0], definition.primary), b: value(members[1], definition.primary) });
    } else {
      const a = members.find(row => row.request.phase === "baseline");
      const b = members.find(row => row.request.phase === "candidate");
      scored.push({ a: value(a, definition.primary), b: value(b, definition.primary), rows: members });
    }
  }
  if (pilot.length !== 5 || scored.length !== definition.pairs.scored) throw new Error(`wrong pair count ${definition.id}`);
  const noise = median(pilot.map(row => Math.abs(row.a - row.b) / ((row.a + row.b) / 2)));
  const savings = scored.map(row => (row.a - row.b) / row.a);
  const improvement = median(savings);
  const threshold = Math.max(0.05, 2 * noise);
  const lower = bootstrapLower(savings);
  const semantic = new Set(scored.flatMap(row => row.rows.map(member => member.receipt.semanticDigest)));
  if (semantic.size !== 1) throw new Error(`semantic drift ${definition.id}`);
  const secondary = {};
  for (const name of Object.keys(scored[0].rows[0].receipt.metrics).filter(name => name !== definition.primary)) {
    const pairs = scored.map(row => ({ a: value(row.rows.find(member => member.request.phase === "baseline"), name), b: value(row.rows.find(member => member.request.phase === "candidate"), name) }));
    const relative = median(pairs.map(row => row.a === 0 ? (row.b === 0 ? 0 : Infinity) : (row.b - row.a) / row.a));
    const counter = /_(?:count|max_retained_pages|max_retained_svg_bytes)$/.test(name);
    secondary[name] = { medianRelativeChange: relative, counter, pass: counter ? relative <= 0 : relative <= 0.05 };
  }
  results.push({ case: definition.id, pairs: { pilot: pilot.length, scored: scored.length }, primary: definition.primary,
    pilotNoise: noise, improvement, threshold, bootstrapLower95: lower, pass: improvement > threshold && lower > 0,
    secondary, semanticDigest: [...semantic][0] });
}
const report = { schema: "keyspilli-task17-comparison/v1", seed: 1127, resamples: 2000, results,
  outcome: results.some(row => row.pass) && results.every(row => Object.values(row.secondary).every(item => item.pass)) ? "VERIFIED_GAIN" :
    results.every(row => Object.values(row.secondary).every(item => item.pass)) ? "NO_PROVEN_GAIN" : "REJECTED" };
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ outcome: report.outcome, passingCases: results.filter(row => row.pass).map(row => row.case) }));
process.exitCode = report.outcome === "REJECTED" ? 2 : 0;
