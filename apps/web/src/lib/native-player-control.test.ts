import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { ingestSource } from "@keyspilli/catalog";
import { parseMusicXmlNotes } from "@keyspilli/midi";
import { controlXml } from "../../scripts/verify-native-player.mjs";
import { getSongDetail } from "./catalog-api";
import { replayChordsBacking } from "../components/player/chords-backing";

const previous = process.env.KEYSPILLI_DATA_DIR;
const root = mkdtempSync(join(tmpdir(), "keyspilli-native-control-"));
process.env.KEYSPILLI_DATA_DIR = root;
afterAll(() => {
  if (previous === undefined) delete process.env.KEYSPILLI_DATA_DIR;
  else process.env.KEYSPILLI_DATA_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

async function backingFor(xml: string) {
  const buf = Buffer.from(xml);
  const hash = createHash("sha256").update(buf).digest("hex"), baseId = `upload-${hash}`;
  const result = await ingestSource({ buf, baseId, title: "Native software control", artist: "Software fixture",
    contentType: "upload", acquiredVia: "upload", sourceRef: `upload:${hash}` }, { uploadReplay: { mode: "reuse" } });
  expect(result.error).toBeUndefined();
  const detail = await getSongDetail(baseId + "-a");
  if (!detail?.data) throw new Error("Uploaded Advanced control data is unavailable");
  return replayChordsBacking(detail.chordData ?? detail.data).resolution;
}

it("qualifies the actual uploaded native control for default Chords playback", async () => {
  const backing = await backingFor(controlXml("source-qualification"));
  expect(backing.notes.length + backing.chords.length).toBeGreaterThan(0);
  for (const beat of [0, 4, 8]) {
    expect(backing.notes.some(note => note.start <= beat && note.start + note.dur > beat)
      || backing.chords.some(chord => chord.beat <= beat && chord.beat + (chord.durationBeats ?? 0) > beat)).toBe(true);
  }
  expect(backing.fallbackSpans).toEqual([]);
});

it("keeps the former octave-unison control silent when its backing role is uncertain", async () => {
  // Remove the third and fifth, leaving the original C3/C4 source ambiguity.
  const xml = controlXml("uncertain-source").replace(/<note><chord\/><pitch><step>[EG]<\/step>.*?<\/note>/g, "");
  expect(parseMusicXmlNotes(xml).notes).toHaveLength(32);
  expect(new Set(parseMusicXmlNotes(xml).notes.map(note => note.midi % 12))).toEqual(new Set([0]));
  const backing = await backingFor(xml);
  expect(backing.notes).toEqual([]);
  expect(backing.chords).toEqual([]);
  expect(backing.fallbackSpans.length).toBeGreaterThan(0);
});
