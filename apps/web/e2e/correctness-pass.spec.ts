import { expect, test } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceSongsByBase, type SongRow } from "../../../packages/catalog/src/db";
import type { PlayerDetail } from "../src/components/player/Player";

const token = { Authorization: "Bearer test-token-for-e2e" };
const xml = (minor = false) => `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>${minor ? -3 : 0}</fifths><mode>${minor ? "minor" : "major"}</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${Array.from({ length: 16 }, () => '<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>').join("")}</measure></part></score-partwise>`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth", hand: "both" })));
});

test("minor-key filters survive reload and reach the exact catalog query", async ({ page, request }) => {
  const created = await request.post("/api/uploads?title=Minor%20key%20fixture&artist=Authored%20Test", {
    headers: { ...token, "Content-Type": "application/xml" }, data: Buffer.from(xml(true)),
  });
  expect(created.ok(), await created.text()).toBe(true);
  const receipt = await created.json();
  try {
    const id = receipt.songIds.find((value: string) => value.endsWith("-a"));
    const detail = await (await request.get(`/api/songs/${id}`)).json();
    const metadata = await request.patch(`/api/songs/${id}`, { headers: token, data: { expectedRevision: detail.publicationRevision, key: "Cm" } });
    expect(metadata.ok(), await metadata.text()).toBe(true);
    await page.goto("/songs?key=Cm");
    await expect(page.getByRole("combobox", { name: "Key", exact: true })).toHaveValue("Cm");
    await expect(page.locator(".library-toolbar").getByRole("status")).toHaveText("1 of 1 songs");
    await expect(page.getByRole("link", { name: "Minor key fixture", exact: true })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/key=Cm/);
    await expect(page.locator(".library-toolbar").getByRole("status")).toHaveText("1 of 1 songs");
    await page.getByRole("combobox", { name: "Key", exact: true }).selectOption("C");
    await expect(page.getByRole("link", { name: "Minor key fixture", exact: true })).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole("combobox", { name: "Key", exact: true })).toHaveValue("Cm");
    await expect(page.locator(".library-toolbar").getByRole("status")).toHaveText("1 of 1 songs");
  } finally {
    expect((await request.delete(`/api/songs/${receipt.baseId}`, { headers: token })).ok()).toBe(true);
  }
});

