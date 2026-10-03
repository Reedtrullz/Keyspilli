import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { assessWorkerHealthFile, workerHealthFilePath, writeWorkerHealthSnapshot } from "../src/worker-health.js";
import type { WorkerHealthSnapshot } from "../src/worker-runtime.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it("atomically writes an ID-free snapshot and classifies it stale from a separate reader", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "keyspilli-health-test-"));
  temporaryDirectories.push(dataDir);
  const file = workerHealthFilePath(dataDir);
  const snapshot: WorkerHealthSnapshot = {
    status: "busy",
    heartbeatAt: new Date(10_000).toISOString(),
    staleAfterMs: 30_000,
    capabilityRevision: "0123456789abcdef",
    progress: "transcribing",
    activeJobs: 1,
    unfinishedJobs: 0,
    recoveryPending: false,
    queue: { sampled: 2, sampleLimit: 5, moreMayExist: false, oldestAgeMs: 60_000 },
  };
  writeWorkerHealthSnapshot(file, snapshot);

  expect(assessWorkerHealthFile(file, 20_000)).toMatchObject({ state: "busy", healthy: true, heartbeatAgeMs: 10_000 });
  expect(assessWorkerHealthFile(file, 50_001)).toMatchObject({ state: "stale", healthy: false });
  expect(readFileSync(file, "utf8")).not.toMatch(/job-id|youtube\.com|KEYSPILLI_/);

  writeFileSync(file, " ".repeat(8_192));
  expect(assessWorkerHealthFile(file)).toMatchObject({ state: "invalid", healthy: false });

  writeWorkerHealthSnapshot(file, { ...snapshot, capabilityRevision: "revision-from-payload" });
  expect(assessWorkerHealthFile(file)).toMatchObject({ state: "invalid", healthy: false });
});
