import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import type { PlayerDetail, PlayerShell } from "../src/components/player/Player";
const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${['C','D','E','F','G','A','B','C'].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration></note>`).join('')}</measure></part></score-partwise>`;
test("owner metadata preview saves all variants and survives validation, auth expiry and stale review", async ({ page, request }) => {
  const headers = { Authorization: "Bearer test-token-for-e2e", "Content-Type": "application/xml" };
  const created = await request.post("/api/uploads?title=Metadata%20Fixture&artist=Author", { headers, data: Buffer.from(xml) });
  expect(created.ok(), await created.text()).toBe(true);
  const receipt = await created.json(), id = receipt.songIds.find((value: string) => value.endsWith("-a"));
  const root = process.env.KEYSPILLI_E2E_SCRATCH_DIR!;
  const files = await Promise.all(receipt.songIds.map((songId: string) => readFile(join(root,"artifacts",receipt.baseId,songId.split("-").at(-1)!,"notes.json"))));
  try {
    await page.goto(`/player/${id}/beginner`);
    const editor = page.getByRole("group", { name: "Owner metadata edit" });
    await editor.locator("summary").click();
    await editor.getByLabel("Lesson title").fill("Edited lesson");
    await editor.getByRole("button", { name: "Preview metadata changes" }).click();
    await expect(editor.getByLabel("Metadata change preview")).toContainText("Metadata Fixture → Edited lesson");
    let expire = true;
    await page.route(`**/api/songs/${id}`, route => route.continue({ headers: { ...route.request().headers(), ...(expire ? { authorization: "Bearer expired-test-token" } : {}) } }));
    await editor.getByRole("button", { name: "Save reviewed metadata" }).click();
    await expect(editor.getByRole("status")).toContainText("Owner access expired");
    expire = false;
    await editor.getByRole("button", { name: "Save reviewed metadata" }).click();
    await expect(editor.getByRole("status")).toContainText("Saved for every available variant");
    expect(await Promise.all(receipt.songIds.map((songId: string) => readFile(join(root,"artifacts",receipt.baseId,songId.split("-").at(-1)!,"notes.json"))))).toEqual(files);
    for (const songId of receipt.songIds) expect((await (await request.get(`/api/songs/${songId}`)).json()).song.title).toBe("Edited lesson");
    await editor.getByRole("button", { name: "Reload publication" }).click();
    await page.getByRole("group", { name: "Owner metadata edit" }).locator("summary").click();
    await editor.getByLabel("Lesson category").fill("Study");
    await editor.getByRole("button", { name: "Preview metadata changes" }).click();
    const current = await (await request.get(`/api/songs/${id}`)).json();
    expect((await request.patch(`/api/songs/${id}`, { headers: { Authorization: headers.Authorization }, data: { expectedRevision: current.publicationRevision, artist: "New owner label" } })).ok()).toBe(true);
    await editor.getByRole("button", { name: "Save reviewed metadata" }).click();
    await expect(editor.getByRole("status")).toContainText("This version changed");
    await editor.getByRole("button", { name: "Reload publication" }).click();
    await editor.locator("summary").click();
    expect((await request.patch(`/api/songs/${id}`, { headers: { Authorization: headers.Authorization }, data: { title: "x".repeat(161) } })).status()).toBe(400);
    await editor.getByLabel("Lesson title").fill("");
    await expect(editor.getByRole("button", { name: "Preview metadata changes" })).toBeDisabled();
    await editor.getByRole("button", { name: "Discard metadata changes" }).click();
    await expect(editor.getByLabel("Lesson title")).toHaveValue("Edited lesson");
  } finally { expect((await request.delete(`/api/songs/${receipt.baseId}`, { headers })).ok()).toBe(true); }
});

test("same-song republication updates the pinned detail request", async ({page, request, baseURL}) => {
  if (!baseURL) throw Error("The maintained app base URL is required");
  const headers = {Authorization: "Bearer test-token-for-e2e", "Content-Type": "application/xml"};
  const created = await request.post("/api/uploads?title=Publication%20Fixture&artist=Author", {headers, data: Buffer.from(xml)});
  expect(created.ok(), await created.text()).toBe(true);
  const receipt: {baseId: string; songIds: string[]} = await created.json();
  const id = receipt.songIds.find(value => value.endsWith("-a"));
  const scratch = process.env.KEYSPILLI_E2E_SCRATCH_DIR;
  if (!id || !scratch) throw Error("Expected an owned uploaded fixture");
  const notesPath = join(scratch, "artifacts", receipt.baseId, "a", "notes.json");
  const notesBefore = await readFile(notesPath);
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const original: PlayerDetail = await (await request.get("/api/songs/" + id)).json();
    expect((await request.patch("/api/songs/" + id, {headers: {Authorization: headers.Authorization},
      data: {expectedRevision: original.publicationRevision, title: "Republished Fixture"}})).ok()).toBe(true);
    const updated: PlayerDetail = await (await request.get("/api/songs/" + id)).json();
    if (!original.publicationRevision || !updated.publicationRevision) throw Error("Expected pinned publication revisions");
    expect(updated.publicationRevision).not.toBe(original.publicationRevision);
    expect((await request.get("/api/songs/" + id + "?revision=" + encodeURIComponent(original.publicationRevision))).status()).toBe(409);
    const shell = ({song, variants, publicationRevision}: PlayerDetail): PlayerShell => ({song, variants, publicationRevision});
    const entry = [
      'import React from "react"; import {createRoot} from "react-dom/client";',
      'import {Player} from "./src/components/player/Player";',
      'import {AppRouterContext} from "next/dist/shared/lib/app-router-context.shared-runtime";',
      'import {PathnameContext,SearchParamsContext} from "next/dist/shared/lib/hooks-client-context.shared-runtime";',
      'const versions=' + JSON.stringify([shell(original), shell(updated)]) + ';',
      'const router={back(){},forward(){},refresh(){},prefetch(){},push(){},replace(){}};',
      'function Fixture(){const [version,setVersion]=React.useState(0);return <AppRouterContext.Provider value={router}><PathnameContext.Provider value={"/player/"+versions[version].song.id+"/sheet"}><SearchParamsContext.Provider value={new URLSearchParams()}><button onClick={()=>setVersion(1)}>Use republished fixture</button><Player initial={versions[version]} mode="sheet"/></SearchParamsContext.Provider></PathnameContext.Provider></AppRouterContext.Provider>;}',
      'createRoot(document.getElementById("fixture")).render(<Fixture/>);',
    ].join("\n");
    const bundled = await build({stdin: {contents: entry, resolveDir: join(__dirname, ".."), loader: "tsx"},
      bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", external: ["/verovio/*"],
      define: {"process.env.NODE_ENV": '"test"'}, banner: {js: 'globalThis.process={env:{NODE_ENV:"test"}};'}});
    const javascript = bundled.outputFiles[0];
    if (!javascript) throw Error("No component fixture bundle");
    const path = "/api/songs/" + id;
    server = createServer(async (incoming, outgoing) => {
      try {
        const url = new URL(incoming.url ?? "/", "http://fixture.invalid");
        if (incoming.method !== "GET") {outgoing.writeHead(405); outgoing.end(); return;}
        if (url.pathname === "/fixture.js") {
          outgoing.writeHead(200, {"Content-Type": "text/javascript"}); outgoing.end(javascript.contents);
        } else if (url.pathname === path) {
          // The app now requires login; this fixture proxy is a trusted caller.
          const result = await fetch(new URL(url.pathname + url.search, baseURL), {headers: {"x-keyspilli-api-token": headers.Authorization}});
          outgoing.writeHead(result.status, {"Content-Type": "application/json"}); outgoing.end(await result.text());
        } else if (url.pathname === "/") {
          outgoing.writeHead(200, {"Content-Type": "text/html"});
          outgoing.end('<div id="fixture"></div><script src="/fixture.js"></script>');
        } else {outgoing.writeHead(404); outgoing.end();}
      } catch (error) {
        if (!outgoing.headersSent) outgoing.writeHead(500);
        outgoing.end(error instanceof Error ? error.message : "Fixture unavailable");
      }
    });
    const listening = server;
    await new Promise<void>((resolve, reject) => {listening.once("error", reject); listening.listen(0, "127.0.0.1", () => resolve());});
    const address = listening.address();
    if (!address || typeof address === "string") throw Error("No loopback fixture address");
    await page.addInitScript(() => localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({soundSource: "synth"})));
    await page.goto("http://127.0.0.1:" + address.port);
    await expect(page.getByRole("heading", {name: "Publication Fixture", exact: true})).toBeVisible();
    await page.getByRole("button", {name: "Use republished fixture", exact: true}).click();
    await expect(page.getByRole("heading", {name: "Republished Fixture", exact: true})).toBeVisible();
    await page.getByRole("button", {name: /^View\s*Sheet Music$/}).click();
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === path),
      page.getByRole("menuitemradio", {name: /^Note letters/}).click(),
    ]);
    expect(response.status()).toBe(200);
    expect(new URL(response.url()).searchParams.get("revision")).toBe(updated.publicationRevision);
    await expect(page.getByRole("button", {name: /^View\s*Note letters$/})).toBeVisible();
    expect(await readFile(notesPath)).toEqual(notesBefore);
  } finally {
    if (server) {
      const listening = server;
      listening.closeAllConnections();
      await new Promise<void>((resolve, reject) => listening.close(error => error ? reject(error) : resolve()));
    }
    expect((await request.delete("/api/songs/" + receipt.baseId, {headers})).ok()).toBe(true);
  }
});
