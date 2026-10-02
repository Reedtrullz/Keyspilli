export type WorkerProgress =
  | "claiming"
  | "checking-disk"
  | "downloading"
  | "extracting"
  | "transcribing"
  | "publishing"
  | "finalizing";

export interface WorkerHealthSnapshot {
  status: "starting" | "polling" | "idle" | "busy" | "draining" | "unfinished" | "stopped" | "health-error";
  heartbeatAt: string;
  staleAfterMs: number;
  capabilityRevision: string;
  progress: WorkerProgress | null;
  activeJobs: 0 | 1;
  unfinishedJobs: 0 | 1;
  recoveryPending: boolean;
  queue: { sampled: number; sampleLimit: 5; moreMayExist: boolean; oldestAgeMs: number | null };
}

export interface WorkerQueueEntry {
  id: string;
  createdAt: string;
}

export type WorkerErrorKind = "startup" | "poll" | "job" | "shutdown grace expired" | "health" | "grace fence";

export interface WorkerLoopOptions<T extends WorkerQueueEntry> {
  signal: AbortSignal;
  pollMs: number;
  heartbeatMs: number;
  shutdownGraceMs: number;
  capabilityRevision: string;
  startup?(signal: AbortSignal): Promise<void>;
  getQueuedJobs(): Promise<T[]> | T[];
  processJob(
    job: T,
    signal: AbortSignal,
    progress: (stage: WorkerProgress) => void,
    registerGraceExpired: (handler: (stage: WorkerProgress | null) => void) => void,
  ): Promise<void>;
  onHealth(snapshot: WorkerHealthSnapshot): void;
  onError?(kind: WorkerErrorKind): void;
  now?: () => number;
}

let latestSnapshot: WorkerHealthSnapshot | null = null;

export function getWorkerHealthSnapshot(): WorkerHealthSnapshot | null {
  return latestSnapshot && { ...latestSnapshot, queue: { ...latestSnapshot.queue } };
}

