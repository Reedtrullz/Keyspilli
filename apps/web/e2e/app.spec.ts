import { openAdvancedArrangementControls, openPlayerTool } from "./player-tools";
import { expect, test } from "@playwright/test";
import { seedMidiDir } from "../../../packages/catalog/src/paths";
import { join } from "node:path";

const SONG = "f-f-chopin-nocturne-m";
const UG_SONG = "the-theorist-elton-john-your-song-piano-cover-jz6ugvghbt8-a";
const BRAHMS_SONG = "j-brahms-brahms-horn-trio-a";

// Pin e2e runs to the deterministic oscillator engine so sampled-piano CDN
// fetches do not stall headless playback assertions.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!window.localStorage.getItem("keyspilli.prefs.v1")) {
      window.localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth" }));
    }
  });
});

test("home page shows the catalog", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Play the songs you love/ })).toBeVisible();
  await expect(page.locator("a[href^='/player/']").first()).toBeVisible();
});

test("song library filters by import method", async ({ page }) => {
  await page.goto("/songs");
  await page.getByLabel("Import method", { exact: true }).selectOption("midi");
  await expect(page.getByLabel("Difficulty", { exact: true })).toHaveCount(0);
  await expect(page.locator("a[href^='/player/']").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Beginner level" }).first()).toBeVisible();
  for (const method of ["sheet-music", "youtube", "other", ""]) {
    const response = page.waitForResponse(r => {
      const url = new URL(r.url());
      return url.pathname === "/api/songs" && (url.searchParams.get("importMethod") ?? "") === method;
    });
    await page.getByLabel("Import method", { exact: true }).selectOption(method);
    const result = await response;
    expect(result.status()).toBe(200);
    const body = await result.json();
    await expect(page.getByRole("status")).toHaveText(`${body.songs.length} songs`);
    await expect(page.getByRole("group", { name: /Difficulty levels for/ })).toHaveCount(body.songs.length);
  }
});

test("song library groups difficulty levels into one card per song", async ({ page }) => {
  await page.goto("/songs");
  await page.getByLabel("Sort").selectOption("title");
  await page.getByLabel("Search songs").fill("Vocalise");
  const vocalise = page.getByText("Vocalise № 1", { exact: true });
  await expect(vocalise).toHaveCount(1);
  const levels = page.getByRole("group", { name: /Difficulty levels for Vocalise/ });
  await expect(levels.getByRole("link", { name: "Open Very Beginner level" })).toHaveCount(0);
  await expect(levels.getByRole("link", { name: "Open Beginner level" })).toBeVisible();
  await expect(levels.getByRole("link", { name: "Open Easy level" })).toBeVisible();
  await expect(levels.getByRole("link", { name: "Open Advanced level" })).toBeVisible();
  await expect(levels.getByRole("link", { name: "Open Very Easy level" })).toHaveCount(0);
  await expect(levels.getByRole("link")).toHaveCount(4);
  await expect(levels.getByRole("link")).toHaveText(["B", "E", "M", "A"]);
});

test("explicit Very Easy player URLs keep the legacy level visible", async ({ page }) => {
  await page.goto("/player/f-f-chopin-nocturne-ve");
  const levels = page.getByRole("heading", { name: "Same song, other levels" }).locator("..");
  await expect(levels.getByRole("link", { name: "Very Easy", exact: true })).toBeVisible();
  await expect(levels.getByRole("link", { name: "Easy", exact: true })).toBeVisible();
  await expect(levels.getByRole("link")).toHaveCount(5);
});

test("catalog API reports the full grouped total independently of page size", async ({ request }) => {
  const res = await request.get("/api/songs?group=1&limit=1");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { songs: unknown[]; total: number };
  expect(body.songs).toHaveLength(1);
  expect(body.total).toBeGreaterThan(body.songs.length);
});

test("player loads and switches views", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await expect(page.getByRole("heading", { name: "Nocturne" })).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  // view switcher
  await page.getByRole("button", { name: /View/ }).click();
  await page.getByRole("menuitemradio", { name: /Note letters/ }).click();
  await expect(page.getByLabel("Note letters view")).toBeVisible();
  // lead sheet
  await page.getByRole("button", { name: /View/ }).click();
  await page.getByRole("menuitemradio", { name: /Lead Sheet/ }).click();
  await expect(page.getByLabel("Lead sheet view")).toBeVisible();
  // sheet music via Verovio
  await page.getByRole("button", { name: /View/ }).click();
  await page.getByRole("menuitemradio", { name: /Sheet Music/ }).click();
  await expect(page.locator(".sheet-svg svg").first()).toBeVisible({ timeout: 30_000 });
  const scorePages = page.locator(".sheet-svg__page");
  await expect(scorePages.first()).toBeVisible({ timeout: 30_000 });
  expect(await scorePages.count()).toBeGreaterThan(1);
  expect(await page.evaluate(() => (window as unknown as { __sheetRenderMode?: string }).__sheetRenderMode)).toBe("virtual");
  expect(await page.evaluate(() => (window as unknown as { __sheetRenderer?: string }).__sheetRenderer)).toBe("worker");
  const scoreGeometry = await page.locator(".sheet-svg svg").first().evaluate((svg) => ({
    width: Number.parseFloat(svg.getAttribute("width") ?? "0"),
    height: Number.parseFloat(svg.getAttribute("height") ?? "0"),
    viewBox: svg.getAttribute("viewBox"),
    renderedHeight: svg.getBoundingClientRect().height,
  }));
  expect(scoreGeometry.width).toBeGreaterThan(100);
  expect(scoreGeometry.height).toBeGreaterThan(100);
  expect(scoreGeometry.renderedHeight).toBeGreaterThan(100);
  expect(scoreGeometry.viewBox).toBeTruthy();
  expect(await page.evaluate(() => (window as unknown as { __sheetError?: string }).__sheetError)).toBeFalsy();
});