test("returning from a reloaded player restores the library filters, page and scroll", async ({ page, request }) => {
  const created = await request.post("/api/uploads?title=roadmap-075%20Return%20fixture&artist=Roadmap%20Fixture", {
    headers: { ...token, "Content-Type": "application/xml" }, data: Buffer.from(xml()),
  });
  expect(created.ok(), await created.text()).toBe(true);
  const receipt = await created.json();
  const id: string = receipt.songIds.find((value: string) => value.endsWith("-a"));
  try {
    await page.goto("/songs?q=roadmap&key=C&sort=title&page=2");
    await expect(page.locator(".library-toolbar").getByRole("status")).toHaveText("60 of 251 songs");
    const lesson = page.locator(`.library-results [role="group"] a[href="/player/${id}"]`);
    await lesson.scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => window.scrollY);
    expect(scroll).toBeGreaterThan(0);
    await lesson.click();
    await expect(page.getByRole("heading", { name: "roadmap-075 Return fixture", exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("link", { name: "Easy", exact: true }).click();
    await expect(page).toHaveURL(/-e/);
    await page.reload();
    await page.getByRole("link", { name: "Return to library", exact: true }).click();
    await expect(page).toHaveURL(/\/songs\?/);
    await expect(page.locator(".library-toolbar").getByRole("status")).toHaveText("60 of 251 songs");
    await expect(page.getByLabel("Search songs")).toHaveValue("roadmap");
    await expect(page.getByLabel("Key", { exact: true })).toHaveValue("C");
    await expect(page.getByLabel("Sort", { exact: true })).toHaveValue("title");
    expect(new URL(page.url()).searchParams.get("page")).toBe("2");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(scroll, 0);
  } finally {
    expect((await request.delete(`/api/songs/${receipt.baseId}`, { headers: token })).ok()).toBe(true);
  }
});

test("unknown MIDI hardware range is reported without a false confirmed zero or a new practice block", async ({ page, request }, testInfo) => {
  const created = await request.post("/api/uploads?title=Unknown%20range%20fixture&artist=Authored%20Test", {
    headers: { ...token, "Content-Type": "application/xml" }, data: Buffer.from(xml()),
  });
  expect(created.ok(), await created.text()).toBe(true);
  const receipt = await created.json();
  try {
    await page.addInitScript(() => {
      const input = { id: "unknown-range", name: "Synthetic MIDI keyboard", state: "connected", onmidimessage: null };
      Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: async () => ({ inputs: new Map([[input.id, input]]), onstatechange: null }) });
    });
    await page.goto(`/player/${receipt.songIds.find((id: string) => id.endsWith("-a"))}/falling`);
    await page.getByRole("button", { name: "Input", exact: true }).click();
    await page.getByRole("button", { name: "Connect MIDI", exact: true }).click();
    await page.getByRole("button", { name: "Close tools", exact: true }).click();
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Set up practice" });
    await expect(dialog.getByLabel("Practice target reachability")).not.toContainText("physical");
    await dialog.getByLabel("Input", { exact: true }).selectOption("midi");
    await expect(dialog.getByLabel("Practice target reachability")).toContainText("Physical keyboard range not confirmed.");
    await expect(dialog.getByRole("button", { name: "Start practice", exact: true })).toBeEnabled();
    await expect(dialog).toHaveCSS("opacity", "1");
    await page.screenshot({ path: testInfo.outputPath("unknown-range.png") });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    expect((await request.delete(`/api/songs/${receipt.baseId}`, { headers: token })).ok()).toBe(true);
  }
});