export async function runWorkerLoop<T extends WorkerQueueEntry>(options: WorkerLoopOptions<T>): Promise<"stopped" | "unfinished" | "fence-failed"> {
  const now = options.now ?? Date.now;
  let status: WorkerHealthSnapshot["status"] = "starting";
  let progress: WorkerProgress | null = null;
  let active = false;
  let unfinished = false;
  let recoveryPending = false;
  let lastHeartbeat = now();
  let queued: T[] = [];
  let queueMayHaveMore = false;
  let wakeDelay: (() => void) | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveGraceExpired: (() => void) | undefined;
  let activeGraceExpired: (stage: WorkerProgress | null) => void = () => {};
  let drainOutcome: "stopped" | "unfinished" | "fence-failed" = "stopped";
  let drainExpired = false;
  let drainFenceSucceeded = false;
  let graceFenceFailed = false;
  let activeGraceFenceRegistered = false;

  const reportError = (kind: WorkerErrorKind) => {
    try { options.onError?.(kind); } catch { /* Observability callbacks cannot stop worker cleanup. */ }
  };

  const publish = () => {
    const sample = queued.slice(0, 5);
    const createdAt = sample[0] ? Date.parse(sample[0].createdAt) : NaN;
    const snapshot: WorkerHealthSnapshot = {
      status,
      heartbeatAt: new Date(lastHeartbeat).toISOString(),
      staleAfterMs: options.heartbeatMs * 2,
      capabilityRevision: options.capabilityRevision,
      progress,
      activeJobs: active ? 1 : 0,
      unfinishedJobs: unfinished ? 1 : 0,
      recoveryPending,
      queue: {
        sampled: sample.length,
        sampleLimit: 5,
        moreMayExist: queueMayHaveMore || queued.length >= 5,
        oldestAgeMs: Number.isFinite(createdAt) ? Math.max(0, now() - createdAt) : null,
      },
    };
    latestSnapshot = snapshot;
    try {
      options.onHealth(snapshot);
    } catch {
      latestSnapshot = { ...snapshot, status: "health-error" };
      reportError("health");
    }
  };

  const onAbort = () => {
    status = "draining";
    lastHeartbeat = now();
    publish();
    if (active && graceTimer === undefined) {
      graceTimer = setTimeout(() => {
        if (!active) return;
        // Stop waiting at the configured bound, retain the active snapshot,
        // and let the owned job's lease/reconciliation contract recover it.
        reportError("shutdown grace expired");
        try {
          if (!activeGraceFenceRegistered) throw new Error("shutdown lease fence was not registered");
          activeGraceExpired(progress);
        } catch {
          graceFenceFailed = true;
          reportError("grace fence");
        } finally {
          unfinished = true;
          recoveryPending = !graceFenceFailed;
          status = graceFenceFailed ? "health-error" : "unfinished";
          publish();
          resolveGraceExpired?.();
        }
      }, options.shutdownGraceMs);
    }
    wakeDelay?.();
  };

  const heartbeat = setInterval(() => {
    lastHeartbeat = now();
    publish();
  }, options.heartbeatMs);
  heartbeat.unref();
  options.signal.addEventListener("abort", onAbort, { once: true });
  publish();
  if (options.signal.aborted) onAbort();

  const delay = () => new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", finish);
      wakeDelay = undefined;
      resolve();
    };
    const timer = setTimeout(finish, options.pollMs);
    wakeDelay = finish;
    options.signal.addEventListener("abort", finish, { once: true });
    if (options.signal.aborted) finish();
  });

  try {
    if (options.startup && !options.signal.aborted) {
      try {
        await options.startup(options.signal);
      } catch {
        reportError("startup");
        throw new Error("worker startup failed");
      }
    }
    while (!options.signal.aborted) {
      status = "polling";
      progress = null;
      lastHeartbeat = now();
      publish();
      try {
        queued = await options.getQueuedJobs();
        queueMayHaveMore = queued.length >= 5;
      } catch {
        queued = [];
        queueMayHaveMore = false;
        reportError("poll");
      }
      status = "idle";
      lastHeartbeat = now();
      publish();
      for (const job of queued) {
        if (options.signal.aborted) break;
        queued = queued.slice(1);
        active = true;
        status = "busy";
        progress = "claiming";
        lastHeartbeat = now();
        publish();
        try {
          let resolveExpired!: (expired: boolean) => void;
          const expiredPromise = new Promise<boolean>((resolve) => { resolveExpired = resolve; });
          resolveGraceExpired = () => resolveExpired(true);
          activeGraceExpired = () => {};
          activeGraceFenceRegistered = false;
          const work = Promise.resolve().then(() => options.processJob(job, options.signal, (stage) => {
            progress = stage;
            publish();
          }, (handler) => {
            activeGraceFenceRegistered = true;
            activeGraceExpired = handler;
          })).catch(() => {
            reportError("job");
          });
          if (options.signal.aborted) onAbort();
          const expired = await Promise.race([work.then(() => false), expiredPromise]);
          if (expired) {
            // The job promise may still settle later; its existing lease fence
            // protects publication while the runtime reports recovery pending.
            drainOutcome = graceFenceFailed ? "fence-failed" : "unfinished";
            drainExpired = true;
            drainFenceSucceeded = !graceFenceFailed;
            return drainOutcome;
          }
        } finally {
          if (!unfinished) {
            if (graceTimer !== undefined) clearTimeout(graceTimer);
            graceTimer = undefined;
            resolveGraceExpired = undefined;
            activeGraceExpired = () => {};
            activeGraceFenceRegistered = false;
            active = false;
            progress = null;
            if (options.signal.aborted) status = "draining";
            else status = "idle";
            lastHeartbeat = now();
            publish();
          }
        }
      }
      if (!options.signal.aborted) await delay();
    }
  } finally {
    clearInterval(heartbeat);
    if (graceTimer !== undefined) clearTimeout(graceTimer);
    options.signal.removeEventListener("abort", onAbort);
    if (drainExpired) {
      status = drainFenceSucceeded ? "unfinished" : "health-error";
      active = true;
      unfinished = true;
      recoveryPending = drainFenceSucceeded;
      lastHeartbeat = now();
      publish();
    } else {
      status = "stopped";
      active = false;
      unfinished = false;
      recoveryPending = false;
      progress = null;
      lastHeartbeat = now();
      publish();
    }
  }
  return drainOutcome;
}
