import { expect, test } from "@playwright/test";

test("recent jobs survive reopening, another submission, missing results and retry", async ({ page }) => {
  const jobs = [
    { id: "saved-complete", status: "done", displayState: "Completed", resultAvailable: true, songId: "roadmap-001-easy", error: null },
    { id: "missing-result", status: "done", displayState: "Result unavailable", resultAvailable: false, songId: "removed-easy", error: null },
    { id: "reconcile-job", status: "error", displayState: "Needs reconciliation", resultAvailable: false, songId: null, error: "Import saved an artifact; owner reconciliation is required." },
    { id: "cancelled-job", status: "error", displayState: "Cancelled", resultAvailable: false, songId: null, error: "Piano preview cancelled." },
  ].map(job => ({ ...job, youtubeUrl: "https://www.youtube.com/watch?v=fixture", createdAt: "2026-10-02T00:00:00Z" }));
  let listAvailable = false, statusAvailable = false, submissions = 0;
  await page.route("**/api/youtube/jobs", route => route.fulfill(listAvailable
    ? { json: { jobs } } : { status: 503, json: { error: "unavailable" } }));
  await page.route("**/api/youtube/status/*", route => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1);
    const job = jobs.find(job => job.id === id) ?? { ...jobs[0], id };
    return route.fulfill(statusAvailable ? { json: job } : { status: 503, json: { error: "unavailable" } });
  });
  await page.route("**/api/youtube/import", route => {
    submissions++;
    return route.fulfill({ status: 202, json: { jobId: "second-job" } });
  });
  await page.goto("/youtube?job=saved-complete");
  const inbox = page.getByRole("region", { name: "Recent imports" });
  await expect(inbox.getByRole("alert")).toHaveText("Recent imports are unavailable.");
  await expect(page.getByText("Status unavailable; checking again shortly.")).toBeVisible();
  listAvailable = statusAvailable = true;
  await inbox.getByRole("button", { name: "Retry import list" }).click();
  await expect(inbox.getByRole("link", { name: "Completed · saved-complete", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create piano preview" })).toBeEnabled();
  await page.getByLabel("YouTube link").fill("https://www.youtube.com/watch?v=second");
  await page.getByRole("button", { name: "Create piano preview" }).click();
  await expect(page).toHaveURL(/job=second-job/);
  expect(submissions).toBe(1);
  await inbox.getByRole("link", { name: "Result unavailable · missing-result", exact: true }).click();
  await expect(page).toHaveURL(/job=missing-result/);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("This job completed, but its result is unavailable");
  await expect(page.locator('a[href="/player/removed-easy"]')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("This job completed, but its result is unavailable");
  await inbox.getByRole("link", { name: "Needs reconciliation · reconcile-job", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("owner reconciliation is required");
  await expect(page.getByRole("button", { name: "Cancel preview" })).toHaveCount(0);
  expect(submissions).toBe(1);
});