test("Your Song Sheet Music virtualizes SVG pages and renders the last page on scroll", async ({ page }) => {
  await page.goto(`/player/${UG_SONG}`);
  await page.getByRole("button", { name: /View/ }).click();
  await page.getByRole("menuitemradio", { name: /Sheet Music/ }).click();

  const pages = page.locator(".sheet-svg__page");
  await expect(page.locator(".sheet-svg svg").first()).toBeVisible({ timeout: 30_000 });
  const pageCount = await page.evaluate(() => (window as unknown as { __sheetPageCount?: number }).__sheetPageCount ?? 0);
  expect(pageCount).toBeGreaterThan(1);
  const firstScore = await pages.first().evaluate((element) => ({
    markup: element.innerHTML,
    svgCount: element.querySelectorAll("svg").length,
    height: Math.min(...Array.from(element.querySelectorAll("svg")).map((svg) => svg.getBoundingClientRect().height)),
  }));
  expect(firstScore.svgCount).toBeGreaterThanOrEqual(1);
  expect(firstScore.markup).toMatch(/(?:tie|slur)/i);
  expect(firstScore.markup).toMatch(/(?:staff|measure|note)/i);
  expect(firstScore.height).toBeGreaterThan(100);

  // Page shells preserve the total scroll range, while the virtualizer keeps
  // only a bounded neighborhood of expensive SVG markup attached.
  const lastPage = pages.nth(pageCount - 1);
  await lastPage.scrollIntoViewIfNeeded();
  await expect(lastPage.locator("svg").first()).toBeVisible({ timeout: 30_000 });
  const lastScore = await lastPage.evaluate((element) => {
    const markup = element.innerHTML;
    const svgs = Array.from(element.querySelectorAll("svg"));
    return {
      svgCount: svgs.length,
      // Page-local IDs vary across Verovio builds; the first page assertions
      // above cover notation semantics, while the last-page check verifies
      // that a real rendered SVG (rather than a placeholder) is mounted.
      hasNotationGlyph: /<(?:path|use|text)\b/i.test(markup),
      hasStaffContent: /<(?:g|path|use|text)\b/i.test(markup),
      minHeight: Math.min(...svgs.map((svg) => svg.getBoundingClientRect().height)),
    };
  });
  expect(lastScore.svgCount).toBeGreaterThanOrEqual(1);
  expect(lastScore.hasNotationGlyph).toBe(true);
  expect(lastScore.hasStaffContent).toBe(true);
  expect(lastScore.minHeight).toBeGreaterThan(100);
  const mountedSvgPages = await pages.evaluateAll((elements) => elements.filter((element) => element.querySelector("svg")).length);
  expect(mountedSvgPages).toBeLessThanOrEqual(5);
  expect(await page.evaluate(() => (window as unknown as { __sheetRenderer?: string }).__sheetRenderer)).toBe("worker");
  expect(await page.evaluate(() => (window as unknown as { __sheetError?: string }).__sheetError)).toBeFalsy();
});

