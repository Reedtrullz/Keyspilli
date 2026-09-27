import { afterAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { claimJob, getDb, getJob, insertJob, type JobRow } from "@keyspilli/catalog";
import { POST } from "./route";

const root = mkdtempSync(join(tmpdir(), "keyspilli-retry-"));
process.env.KEYSPILLI_DATA_DIR = root;
process.env.KEYSPILLI_API_TOKEN = "test-token";
afterAll(() => { getDb().close(); rmSync(root, { recursive: true, force: true }); });

const request = (id: string) => POST(new Request(`http://localhost/api/youtube/jobs/${id}/retry`, {
  method: "POST", headers: { authorization: "Bearer test-token" },
}), { params: Promise.resolve({ id }) });
const add = (id: string, status: JobRow["status"], error: string | null = null) => insertJob({
  id, status, error, youtubeUrl: "https://youtube.com/watch?v=abcdefghijk", songId: null,
  attempts: 2, createdAt: new Date().toISOString(), finishedAt: status === "error" ? new Date().toISOString() : null,
});

it("retries only terminal retryable errors without creating a second lease", async () => {
  add("queued", "queued");
  add("active", "queued");
  const owner = claimJob("active");
  add("complete", "done");
  add("retryable", "error", "attempt 2: temporary network failure");
  add("review", "error", "attempt 2: SOURCE_REVIEW_REQUIRED: source changed");
  add("reconcile", "error", "attempt 1: ARTIFACT_RECONCILIATION_REQUIRED: commit failed");
  add("cancelled", "error", "TUTORIAL_PREVIEW_CANCELLED");

  for (const id of ["queued", "active", "complete", "review", "reconcile", "cancelled"]) {
    expect((await request(id)).status, id).toBe(409);
  }
  expect(getJob("active")?.status).toBe("processing");
  expect((getDb().prepare("SELECT lease_owner FROM conversion_jobs WHERE id = 'active'").get() as { lease_owner: string }).lease_owner).toBe(owner);
  expect((await request("missing")).status).toBe(404);
  expect((await request("retryable")).status).toBe(200);
  expect(getJob("retryable")).toMatchObject({ status: "queued", attempts: 0, error: null });
});
