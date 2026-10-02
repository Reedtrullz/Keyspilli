import { getArtifactFile } from "./catalog-api";
import { publicJobError } from "./job-error";

/** A done row alone does not prove that its published result still exists. */
export async function publicJobView<T extends { status?: unknown; songId?: unknown; error?: unknown }>(job: T) {
  const error = publicJobError(job.error);
  let resultAvailable = false;
  if (job.status === "done" && typeof job.songId === "string") {
    try { resultAvailable = (await getArtifactFile(job.songId, "variant.mid")) !== null; } catch { /* unavailable until verified */ }
  }
  const displayState = error?.startsWith("Import saved an artifact") ? "Needs reconciliation"
    : error?.startsWith("Import stopped because the worker") ? "Resource blocked"
    : error?.startsWith("Piano preview cancelled") ? "Cancelled"
    : job.status === "done" ? resultAvailable ? "Completed" : "Result unavailable"
    : job.status === "error" ? "Failed" : job.status === "processing" ? "Processing" : "Queued";
  return { ...job, error, resultAvailable, displayState };
}