test("direct sheet routes start with a metadata shell and load player data on mode switch", async ({ page }) => {
  let detailRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith(`/api/songs/${SONG}`)) detailRequests += 1;
  });

  await page.goto(`/player/${SONG}/sheet`);
  await expect(page.getByRole("heading", { name: "Nocturne" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Player stage — Sheet Music" })).toBeVisible();
  // SheetMusicView only needs the id/XML route; the large player detail is
  // deferred until a control or another view explicitly needs it.
  expect(detailRequests).toBe(0);

  await page.getByRole("button", { name: /View/ }).click();
  await page.getByRole("menuitemradio", { name: /Note letters/ }).click();
  await expect(page.getByLabel("Note letters view")).toBeVisible();
  expect(detailRequests).toBeGreaterThan(0);
});

test("direct sheet RSC payload excludes the large player detail", async ({ page }) => {
  const detailRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().endsWith(`/api/songs/${BRAHMS_SONG}`)) {
      detailRequests.push(request.url());
    }
  });

  const response = await page.goto(`/player/${BRAHMS_SONG}/sheet`);
  expect(response).toBeTruthy();
  const html = (await response!.body()).toString();
  // Production before this round was 1,184,890 decoded bytes for this
  // 69-page fixture and serialized `data.notes` in the RSC flight payload.
  expect(Buffer.byteLength(html)).toBeLessThan(600_000);
  expect(html).not.toContain('\\"data\\":{\\"notes\\":');
  expect(detailRequests).toHaveLength(0);
  await expect(page.locator(".sheet-svg svg").first()).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { __sheetRenderer?: string }).__sheetRenderer)).toBe("worker");
  expect(await page.evaluate(() => (window as unknown as { __sheetPageCount?: number }).__sheetPageCount ?? 0)).toBeGreaterThan(1);
});

