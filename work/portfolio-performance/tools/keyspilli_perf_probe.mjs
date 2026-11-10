#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { copyBoundedEvidence } from "../../../deploy/t17-evidence.mjs";

const SHAPES = {
  small: { notes: 640, measures: 160, samples: 3, renderers: ["worker"], stress: "" },
  span: { notes: 4096, measures: 2048, samples: 6, renderers: ["worker", "main"], stress: "span" },
  stress: { notes: 20000, measures: 500, samples: 6, renderers: ["worker", "main"], stress: "1" },
};
const BOUND = 1024 * 1024;
const OUTPUT_LIMIT = 2 * 1024 * 1024;
const REQUEST_KEYS = ["caseHash", "phase", "unit", "sample", "scenario", "revision", "tree", "fixtureDigest", "harnessDigest", "shape", "economicsDigest"];
const CAPABILITIES = ["chromium", "musicxml-sheet", "verovio-worker", "forced-main-fallback", "pdf-export", "retained-pages<=5", "retained-svg<=4MiB"];
let activeScratch = null;
let currentChild = null;

function fail(message) {
  throw new Error(message);
}

function requireCondition(condition, message) {
  if (!condition) fail(message);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixtureXml(shape) {
  const beats = shape.id === "small" ? 4 : shape.id === "span" ? 2 : 5;
  const measures = shape.id === "small" ? 160 : shape.id === "span" ? 2048 : 500;
  return `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${Array.from({ length: measures }, (_, index) => {
    const attributes = index === 0 ? `<attributes><divisions>${shape.id === "small" ? 1 : 2}</divisions><time><beats>${beats}</beats><beat-type>4</beat-type></time></attributes>` : "";
    const notes = shape.id === "small"
      ? ["C", "D", "E", "G"].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`).join("")
      : Array.from({ length: shape.id === "span" ? 1 : 10 }, () => (shape.id === "span" ? ["C", "E"] : ["C", "E", "G", "C"]).map((step, pitch) => `<note>${pitch ? "<chord/>" : ""}<pitch><step>${step}</step><octave>${pitch === 3 ? 5 : 4}</octave></pitch><duration>${shape.id === "span" ? 4 : 1}</duration><type>${shape.id === "span" ? "half" : "eighth"}</type></note>`).join("")).join("");
    return `<measure number="${index + 1}">${attributes}${notes}</measure>`;
  }).join("")}</part></score-partwise>`;
}

function filesUnder(root) {
  const files = [];
  const visit = path => {
    for (const entry of readdirSync(path)) {
      const child = join(path, entry);
      const stat = statSync(child);
      if (stat.isDirectory()) visit(child);
      else files.push(child);
    }
  };
  visit(root);
  return files;
}

function findTrace(root) {
  if (!existsSync(root)) return undefined;
  const traces = filesUnder(root).filter(path => path.endsWith(".zip"));
  return traces.length === 1 ? traces[0] : undefined;
}

function runPlaywright(shape, output, timeoutMs) {
  return new Promise(resolve => {
    const env = { ...process.env, KEYSPILLI_PERF_BASELINE: "1", KEYSPILLI_PERF_VIEWPORT: shape.viewport };
    if (shape.stress) env.KEYSPILLI_PERF_STRESS = shape.stress;
    else delete env.KEYSPILLI_PERF_STRESS;
    if (shape.trace) env.KEYSPILLI_PERF_TRACE = "1";
    else delete env.KEYSPILLI_PERF_TRACE;
    const child = spawn("pnpm", ["exec", "playwright", "test", "--config", "playwright.roadmap.config.ts", "--workers=1", "--reporter=line", `--output=${output}`], {
      cwd: join(process.cwd(), "apps/web"), env, detached: true, stdio: ["ignore", "pipe", "pipe"], shell: false,
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let bounded = true;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
      setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 1000).unref();
    }, timeoutMs);
    child.stdout.on("data", chunk => {
      const room = BOUND - stdoutBytes;
      stdout.push(chunk.subarray(0, Math.max(0, room)));
      stdoutBytes += chunk.length;
      bounded &&= stdoutBytes <= BOUND;
    });
    child.stderr.on("data", chunk => {
      const room = BOUND - stderrBytes;
      stderr.push(chunk.subarray(0, Math.max(0, room)));
      stderrBytes += chunk.length;
      bounded &&= stderrBytes <= BOUND;
    });
    child.on("error", error => resolve({ code: null, signal: null, timedOut, bounded, error: String(error), stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, bounded, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

function metric(values, unit = "ms") {
  requireCondition(Array.isArray(values) && values.length > 0, "empty metric");
  requireCondition(values.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0), "invalid metric");
  return { scope: "nested", unit, values };
}

function collectMetrics(samples, renderers, expectedSamples) {
  const metrics = {};
  for (const renderer of renderers) {
    const rows = samples.filter(row => row.renderer === renderer);
    requireCondition(rows.length === expectedSamples / renderers.length, `missing ${renderer} samples`);
    requireCondition(rows.every(row => Number.isInteger(row.sample) && row.sample >= 0), "invalid nested sample identity");
    metrics[`${renderer}_library_cold_ms`] = metric(rows.map(row => row.libraryMs?.[0]));
    metrics[`${renderer}_library_warm_ms`] = metric(rows.map(row => row.libraryMs?.[1]));
    metrics[`${renderer}_player_view_ms`] = metric(rows.map(row => row.playerViewMs));
    metrics[`${renderer}_first_note_ms`] = metric(rows.map(row => row.firstScheduledNoteMs));
    metrics[`${renderer}_in_page_first_sheet_ms`] = metric(rows.map(row => row.inPageFirstSheetMs));
    metrics[`${renderer}_in_page_warm_sheet_ms`] = metric(rows.map(row => row.inPageWarmSheetMs));
    metrics[`${renderer}_direct_sheet_first_ms`] = metric(rows.map(row => row.sheetMs?.[0]));
    metrics[`${renderer}_direct_sheet_second_ms`] = metric(rows.map(row => row.sheetMs?.[1]));
    metrics[`${renderer}_pdf_ms`] = metric(rows.map(row => row.pdfMs));
    metrics[`${renderer}_player_long_task_count`] = metric(rows.map(row => row.longTasks?.player?.count), "count");
    metrics[`${renderer}_player_long_task_ms`] = metric(rows.map(row => row.longTasks?.player?.durationMs));
    metrics[`${renderer}_sheet_long_task_count`] = metric(rows.map(row => row.longTasks?.sheet?.count), "count");
    metrics[`${renderer}_sheet_long_task_ms`] = metric(rows.map(row => row.longTasks?.sheet?.durationMs));
    metrics[`${renderer}_max_retained_pages`] = metric(rows.map(row => Math.max(...row.retention.map(item => item.pages))), "count");
    metrics[`${renderer}_max_retained_svg_bytes`] = metric(rows.map(row => Math.max(...row.retention.map(item => item.estimatedStringBytes))), "bytes");
    metrics[`${renderer}_heap_bytes`] = metric(rows.map(row => row.memory?.heapBytes), "bytes");
    metrics[`${renderer}_transferred_bytes`] = metric(rows.map(row => Object.values(row.transferredBytes ?? {}).reduce((sum, value) => sum + value, 0)), "bytes");
  }
  return metrics;
}

async function main() {
  let request;
  try { request = JSON.parse(process.env.MEASURE_REQUEST ?? ""); } catch { fail("malformed MEASURE_REQUEST"); }
  requireCondition(request && typeof request === "object" && !Array.isArray(request), "malformed MEASURE_REQUEST");
  requireCondition(REQUEST_KEYS.every(key => key in request), "missing MEASURE_REQUEST binding");
  requireCondition(request.scenario === "happy", "unsupported scenario");
  requireCondition(request.phase === "baseline" || request.phase === "candidate", "invalid phase");
  requireCondition(Number.isInteger(request.sample) && request.sample >= 0, "invalid sample");
  const shape = request.shape;
  requireCondition(shape && typeof shape === "object" && SHAPES[shape.id], "unsupported shape");
  const spec = SHAPES[shape.id];
  requireCondition(shape.notes === spec.notes && shape.measures === spec.measures && shape.samples === spec.samples, "wrong fixture");
  requireCondition(shape.viewport === "390x844" || shape.viewport === "1280x800", "unsupported viewport");
  const xml = fixtureXml({ ...shape, id: shape.id });
  requireCondition(hash(xml) === request.fixtureDigest, "fixture digest mismatch");
  const actualRevision = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: process.cwd(), encoding: "utf8", shell: false });
  requireCondition(actualRevision.status === 0 && actualRevision.stdout.trim() === request.tree, "revision tree mismatch");
  requireCondition(typeof request.revision === "string" && request.revision.length > 0, "missing revision");

  const scratch = activeScratch = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "keyspilli-t17-"));
  const output = join(scratch, "playwright");
  const timeoutMs = spec.samples === 3 ? 180_000 : 600_000;
  const child = await runPlaywright({ ...spec, ...shape }, output, timeoutMs);
  currentChild = child;
  requireCondition(child.bounded, "playwright output bound exceeded");
  requireCondition(!child.timedOut, "playwright deadline exceeded");
  requireCondition(child.code === 0, `playwright failed: ${child.stderr.toString("utf8").slice(-2048)}`);
  const matches = filesUnder(output).filter(path => /performance-(baseline|span|stress)\.json$/.test(path));
  requireCondition(matches.length === 1, `expected one attachment, found ${matches.length}`);
  requireCondition(statSync(matches[0]).size <= OUTPUT_LIMIT, "attachment bound exceeded");
  const traces = filesUnder(output).filter(path => path.endsWith(".zip"));
  requireCondition(traces.length <= 1, `expected at most one trace, found ${traces.length}`);
  const trace = traces[0];
  const attachment = readFileSync(matches[0]);
  const result = JSON.parse(attachment.toString("utf8"));
  requireCondition(result.schemaVersion === 3, "wrong measurement contract; require click-to-note and live post-GC heap");
  requireCondition(result.viewport?.width === Number(shape.viewport.split("x")[0]) && result.viewport?.height === Number(shape.viewport.split("x")[1]), "viewport mismatch");
  requireCondition(result.fixture?.notes === spec.notes && result.fixture?.measures === spec.measures && result.fixture?.sha256 === request.fixtureDigest, "fixture mismatch");
  requireCondition(Array.isArray(result.samples) && result.samples.length === spec.samples && result.sampleCount === spec.samples, "sample count mismatch");
  const renderers = [...new Set(result.samples.map(row => row.renderer))].sort();
  requireCondition(JSON.stringify(renderers) === JSON.stringify([...spec.renderers].sort()), "worker/fallback coverage mismatch");
  for (const renderer of renderers) {
    const ids = result.samples.filter(row => row.renderer === renderer).map(row => row.sample);
    requireCondition(new Set(ids).size === ids.length, "duplicate renderer sample");
  }
  for (const row of result.samples) {
    requireCondition(row.renderer === "worker" || row.renderer === "main", "unknown renderer");
    requireCondition(Number.isFinite(row.memory?.heapBytes) && row.memory.heapBytes > 0, "missing live post-GC heap");
    requireCondition(row.retention?.every(item => item.renderer === row.renderer && item.pages <= 5 && item.estimatedStringBytes <= 4 * 1024 * 1024 && item.fallbackBytes === 0), "retention or renderer proof failed");
  }
  const metrics = collectMetrics(result.samples, renderers, spec.samples);
  const scoreXmlSha256 = result.samples.map(row => row.semantic?.scoreXmlSha256);
  requireCondition(scoreXmlSha256.every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)), "missing score XML hash");
  requireCondition(new Set(scoreXmlSha256).size === 1, "score XML drift");
  const pdfCanonicalSha256 = result.samples.map(row => row.semantic?.pdfCanonicalSha256);
  requireCondition(pdfCanonicalSha256.every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)), "missing canonical PDF hash");
  requireCondition(new Set(pdfCanonicalSha256).size === 1, "canonical PDF drift");
  const semantic = {
    fixture: result.fixture, viewport: result.viewport, renderers,
    pageCounts: result.samples.map(row => row.pageCount),
    scoreXmlSha256,
    pdfCanonicalSha256,
  };
  const rawSemantics = {
    pdfSha256: result.samples.map(row => row.semantic.pdfSha256),
    pdfBytes: result.samples.map(row => row.semantic.pdfBytes),
  };
  const receipt = {
    status: "complete",
    ...Object.fromEntries(REQUEST_KEYS.filter(key => key !== "shape").map(key => [key, request[key]])),
    shape,
    source: { rev: spawnSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8", shell: false }).stdout.trim(), tree: request.tree },
    attachment: { path: relative(scratch, matches[0]), sha256: hash(attachment), bytes: attachment.byteLength },
    child: { stdoutSha256: hash(child.stdout), stderrSha256: hash(child.stderr), stdoutBytes: child.stdout.byteLength, stderrBytes: child.stderr.byteLength },
    metrics,
    semantic,
    rawSemantics,
    semanticDigest: hash(JSON.stringify(semantic)),
    capabilities: CAPABILITIES,
    unsupported: { nativeWasmMemoryBytes: "Chromium does not expose Verovio WASM/native memory separately" },
  };
  writeFileSync(join(scratch, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  process.stdout.write(JSON.stringify(receipt) + "\n");
  if (process.env.KEYSPILLI_PERF_KEEP) copyBoundedEvidence({ scratch, keep: process.env.KEYSPILLI_PERF_KEEP, attachment: matches[0], trace });
  rmSync(scratch, { recursive: true, force: true });
  activeScratch = null;
}

main().catch(error => {
  if (activeScratch) {
    const diagnostic = currentChild ? {
      code: currentChild.code,
      signal: currentChild.signal,
      timedOut: currentChild.timedOut,
      bounded: currentChild.bounded,
      stdout: currentChild.stdout.toString("utf8").slice(-4096),
      stderr: currentChild.stderr.toString("utf8").slice(-4096),
    } : null;
    writeFileSync(join(activeScratch, "failure.json"), JSON.stringify({ status: "incomplete", error: error instanceof Error ? error.message : String(error), diagnostic }) + "\n");
    if (process.env.KEYSPILLI_PERF_KEEP) {
      copyBoundedEvidence({ scratch: activeScratch, keep: process.env.KEYSPILLI_PERF_KEEP, attachment: undefined, trace: findTrace(join(activeScratch, "playwright")) });
    }
    rmSync(activeScratch, { recursive: true, force: true });
  }
  process.stdout.write(JSON.stringify({ status: "incomplete", error: error instanceof Error ? error.message : String(error) }) + "\n");
  process.exitCode = 1;
});
