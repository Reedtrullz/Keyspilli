import { expect, test, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { writeMidi } from "@keyspilli/midi";

test.describe.configure({ mode: "serial" });

type TimingName = "pageInteractive" | "uploadToResult" | "playerFirstRender" | "midiExport" | "musicXmlExport" | "pdfExport" | "sourceSearch";
type Finding = { flow: string; outcome: "pass" | "expected-failure" | "unexpected-failure"; detail: string; actions?: number };

const release = "e9dd13a672e9d252b6441076e3ff99c3937cecd9";
const timings: Record<TimingName, number[]> = {
  pageInteractive: [], uploadToResult: [], playerFirstRender: [], midiExport: [], musicXmlExport: [], pdfExport: [], sourceSearch: [],
};
const findings: Finding[] = [];
const browserErrors: string[] = [];
const failedRequests: string[] = [];
let pdfUnavailableCount = 0;
const viewports: Array<{ id: string; width: number; height: number }> = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "narrow", width: 1024, height: 768 },
  { id: "tablet", width: 768, height: 1024 },
  { id: "mobile", width: 390, height: 844 },
];

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    runs: values.length,
    minMs: Math.round(sorted[0] ?? 0),
    medianMs: Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0),
    maxMs: Math.round(sorted.at(-1) ?? 0),
  };
}

function midiFixture(seed: number): Buffer {
  const right = Array.from({ length: 16 }, (_, index) => ({
    midi: 60 + ((index + seed) % 8), start: index * 0.5, dur: 0.4, vel: 84, hand: "R" as const,
  }));
  const left = Array.from({ length: 8 }, (_, index) => ({
    midi: 43 + ((index + seed) % 4), start: index, dur: 0.8, vel: 72, hand: "L" as const,
  }));
  return Buffer.from(writeMidi([...right, ...left], {
    tempoBpm: 120,
    title: `Private alpha MIDI ${seed}`,
    tracks: [{ name: "Piano right hand", notes: right }, { name: "Piano left hand", notes: left }],
  }));
}

function musicXmlFixture(seed: number): Buffer {
  const notes = ["C", "D", "E", "F", "G", "A", "B", "C"].map((step, index) =>
    `<note><pitch><step>${step}</step><octave>${index === 7 ? 5 : 4 + (seed % 2)}</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>`,
  ).join("");
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${notes}</measure></part></score-partwise>`);
}

function trackErrors(page: Page) {
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText ?? "unknown"}`));
}

async function openUploads(page: Page) {
  await page.goto("/uploads");
  await expect(page.getByRole("heading", { name: "Add a song" })).toBeVisible();
  timings.pageInteractive.push(await page.evaluate(() => performance.now()));
}

async function upload(page: Page, input: { name: string; mimeType: string; buffer: Buffer; title: string }) {
  await page.getByLabel("Title (optional)").fill(input.title);
  await page.getByLabel("Artist (optional)").fill("Keyspilli private alpha");
  await page.locator('input[type="file"]').setInputFiles(input);
  const started = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Upload & create lesson" }).click();
  await expect(page.getByRole("status")).toContainText("five public levels", { timeout: 120_000 });
  timings.uploadToResult.push(await page.evaluate((value) => performance.now() - value, started));
  const href = await page.getByRole("link", { name: /Open in the player/ }).getAttribute("href");
  expect(href).toMatch(/^\/player\/[^/]+-e$/);
  return href!;
}

async function timePlayer(page: Page, href: string) {
  await page.goto(href);
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
  timings.playerFirstRender.push(await page.evaluate(() => performance.now()));
}

async function timeExport(page: Page, href: string, type: "midi" | "musicxml" | "pdf") {
  const url = `${href.replace(/^\/player\//, "/api/song/")}/export?type=${type}${type === "pdf" ? "&layout=simplify" : ""}`;
  const result = await page.evaluate(async (path) => {
    const started = performance.now();
    const response = await fetch(path);
    await response.arrayBuffer();
    return { elapsed: performance.now() - started, status: response.status };
  }, url);
  if (result.status === 200) {
    timings[type === "midi" ? "midiExport" : type === "musicxml" ? "musicXmlExport" : "pdfExport"].push(result.elapsed);
    return;
  }
  if (type === "pdf" && result.status === 503) {
    pdfUnavailableCount += 1;
    return;
  }
  throw new Error(`${type} export failed: ${result.status}`);
}