test("player controls: loop, tempo, transpose, hands", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await page.locator(".player-loop-controls summary").click();
  await page.getByRole("button", { name: "Enable loop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Clear loop", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Decrease speed" }).click();
  await expect(page.getByText("90%")).toBeVisible();
  await page.getByRole("button", { name: "Right hand", exact: true }).click();
  await page.getByRole("button", { name: "Both hands", exact: true }).click();
  // seek bar + spacebar play/pause
  const seek = page.getByRole("slider", { name: "Seek" });
  await expect(seek).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Space");
  await expect(page.getByText("Playing — click anywhere to pause")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByText("Playing — click anywhere to pause")).not.toBeVisible();
});

test("chord mode distinguishes strict UG coverage from hybrid Auto", async ({ page }) => {
  await page.goto(`/player/${UG_SONG}`);
  await openPlayerTool(page, "Sound");
  const dialog = page.getByRole("dialog", { name: "Sound settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: "Chord mode" }).click();
  await openAdvancedArrangementControls(page);
  await expect(dialog.getByText("Chord source")).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "UG timeline" })).toBeEnabled();
  await dialog.getByRole("radio", { name: "UG timeline" }).click();
  await dialog.getByRole("button", { name: "Close tools" }).click();
  await expect(page.locator('[role="dialog"][aria-label="Sound settings"]')).toHaveCount(0);
  await expect(page.getByTestId("chord-mode-status")).toHaveText("UG opening (partial)");

  await openPlayerTool(page, "Sound");
  const hybridDialog = page.getByRole("dialog", { name: "Sound settings" });
  await openAdvancedArrangementControls(page);
  await hybridDialog.getByRole("radio", { name: "Auto", exact: true }).click();
  await hybridDialog.getByRole("button", { name: "Close tools" }).click();
  await expect(page.getByTestId("chord-mode-status")).toHaveText("UG + generated fallback");
});

