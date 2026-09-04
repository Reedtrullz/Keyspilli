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
