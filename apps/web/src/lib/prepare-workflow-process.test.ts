import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { captureRuntime, CONFIG } from "./prepare-workflow-pins.js";
import { preparationEnvironment, runOwnedProcess, runPreparationStage } from "./prepare-workflow-process.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");
mkdirSync(join(root, "output"), { recursive: true });
const scratch = mkdtempSync(join(root, "output/deterministic-process-"));
let retainDiagnostic = false;
afterAll(() => {
  if (retainDiagnostic) console.error("owned process diagnostics retained", scratch);
  else rmSync(scratch, { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());
const env = preparationEnvironment(scratch, process.execPath);
const base = { command: "fixture", executable: process.execPath, cwd: root, env, timeoutMs: 3000, stdout: (_bytes: Buffer) => {}, stderr: (_bytes: Buffer) => {} };

const retained = (test: () => Promise<void>) => async () => {
  try { await test(); }
  catch (error) { retainDiagnostic = true; throw error; }
};

/** The finite helper is armed at the actual first post-close group probe, not
 * after a startup-relative sleep. Both fixtures acknowledge their TERM handler
 * before their leader exits and never retain the leader's output handles. */
async function descendant(options: {
  finite?: boolean; exitCode?: number; exitSignal?: boolean; signal?: AbortSignal; timeoutMs?: number;
  onFirstProbe?: () => void; onSignal?: (signal: string | number | undefined) => void;
  rejectTerm?: boolean;
} = {}) {
  const directory = mkdtempSync(join(scratch, "descendant-"));
  const events = join(directory, "events.jsonl"), arm = join(directory, "arm");
  writeFileSync(join(directory, "helper.mjs"), `
    import {appendFileSync,existsSync} from 'node:fs';
    const events=${JSON.stringify(events)}, arm=${JSON.stringify(arm)};
    const log=event=>appendFileSync(events,JSON.stringify({event,atNs:process.hrtime.bigint().toString(),pid:process.pid,parentPid:process.ppid})+'\\n');
    process.on('SIGTERM',()=>log('term'));
    log('ready'); process.send({ready:true});
    ${options.finite ? `const wait=setInterval(()=>{if(!existsSync(arm))return;clearInterval(wait);log('armed');setTimeout(()=>{log('natural-completion');process.exit(0)},75)},5);` : "setInterval(()=>{},1000);"}
  `);
  writeFileSync(join(directory, "leader.mjs"), `
    import {spawn} from 'node:child_process';
    const child=spawn(process.execPath,[${JSON.stringify(join(directory, "helper.mjs"))}],{stdio:['ignore','ignore','ignore','ipc']});
    child.on('message',()=>{console.log(JSON.stringify({leader:process.pid,helper:child.pid}));child.disconnect();child.unref();${options.exitSignal ? "process.kill(process.pid,'SIGTERM');" : `process.exitCode=${options.exitCode ?? 0};`}});
  `);
  const actualKill = process.kill.bind(process);
  let group: number | undefined, firstProbe = false, stdout = "", stderr = "", cleanupNeeded = false;
  const signals: Array<string | number | undefined> = [];
  const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    if (group !== undefined && pid === -group) {
      if (signal === 0) {
        const present = actualKill(pid, signal);
        if (!firstProbe) {
          firstProbe = true;
          if (options.finite) writeFileSync(arm, "armed at first post-close presence probe\n", { flag: "wx" });
          options.onFirstProbe?.();
        }
        return present;
      }
      signals.push(signal); options.onSignal?.(signal);
      if (options.rejectTerm && signal === "SIGTERM") throw Object.assign(new Error("controlled signal uncertainty"), { code: "EPERM" });
    }
    return actualKill(pid, signal);
  });
  try {
    const receipt = await runOwnedProcess({ ...base, args: [join(directory, "leader.mjs")],
      timeoutMs: options.timeoutMs ?? base.timeoutMs, signal: options.signal,
      stdout: bytes => { stdout += bytes.toString(); const line = stdout.split("\n").find(value => value.endsWith("}")); if (line) group = JSON.parse(line).leader; },
      stderr: bytes => { stderr += bytes.toString(); } });
    const journal = existsSync(events) ? readFileSync(events, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
    const result = { receipt, firstProbe, signals, journal, stdout, stderr, get cleanupNeeded() { return cleanupNeeded; } };
    writeFileSync(join(directory, "receipt.json"), JSON.stringify(result, null, 2) + "\n");
    return result;
  } finally {
    kill.mockRestore();
    // An intentionally ambiguous receipt must not leave a real fixture running.
    if (group !== undefined) {
      const present = () => { try { actualKill(-group!, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; } };
      if (present()) {
        cleanupNeeded = true; actualKill(-group, "SIGKILL");
        const deadline = Date.now() + 3000;
        while (present() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        writeFileSync(join(directory, "test-cleanup.json"), JSON.stringify({ cleanupNeeded, groupClosed: !present() }) + "\n");
        if (present()) { retainDiagnostic = true; throw new Error("owned test group did not close after cleanup"); }
      }
    }
  }
}

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

  it("allows a finite same-group helper to finish naturally after its successful leader closes", retained(async () => {
    const result = await descendant({ finite: true });
    expect(result.firstProbe).toBe(true);
    expect(result.receipt).toEqual({ command: "fixture", exitCode: 0, signal: null, termination: "exit", groupClosed: true });
    expect(result.journal.map(entry => entry.event)).toEqual(["ready", "armed", "natural-completion"]);
    expect(result.signals).toEqual([]);
    expect(result.cleanupNeeded).toBe(false);
  }));

  it("refuses a persistent TERM-ignoring descendant after the bounded drain and confirms KILL cleanup", retained(async () => {
    const result = await descendant();
    expect(result.firstProbe).toBe(true);
    expect(result.receipt).toEqual({ command: "fixture", exitCode: 0, signal: null, termination: "descendants", groupClosed: true });
    expect(result.signals).toContain("SIGTERM"); expect(result.signals).toContain("SIGKILL");
    expect(result.journal.map(entry => entry.event)).toEqual(["ready", "term"]);
    expect(result.cleanupNeeded).toBe(false);
  }));

  it("honors cancellation during the actual post-close drain instead of converting it to success or descendants", retained(async () => {
    const controller = new AbortController(); let cancelled = false;
    const signalledAfterCancellation: boolean[] = [];
    const result = await descendant({ signal: controller.signal,
      onFirstProbe: () => queueMicrotask(() => { cancelled = true; controller.abort(); }),
      onSignal: () => signalledAfterCancellation.push(cancelled) });
    expect(result.firstProbe).toBe(true);
    expect(result.receipt).toEqual({ command: "fixture", exitCode: 0, signal: null, termination: "interrupt", groupClosed: true });
    expect(signalledAfterCancellation.length).toBeGreaterThan(0);
    expect(signalledAfterCancellation.every(Boolean)).toBe(true);
  }));

  it("keeps the original command timeout callback authoritative during post-close drain", retained(async () => {
    const budget = 1737, schedule = setTimeout;
    let expire: (() => void) | undefined, deadlineRegistrations = 0, expirationAvailable = false;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      const handle = schedule(callback, ms, ...args);
      if (ms === budget) { deadlineRegistrations++; expire = () => callback(...args); }
      return handle;
    }) as typeof setTimeout);
    const result = await descendant({ timeoutMs: budget,
      onFirstProbe: () => { expirationAvailable = !!expire; queueMicrotask(() => expire?.()); } });
    expect(result.firstProbe).toBe(true); expect(expirationAvailable).toBe(true); expect(deadlineRegistrations).toBe(1);
    expect(result.receipt).toEqual({ command: "fixture", exitCode: 0, signal: null, termination: "timeout", groupClosed: true });
  }));

  it("refuses grace success when the original monotonic deadline expired before its queued timer callback", retained(async () => {
    const budget = 1737, now = performance.now.bind(performance); let stalledMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now() + stalledMs);
    const result = await descendant({ finite: true, timeoutMs: budget,
      onFirstProbe: () => queueMicrotask(() => { stalledMs = budget + 1; }) });
    expect(result.firstProbe).toBe(true);
    expect(result.receipt).toEqual({ command: "fixture", exitCode: 0, signal: null, termination: "timeout", groupClosed: true });
    expect(result.signals).toContain("SIGTERM");
  }));

  for (const options of [{ exitCode: 7, exitSignal: false }, { exitCode: undefined, exitSignal: true }]) {
    it(`does not grant successful-close drain to a ${options.exitSignal ? "signalled" : "nonzero-exit"} leader`, retained(async () => {
      let yielded = false; const signalAfterYield: boolean[] = [];
      const result = await descendant({ ...options,
        onFirstProbe: () => queueMicrotask(() => { yielded = true; }), onSignal: () => signalAfterYield.push(yielded) });
      expect(result.firstProbe).toBe(true);
      expect(result.receipt).toEqual({ command: "fixture", exitCode: options.exitSignal ? null : 7,
        signal: options.exitSignal ? "SIGTERM" : null, termination: "descendants", groupClosed: true });
      expect(signalAfterYield[0]).toBe(false);
      expect(result.cleanupNeeded).toBe(false);
    }));
  }

  it("does not certify a transient unknown group probe merely because later probes report absence", retained(async () => {
    const actualKill = process.kill.bind(process); let probes = 0;
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid < 0 && signal === 0 && probes++ === 0) throw Object.assign(new Error("controlled unknown group probe"), { code: "EPERM" });
      return actualKill(pid, signal);
    });
    const result = await runOwnedProcess({ ...base, args: ["-e", "process.exit(0)"] });
    writeFileSync(join(scratch, "transient-probe-receipt.json"), JSON.stringify(result) + "\n");
    expect(probes).toBeGreaterThan(1); expect(result.groupClosed).toBe(false);
  }));

  it("keeps persistent probe uncertainty ambiguous without leaving an actual live child", retained(async () => {
    const actualKill = process.kill.bind(process);
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid < 0 && signal === 0) throw Object.assign(new Error("controlled persistent unknown group probe"), { code: "EPERM" });
      return actualKill(pid, signal);
    });
    const result = await runOwnedProcess({ ...base, args: ["-e", "process.exit(0)"] });
    writeFileSync(join(scratch, "persistent-probe-receipt.json"), JSON.stringify(result) + "\n");
    expect(result.groupClosed).toBe(false);
  }), 8000);

  it("keeps a signal error ambiguous even when the owned fixture can subsequently be cleaned", retained(async () => {
    const result = await descendant({ rejectTerm: true });
    expect(result.firstProbe).toBe(true); expect(result.receipt.groupClosed).toBe(false);
    expect(result.receipt.termination).toBe("descendants");
    expect(result.cleanupNeeded).toBe(true);
  }));
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