test("chord styles persist across source changes, seeking, guidance, and mobile keyboard navigation", async ({ page }) => {
  await page.goto(`/player/${UG_SONG}`);
  await openPlayerTool(page, "Sound");
  let dialog = page.getByRole("dialog", { name: "Sound settings" });
  await dialog.getByRole("radio", { name: "Chord mode" }).click();
  await openAdvancedArrangementControls(page);
  const styles = dialog.getByRole("radiogroup", { name: "Accompaniment style" });
  await expect(styles.getByRole("radio", { name: "Bass + chords" })).toHaveAttribute("aria-checked", "true");
  await expect(dialog).toContainText("Backing only");
  await styles.getByRole("radio", { name: "Melody + accompaniment" }).click();
  await expect(styles.getByRole("radio", { name: "Melody + accompaniment" })).toHaveAttribute("aria-checked", "true");
  await expect(dialog).toContainText("Original passage is retained");
  await dialog.getByRole("radio", { name: "UG timeline" }).click();
  await dialog.getByRole("button", { name: "Close tools" }).click();
  await expect(page.getByTestId("chord-mode-status")).toHaveText("UG opening (partial)");

  await page.getByRole("slider", { name: "Seek" }).fill("1");
  await openPlayerTool(page, "Sound");
  dialog = page.getByRole("dialog", { name: "Sound settings" });
  await openAdvancedArrangementControls(page);
  await dialog.getByRole("radio", { name: "Bass + chords" }).click();
  await dialog.getByRole("radio", { name: "Generated" }).click();
  await dialog.getByRole("button", { name: "Close tools" }).click();
  await page.reload();
  await openPlayerTool(page, "Sound");
  dialog = page.getByRole("dialog", { name: "Sound settings" });
  await openAdvancedArrangementControls(page);
  await expect(dialog.getByRole("radio", { name: "Bass + chords" })).toHaveAttribute("aria-checked", "true");
  await expect(dialog.getByRole("radio", { name: "Generated" })).toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("button", { name: "Close tools" }).click();

  await page.getByRole("button", { name: /View/ }).click();
  await page.getByRole("menuitemradio", { name: /Note letters/ }).click();
  await expect(page.getByLabel("Note letters view")).toBeVisible();
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByRole("button", { name: "Chord practice", exact: true }).click();
  const practice = page.getByTestId("chord-practice-panel");
  await expect(practice.getByRole("heading", { name: "Find the chord tones" })).toBeVisible();
  await expect(practice).toContainText("Hand labels are suggested, not measured performance");
  await practice.getByRole("button", { name: "Close", exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole("button", { name: "Tools", exact: true }).focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog", { name: "Display settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Sound", exact: true }).focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog", { name: "Sound settings" });
  await dialog.getByRole("radio", { name: "Melody + accompaniment" }).focus();
  await page.keyboard.press("Space");
  await expect(dialog.getByRole("radio", { name: "Melody + accompaniment" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".player-page")).toHaveJSProperty("clientWidth", 390);
});

test("wait practice shows the chord and keeps its onset until the other notes are played", async ({ page }) => {
  await page.goto(`/player/${UG_SONG}`);
  await openPlayerTool(page, "Sound");
  const dialog = page.getByRole("dialog", { name: "Sound settings" });
  await dialog.getByRole("radio", { name: "Chord mode" }).click();
  await openAdvancedArrangementControls(page);
  await dialog.getByRole("radio", { name: "Bass + chords" }).click();
  await dialog.getByRole("radio", { name: "Generated" }).click();
  await dialog.getByRole("radio", { name: "Synth Piano" }).click();
  await dialog.getByRole("button", { name: "Close tools" }).click();

  const seek = page.getByRole("slider", { name: "Seek" });
  await seek.fill("0.4");
  await page.getByRole("button", { name: "Right hand", exact: true }).click();
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByLabel("Behavior", { exact: true }).selectOption("wait");
  await page.getByLabel("Passage", { exact: true }).selectOption("current");
  await page.getByRole("button", { name: "Start practice", exact: true }).click();

  const grading = page.getByRole("region", { name: "Practice grading" });
  await expect(grading).toContainText("Play: A#4 (right hand)");
  await expect(grading).toContainText("D#5 (right hand)");
  await expect(seek).toHaveValue("0.4");
  await page.keyboard.press("u");
  await expect(grading).toContainText("Play: D#5 (right hand)");
  await expect.poll(async () => Number(await seek.inputValue())).toBeLessThan(1);
  await page.getByRole("button", { name: "Finish practice", exact: true }).click();
});

test("Chords opens a short Wait exercise from the selected bar", async ({ page }) => {
  await page.goto(`/player/${process.env.KEYSPILLI_PRACTICE_E2E_SONG ?? UG_SONG}`);
  await openPlayerTool(page, "Sound");
  const sound = page.getByRole("dialog", { name: "Sound settings" });
  await sound.getByRole("radio", { name: "Chord mode" }).click();
  await sound.getByRole("button", { name: "Close tools" }).click();
  const bar = page.getByRole("spinbutton", { name: "Bar", exact: true });
  await bar.fill("3");
  await bar.press("Enter");
  const startTime = await page.getByRole("slider", { name: "Seek" }).inputValue();

  await page.getByRole("button", { name: "Practice", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Set up practice" });
  await expect(setup.getByRole("combobox", { name: "Behavior" })).toHaveValue("wait");
  await expect(setup.getByRole("combobox", { name: "Passage" })).toHaveValue("bars");
  await expect(setup.getByRole("option", { name: "Current 4 bars" })).toBeAttached();
  await setup.getByRole("button", { name: "Start practice" }).click();
  await expect(page.getByRole("region", { name: "Practice grading" })).toContainText("Wait for notes");
  await expect(page.getByRole("slider", { name: "Seek" })).toHaveValue(startTime);
  await page.getByRole("button", { name: "Finish practice" }).click();
  await page.locator(".player-loop-controls summary").click();
  await page.getByRole("button", { name: "Loop current bar" }).click();
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Set up practice" }).getByRole("combobox", { name: "Passage" })).toHaveValue("loop");
});

test("practice mode starts and exits cleanly", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByRole("button", { name: "Start practice", exact: true }).click();
  await expect(page.getByRole("region", { name: "Practice grading" })).toBeVisible();
  await page.getByRole("button", { name: "Finish practice", exact: true }).click();
  await page.getByRole("button", { name: "Dismiss result", exact: true }).click();
  await expect(page.getByRole("region", { name: "Practice grading" })).not.toBeVisible();
});

test("chord practice shows a compact target and advances by chord", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByRole("button", { name: "Chord practice", exact: true }).click();
  const panel = page.getByTestId("chord-practice-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Find the chord tones" })).toBeVisible();
  await expect(panel.getByLabel("Target notes")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Hear chord" })).toBeVisible();
  await panel.getByRole("button", { name: "Skip" }).click();
  await expect(panel.getByText(/Chord 2 of/)).toBeVisible();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel).not.toBeVisible();
});

