import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { captureRuntime, CONFIG } from "./prepare-workflow-pins.js";
import { preparationEnvironment, runOwnedProcess, runPreparationStage } from "./prepare-workflow-process.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");
mkdirSync(join(root, "output"), { recursive: true });
const scratch = mkdtempSync(join(root, "output/deterministic-process-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const env = preparationEnvironment(scratch, process.execPath);
const base = { command: "fixture", executable: process.execPath, cwd: root, env, timeoutMs: 3000, stdout: (_bytes: Buffer) => {}, stderr: (_bytes: Buffer) => {} };

describe("owned child groups", () => {
  it("reaps a known failed child and records its actual exit", async () => {
    const result = await runOwnedProcess({ ...base, args: ["-e", "process.exit(7)"] });
    expect(result).toEqual({ command: "fixture", exitCode: 7, signal: null, termination: "exit", groupClosed: true });
  });

  it("times out a child that ignores TERM, escalates to KILL, and confirms group closure", async () => {
    const started = performance.now();
    const result = await runOwnedProcess({ ...base, timeoutMs: 250, args: ["-e", 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'] });
    expect(result).toMatchObject({ termination: "timeout", signal: "SIGKILL", groupClosed: true });
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it("handles cancellation after a parent reaps its inherited descendant", async () => {
    const controller = new AbortController();
    const code = `const {spawn}=require('node:child_process');
      const kid=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
      kid.on('close',()=>process.exit(0)); process.on('SIGTERM',()=>{kid.kill('SIGTERM')});
      console.log('ready'); setInterval(()=>{},1000);`;
    let pid = 0;
    const result = await runOwnedProcess({ ...base, args: ["-e", code], signal: controller.signal,
      stdout: chunk => { if (chunk.toString().includes("ready")) { pid++; controller.abort(); } } });
    expect(pid).toBe(1); expect(result).toMatchObject({ termination: "interrupt", groupClosed: true });
  });

  it("never starts an already-cancelled child", async () => {
    const controller = new AbortController(); controller.abort();
    const result = await runOwnedProcess({ ...base, executable: "/does-not-exist", args: [], signal: controller.signal });
    expect(result).toMatchObject({ termination: "interrupt", groupClosed: true });
  });
});

describe("bounded maintained-stage logs", () => {
  it("caps stdout/stderr independently, records truncation, and stops after a known failed command", async () => {
    const fixture = join(scratch, "fixture"), attempt = join(fixture, "attempt");
    mkdirSync(join(fixture, "apps/web/scripts"), { recursive: true }); mkdirSync(join(attempt, "tmp"), { recursive: true });
    writeFileSync(join(fixture, "apps/web/scripts/prepare-song.mts"), `
      await new Promise(resolve=>process.stdout.write(Buffer.alloc(${CONFIG.logBytes + 1000},'o'),resolve));
      await new Promise(resolve=>process.stderr.write(Buffer.alloc(${CONFIG.logBytes + 2000},'e'),resolve)); process.exitCode=9;`);
    const receipt = await runPreparationStage({ root: fixture, attempt, work: join(attempt, "work"), source: "/fixture.mid", title: "test", artist: "test", runtime: captureRuntime(root) });
    expect(receipt).toMatchObject({ outcome: "failed", closed: true, integrityError: null }); expect(receipt.commands).toHaveLength(1);
    expect(receipt.logs.stdout).toEqual({ bytes: CONFIG.logBytes + 1000, capturedBytes: CONFIG.logBytes, truncated: true });
    // Some Node distributions emit a harmless warning on stderr; the receipt uses
    // actual byte counts and the file remains bounded regardless.
    expect(receipt.logs.stderr.bytes).toBeGreaterThanOrEqual(CONFIG.logBytes + 2000);
    expect(receipt.logs.stderr).toMatchObject({ capturedBytes: CONFIG.logBytes, truncated: true });
    expect(readFileSync(join(attempt, "stdout.log")).length).toBe(CONFIG.logBytes);
    expect(readFileSync(join(attempt, "stderr.log")).length).toBe(CONFIG.logBytes);
  }, 10_000);

  it("does not forward poisoned hooks, provider variables or production destinations to an actual child", async () => {
    const fixture = join(scratch, "env-fixture"), attempt = join(fixture, "attempt");
    mkdirSync(join(fixture, "apps/web/scripts"), { recursive: true }); mkdirSync(join(attempt, "tmp"), { recursive: true });
    writeFileSync(join(fixture, "apps/web/scripts/prepare-song.mts"), `
      const forbidden=Object.keys(process.env).filter(key=>/^(NODE_OPTIONS|NODE_PATH|TSX_TSCONFIG_PATH|OPENAI_API_KEY|ANTHROPIC_API_KEY|KEYSPILLI_)/.test(key));
      console.log(JSON.stringify(forbidden)); process.exitCode=forbidden.length?93:7;`);
    const poisoned = { NODE_OPTIONS: "--require=/must-not-execute", NODE_PATH: "/must-not-load", TSX_TSCONFIG_PATH: "/must-not-read",
      OPENAI_API_KEY: "test-fixture-only", ANTHROPIC_API_KEY: "test-fixture-only", KEYSPILLI_DATA_DIR: "/must-not-create-production-data", KEYSPILLI_CHORD_SOURCE_MAP: "/must-not-read-production-map" };
    const previous = Object.fromEntries(Object.keys(poisoned).map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, poisoned);
      const receipt = await runPreparationStage({ root: fixture, attempt, work: join(attempt, "work"), source: "/fixture.mid", title: "test", artist: "test", runtime: captureRuntime(root) });
      expect(receipt.commands[0]).toMatchObject({ exitCode: 7, groupClosed: true });
      expect(readFileSync(join(attempt, "stdout.log"), "utf8").trim()).toBe("[]");
    } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  }, 10_000);
});
