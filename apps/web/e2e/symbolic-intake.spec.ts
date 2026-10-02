import { expect, test } from "@playwright/test";

const xml = Buffer.from(`<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Owner study</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note></measure></part></score-partwise>`, "utf8");
const preflight = {
  preflightId: "symbolic-preflight-fixture",
  sourceHash: "a".repeat(64),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  format: "musicxml",
  tempoBpm: 120,
  timeSig: [4, 4],
  parts: [{ id: "P1", name: "Owner study", noteCount: 1, lowMidi: 60, highMidi: 60, startBeat: 0, endBeat: 1, percussion: false }],
  unsupportedControls: [],
  previewNotes: [{ partId: "P1", midi: 60, start: 0, dur: 1, vel: 80 }],
};

async function reviewOneNoteStudy(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/uploads");
  await page.locator('input[type="file"]').setInputFiles({ name: "owner-study.musicxml", mimeType: "application/xml", buffer: xml });
  await page.getByRole("button", { name: "Review file parts" }).click();
  await expect(page.getByRole("list", { name: "Source parts" })).toContainText("Owner study");
  await page.locator('ul[aria-label="Source parts"] input[type="checkbox"]').first().check();
  await page.getByLabel("Role for Owner study").selectOption("other");
  await page.getByLabel(/I created these symbolic bytes/).check();
  await page.getByLabel(/This is an authorized exact short study/).check();
}

test("canceling symbolic review never submits publication", async ({ page }) => {
  let preflightRequests = 0;
  let publicationRequests = 0;
  await page.route("**/api/uploads/preflight", async (route) => {
    preflightRequests++;
    await route.fulfill({ json: preflight });
  });
  await page.route(/\/api\/uploads(?:\?.*)?$/, async (route) => {
    publicationRequests++;
    await route.fulfill({ status: 500, json: { error: "publication should not be reached" } });
  });

  await reviewOneNoteStudy(page);
  await page.getByRole("button", { name: "Cancel review" }).click();

  await expect(page.getByRole("button", { name: "Review file parts" })).toBeVisible();
  expect(preflightRequests).toBe(1);
  expect(publicationRequests).toBe(0);
});

test("a late preflight response cannot attach to a replacement file", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (typeof input === "string" && input.endsWith("/api/uploads/preflight")) {
        const { signal: _signal, ...options } = init ?? {};
        return nativeFetch(input, options);
      }
      return nativeFetch(input, init);
    };
  });
  let releaseFirstResponse!: () => void;
  let markFirstRequest!: () => void;
  const firstRequestStarted = new Promise<void>((resolve) => { markFirstRequest = resolve; });
  const releaseResponse = new Promise<void>((resolve) => { releaseFirstResponse = resolve; });
  await page.route("**/api/uploads/preflight", async (route) => {
    markFirstRequest();
    await releaseResponse;
    await route.fulfill({ json: preflight });
  });

  await page.goto("/uploads");
  const picker = page.locator('input[type="file"]');
  await picker.setInputFiles({ name: "old.musicxml", mimeType: "application/xml", buffer: xml });
  await page.getByRole("button", { name: "Review file parts" }).click();
  await firstRequestStarted;
  // Selecting a file removes the picker from the DOM. Clear that file through
  // the user flow, then choose its replacement while the old response is in flight.
  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Browse files" }).waitFor();
  await page.locator('input[type="file"]').setInputFiles({ name: "replacement.musicxml", mimeType: "application/xml", buffer: Buffer.from("<score-partwise/>") });
  releaseFirstResponse();

  await expect(page.getByRole("button", { name: "Review file parts" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Source parts" })).toHaveCount(0);
});

test("publishing a reviewed study binds the exact bytes and explicit study intent", async ({ page }) => {
  let submittedChoice: Record<string, unknown> | undefined;
  let submittedBytes: Buffer | undefined;
  await page.route("**/api/uploads/preflight", async (route) => route.fulfill({ json: preflight }));
  await page.route(/\/api\/uploads(?:\?.*)?$/, async (route) => {
    submittedChoice = JSON.parse(route.request().headers()["x-keyspilli-upload-choice"] ?? "null") as Record<string, unknown>;
    submittedBytes = route.request().postDataBuffer() ?? undefined;
    await route.fulfill({
      json: {
        baseId: "upload-fixture",
        sourceHash: preflight.sourceHash,
        publicationRevision: "fixture-revision",
        songIds: ["upload-fixture-b", "upload-fixture-e"],
        easySongId: "upload-fixture-e",
        title: "Owner study",
        artist: "",
        reused: false,
        symbolicIntent: {
          schemaVersion: 1,
          sourceHash: preflight.sourceHash,
          rightsAttested: true,
          arrangementIntent: "original",
          selectedParts: [{ id: "P1", name: "Owner study", role: "other" }],
          study: { ownerAuthored: true, profile: "source", kind: "one-note", noteCount: 1, availableLevels: ["beginner", "easy"] },
        },
      },
    });
  });

  await reviewOneNoteStudy(page);
  await page.getByRole("button", { name: "Confirm and publish lesson" }).click();

  await expect(page.getByRole("status")).toContainText("One-note study created. Available levels: Beginner, Easy.");
  expect(submittedBytes).toEqual(Buffer.from(xml));
  expect(submittedChoice).toMatchObject({
    selectedParts: [{ id: "P1", role: "other" }],
    arrangementIntent: "original",
    rightsAttested: true,
    ownerAuthoredStudy: true,
  });
});


test("included starter stays opt-in and publishes through the reviewed short-study gate", async ({ page, request }) => {
  const headers = { Authorization: "Bearer test-token-for-e2e" };
  await page.goto("/");
  await page.getByRole("link", { name: "Try a starter study" }).click();
  await page.locator("#starter-studies summary").click();
  let publications = 0;
  page.on("request", req => { if (/\/api\/uploads(?:\?.*)?$/.test(new URL(req.url()).pathname) && req.method() === "POST") publications++; });
  await page.getByRole("button", { name: "Choose triad starter", exact: true }).click();
  expect(publications).toBe(0);
  await page.getByRole("button", { name: "Review file parts" }).click();
  await page.locator('ul[aria-label="Source parts"] input[type="checkbox"]').first().check();
  await page.getByLabel("Role for Starter notes").selectOption("harmony");
  await page.getByLabel(/I created these symbolic bytes/).check();
  await page.getByLabel(/This is an authorized exact short study/).check();
  const [response] = await Promise.all([page.waitForResponse(res => new URL(res.url()).pathname === "/api/uploads" && res.request().method() === "POST"), page.getByRole("button", { name: "Confirm and publish lesson" }).click()]);
  expect(response.ok(), await response.text()).toBe(true);
  const receipt = await response.json();
  try {
    expect(receipt.symbolicIntent.study).toMatchObject({ kind: "triad", noteCount: 3, profile: "source" });
    await expect(page.getByRole("status")).toContainText("Triad study created");
    const detail = await (await request.get(`/api/songs/${receipt.easySongId}`)).json();
    expect(detail.data.notes.map((note: { midi: number }) => note.midi).sort((a: number, b: number) => a-b)).toEqual([60,64,67]);
    expect(detail.data.notes.every((note: { start: number; dur: number }) => note.start === 0 && note.dur === 1)).toBe(true);
  } finally { expect((await request.delete(`/api/songs/${receipt.baseId}`, { headers })).ok()).toBe(true); }
});