test("changing hand while learning chord tones replaces stale targets", async ({ page }) => {
  await page.goto(`/player/${UG_SONG}`);
  await openPlayerTool(page, "Sound");
  const sound = page.getByRole("dialog", { name: "Sound settings" });
  await sound.getByRole("radio", { name: "Chord mode" }).click();
  await openAdvancedArrangementControls(page);
  await sound.getByRole("radio", { name: "Bass + chords" }).click();
  await sound.getByRole("radio", { name: "Generated" }).click();
  await sound.getByRole("button", { name: "Close tools" }).click();
  await page.getByRole("button", { name: "Practice", exact: true }).click();
  await page.getByRole("button", { name: "Chord practice", exact: true }).click();
  const panel = page.getByTestId("chord-practice-panel");
  await expect(panel.getByLabel("Target notes")).toContainText("RH");
  await panel.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Left hand", exact: true }).click();
  await expect(panel.getByLabel("Target notes")).not.toContainText("RH");
  await expect(panel).toContainText("Chord 1 of");
  await expect(panel).toContainText("restarted for the selected hand");
});

test("download dialog offers free exports", async ({ page }) => {
  await page.goto(`/player/${SONG}`);
  await page.getByRole("button", { name: /Download sheet music and MIDI/ }).click();
  await expect(page.getByRole("dialog", { name: /Download sheet music or MIDI/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /MIDI/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Simplify PDF/ })).toBeVisible();
});

test("MIDI export returns a file", async ({ request }) => {
  const res = await request.get(`/api/song/${SONG}/export?type=midi`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("audio/midi");
});

test("simplify PDF export generates a PDF", async ({ request }) => {
  const res = await request.get(`/api/song/${SONG}/export?type=pdf&layout=simplify`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  const body = await res.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
});

test("classic PDF export renders engraved score", async ({ request }) => {
  const res = await request.get(`/api/song/${SONG}/export?type=pdf&layout=classic`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  const body = await res.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
});

test("Your Song PDF export works for both layouts", async ({ request }) => {
  for (const layout of ["simplify", "classic"] as const) {
    const res = await request.get(`/api/song/${UG_SONG}/export?type=pdf&layout=${layout}`);
    expect(res.status(), `${layout} PDF status`).toBe(200);
    expect(res.headers()["content-type"], `${layout} PDF content type`).toContain("application/pdf");
    const body = await res.body();
    expect(body.byteLength, `${layout} PDF size`).toBeGreaterThan(1000);
    expect(body.subarray(0, 5).toString(), `${layout} PDF header`).toBe("%PDF-");
  }
});

test("PDF export rejects unknown layouts with a stable safe error", async ({ request }) => {
  const res = await request.get(`/api/song/${SONG}/export?type=pdf&layout=unknown`);
  expect(res.status()).toBe(400);
  await expect(res.json()).resolves.toEqual({ error: "unknown PDF layout" });
});

test("upload flow creates a playable song", async ({ request }) => {
  const fs = await import("node:fs");
  const buf = fs.readFileSync(join(seedMidiDir(), "f-abt-vocalise-o-1.mid"));
  const res = await request.post("/api/uploads?title=Upload Test&artist=Keyspilli", {
    data: buf,
    headers: { authorization: "Bearer test-token-for-e2e" },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { songIds: string[] };
  expect(body.songIds.length).toBe(6);
});

test("uploads page shows the wizard", async ({ page }) => {
  await page.goto("/uploads");
  await expect(page.getByText("Drop your .mid, .midi, .musicxml or .mxl here")).toBeVisible();
});
