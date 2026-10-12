/** Owned POSIX child groups, bounded logs, and the one maintained preparation stage. */
import { spawn } from "node:child_process";
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { capturePayload, CONFIG, requireThat, type RuntimePin } from "./prepare-workflow-pins.js";

export function preparationEnvironment(tmp: string, nodePath: string): NodeJS.ProcessEnv {
  // Never copy process.env. In particular NODE_OPTIONS, NODE_PATH, TSX hooks,
  // credentials and KEYSPILLI production destinations do not cross this boundary.
  return { PATH: `${dirname(nodePath)}:/usr/bin:/bin`, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", NODE_ENV: "production", TMPDIR: tmp,
    TSX_DISABLE_CACHE: "1", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
}
export interface LogStats { bytes: number; capturedBytes: number; truncated: boolean }
export interface CommandReceipt {
  command: string; exitCode: number | null; signal: string | null;
  termination: "exit" | "timeout" | "interrupt" | "spawn-error" | "descendants";
  groupClosed: boolean;
}
export interface StageReceipt {
  schemaVersion: 1; outcome: "succeeded" | "failed" | "interrupted" | "timed-out" | "ambiguous" | "invalid";
  closed: boolean; commands: CommandReceipt[]; logs: { stdout: LogStats; stderr: LogStats };
  integrityError: string | null;
}
export interface StageInput {
  root: string; attempt: string; work: string; source: string; phrasePlan?: string; title: string; artist: string;
  runtime: RuntimePin; signal?: AbortSignal;
}
export type StageRunner = (input: StageInput) => Promise<StageReceipt>;

function signalGroup(group: number, signal: NodeJS.Signals): void {
  try { process.kill(-group, signal); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * `close` reaps the direct child and closes inherited output pipes. A group that
 * cannot be proven gone is ambiguous, even if its leader has exited. Never infer
 * cleanup from an old PID/timestamp or silently recover an abandoned invocation.
 */
export async function runOwnedProcess(input: {
  command: string; executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv;
  timeoutMs: number; signal?: AbortSignal; stdout: (chunk: Buffer) => void; stderr: (chunk: Buffer) => void;
}): Promise<CommandReceipt> {
  requireThat(process.platform !== "win32", "owned preparation requires POSIX process groups");
  if (input.signal?.aborted) return { command: input.command, exitCode: null, signal: null, termination: "interrupt", groupClosed: true };
  const child = spawn(input.executable, input.args, { cwd: input.cwd, env: input.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let termination: CommandReceipt["termination"] = "exit", exitCode: number | null = null, exitSignal: string | null = null;
  let closed = false, unsafe = false;
  const alive = (group: number) => {
    try { process.kill(-group, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      // Uncertain presence cannot become a success after a later clean probe.
      unsafe = true; return true;
    }
  };
  let killTimer: ReturnType<typeof setTimeout> | undefined, deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let finish!: () => void;
  const completion = new Promise<void>(resolve => { finish = resolve; });
  const stop = (why: "timeout" | "interrupt") => {
    if (termination !== "exit") return;
    termination = why;
    if (child.pid !== undefined) {
      try { signalGroup(child.pid, "SIGTERM"); } catch { unsafe = true; }
      killTimer = setTimeout(() => { try { signalGroup(child.pid!, "SIGKILL"); } catch { unsafe = true; } }, 500);
    }
    deadlineTimer = setTimeout(() => {
      // A descendant that escaped its inherited group or retained a pipe cannot
      // be certified closed. Stop waiting, leave the mutation lock, require a new run.
      unsafe = true; child.stdout.destroy(); child.stderr.destroy(); finish();
    }, 5_000);
  };
  const onAbort = () => stop("interrupt");
  const onStdout = (chunk: Buffer) => { try { input.stdout(chunk); } catch { unsafe = true; stop("interrupt"); } };
  const onStderr = (chunk: Buffer) => { try { input.stderr(chunk); } catch { unsafe = true; stop("interrupt"); } };
  child.stdout.on("data", onStdout); child.stderr.on("data", onStderr);
  child.on("error", () => { termination = "spawn-error"; });
  child.on("close", (code, signal) => { closed = true; exitCode = code; exitSignal = signal; finish(); });
  input.signal?.addEventListener("abort", onAbort, { once: true });
  const timeoutMs = Math.max(1, input.timeoutMs), commandDeadline = performance.now() + timeoutMs;
  const timeout = setTimeout(() => stop("timeout"), timeoutMs);
  try {
    await completion;
    if (child.pid !== undefined && closed && exitCode === 0 && exitSignal === null && termination === "exit" && !unsafe) {
      // Runtime helpers may finish just after their successful leader closes.
      // Keep the original timeout/abort authority and require full group absence.
      const drainDeadline = performance.now() + 250;
      while (termination === "exit" && !unsafe) {
        if (performance.now() >= commandDeadline) { stop("timeout"); break; }
        if (!alive(child.pid) || unsafe || termination !== "exit") break;
        const remaining = Math.min(drainDeadline, commandDeadline) - performance.now();
        if (remaining <= 0) break;
        await delay(Math.min(25, remaining));
      }
      // A queued timeout callback may trail the awaited poll after an event-loop
      // delay. Its original monotonic deadline still wins over success/refusal.
      if (termination === "exit" && performance.now() >= commandDeadline) stop("timeout");
    }
    if (child.pid !== undefined && alive(child.pid)) {
      if (termination === "exit") termination = "descendants";
      try {
        signalGroup(child.pid, "SIGTERM");
        const started = performance.now();
        while (alive(child.pid) && performance.now() - started < 5_000) {
          if (performance.now() - started >= 500) signalGroup(child.pid, "SIGKILL");
          await delay(25);
        }
      } catch { unsafe = true; }
    }
    return { command: input.command, exitCode, signal: exitSignal, termination,
      groupClosed: closed && !unsafe && (child.pid === undefined || !alive(child.pid)) };
  } finally {
    clearTimeout(timeout); if (killTimer) clearTimeout(killTimer); if (deadlineTimer) clearTimeout(deadlineTimer);
    input.signal?.removeEventListener("abort", onAbort);
    child.stdout.off("data", onStdout); child.stderr.off("data", onStderr);
  }
}

function logCapture(path: string): { push: (bytes: Buffer) => void; stats: LogStats; close: () => void } {
  const fd = openSync(path, "wx", 0o600), stats: LogStats = { bytes: 0, capturedBytes: 0, truncated: false };
  return {
    stats,
    push(bytes) {
      stats.bytes += bytes.length;
      const count = Math.min(bytes.length, CONFIG.logBytes - stats.capturedBytes);
      let written = 0;
      while (written < count) { const size = writeSync(fd, bytes, written, count - written); requireThat(size > 0, "unable to write bounded log"); written += size; }
      stats.capturedBytes += written;
      stats.truncated = stats.bytes > stats.capturedBytes;
    },
    close() { try { fsyncSync(fd); } finally { closeSync(fd); } },
  };
}

export const runPreparationStage: StageRunner = async input => {
  const stdout = logCapture(join(input.attempt, "stdout.log")), stderr = logCapture(join(input.attempt, "stderr.log"));
  const commands: CommandReceipt[] = [], started = performance.now();
  let integrityError: string | null = null;
  const env = preparationEnvironment(join(input.attempt, "tmp"), input.runtime.nodePath);
  const jobs = [
    { command: "prepare-song", script: "prepare-song.mts", args: [input.source, input.work, input.title, input.artist, ...(input.phrasePlan ? ["--phrase-plan", input.phrasePlan] : [])], env },
    { command: "song-bundle-verify", script: "song-bundle.mts", args: ["verify", join(input.work, "bundle"), join(input.work, "installed")],
      env: { ...env, KEYSPILLI_DATA_DIR: join(input.work, "installed"), KEYSPILLI_CHORD_SOURCE_MAP: join(input.work, "installed", "chord-sources.json") } },
  ];
  try {
    for (const job of jobs) {
      const receipt = await runOwnedProcess({ command: job.command, executable: input.runtime.nodePath,
        args: ["--import", input.runtime.tsxPath, join(input.root, "apps/web/scripts", job.script), ...job.args],
        cwd: input.root, env: job.env, timeoutMs: CONFIG.preparationTimeoutMs - (performance.now() - started), signal: input.signal,
        stdout: stdout.push, stderr: stderr.push });
      commands.push(receipt);
      if (!receipt.groupClosed || receipt.exitCode !== 0 || receipt.termination !== "exit") break;
      // Refuse a linked/oversized tree before the additional writable verifier.
      if (job.command === "prepare-song") {
        try { capturePayload(input.attempt, "work"); }
        catch (error) { integrityError = (error as Error).message.slice(0, 512); break; }
      }
    }
    const last = commands.at(-1)!;
    return { schemaVersion: 1, closed: commands.every(command => command.groupClosed), commands, integrityError,
      outcome: !last.groupClosed ? "ambiguous" : last.termination === "timeout" ? "timed-out" : last.termination === "interrupt" ? "interrupted"
        : integrityError ? "invalid" : commands.length === 2 && commands.every(command => command.exitCode === 0 && command.termination === "exit") ? "succeeded" : "failed",
      logs: { stdout: stdout.stats, stderr: stderr.stats } };
  } finally { stdout.close(); stderr.close(); }
};