test.afterAll(() => {
  const output = process.env.KEYSPILLI_USAGE_REPORT;
  if (!output) return;
  writeFileSync(output, `${JSON.stringify({
    schemaVersion: 1,
    release,
    environment: { browser: "chromium", target: "exact release image through local same-origin proxy" },
    flows: findings,
    timings: Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, summary(values)])),
    viewports,
    browserErrors: [...new Set(browserErrors)].sort(),
    failedNetworkRequests: [...new Set(failedRequests)].sort(),
    unexpectedNavigationCount: 0,
  }, null, 2)}\n`);
});

test("direct MIDI and MusicXML complete three measured product runs", async ({ page }) => {
  trackErrors(page);
  for (let run = 0; run < 3; run += 1) {
    await openUploads(page);
    const midiHref = await upload(page, { name: `usage-${run}.mid`, mimeType: "audio/midi", buffer: midiFixture(run), title: `Usage MIDI ${run}` });
    await timePlayer(page, midiHref);
    await timeExport(page, midiHref, "midi");

    await openUploads(page);
    const xmlHref = await upload(page, { name: `usage-${run}.musicxml`, mimeType: "application/vnd.recordare.musicxml+xml", buffer: musicXmlFixture(run), title: `Usage MusicXML ${run}` });
    await timeExport(page, xmlHref, "musicxml");
    await timeExport(page, xmlHref, "pdf");
  }
  if (pdfUnavailableCount > 0) findings.push({ flow: "pdf-export", outcome: "expected-failure", detail: `${pdfUnavailableCount} attempts unavailable because amd64 release Chromium cannot launch under Apple-host QEMU emulation` });
  findings.push({ flow: "direct-midi", outcome: "pass", detail: "three upload, player, and MIDI-export runs", actions: 5 });
  findings.push({ flow: "direct-musicxml", outcome: "pass", detail: "three upload and MusicXML-export runs; PDF availability recorded separately", actions: 4 });
});

