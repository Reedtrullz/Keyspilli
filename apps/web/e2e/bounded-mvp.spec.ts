import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const MUSIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
    <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
    <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
    <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type></note>
  </measure></part>
</score-partwise>`;

test("scratch upload creates an Easy player with public levels and exports", async ({ page, request }) => {
  const initialCatalog = await request.get("/api/songs?group=1&limit=1");
  expect(initialCatalog.status()).toBe(200);
  expect((await initialCatalog.json()).total).toBe(0);

  await page.goto("/uploads");
  await expect(page.getByText(/MIDI, MusicXML, or MXL/)).toBeVisible();
  await page.getByLabel("Title (optional)").fill("Scratch MusicXML");
  await page.getByLabel("Artist (optional)").fill("Keyspilli E2E");
  await page.locator('input[type="file"]').setInputFiles({
    name: "scratch.musicxml",
    mimeType: "application/vnd.recordare.musicxml+xml",
    buffer: Buffer.from(MUSIC_XML),
  });
  await page.getByRole("button", { name: "Upload & create lesson" }).click();

  await expect(page.getByRole("status")).toContainText("five public levels");
  const playerLink = page.getByRole("link", { name: /Open in the player/ });
  await expect(playerLink).toBeVisible();
  const easyHref = await playerLink.getAttribute("href");
  expect(easyHref).toMatch(/^\/player\/[^/]+-e$/);
  const uploadResponse = await request.get("/api/songs?limit=20");
  const uploadedSongs = (await uploadResponse.json()).songs as Array<{ id: string; difficulty: string }>;
  expect(uploadedSongs).toHaveLength(6);
  const veryEasyId = uploadedSongs.find((song) => song.difficulty === "very-easy")?.id;
  expect(veryEasyId).toBeTruthy();

  await page.goto(easyHref!);
  const levels = page.getByRole("heading", { name: "Same song, other levels" }).locator("..");
  await expect(levels.getByRole("link")).toHaveCount(5);
  await expect(levels.getByRole("link")).toHaveText(["Very Beginner", "Beginner", "Easy", "Medium", "Advanced"]);
  await expect(levels.getByRole("link", { name: "Very Easy", exact: true })).toHaveCount(0);

  await page.goto(`/player/${veryEasyId}`);
  const legacyLevels = page.getByRole("heading", { name: "Same song, other levels" }).locator("..");
  await expect(legacyLevels.getByRole("link")).toHaveCount(6);
  await expect(legacyLevels.getByRole("link", { name: "Very Easy", exact: true })).toBeVisible();

  for (const type of ["midi", "musicxml"] as const) {
    const response = await request.get(`${easyHref!.replace(/^\/player\//, "/api/song/")}/export?type=${type}`);
    expect(response.status(), `${type} export`).toBe(200);
    expect((await response.body()).byteLength, `${type} export bytes`).toBeGreaterThan(32);
  }
});

test("scratch upload reports malformed symbolic content without publishing", async ({ page, request }) => {
  await page.goto("/uploads");
  await page.locator('input[type="file"]').setInputFiles({
    name: "not-really.musicxml",
    mimeType: "application/vnd.recordare.musicxml+xml",
    buffer: Buffer.from("<html><body>not a score</body></html>"),
  });
  await page.getByRole("button", { name: "Upload & create lesson" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText(/parse failed|too few notes|invalid/i);
  const catalog = await request.get("/api/songs?limit=20");
  expect((await catalog.json()).songs).toHaveLength(6);
});

test("creation surfaces consistently lead to symbolic discovery and upload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("link", { name: "Add a song" })).toHaveAttribute("href", "/uploads");
  await expect(page.getByText(/YouTube → sheet music/i)).toHaveCount(0);

  await page.goto("/youtube");
  await expect(page.getByRole("heading", { name: "Create a lesson from a symbolic file" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Add a song" })).toHaveAttribute("href", "/uploads");
  await expect(page.getByRole("button", { name: /convert/i })).toHaveCount(0);

  await page.goto("/uploads");
  const details = page.getByRole("heading", { name: "1. Song details" });
  const discovery = page.getByRole("heading", { name: "2. Find source leads (optional)" });
  const file = page.getByRole("heading", { name: "3. Choose a symbolic file" });
  expect(await details.boundingBox()).not.toBeNull();
  expect((await details.boundingBox())!.y).toBeLessThan((await discovery.boundingBox())!.y);
  expect((await discovery.boundingBox())!.y).toBeLessThan((await file.boundingBox())!.y);

  await page.getByLabel("Title (optional)").fill("No Provider Song");
  await page.getByLabel("Artist (optional)").fill("No Provider Artist");
  await page.getByRole("button", { name: "Find source leads" }).click();
  await expect(page.getByText(/Source search is not configured.*upload.*directly/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Browse files" })).toBeEnabled();
});

test("source discovery distinguishes no results, rate limits, and metadata-only leads", async ({ page }) => {
  let mode: "none" | "rate" | "candidate" = "none";
  await page.route("**/api/source-candidates?**", async (route) => {
    if (mode === "none") return route.fulfill({ json: { status: "no-candidates", candidates: [] } });
    if (mode === "rate") return route.fulfill({ status: 429, json: { code: "SOURCE_SEARCH_RATE_LIMITED", error: "Source search is temporarily rate limited. Try again shortly." } });
    return route.fulfill({ json: { status: "candidates-found", candidates: [{
      candidateId: "lead-1",
      resultTitle: "Open Band – Open Song MIDI",
      resultSnippet: "A possible symbolic source",
      provider: "brave-search-api",
      candidateUrl: "https://example.test/song.mid",
      symbolicFormat: "midi",
      identity: "IDENTITY_EXACT",
      rights: "UNKNOWN_RIGHTS",
      timing: "UNKNOWN_TIMING",
    }] } });
  });
  await page.route("**/api/source-handoffs", (route) => route.fulfill({ status: 201, json: { handoff: {
    handoffId: "handoff-1", candidateId: "lead-1", provider: "brave-search-api", expectedFormat: "midi", userAffirmedTarget: false,
  } } }));

  await page.goto("/uploads");
  await page.getByLabel("Title (optional)").fill("Open Song");
  await page.getByLabel("Artist (optional)").fill("Open Band");
  await page.getByRole("button", { name: "Find source leads" }).click();
  await expect(page.getByText(/couldn't find a usable symbolic source lead/i)).toBeVisible();

  mode = "rate";
  await page.getByRole("button", { name: "Try source search again" }).click();
  await expect(page.getByText(/Source search is temporarily rate limited/i)).toBeVisible();

  mode = "candidate";
  await page.getByRole("button", { name: "Try source search again" }).click();
  await expect(page.getByText("Open Band – Open Song MIDI")).toBeVisible();
  await expect(page.getByText(/Search results are leads only/i)).toBeVisible();
  await expect(page.getByText(/Permission: you must verify/i)).toBeVisible();
  await expect(page.getByText(/Timing: unverified/i)).toBeVisible();
  await page.getByRole("button", { name: "Use as a lead" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "different.musicxml",
    mimeType: "application/vnd.recordare.musicxml+xml",
    buffer: Buffer.from(MUSIC_XML),
  });
  await expect(page.getByText(/lead expected a MIDI file.*actual file contents decide/i)).toBeVisible();
});
