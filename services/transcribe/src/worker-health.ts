import { closeSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { WorkerHealthSnapshot } from "./worker-runtime.js";

export type WorkerHealthAssessment =
  | { state: "missing" | "invalid"; healthy: false; heartbeatAgeMs: null }
  | { state: "stale" | "draining" | "unfinished" | "stopped" | "health-error"; healthy: false; heartbeatAgeMs: number; snapshot: WorkerHealthSnapshot }
  | { state: "starting" | "polling" | "idle" | "busy"; healthy: true; heartbeatAgeMs: number; snapshot: WorkerHealthSnapshot };

export function workerHealthFilePath(dataDirectory: string): string {
  return join(resolve(dataDirectory), "transcribed", "worker-health.json");
}

export function writeWorkerHealthSnapshot(path: string, snapshot: WorkerHealthSnapshot): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  const serialized = JSON.stringify(snapshot);
  if (Buffer.byteLength(serialized, "utf8") > 4_096) throw new Error("worker health snapshot exceeded size bound");
  writeFileSync(temporary, serialized, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

export function invalidateWorkerHealthSnapshot(path: string): void {
  try { unlinkSync(path); } catch { /* A read-only health probe will classify an old snapshot stale. */ }
}

function isSnapshot(value: unknown): value is WorkerHealthSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WorkerHealthSnapshot>;
  return ["starting", "polling", "idle", "busy", "draining", "unfinished", "stopped", "health-error"].includes(item.status ?? "")
    && typeof item.heartbeatAt === "string"
    && Number.isFinite(item.staleAfterMs) && item.staleAfterMs! > 0
    && typeof item.capabilityRevision === "string" && /^[a-f0-9]{16}$/.test(item.capabilityRevision)
    && (item.progress === null || (typeof item.progress === "string"
      && ["claiming", "checking-disk", "downloading", "extracting", "transcribing", "publishing", "finalizing"].includes(item.progress)))
    && (item.activeJobs === 0 || item.activeJobs === 1)
    && (item.unfinishedJobs === 0 || item.unfinishedJobs === 1)
    && typeof item.recoveryPending === "boolean"
    && !!item.queue && Number.isInteger(item.queue.sampled) && item.queue.sampled >= 0 && item.queue.sampled <= 5
    && item.queue.sampleLimit === 5 && typeof item.queue.moreMayExist === "boolean"
    && (item.queue.oldestAgeMs === null || Number.isFinite(item.queue.oldestAgeMs));
}

export function assessWorkerHealthFile(path: string, now = Date.now()): WorkerHealthAssessment {
  let parsed: unknown;
  try {
    const descriptor = openSync(path, "r");
    try {
      const bounded = Buffer.alloc(4_097);
      const size = readSync(descriptor, bounded, 0, bounded.length, 0);
      if (size > 4_096) return { state: "invalid", healthy: false, heartbeatAgeMs: null };
      parsed = JSON.parse(bounded.toString("utf8", 0, size));
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { state: "missing", healthy: false, heartbeatAgeMs: null }
      : { state: "invalid", healthy: false, heartbeatAgeMs: null };
  }
  if (!isSnapshot(parsed)) return { state: "invalid", healthy: false, heartbeatAgeMs: null };
  const heartbeat = Date.parse(parsed.heartbeatAt);
  if (!Number.isFinite(heartbeat)) return { state: "invalid", healthy: false, heartbeatAgeMs: null };
  const heartbeatAgeMs = Math.max(0, now - heartbeat);
  if (heartbeatAgeMs > parsed.staleAfterMs) return { state: "stale", healthy: false, heartbeatAgeMs, snapshot: parsed };
  if (parsed.status === "draining" || parsed.status === "unfinished" || parsed.status === "stopped" || parsed.status === "health-error") {
    return { state: parsed.status, healthy: false, heartbeatAgeMs, snapshot: parsed };
  }
  return { state: parsed.status as "starting" | "polling" | "idle" | "busy", healthy: true, heartbeatAgeMs, snapshot: parsed };
}

export function defaultWorkerHealthFilePath(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return workerHealthFilePath(env.KEYSPILLI_DATA_DIR ?? resolve(cwd, "data"));
}