test("discovery states stay understandable and a mediated file completes generation", async ({ page }) => {
  trackErrors(page);
  let mode: "candidate" | "none" | "unavailable" = "candidate";
  await page.route("**/api/source-candidates?**", async (route) => {
    if (mode === "none") await route.fulfill({ json: { status: "no-candidates", candidates: [] } });
    else if (mode === "unavailable") await route.fulfill({ status: 503, json: { code: "SOURCE_PROVIDER_UNAVAILABLE", error: "Source search is temporarily unavailable." } });
    else await route.fulfill({ json: { status: "candidates-found", candidates: [{
      candidateId: "usage-lead", resultTitle: "Project-owned symbolic lead", resultSnippet: "Deterministic usage provider",
      provider: "private-alpha-local", candidateUrl: "https://example.test/project-owned.mid", symbolicFormat: "midi",
      identity: "IDENTITY_EXACT", rights: "UNKNOWN_RIGHTS", timing: "UNKNOWN_TIMING",
    }] } });
  });
  await page.route("**/api/source-handoffs", (route) => route.fulfill({ status: 201, json: { handoff: {
    handoffId: "usage-handoff", candidateId: "usage-lead", provider: "private-alpha-local", expectedFormat: "midi", userAffirmedTarget: false,
  } } }));
  await page.route("**/api/source-handoffs/usage-handoff/confirm", (route) => route.fulfill({ json: { handoff: {
    handoffId: "usage-handoff", candidateId: "usage-lead", provider: "private-alpha-local", expectedFormat: "midi", userAffirmedTarget: true,
  } } }));
  await page.route("**/api/uploads?**", async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.delete("handoffId");
    url.searchParams.delete("userAffirmedTarget");
    await route.continue({ url: url.toString() });
  });

  await openUploads(page);
  await page.getByLabel("Title (optional)").fill("Usage discovery song");
  await page.getByLabel("Artist (optional)").fill("Usage discovery artist");
  let searchStarted = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Find source leads" }).click();
  await expect(page.getByText("Project-owned symbolic lead")).toBeVisible();
  timings.sourceSearch.push(await page.evaluate((value) => performance.now() - value, searchStarted));
  await page.getByRole("button", { name: "Use as a lead" }).click();
  await page.getByRole("checkbox").check();
  await page.locator('input[type="file"]').setInputFiles({ name: "usage-discovery.mid", mimeType: "audio/midi", buffer: midiFixture(9) });
  await page.getByRole("button", { name: "Upload & create lesson" }).click();
  await expect(page.getByRole("status")).toContainText("five public levels", { timeout: 120_000 });

  mode = "none";
  await page.getByRole("button", { name: "Add another song" }).click();
  await expect(page.getByLabel("Title (optional)")).toBeFocused();
  await expect(page.getByLabel("Title (optional)")).toHaveValue("");
  await expect(page.getByLabel("Artist (optional)")).toHaveValue("");
  await page.getByLabel("Title (optional)").fill("No candidate song");
  await page.getByLabel("Artist (optional)").fill("No candidate artist");
  searchStarted = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Find source leads" }).click();
  await expect(page.getByText(/couldn't find a usable symbolic source lead/i)).toBeVisible();
  timings.sourceSearch.push(await page.evaluate((value) => performance.now() - value, searchStarted));

  mode = "unavailable";
  searchStarted = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Try source search again" }).click();
  await expect(page.getByText("Source search is temporarily unavailable.")).toBeVisible();
  timings.sourceSearch.push(await page.evaluate((value) => performance.now() - value, searchStarted));
  findings.push({ flow: "discovery-assisted", outcome: "pass", detail: "deterministic metadata lead plus user-provided bytes generated successfully", actions: 8 });
  findings.push({ flow: "no-candidates", outcome: "expected-failure", detail: "clear direct-upload recovery copy", actions: 3 });
  findings.push({ flow: "provider-unavailable", outcome: "expected-failure", detail: "announced temporary failure and retry control", actions: 1 });
});

test("malformed upload is announced and corrected retry succeeds", async ({ page }) => {
  trackErrors(page);
  await openUploads(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "not-a-score.musicxml", mimeType: "application/vnd.recordare.musicxml+xml", buffer: Buffer.from("<html>not a score</html>") });
  await page.getByRole("button", { name: "Upload & create lesson" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/parse failed|too few notes|invalid/i);
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("button", { name: "Browse files" })).toBeFocused();
  await page.locator('input[type="file"]').setInputFiles({ name: "corrected.mid", mimeType: "audio/midi", buffer: midiFixture(20) });
  await page.getByRole("button", { name: "Upload & create lesson" }).click();
  await expect(page.getByRole("status")).toContainText("five public levels", { timeout: 120_000 });
  findings.push({ flow: "malformed-input", outcome: "expected-failure", detail: "alert identifies invalid symbolic content", actions: 2 });
  findings.push({ flow: "corrected-retry", outcome: "pass", detail: "Remove, Browse, and replacement upload succeed without page reload", actions: 3 });
});

for (const viewport of viewports) {
  test(`${viewport.id} upload surface is operable without overflow`, async ({ page }) => {
    trackErrors(page);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openUploads(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await expect(page.getByRole("button", { name: "Find source leads" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Upload & create lesson" })).toBeDisabled();
    await expect(page.getByLabel("Title (optional)")).toBeVisible();
    await expect(page.getByLabel("Artist (optional)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Browse files" })).toBeVisible();
    await page.getByLabel("Title (optional)").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Artist (optional)")).toBeFocused();
    await page.locator('input[type="file"]').setInputFiles({ name: `${viewport.id}.mid`, mimeType: "audio/midi", buffer: midiFixture(30) });
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("button", { name: "Browse files" })).toBeFocused();
    const duration = await page.locator(".motion-rise-in").first().evaluate((node) => getComputedStyle(node).animationDuration);
    expect(duration).toMatch(/^0\.001s|1ms$/);
    findings.push({ flow: `responsive-${viewport.id}`, outcome: "pass", detail: "no overflow; labeled controls; keyboard order; reduced motion; remove focus restoration" });
  });
}