test.describe("linked version correctness", () => {
  const bases = ["correctness-original", "correctness-b", "correctness-c"];
  let scratch: string;
  test.beforeAll(async () => {
    const configured = process.env.KEYSPILLI_E2E_SCRATCH_DIR;
    if (!configured || !realpathSync(configured).startsWith(join(realpathSync(tmpdir()), "keyspilli-web-e2e-"))) {
      throw new Error("Correctness fixtures require the isolated roadmap scratch catalog.");
    }
    scratch = configured;
    for (const [index, baseId] of bases.entries()) {
      const row: SongRow = {
        id: baseId + "-a", baseId, title: "Correctness " + (index === 0 ? "Original" : index === 1 ? "B" : "C"),
        artist: "Synthetic fixture", category: "Test", difficulty: "advanced", difficultyScore: 4, key: "C", tempo: 120,
        style: "classical", mood: "peaceful", bassPattern: "block", duration: 8, contentType: "youtube", acquiredVia: "youtube",
        sourceYoutubeUrl: "https://www.youtube.com/watch?v=00000000000", hasSheetXml: 0, sections: null, plays: 0, level: "a",
        createdAt: "2026-10-12T00:00:00Z",
      };
      await mkdir(join(scratch, "artifacts", baseId, "a"), { recursive: true });
      await writeFile(join(scratch, "artifacts", baseId, "a", "notes.json"), JSON.stringify({
        notes: [{ midi: 60 + index, start: 0, dur: 1, vel: 80, hand: "R" }], chords: [],
        measures: [{ index: 0, startBeat: 0, endBeat: 16 }], key: "C", tempoBpm: 120, timeSig: [4, 4],
      }));
      if (index) await writeFile(join(scratch, "artifacts", baseId, "review-provenance.json"), JSON.stringify({
        sourceBaseId: bases[0], version: index === 1 ? "B" : "C",
      }));
      replaceSongsByBase(baseId, [row]);
    }
  });
  test.afterAll(async () => {
    if (!scratch) return;
    for (const baseId of bases) {
      replaceSongsByBase(baseId, []);
      await rm(join(scratch, "artifacts", baseId), { recursive: true, force: true });
    }
  });

  test("a stalled version request times out independently of fetch, retains settings and ignores its late result", async ({ page, request }) => {
    const delayed: PlayerDetail = await (await request.get("/api/songs/correctness-b-a")).json();
    await page.goto("/player/correctness-original-a");
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "75%", exact: true }).click();
    await page.getByRole("button", { name: "Right hand", exact: true }).click();
    await page.evaluate(body => {
      const nativeFetch = window.fetch;
      let hold = true;
      window.fetch = (input, init) => {
        if (hold && input === "/api/songs/correctness-b-a") {
          hold = false;
          return new Promise<Response>(resolve => {
            // Deliberately ignore abort to prove pending state is released even for a stuck transport.
            (window as unknown as { releaseDelayedVersion: () => void }).releaseDelayedVersion = () => resolve(
              new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
            );
          });
        }
        return nativeFetch(input, init);
      };
    }, delayed);
    await page.clock.install();
    await page.getByRole("combobox", { name: "Version", exact: true }).selectOption({ label: "B" });
    await expect(page.getByRole("status").filter({ hasText: "Loading version" })).toBeVisible();
    await page.clock.fastForward(15_001);
    await expect(page.getByRole("alert").filter({ hasText: "Loading this version timed out" })).toBeVisible();
    const selector = page.getByRole("combobox", { name: "Version", exact: true });
    await expect(selector).toBeEnabled();
    await expect(selector).toBeFocused();
    await expect(page.getByRole("heading", { name: "Correctness Original", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "75%", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Right hand", exact: true })).toHaveAttribute("aria-pressed", "true");
    await selector.selectOption({ label: "B" });
    await expect(page.getByRole("heading", { name: "Correctness B", exact: true })).toBeVisible();
    await selector.selectOption({ label: "C" });
    await expect(page.getByRole("heading", { name: "Correctness C", exact: true })).toBeVisible();
    await page.evaluate(() => (window as unknown as { releaseDelayedVersion: () => void }).releaseDelayedVersion());
    await expect(page.getByRole("heading", { name: "Correctness C", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/correctness-c-a/);
  });

  test("version and sheet switches retain library return context and name the selected saved export", async ({ page }, testInfo) => {
    await page.goto("/songs?q=Correctness&sort=title");
    await expect(page.locator(".library-toolbar").getByRole("status")).toHaveText("3 of 3 songs");
    await page.locator('.library-results [role="group"] a[href="/player/correctness-original-a"]').click();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    await page.getByRole("combobox", { name: "Version", exact: true }).selectOption({ label: "B" });
    await expect(page.getByRole("heading", { name: "Correctness B", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Download sheet music and MIDI" }).click();
    const download = page.getByRole("dialog", { name: "Download sheet music or MIDI" });
    await expect(download.getByRole("option", { name: "Saved version B", exact: true })).toHaveCount(1);
    await expect(download.getByRole("option", { name: "Current playback arrangement", exact: true })).toHaveAttribute("disabled", "");
    await expect(download).toHaveCSS("opacity", "1");
    await page.screenshot({ path: testInfo.outputPath("saved-version-export.png") });
    await download.getByRole("button", { name: "Done", exact: true }).click();
    await page.goto("/player/correctness-b-a/sheet");
    await page.getByRole("button", { name: "Download sheet music and MIDI" }).click();
    await expect(download.getByRole("option", { name: "Saved version B", exact: true })).toHaveCount(1);
    await download.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("link", { name: "Return to library", exact: true })).toHaveAttribute("href", "/songs?q=Correctness&sort=title");
    await page.getByRole("link", { name: "Return to library", exact: true }).click();
    await expect(page).toHaveURL(/\/songs\?q=Correctness&sort=title$/);
    await expect(page.locator(".library-toolbar").getByRole("status")).toHaveText("3 of 3 songs");
    await expect(page.getByLabel("Search songs")).toHaveValue("Correctness");
    await page.goto("/player/correctness-c-a/sheet");
    await expect(page.getByRole("link", { name: "Return to library", exact: true })).toHaveAttribute("href", "/songs");
  });
});
