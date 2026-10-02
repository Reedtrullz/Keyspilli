import { describe, expect, it } from "vitest";
import { getWorkerHealthSnapshot, runWorkerLoop } from "../src/worker-runtime.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("worker runtime health and shutdown", () => {
  it("publishes bounded queue age and reports unfinished work while draining", async () => {
    const controller = new AbortController();
    const started = deferred();
    const finishJob = deferred();
    const unfinished = deferred<Record<string, unknown>>();
    const processed: string[] = [];
    const health: Array<Record<string, unknown>> = [];
    const jobs = Array.from({ length: 7 }, (_, i) => ({
      id: `private-job-${i}`,
      createdAt: new Date(Date.now() - (7 - i) * 1_000).toISOString(),
    }));
    const loop = runWorkerLoop({
      signal: controller.signal,
      pollMs: 60_000,
      heartbeatMs: 60_000,
      shutdownGraceMs: 10,
      capabilityRevision: "0123456789abcdef",
      getQueuedJobs: async () => jobs.slice(0, 5),
      processJob: async (job, _signal, progress, registerGraceExpired) => {
        processed.push(job.id);
        registerGraceExpired(() => {});
        progress("publishing");
        started.resolve();
        await finishJob.promise;
      },
      onHealth: (snapshot) => {
        health.push(snapshot as unknown as Record<string, unknown>);
        if (snapshot.status === "unfinished") unfinished.resolve(snapshot as unknown as Record<string, unknown>);
      },
    });

    await started.promise;
    controller.abort();
    const state = await unfinished.promise;
    expect(state).toMatchObject({ status: "unfinished", activeJobs: 1, unfinishedJobs: 1, recoveryPending: true, progress: "publishing" });
    expect(state.queue).toMatchObject({ sampled: 4, sampleLimit: 5, moreMayExist: true });
    expect((state.queue as { oldestAgeMs: number }).oldestAgeMs).toBeGreaterThanOrEqual(6_000);
    expect(JSON.stringify(health)).not.toContain("private-job");

    finishJob.resolve();
    await loop;
    expect(processed).toEqual(["private-job-0"]);
    expect(health.at(-1)).toMatchObject({ status: "unfinished", activeJobs: 1, unfinishedJobs: 1, recoveryPending: true });
  });

  it("returns at grace expiry and preserves the residual job as unfinished", async () => {
    const controller = new AbortController();
    const started = deferred();
    const releaseResidual = deferred();
    let expiryStage: string | null | undefined;
    const expiryOrder: string[] = [];
    const health: Array<{ status: string; activeJobs: number; unfinishedJobs: number }> = [];
    const loop = runWorkerLoop({
      signal: controller.signal,
      pollMs: 60_000,
      heartbeatMs: 60_000,
      shutdownGraceMs: 10,
      capabilityRevision: "0123456789abcdef",
      getQueuedJobs: () => [{ id: "private-hung-job", createdAt: new Date().toISOString() }],
      processJob: async (_job, _signal, progress, registerGraceExpired) => {
        registerGraceExpired((stage) => {
          expiryStage = stage;
          expiryOrder.push("fenced");
          throw new Error("private lease diagnostic");
        });
        progress("publishing");
        started.resolve();
        await releaseResidual.promise;
      },
      onHealth: (snapshot) => health.push(snapshot),
      onError: () => { throw new Error("private callback diagnostic"); },
    });

    await started.promise;
    controller.abort();
    await expect(loop).resolves.toBe("fence-failed");
    expiryOrder.push("returned");
    expect(expiryStage).toBe("publishing");
    expect(expiryOrder).toEqual(["fenced", "returned"]);
    expect(health.at(-1)).toMatchObject({ status: "health-error", activeJobs: 1, unfinishedJobs: 1, recoveryPending: false });
    expect(JSON.stringify(health)).not.toContain("private-hung-job");

    releaseResidual.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(health.at(-1)).toMatchObject({ status: "health-error", activeJobs: 1, unfinishedJobs: 1, recoveryPending: false });
  });

  it("contains throwing health and error callbacks and marks local health unhealthy", async () => {
    const controller = new AbortController();
    const reported: string[] = [];
    const run = runWorkerLoop({
      signal: controller.signal,
      pollMs: 1_000,
      heartbeatMs: 60_000,
      shutdownGraceMs: 1_000,
      capabilityRevision: "0123456789abcdef",
      getQueuedJobs: () => {
        controller.abort();
        return [];
      },
      processJob: async () => {},
      onHealth: () => { throw new Error("private filesystem path"); },
      onError: (kind) => {
        reported.push(kind);
        throw new Error("private logging failure");
      },
    });

    await expect(run).resolves.toBe("stopped");
    expect(reported).toContain("health");
    expect(getWorkerHealthSnapshot()?.status).toBe("health-error");
  });
});
