import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { KEYMAP } from "../../../packages/player-core/src/input";
import { createMicrophoneProbe, installSyntheticPlayerMicrophone } from "./microphone-probe";
import { createTransportProbe, installOwnerAudioProbe } from "./transport-probe";

const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${["C", "D", "E", "F", "G", "A", "B", "C"].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`).join("")}</measure></part></score-partwise>`;

test.describe("microphone capture lifecycle", () => {
  let probe: Awaited<ReturnType<typeof createMicrophoneProbe>>;
  test.beforeAll(async () => { probe = await createMicrophoneProbe(); });
  test.afterAll(async () => { await probe.close(); });
  test.beforeEach(async ({page}) => {
    await page.goto(probe.origin);
    await expect.poll(() => page.evaluate(() => window.__keyspilliMicrophoneProbe.snapshot().mounted)).toBe(true);
  });
  test.afterEach(async ({page}, info) => {
    if (page.isClosed()) return;
    await info.attach("capture-resource-state", {body: JSON.stringify(await page.evaluate(() => window.__keyspilliMicrophoneProbe.snapshot())), contentType: "application/json"});
    await page.evaluate(() => window.__keyspilliMicrophoneProbe.dispose());
  });

  test("synthetic A4 is detected and repeated release/disconnection closes capture", async ({page}) => {
    await page.getByRole("button", {name: "Enable synthetic microphone", exact: true}).click();
    await expect(page.getByLabel("Capture status")).toContainText("Ready");
    await expect.poll(() => page.evaluate(() => window.__keyspilliMicrophoneProbe.snapshot().pitches)).toContain(69);
    await page.getByRole("button", {name: "Release microphone", exact: true}).click();
    await page.getByRole("button", {name: "Release microphone", exact: true}).click();
    await expect.poll(() => page.evaluate(() => window.__keyspilliMicrophoneProbe.snapshot().contexts.every(state => state === "closed"))).toBe(true);
    expect(await page.evaluate(() => window.__keyspilliMicrophoneProbe.snapshot().tracks)).toEqual(["ended"]);
    await page.getByRole("button", {name: "Enable synthetic microphone", exact: true}).click();
    await expect(page.getByLabel("Capture status")).toContainText("Ready");
    await page.evaluate(() => window.__keyspilliMicrophoneProbe.endTrack());
    await expect(page.getByLabel("Capture status")).toContainText("Microphone disconnected");
    await expect.poll(() => page.evaluate(() => window.__keyspilliMicrophoneProbe.snapshot().contexts.every(state => state === "closed"))).toBe(true);
    expect(await page.evaluate(() => window.__keyspilliMicrophoneProbe.snapshot().tracks)).toEqual(["ended", "ended"]);
    expect(await page.evaluate(() => window.__keyspilliMicrophoneProbe.snapshot().disconnects)).toBe(1);
  });

  for (const unmount of [false, true]) {
    test(`pending synthetic permission is released after ${unmount ? "unmount" : "cancellation"}`, async ({page}) => {
      await page.evaluate(() => { window.__keyspilliMicrophoneProbe.holdPermission = true; });
      await page.getByRole("button", {name: "Enable synthetic microphone", exact: true}).click();
      await expect(page.getByLabel("Capture status")).toContainText("Pending");
      await expect.poll(() => page.evaluate(() => window.__keyspilliMicrophoneProbe.snapshot().tracks.length)).toBe(1);
      await page.getByRole("button", {name: unmount ? "Unmount microphone owner" : "Release microphone", exact: true}).click();
      await page.evaluate(async () => { const state = window.__keyspilliMicrophoneProbe; state.releasePermission(); await state.requestDone; });
      const state = await page.evaluate(() => window.__keyspilliMicrophoneProbe.snapshot());
      expect(state.tracks).toEqual(["ended"]);
      expect(state.contexts).toEqual([]);
      expect(state.pitches).toEqual([]);
      expect(state.mounted).toBe(!unmount);
    });
  }

  test("unmount during capture setup releases the awaited cleanup handoff", async ({page}) => {
    await page.evaluate(() => { window.__keyspilliMicrophoneProbe.unmountOnContext = true; });
    await page.getByRole("button", {name: "Enable synthetic microphone", exact: true}).click();
    await page.evaluate(() => window.__keyspilliMicrophoneProbe.requestDone);
    const state = await page.evaluate(() => window.__keyspilliMicrophoneProbe.snapshot());
    expect(state.mounted).toBe(false);
    expect(state.tracks).toEqual(["ended"]);
    await expect.poll(() => page.evaluate(() => window.__keyspilliMicrophoneProbe.snapshot().contexts)).toEqual(["closed"]);
  });
});

test("Player opts into synthetic capture and releases it on input changes and setup cancellation", async ({page, request}) => {
  const headers = {Authorization: "Bearer test-token-for-e2e", "Content-Type": "application/xml"};
  const uploaded = await request.post("/api/uploads?title=Microphone%20Fixture&artist=Authored", {headers, data: Buffer.from(xml)});
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const receipt = await uploaded.json(), id = receipt.songIds.find((value: string) => value.endsWith("-a"));
  await page.addInitScript(installSyntheticPlayerMicrophone);
  await page.addInitScript(() => localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({soundSource: "synth"})));
  try {
    await page.goto(`/player/${id}/beginner`);
    expect(await page.evaluate(() => window.__keyspilliPlayerMicrophone.snapshot().tracks)).toEqual([]);
    await page.getByRole("button", {name: "Practice", exact: true}).click();
    const dialog = page.getByRole("dialog", {name: "Set up practice"});
    await dialog.getByLabel("Input", {exact: true}).selectOption("microphone");
    expect(await page.evaluate(() => window.__keyspilliPlayerMicrophone.snapshot().tracks)).toEqual([]);
    await dialog.getByRole("button", {name: "Enable microphone", exact: true}).click();
    await expect(dialog.getByRole("button", {name: "Microphone ready", exact: true})).toBeVisible();
    await expect(dialog.getByRole("status")).toContainText("Single pitch detected (beta)");
    await dialog.getByLabel("Input", {exact: true}).selectOption("keyboard");
    expect(await page.evaluate(() => window.__keyspilliPlayerMicrophone.snapshot().tracks)).toEqual(["ended"]);
    await expect.poll(() => page.evaluate(() => window.__keyspilliPlayerMicrophone.snapshot().contexts)).toEqual(["closed"]);
    await dialog.getByLabel("Input", {exact: true}).selectOption("microphone");
    await dialog.getByRole("button", {name: "Enable microphone", exact: true}).click();
    await expect(dialog.getByRole("button", {name: "Microphone ready", exact: true})).toBeVisible();
    await dialog.getByRole("button", {name: "Cancel", exact: true}).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.__keyspilliPlayerMicrophone.snapshot().tracks)).toEqual(["ended", "ended"]);
    await expect.poll(() => page.evaluate(() => window.__keyspilliPlayerMicrophone.snapshot().contexts)).toEqual(["closed", "closed"]);
  } finally {
    if (!page.isClosed()) await page.evaluate(() => window.__keyspilliPlayerMicrophone?.dispose());
    expect((await request.delete(`/api/songs/${receipt.baseId}`, {headers})).ok()).toBe(true);
  }
});

