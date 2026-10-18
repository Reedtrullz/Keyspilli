import {expect, test} from "@playwright/test";
import {createHash, randomUUID} from "node:crypto";
import {mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {deleteSongsByBase, upsertSong, type SongRow} from "../../../packages/catalog/src/db";
import {parseMidi, parseMusicXmlNotes, writeMidi, writeMusicXml, type Variant} from "@keyspilli/midi";

test("legacy Original and Chords active downloads preserve the catalog and refuse stale selections", async ({page, request}) => {
  const root = process.env.KEYSPILLI_E2E_SCRATCH_DIR;
  if (!root) throw new Error("Owned scratch catalog required");
  const baseId = `legacy-export-${randomUUID()}`, id = `${baseId}-a`, dir = join(root, "artifacts", baseId, "a");
  const notes = [
    {midi: 52, hand: "L" as const, start: 0.5, dur: 2, vel: 64},
    {midi: 55, hand: "R" as const, start: 0.5, dur: 2, vel: 88},
    {midi: 60, hand: "R" as const, start: 0.5, dur: 2, vel: 96},
  ];
  const variant: Variant = {level: "advanced", difficultyScore: 1, bassPattern: "block", key: "C", tempoBpm: 120,
    timeSig: [4, 4], measures: [{index: 0, startBeat: 0, endBeat: 4}], notes,
    chords: [{beat: 0, name: "N.C.", notes: [], durationBeats: 0.5, sourceKind: "authored"},
      {beat: 0.5, name: "C/E", notes: [], durationBeats: 2, sourceKind: "authored"},
      {beat: 2.5, name: "N.C.", notes: [], durationBeats: 1.5, sourceKind: "authored"}]};
  const song: SongRow = {id, baseId, level: "a", title: "Legacy export control", artist: "Software fixture", category: "Test",
    difficulty: "advanced", difficultyScore: 1, key: "C", tempo: 120, style: "test", mood: "neutral", bassPattern: "block", duration: 2,
    contentType: "standard", acquiredVia: null, sourceYoutubeUrl: null, hasSheetXml: 1, sections: null, plays: 0, createdAt: "2026-10-17T00:00:00Z"};
  await mkdir(dir, {recursive: true});
  await writeFile(join(dir, "notes.json"), JSON.stringify(variant));
  await writeFile(join(dir, "variant.mid"), writeMidi(notes, {tempoBpm: 120, timeSig: [4, 4], tracks: [{name: "Left Hand", notes: [notes[0]!] }, {name: "Right Hand", notes: notes.slice(1)}]}));
  await writeFile(join(dir, "variant.xml"), writeMusicXml(variant, song.title, song.artist, {chordWords: true}));
  upsertSong(song);
  const digestFiles = async () => Promise.all((await readdir(dir)).sort().map(async name => [name, createHash("sha256").update(await readFile(join(dir, name))).digest("hex")]));
  const before = await digestFiles(), beforeNotes = await readFile(join(dir, "notes.json"));
  const token = {Authorization: "Bearer test-token-for-e2e"};
  let packet: Record<string, unknown> | undefined;
  try {
    const detail = await (await request.get(`/api/songs/${id}`)).json();
    expect(detail.publicationRevision).toBeNull();
    for (const mode of ["piano", "chord"] as const) {
      await page.addInitScript(({mode}) => localStorage.setItem("keyspilli.prefs.v1", JSON.stringify({soundSource: "synth", backgroundMode: mode,
        accompanimentStyle: "bass-chords", hand: "both", speed: 1, transpose: 0})), {mode});
      await page.goto(`/player/${id}`);
      await page.getByRole("button", {name: "Download sheet music and MIDI", exact: true}).click();
      const dialog = page.getByRole("dialog", {name: "Download sheet music or MIDI", exact: true});
      expect(await dialog.locator('option[value="active"]').evaluate((option: HTMLOptionElement) => option.disabled)).toBe(false);
      await dialog.getByRole("combobox", {name: "Arrangement"}).selectOption("active");
      for (const [type, label] of [["midi", "Active MIDI"], ["musicxml", "Active MusicXML"], ["pdf", "Active Sheet PDF"]] as const) {
        const [download, response] = await Promise.all([page.waitForEvent("download"),
          page.waitForResponse(value => value.url().endsWith(`/api/song/${id}/active-export`)),
          dialog.getByRole("button", {name: label, exact: true}).click()]);
        expect(response.status()).toBe(200);
        packet = response.request().postDataJSON();
        expect(packet?.revision).toBeNull();
        expect(packet?.selection).toMatchObject({backgroundMode: mode});
        expect(response.headers()["x-publication-revision"]).toBe("unpinned");
        expect(response.headers()["x-active-arrangement-sha256"]).toBe(packet?.expectedHash);
        const file = await download.path(); expect(file).not.toBeNull();
        const bytes = await readFile(file!);
        if (type === "pdf") {
          expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
          expect(bytes.subarray(-1024).toString()).toMatch(/startxref\s+\d+\s+%%EOF\s*$/);
        } else {
          const parsed = type === "midi" ? parseMidi(bytes) : parseMusicXmlNotes(bytes.toString());
          expect(parsed.notes.map(note => [note.midi, note.start, note.dur]).sort((a, b) => a[0]! - b[0]!)).toEqual(
            (mode === "piano" ? [52, 55, 60] : [40, 67, 72, 76]).map(midi => [midi, 0.5, 2]));
          expect(parsed.tempoBpm).toBeCloseTo(120, 4);
        }
      }
      await dialog.getByRole("button", {name: "Done", exact: true}).click();
    }
    expect(await digestFiles()).toEqual(before);
    expect((await request.get(`/api/songs/${id}`)).ok()).toBe(true);
    expect(await readdir(join(root, "artifacts", baseId))).toEqual(["a"]);
    expect(packet).toBeDefined();
    expect((await request.post(`/api/song/${id}/active-export`, {data: packet})).status()).toBe(401);
    const {revision: _revision, ...missingRevision} = packet!;
    expect((await request.post(`/api/song/${id}/active-export`, {headers: token, data: missingRevision})).status()).toBe(400);
    expect((await request.post(`/api/song/${id}/active-export`, {headers: token, data: {...packet, revision: "unpinned"}})).status()).toBe(409);
    const changed = JSON.parse(beforeNotes.toString()); changed.notes[0].midi++;
    await writeFile(join(dir, "notes.json"), JSON.stringify(changed));
    expect((await request.post(`/api/song/${id}/active-export`, {headers: token, data: {...packet, type: "midi"}})).status()).toBe(409);
    await writeFile(join(dir, "notes.json"), beforeNotes);
    await writeFile(join(root, "artifacts", baseId, ".publication-id"), "now-published\n");
    expect((await request.post(`/api/song/${id}/active-export`, {headers: token, data: {...packet, type: "midi"}})).status()).toBe(409);
  } finally {
    deleteSongsByBase(baseId);
    await rm(join(root, "artifacts", baseId), {recursive: true, force: true});
  }
});
