import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMidi, parseMusicXmlNotes, type Variant } from "@keyspilli/midi";
import { pickupFixture, pickupKinds } from "../../midi/test/pickup-fixtures.js";
import { ingestSource } from "../src/ingest.js";
import { getSongsByBase } from "../src/db.js";

const root = mkdtempSync(join(tmpdir(), "keyspilli-pickup-ingest-"));
const previous = process.env.KEYSPILLI_DATA_DIR;
beforeAll(() => { process.env.KEYSPILLI_DATA_DIR = root; });
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.KEYSPILLI_DATA_DIR;
  else process.env.KEYSPILLI_DATA_DIR = previous;
});

it.each(pickupKinds)("publishes six %s control variants whose stored duration includes the final rest", async kind => {
  const fixture = pickupFixture(kind, 8);
  const result = await ingestSource({ buf: new TextEncoder().encode(fixture.xml), title: `Synthetic ${kind} pickup`, artist: "Software control", contentType: "upload" });
  expect(result.error).toBeUndefined();
  expect(result.songIds).toHaveLength(6);
  const rows = getSongsByBase(result.baseId);
  expect(rows).toHaveLength(6);
  for (const row of rows) {
    expect(row.duration).toBe(Math.round(fixture.endBeat * 60 / row.tempo));
    const directory = join(root, "artifacts", result.baseId, row.level);
    const stored = JSON.parse(readFileSync(join(directory, "notes.json"), "utf8")) as Variant;
    expect(stored.measures).toEqual(fixture.measures);
    for (const parsed of [parseMidi(readFileSync(join(directory, "variant.mid"))), parseMusicXmlNotes(readFileSync(join(directory, "variant.xml"), "utf8"))]) {
      expect(parsed.notationMeasures).toEqual(fixture.measures);
      expect(parsed.durationBeats).toBe(fixture.endBeat);
    }
  }
});