test("speed changes preserve musical position and optional lesson tools leave room for the piano", async ({ page, request }) => {
  const longXml = xml.replace(/<measure number="1">([\s\S]*?)<\/measure>/, (_, contents) =>
    Array.from({ length: 16 }, (_, index) => `<measure number="${index + 1}">${contents}</measure>`).join(""));
  const headers = { Authorization: "Bearer test-token-for-e2e", "Content-Type": "application/xml" };
  const uploaded = await request.post("/api/uploads?title=Transport%20Space%20Fixture&artist=Authored", { headers, data: Buffer.from(longXml) });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const receipt = await uploaded.json(), id = receipt.songIds.find((value: string) => value.endsWith("-a"));
  await page.addInitScript(() => localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth" })));
  try {
    await page.goto(`/player/${id}`);
    const seek = page.getByRole("slider", { name: "Seek", exact: true });
    await seek.fill("20");
    const bar = (await seek.getAttribute("aria-valuetext"))!.split(",")[0];
    await page.getByRole("button", { name: "50%", exact: true }).click();
    await expect(seek).toHaveValue("40");
    await expect(seek).toHaveAttribute("aria-valuetext", new RegExp(`^${bar}`));
    await page.getByRole("button", { name: "100%", exact: true }).click();
    await expect(seek).toHaveValue("20");
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1740, height: 1370 }, { width: 428, height: 700 }, { width: 926, height: 320 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => scrollTo(0, 0));
      const keyboard = page.getByRole("button", { name: "Piano keyboard", exact: true });
      await expect.poll(async () => { const box = await keyboard.boundingBox(); return box ? box.y + box.height : Infinity; }).toBeLessThanOrEqual(viewport.height);
      await expect.poll(async () => (await page.locator(".falling-canvas").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(viewport.height * 0.48);
      await page.getByRole("button", { name: "Focus", exact: true }).click();
      await expect(page.getByLabel("Saved passages and practice history")).toBeHidden();
      const canvas = page.getByLabel("Falling notes player");
      await expect.poll(async () => { const box = await canvas.boundingBox(); return box ? box.y + box.height : Infinity; }).toBeLessThanOrEqual(viewport.height);
      await page.getByRole("button", { name: "Exit focus", exact: true }).click();
      await expect(page.getByLabel("Saved passages and practice history")).toBeVisible();
    }
  } finally { expect((await request.delete(`/api/songs/${receipt.baseId}`, { headers })).ok()).toBe(true); }
});

test("version-bound passages reload and cancelled/completed/interrupted runs stay distinct", async ({ page, request }) => {
  const uploaded = await request.post("/api/uploads?title=Roadmap%20Practice%20Fixture&artist=Authored%20Test", {
    headers: { Authorization: "Bearer test-token-for-e2e", "Content-Type": "application/xml" }, data: Buffer.from(xml),
  });
  expect(uploaded.status(), await uploaded.text()).toBe(200);
  const { baseId, songIds } = await uploaded.json();
  const id = songIds.find((songId: string) => songId.endsWith("-a"));
  expect(id).toBeDefined();
  try {
    await page.addInitScript(() => {
      localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({ soundSource: "synth", hand: "R" }));
      const NativeContext = window.AudioContext;
      const state = window as unknown as { __practiceContexts: AudioContext[] };
      state.__practiceContexts = [];
      window.AudioContext = class extends NativeContext { constructor(options?: AudioContextOptions) { super(options); state.__practiceContexts.push(this); } };
    });
    await page.goto(`/player/${id}/beginner`);
    await page.locator(".player-loop-controls > summary").click();
    await page.getByRole("button", { name: "Loop current bar", exact: true }).click();
    await page.locator(".player-loop-controls > summary").click();
    const workspace = page.locator('details[aria-label="Saved passages and practice history"]');
    await workspace.locator(":scope > summary").click();
    await workspace.getByLabel("Passage name").fill("First phrase");
    await workspace.getByLabel("Practice note").fill("Relax between notes");
    await expect(workspace.getByRole("button", { name: "Save selected loop" })).toBeEnabled();
    await workspace.getByRole("button", { name: "Save selected loop" }).click();
    const sets = workspace.locator('details[aria-label="Owner practice sets"]');
    await sets.locator(":scope > summary").click();
    await sets.getByLabel("New practice set").fill("Daily Fixture");
    await sets.getByRole("button", { name: "Create set", exact: true }).click();
    const passageId = await page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).passages[0].id);
    await sets.getByLabel("Practice set passage").selectOption(passageId);
    await sets.getByRole("button", { name: "Add chosen arrangement" }).click();
    await sets.getByLabel("Practice set passage").selectOption("");
    await sets.getByRole("button", { name: "Add chosen arrangement" }).click();
    await expect(sets.locator("[data-set-item]")).toHaveCount(2);
    await sets.getByRole("button", { name: "Move Roadmap Practice Fixture up", exact: true }).nth(1).press("Enter");
    await sets.getByLabel("Manually completed Roadmap Practice Fixture").first().check();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice-sets.v1")!).sets[0].items.map((item: { passageId?: string; completed: boolean }) => [item.passageId ?? null, item.completed]))).toEqual([[null,true],[passageId,false]]);
    await expect(sets.getByRole("link", { name: "Next unfinished item" })).toHaveAttribute("href", `/player/${id}?passage=${passageId}`);
    await page.evaluate(() => { const state = JSON.parse(localStorage.getItem("keyspilli.practice-sets.v1")!); state.sets[0].items.push({id:"missing",baseId:"missing-owner",variantId:"missing-owner-level",completed:false}); localStorage.setItem("keyspilli.practice-sets.v1",JSON.stringify(state)); window.dispatchEvent(new Event("keyspilli-practice-sets")); });
    await expect(sets.getByText("missing-owner-level · Unavailable; original reference retained", { exact: true })).toBeVisible();

    await page.reload();
    await workspace.locator(":scope > summary").click();
    await expect(workspace.getByText("Relax between notes")).toBeVisible();
    await workspace.getByRole("button", { name: "Select First phrase", exact: true }).click();
    await workspace.getByLabel("Passage name").fill("Same range, different name");
    await workspace.getByRole("button", { name: "Save selected loop" }).click();
    await workspace.getByRole("button", { name: "Select First phrase", exact: true }).click();
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Set up practice" });
    await dialog.getByLabel("Passage", { exact: true }).selectOption("loop");
    await dialog.getByLabel("Behavior").selectOption("wait");
    await dialog.getByLabel("Count-in", { exact: true }).selectOption("4");
    await dialog.getByRole("button", { name: "Start practice", exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).resume.passageId)).toBe(passageId);
    await page.getByRole("button", { name: "Cancel count-in", exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).attempts[0].outcome)).toBe("cancelled");
    await workspace.getByRole("button", { name: "Delete Same range, different name", exact: true }).click();
    await workspace.getByLabel("Passage name").fill("Just saved");
    await workspace.getByRole("button", { name: "Save selected loop" }).click();
    const justSavedId = await page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).passages[1].id);
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Set up practice" });
    await dialog.getByLabel("Passage", { exact: true }).selectOption("loop");
    await dialog.getByLabel("Count-in", { exact: true }).selectOption("4");
    await dialog.getByRole("button", { name: "Start practice", exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).resume.passageId)).toBe(justSavedId);
    await page.getByRole("button", { name: "Cancel count-in", exact: true }).click();
    await workspace.getByRole("button", { name: "Delete Just saved", exact: true }).click();
    await workspace.getByRole("button", { name: "Select First phrase", exact: true }).click();
    await page.evaluate(() => { const state = JSON.parse(localStorage.getItem("keyspilli.practice.v1")!); state.passages[0].startBeat = .5; localStorage.setItem("keyspilli.practice.v1", JSON.stringify(state)); });
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Set up practice" });
    await dialog.getByLabel("Passage", { exact: true }).selectOption("loop");
    await dialog.getByLabel("Behavior").selectOption("wait");
    await dialog.getByLabel("Count-in", { exact: true }).selectOption("0");
    await dialog.getByRole("button", { name: "Start practice", exact: true }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).resume.passageId)).toBeUndefined();
    await page.evaluate(() => { const state = JSON.parse(localStorage.getItem("keyspilli.practice.v1")!); state.passages[0].startBeat = 0; localStorage.setItem("keyspilli.practice.v1", JSON.stringify(state)); });
    const detail = await (await request.get(`/api/songs/${id}`)).json();
    expect(detail.publicationRevision).toBeTruthy();
    const pinned = await request.get(`/api/song/${id}/export?type=midi&revision=${encodeURIComponent(detail.publicationRevision)}`);
    expect(pinned.status()).toBe(200);
    expect(pinned.headers()["x-publication-revision"]).toBe(detail.publicationRevision);
    expect((await pinned.body()).subarray(0, 4).toString()).toBe("MThd");
    expect((await request.get(`/api/song/${id}/export?type=midi&revision=stale-browser-pin`)).status()).toBe(409);
    const targets = detail.data.notes.filter((note: { start: number; dur: number; hand: string }) => note.start < 4 && note.dur >= 0.25 && note.hand !== "L");
    expect(targets.length).toBeGreaterThan(0);
    await page.locator(".player-stage").click();
    for (const note of targets) {
      const key = Object.entries(KEYMAP).find(([, midi]) => midi === note.midi)?.[0];
      expect(key).toBeDefined();
      await page.keyboard.press(key!);
    }
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).attempts[0].outcome)).toBe("completed");
    await page.reload();
    const runs = await page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).attempts);
    expect(runs.map((run: { outcome: string }) => run.outcome)).toEqual(["completed", "cancelled", "cancelled"]);
    expect(runs[0].result.accuracyPct).toBe(100);
    await workspace.locator(":scope > summary").click();
    await workspace.getByRole("button", { name: "Select First phrase", exact: true }).click();
    const ladder = workspace.locator('details[aria-label="Tempo plan for First phrase"]');
    await ladder.locator(":scope > summary").click();
    const bpm = detail.data.tempoBpm;
    await ladder.getByLabel("Starting BPM for First phrase").fill(String(bpm));
    await ladder.getByLabel("Target BPM for First phrase").fill(String(bpm+5));
    await ladder.getByLabel("Runs per tempo").fill("1");
    await ladder.getByRole("button", { name: "Save tempo plan", exact: true }).click();
    await ladder.getByRole("button", { name: `Use plan tempo ${bpm} BPM`, exact: true }).click();
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Set up practice" });
    await dialog.getByLabel("Passage", { exact: true }).selectOption("loop");
    await dialog.getByLabel("Behavior").selectOption("wait");
    await dialog.getByLabel("Count-in", { exact: true }).selectOption("0");
    await dialog.getByRole("button", { name: "Start practice", exact: true }).click();
    await page.locator(".player-stage").click();
    await page.keyboard.press("w");
    for (const note of targets) await page.keyboard.press(Object.entries(KEYMAP).find(([, midi]) => midi === note.midi)![0]);
    const problem = page.getByRole("button", { name: "Revisit difficult passage 1", exact: false });
    await expect(problem).toBeVisible();
    const flawed = await page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).attempts[0]);
    expect(flawed.result.wrong).toBe(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).passages[0].tempoPlan.currentBpm)).toBe(bpm);
    expect(flawed.result.diagnostics.events.some((event: { outcome: string }) => event.outcome === "wrong")).toBe(true);
    await problem.click();
    await expect(problem).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Set up practice" });
    await dialog.getByLabel("Behavior").selectOption("wait");
    await dialog.getByRole("button", { name: "Start practice", exact: true }).click();
    await page.evaluate(async () => { const contexts = (window as unknown as { __practiceContexts: AudioContext[] }).__practiceContexts; const context = [...contexts].reverse().find(item => item.state !== "closed"); if (!context) throw Error("No practice audio context"); await context.suspend(); });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).attempts[0].outcome)).toBe("interrupted");
    await expect(page.getByText("Audio output was interrupted.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Set up practice" });
    await dialog.getByLabel("Behavior").selectOption("wait");
    await dialog.getByRole("button", { name: "Start practice", exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).attempts[0].outcome)).toBe("interrupted");
    await expect(page.getByText("Window focus was lost.", { exact: false })).toBeVisible();
    await ladder.getByRole("button", { name: `Use plan tempo ${bpm} BPM`, exact: true }).click();
    await page.getByRole("button", { name: "Practice", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Set up practice" });
    await dialog.getByLabel("Behavior").selectOption("along");
    await dialog.getByLabel("Count-in", { exact: true }).selectOption("0");
    await expect(dialog.getByRole("button", { name: "Start practice", exact: true })).toBeEnabled();
    const scheduled = targets.map((note: { start: number; midi: number }) => ({ beat: note.start, key: Object.entries(KEYMAP).find(([,midi]) => midi === note.midi)![0] }));
    await dialog.getByRole("button", { name: "Start practice", exact: true }).evaluate(async (start, { notes, bpm }) => {
      if (!(start instanceof HTMLButtonElement) || start.disabled) throw Error("Practice start is unavailable");
      // Start and timestamp the synthetic performance in the same browser turn;
      // a later automation round-trip can miss the passage's first attack.
      start.click();
      const began = performance.now();
      for (const note of notes) {
        await new Promise(resolve => setTimeout(resolve, Math.max(0,note.beat*60_000/bpm-(performance.now()-began))));
        window.dispatchEvent(new KeyboardEvent("keydown", {key:note.key,bubbles:true}));
        window.dispatchEvent(new KeyboardEvent("keyup", {key:note.key,bubbles:true}));
      }
    }, { notes:scheduled, bpm });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).attempts[0].outcome)).toBe("completed");
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).passages[0].tempoPlan.currentBpm)).toBe(bpm+5);
    await ladder.getByRole("button", { name: `Use plan tempo ${bpm+5} BPM`, exact: true }).click();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await ladder.getByRole("button", { name: "Pause plan", exact: true }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).passages[0].tempoPlan.paused)).toBe(true);
    const backup = page.locator('details[aria-label="Back up browser practice"]');
    await backup.locator(":scope > summary").click();
    await backup.getByLabel("Include private practice history").check();
    const downloadEvent = page.waitForEvent("download");
    await backup.getByRole("button", { name: "Download owner state" }).click();
    const download = await downloadEvent, exported = readFileSync((await download.path())!, "utf8");
    const document = JSON.parse(exported);
    expect(document.practiceSets.sets[0].name).toBe("Daily Fixture");
    expect(document.practice.passages[0].name).toBe("First phrase"); expect(document.practice.attempts.length).toBeGreaterThan(0);
    await page.evaluate(() => localStorage.setItem("keyspilli.favorites", '["unrelated-owner-level"]'));
    await backup.getByLabel("Preview restore").setInputFiles({ name: "owner-state.json", mimeType: "application/json", buffer: Buffer.from(exported) });
    await expect(backup.getByText("Preview only; nothing changed.", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.favorites")!))).toEqual(["unrelated-owner-level"]);
    await backup.getByRole("button", { name: "Apply merge restore" }).click();
    await expect(backup.getByRole("status")).toContainText("Restored. Reload");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.favorites")!))).toContain("unrelated-owner-level");
    await page.goto("/");
    const home = page.getByRole("region", { name: "Your practice workspace" });
    await expect(home.getByRole("link", { name: /Open last practice: Roadmap Practice Fixture/ })).toHaveAttribute("href", `/player/${id}`);
    const homeSets = page.locator('details[aria-label="Owner practice sets"]');
    await homeSets.locator(":scope > summary").click();
    await homeSets.getByRole("link", { name: "Next unfinished item" }).click();
    await expect(page.locator(".player-loop-controls")).toHaveAttribute("data-active", "true");
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
    await page.goto("/songs");
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("keyspilli.practice.v1")!).attempts[0].outcome)).toBe("completed");
  } finally {
    const deleted = await request.delete(`/api/songs/${baseId}`, { headers: { Authorization: "Bearer test-token-for-e2e" } });
    expect(deleted.ok()).toBe(true);
  }
});
test.describe("live transport hooks with PlaybackEngine", () => {
  let probe: Awaited<ReturnType<typeof createTransportProbe>>;
  test.beforeAll(async () => {probe = await createTransportProbe();});
  test.afterAll(async () => {await probe.close();});
  test.beforeEach(async ({page}) => {
    await page.goto(probe.origin);
    await expect(page.getByLabel("Transport state")).toContainText("Ready");
  });
  test.afterEach(async ({page}, info) => {
    if (page.isClosed()) return;
    await page.evaluate(() => window.__keyspilliTransportProbe.unmount());
    const state = await page.evaluate(() => window.__keyspilliTransportProbe.snapshot());
    await info.attach("transport-resource-state", {body: JSON.stringify(state), contentType: "application/json"});
    expect(state.mounted).toBe(false);
    expect(state.audio.every(audio => audio.disposed && audio.active === 0)).toBe(true);
  });

  test("discrete play, seek and stop synchronize state while frame ticks update refs", async ({page}) => {
    await page.getByRole("button", {name: "Play engine", exact: true}).click();
    let state = await page.evaluate(() => window.__keyspilliTransportProbe.snapshot());
    expect([state.playing, state.playingRef, state.enginePlaying]).toEqual([true, true, true]);
    await page.evaluate(() => window.__keyspilliTransportProbe.tick(1.25));
    state = await page.evaluate(() => window.__keyspilliTransportProbe.snapshot());
    expect(state.time).toBe(0);
    expect(state.timeRef).toBe(1.25);
    expect(state.engineTime).toBe(1.25);
    expect(state.audio[0]?.starts).toBeGreaterThan(0);
    await page.getByRole("button", {name: "Seek to three seconds", exact: true}).click();
    state = await page.evaluate(() => window.__keyspilliTransportProbe.snapshot());
    expect([state.time, state.timeRef, state.engineTime]).toEqual([3, 3, 3]);
    expect(state.seekVersion).toBe(1);
    await page.getByRole("button", {name: "Stop engine", exact: true}).click();
    const stopped = await page.evaluate(() => window.__keyspilliTransportProbe.snapshot());
    expect([stopped.playing, stopped.playingRef, stopped.enginePlaying]).toEqual([false, false, false]);
    expect(stopped.audio[0]?.active).toBe(0);
    await page.evaluate(() => window.__keyspilliTransportProbe.tick(2));
    expect(await page.evaluate(() => window.__keyspilliTransportProbe.snapshot())).toEqual(stopped);
  });

  test("loop beats survive tempo and speed changes and the engine wraps at their new seconds", async ({page}) => {
    await page.getByRole("button", {name: "Loop beats four to eight", exact: true}).click();
    await page.getByRole("button", {name: "Tempo ninety", exact: true}).click();
    await page.getByRole("button", {name: "Half speed", exact: true}).click();
    let state = await page.evaluate(() => window.__keyspilliTransportProbe.snapshot());
    expect(state.loopBeats).toEqual({startBeat: 4, endBeat: 8});
    expect(state.loop?.startSec).toBeCloseTo(16 / 3);
    expect(state.loop?.endSec).toBeCloseTo(32 / 3);
    await page.getByRole("button", {name: "Seek near loop end", exact: true}).click();
    await page.getByRole("button", {name: "Play engine", exact: true}).click();
    await page.evaluate(() => window.__keyspilliTransportProbe.tick(.5));
    state = await page.evaluate(() => window.__keyspilliTransportProbe.snapshot());
    expect(state.engineTime).toBeCloseTo(16 / 3 + .25);
    expect(state.timeRef).toBeCloseTo(16 / 3 + .25);
    expect(state.enginePlaying).toBe(true);
  });

  test("keyed song replacement resets the transport hook", async ({page}) => {
    await page.getByRole("button", {name: "Play engine", exact: true}).click();
    await page.getByRole("button", {name: "Seek to three seconds", exact: true}).click();
    await page.getByRole("button", {name: "Loop beats four to eight", exact: true}).click();
    await page.getByRole("button", {name: "Switch song", exact: true}).click();
    await expect.poll(() => page.evaluate(() => {
      const state = window.__keyspilliTransportProbe.snapshot();
      return {song: state.song, mounted: state.mounted, hasEngine: state.engineTime !== null};
    })).toEqual({song: 1, mounted: true, hasEngine: true});
    const state = await page.evaluate(() => window.__keyspilliTransportProbe.snapshot());
    expect([state.time, state.timeRef, state.engineTime]).toEqual([0, 0, 0]);
    expect([state.playing, state.playingRef, state.enginePlaying]).toEqual([false, false, false]);
    expect(state.loopBeats).toBeNull();
    expect(state.seekVersion).toBe(0);
  });
});
for (const backgroundMode of ["piano", "chord"] as const) {
  test(`actual FullPlayer disposes ${backgroundMode} audio on tier replacement and unmount`, async ({page, request}, info) => {
    const headers = {Authorization: "Bearer test-token-for-e2e", "Content-Type": "application/xml"};
    const ownerXml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${Array.from({length: 16}, (_, offset) => offset + 1).map(index => `<measure number="${index}"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${[["C", 3], ["C", 4], ["E", 4], ["G", 4]].map(([step, octave], note) => `<note>${note ? "<chord/>" : ""}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>4</duration><type>whole</type></note>`).join("")}</measure>`).join("")}</part></score-partwise>`;
    const uploaded = await request.post("/api/uploads?title=Transport%20Owner&artist=Authored", {headers, data: Buffer.from(ownerXml)});
    expect(uploaded.ok(), await uploaded.text()).toBe(true);
    const receipt = await uploaded.json(), id = receipt.songIds.find((value: string) => value.endsWith("-a"));
    await page.addInitScript(installOwnerAudioProbe);
    await page.addInitScript(mode => localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({soundSource: "synth", backgroundMode: mode, accompanimentStyle: "bass-chords", hand: "both", speed: 1, transpose: 0})), backgroundMode);
    try {
      await page.goto(`/player/${id}`);
      const epoch = await page.evaluate(() => window.__keyspilliOwnerAudio.snapshot().epoch);
      await page.getByRole("button", {name: "Play", exact: true}).click();
      await expect(page.getByLabel("Playback status", {exact: true})).toContainText("Playing");
      await expect.poll(() => page.evaluate(() => window.__keyspilliOwnerAudio.snapshot().starts)).toBeGreaterThan(0);
      await page.getByRole("button", {name: "Pause", exact: true}).click();
      const seek = page.getByRole("slider", {name: "Seek", exact: true});
      await seek.fill("2");
      await expect(seek).toHaveValue("2");
      const before = await page.evaluate(() => window.__keyspilliOwnerAudio.snapshot().states.length);
      await page.getByRole("button", {name: "Play", exact: true}).click();
      await page.getByRole("link", {name: "Easy", exact: true}).click();
      await expect(page).toHaveURL(new RegExp(`/player/${receipt.baseId}-e$`));
      await expect.poll(() => page.evaluate(count => window.__keyspilliOwnerAudio.snapshot().states.slice(0, count).every(state => state === "closed"), before)).toBe(true);
      await page.getByRole("button", {name: "Play", exact: true}).click();
      await expect.poll(() => page.evaluate(() => window.__keyspilliOwnerAudio.snapshot().states.length)).toBeGreaterThan(before);
      await page.getByRole("link", {name: "Home", exact: true}).first().click();
      await expect(page).toHaveURL("/");
      expect(await page.evaluate(() => window.__keyspilliOwnerAudio.snapshot().epoch)).toBe(epoch);
      await expect.poll(() => page.evaluate(() => window.__keyspilliOwnerAudio.snapshot().states.every(state => state === "closed"))).toBe(true);
      const stopped = await page.evaluate(() => window.__keyspilliOwnerAudio.snapshot().starts);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await page.evaluate(() => window.__keyspilliOwnerAudio.snapshot().starts)).toBe(stopped);
    } finally {
      if (!page.isClosed()) await info.attach("actual-owner-audio", {body: JSON.stringify(await page.evaluate(() => window.__keyspilliOwnerAudio?.snapshot())), contentType: "application/json"});
      expect((await request.delete(`/api/songs/${receipt.baseId}`, {headers})).ok()).toBe(true);
    }
  });
}
