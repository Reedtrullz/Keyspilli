import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, expect, request, type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test";
import { parseMidi, parseMusicXmlNotes } from "@keyspilli/midi";
import { capturePlayerClip, savePlayerCapture } from "../e2e/player-audio-capture";
import { readNativePianoBank } from "../src/lib/native-player-assets";

type Mode = "original" | "chords";
const origin = "http://127.0.0.1:3000";
const output = "/browser-results";
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

function controlXml(nonce: string): string {
  const measures = Array.from({ length: 16 }, (_, index) => `<measure number="${index + 1}">
    ${index === 0 ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes><direction><sound tempo="120"/></direction>' : ""}
    <harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
    <backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><staff>2</staff></note>
    </measure>`).join("");
  return `<score-partwise version="4.0"><work><work-title>Native software control ${nonce}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

export async function verifyNativePlayer(revision: string): Promise<void> {
  if (!/^[a-f0-9]{40}$/.test(revision) || process.platform !== "linux" || process.arch !== "x64"
      || process.env.KEYSPILLI_NATIVE_PROBE_SCOPE !== "owned-restore" || process.env.KEYSPILLI_DATA_DIR !== "/data") {
    throw new Error("Native probe requires the owned Linux amd64 restore container and exact revision");
  }
  let api: APIRequestContext | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let baseId: string | undefined;
  let failure: unknown;
  const cleanupErrors: string[] = [];
  const results: object[] = [];
  const pdfPackets: Array<{ mode: Mode; packet: Record<string, unknown> }> = [];
  const xml = controlXml(randomUUID());
  writeFileSync(join(output, "control.musicxml"), xml, { flag: "wx" });
  try {
    const bank = readNativePianoBank("/piano-input");
    results.push({ kind: "pinned-piano-input", assets: bank.assets.size, fixtureSha256: bank.fixtureSha256,
      moduleVersion: bank.moduleVersion, moduleSha256: bank.moduleSha256, rightsSource: bank.rightsSource,
      transport: "read-only local input; live CDN reachability is not tested" });
    api = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Authorization: "Bearer test-token-for-e2e" } });
    const health: unknown = await (await api.get("/api/health")).json();
    if (!object(health) || health.version !== revision || health.status !== "healthy") throw new Error("Wrong candidate identity/readiness");
    const upload = await api.post("/api/uploads?title=Native%20sampled%20software%20control&artist=Software%20fixture", {
      headers: { "Content-Type": "application/xml" }, data: Buffer.from(xml),
    });
    expect(upload.ok()).toBe(true);
    baseId = `upload-${sha(xml)}`;
    const receipt: unknown = await upload.json();
    if (!object(receipt) || typeof receipt.baseId !== "string" || !/^upload-[a-f0-9]{64}$/.test(receipt.baseId)
        || !Array.isArray(receipt.songIds)) throw new Error("Upload ownership receipt is invalid");
    expect(receipt.baseId).toBe(baseId);
    const id = receipt.songIds.find((value: unknown): value is string => value === baseId + "-a");
    if (!id) throw new Error("Advanced control was not prepared");
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ baseURL: origin });
    await context.route("https://smpldsnds.github.io/**", async route => {
      const body = bank.assets.get(route.request().url());
      if (!body) return route.abort();
      await route.fulfill({ status: 200, contentType: "audio/ogg", body, headers: { "Access-Control-Allow-Origin": "*" } });
    });
    for (const mode of ["original", "chords"] as const) {
      const page = await context.newPage();
      const capture = await capturePlayerClip(page, { songId: id, mode, durationMs: 6000, expectedAttackSeconds: [] });
      expect([...capture.sampleAssets].sort((a, b) => a.url.localeCompare(b.url)))
        .toEqual([...bank.sampleAssetPins].sort((a, b) => a.url.localeCompare(b.url)));
      savePlayerCapture(join(output, mode + ".wav"), capture);
      const { wav: _wav, beforeCompressor: _before, ...metadata } = capture;
      writeFileSync(join(output, mode + "-capture.json"), JSON.stringify(metadata, null, 2), { flag: "wx" });
      results.push({ kind: "sampled-playback", mode, rms: capture.rms, peak: capture.peak,
        sampleAssets: capture.sampleAssets.length, samplerStarts: capture.samplerStarts.length, sha256: capture.sha256 });
      await page.getByRole("button", { name: "Download sheet music and MIDI", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Download sheet music or MIDI", exact: true });
      await dialog.getByRole("combobox", { name: "Arrangement" }).selectOption("active");
      let midi: ReturnType<typeof parseMidi> | undefined;
      for (const [format, label, extension] of [["midi", "Active MIDI", "mid"], ["musicxml", "Active MusicXML", "xml"]] as const) {
        const [download, response] = await Promise.all([
          page.waitForEvent("download"),
          page.waitForResponse(value => value.url().endsWith("/active-export") && value.request().method() === "POST"),
          dialog.getByRole("button", { name: label, exact: true }).click(),
        ]);
        expect(response.status()).toBe(200);
        const packet: unknown = response.request().postDataJSON();
        if (!object(packet) || packet.type !== format || typeof packet.expectedHash !== "string" || !object(packet.selection)
            || packet.selection.backgroundMode !== (mode === "original" ? "piano" : "chord")) throw new Error("Active export selection mismatch");
        expect(response.headers()["x-active-arrangement-sha256"]).toBe(packet.expectedHash);
        if (format === "midi") pdfPackets.push({ mode, packet });
        const file = join(output, mode + "." + extension);
        await download.saveAs(file); expect(await download.failure()).toBeNull();
        expect(statSync(file).size).toBeLessThanOrEqual(16 * 1024 * 1024);
        const bytes = readFileSync(file);
        if (format === "midi") {
          expect(bytes.subarray(0, 4).toString()).toBe("MThd"); midi = parseMidi(bytes); expect(midi.notes.length).toBeGreaterThan(0);
        } else {
          if (!midi) throw new Error("MIDI parity reference missing");
          const parsed = parseMusicXmlNotes(bytes.toString());
          const sort = (notes: ReturnType<typeof parseMidi>["notes"]) => [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi || String(a.hand).localeCompare(String(b.hand)));
          const a = sort(midi.notes), b = sort(parsed.notes);
          expect(b.length).toBe(a.length);
          for (let index = 0; index < a.length; index++) {
            expect(b[index]!.midi).toBe(a[index]!.midi); expect(b[index]!.hand).toBe(a[index]!.hand);
            expect(Math.abs(b[index]!.start - a[index]!.start)).toBeLessThanOrEqual(1 / 240);
            expect(Math.abs(b[index]!.dur - a[index]!.dur)).toBeLessThanOrEqual(1 / 240);
          }
        }
        results.push({ kind: "active-ui-export", mode, format, bytes: bytes.length, sha256: sha(bytes) });
      }
      await page.screenshot({ path: join(output, mode + ".png") }); await page.close();
    }
    const silentPage = await context.newPage();
    const silent = await capturePlayerClip(silentPage, { songId: id, mode: "original", durationMs: 4000,
      expectedAttackSeconds: [], signalControl: "silence", capturePreCompressor: true });
    savePlayerCapture(join(output, "silence-control.wav"), silent);
    results.push({ kind: "silence-recorder-control", rms: silent.rms, peak: silent.peak, samplerStarts: silent.samplerStarts.length });
    await silentPage.close(); await context.close(); context = undefined; await browser.close(); browser = undefined;
    // Render PDFs after the capture browser exits; both browsers share the same bounded container.
    for (const { mode, packet } of pdfPackets) {
      const response = await api.post(`/api/song/${id}/active-export`, { data: { ...packet, type: "pdf" } });
      expect(response.status()).toBe(200); expect(response.headers()["x-active-arrangement-sha256"]).toBe(packet.expectedHash);
      const bytes = await response.body(); expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(1000); expect(bytes.length).toBeLessThanOrEqual(32 * 1024 * 1024);
      writeFileSync(join(output, mode + ".pdf"), bytes, { flag: "wx" });
      results.push({ kind: "active-api-export", mode, format: "pdf", bytes: bytes.length, sha256: sha(bytes) });
    }
  } catch (error) { failure = error; }
  finally {
    await context?.close().catch(error => cleanupErrors.push(String(error)));
    await browser?.close().catch(error => cleanupErrors.push(String(error)));
    if (baseId && api) {
      try { expect((await api.delete(`/api/songs/${baseId}`)).ok()).toBe(true); }
      catch (error) { cleanupErrors.push(String(error)); }
    }
    await api?.dispose().catch(error => cleanupErrors.push(String(error)));
    const proof = { kind: "keyspilli-native-sampled", revision, status: failure || cleanupErrors.length ? "failed" : "passed",
      platform: process.platform, architecture: process.arch, sourceControlSha256: sha(xml), results,
      error: failure instanceof Error ? failure.message : failure ? String(failure) : null, cleanupErrors,
      scope: "Generated software control in an owned writable restore copy; actual sampled UI, MIDI/XML UI parity and PDF API transport; no musical, physical or production acceptance" };
    writeFileSync(join(output, "result.json"), JSON.stringify(proof, null, 2), { flag: "wx" });
    console.log(JSON.stringify(proof));
  }
  if (failure || cleanupErrors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyNativePlayer(process.argv[2] ?? "");
}
