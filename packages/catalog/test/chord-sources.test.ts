import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chordPitchClasses } from "@keyspilli/midi";
import {
  loadChordTimeline,
  normalizeChordTimeline,
  parseChordSourceMap,
  resolveChordTimeline,
  validateChordSourceMap,
} from "../src/index.js";

const YOUR_SONG = "the-theorist-elton-john-your-song-piano-cover-jz6ugvghbt8";

describe("catalog chord source plumbing", () => {
  it("loads the checked-in Your Song chart with external provenance", async () => {
    const result = await resolveChordTimeline(YOUR_SONG, { runtimeDataDir: join(process.cwd(), "missing-runtime-data") });
    expect(result).not.toBeNull();
    expect(result?.usedFallback).toBe(false);
    expect(result?.source.id).toBe("ug-your-song");
    expect(result?.timeline.baseId).toBe(YOUR_SONG);
    expect(result?.timeline.chords.length).toBeGreaterThan(8);
    expect(result?.timeline.chords[0]).toMatchObject({ beat: 0, name: "Eb", durationBeats: 4 });
    expect(result?.timeline.coverage).toBe("opening-section");
    expect(result?.timeline.provenance.provider).toBe("ultimate-guitar");
    expect(result?.timeline.provenance.sourceUrl).toMatch(/^https:\/\/tabs\.ultimate-guitar\.com\//);
    expect(JSON.stringify(result?.timeline)).not.toMatch(/lyrics|tablature|chartText/i);
  });

  it("keeps every curated chart voicing musically consistent with its symbol", async () => {
    const timeline = await loadChordTimeline(YOUR_SONG);
    expect(timeline).not.toBeNull();
    for (const chord of timeline?.chords ?? []) {
      const expected = new Set(chordPitchClasses(chord.name));
      const actual = new Set((chord.notes ?? []).map((midi) => ((midi % 12) + 12) % 12));
      expect(actual, `${chord.name} at beat ${chord.beat}`).toEqual(expected);
    }
  });

  it("normalizes aliases, ordering, repeated labels, and overlapping spans", () => {
    const timeline = normalizeChordTimeline({
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test Song",
      artist: "Tester",
      chords: [
        { startBeat: 4, endBeat: 12, name: "G" },
        { beat: 0, durationBeats: 8, name: "C" },
        { beat: 8, durationBeats: 4, name: "C" },
      ],
      provenance: { sourceId: "test", provider: "test", kind: "chart", sourceRef: "test" },
    });
    expect(timeline.chords).toEqual([
      { beat: 0, durationBeats: 4, name: "C" },
      { beat: 4, durationBeats: 4, name: "G" },
      { beat: 8, durationBeats: 4, name: "C" },
    ]);
    expect(timeline.durationBeats).toBe(12);
  });

  it("rejects source maps that could carry raw tab payload or escape the catalog root", () => {
    const map = {
      schemaVersion: 1,
      entries: [{
        baseId: "test-song",
        canonicalTitle: "Test",
        canonicalArtist: "Tester",
        lyrics: "not allowed",
        sources: [{ id: "chart", provider: "ug", kind: "chart", sourceRef: "ug:test", artifactPath: "../raw.json" }],
      }],
    };
    const errors = validateChordSourceMap(map);
    expect(errors.some((error) => /lyrics|artifactPath/.test(error))).toBe(true);
    expect(() => parseChordSourceMap(map)).toThrow(/invalid chord source map/);
  });

  it("rejects raw chart payload keys nested in timeline provenance", () => {
    expect(() => normalizeChordTimeline({
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test",
      artist: "Tester",
      chords: [{ beat: 0, name: "C", notes: [48, 52, 55] }],
      provenance: { sourceId: "chart", provider: "ug", kind: "chart", sourceRef: "ug:test", rawText: "not allowed" },
    })).toThrow(/rawText/);
  });

  it("rejects a chart voicing that omits a required chord tone", () => {
    expect(() => normalizeChordTimeline({
      schemaVersion: 1,
      baseId: "test-song",
      title: "Test",
      artist: "Tester",
      chords: [{ beat: 0, name: "C7", notes: [48, 55, 58] }],
      provenance: { sourceId: "chart", provider: "ug", kind: "chart", sourceRef: "ug:test" },
    })).toThrow(/missing chord pitch classes/);
  });

  it("falls back to generated notes.json when a mapped chart artifact is unavailable", async () => {
    const root = await mkdtemp("keyspilli-chords-");
    try {
      const baseId = "fallback-song";
      const mappingPath = join(root, "map.json");
      const notesPath = join(root, "artifacts", baseId, "a", "notes.json");
      await mkdir(join(root, "artifacts", baseId, "a"), { recursive: true });
      await writeFile(mappingPath, JSON.stringify({
        schemaVersion: 1,
        entries: [{
          baseId,
          canonicalTitle: "Fallback Song",
          canonicalArtist: "Tester",
          fallbackSourceId: "midi",
          sources: [
            { id: "chart", provider: "ultimate-guitar", kind: "chart", sourceRef: "ug:fallback", artifactPath: "missing.json" },
            { id: "midi", provider: "keyspilli", kind: "midi-derived", sourceRef: "variant:advanced:notes.json", confidence: "fallback" },
          ],
        }],
      }));
      await writeFile(notesPath, JSON.stringify({
        notes: [{ midi: 48, start: 0, dur: 8 }],
        chords: [{ beat: 0, name: "C", notes: [48, 60, 64] }, { beat: 4, name: "F", notes: [53, 57, 60] }],
        measures: [{ startBeat: 0, endBeat: 8 }],
      }));
      const result = await resolveChordTimeline(baseId, { mappingPath, catalogRoot: root, runtimeDataDir: root });
      expect(result?.usedFallback).toBe(true);
      expect(result?.source.id).toBe("midi");
      expect(result?.timeline.chords.map((chord) => chord.name)).toEqual(["C", "F"]);
      expect(result?.timeline.provenance.fallbackReason).toContain("notes.json");
      expect(result?.warnings[0]).toContain("chart");

      const mapMissing = await resolveChordTimeline(baseId, { mappingPath: join(root, "missing-map.json"), runtimeDataDir: root });
      expect(mapMissing?.usedFallback).toBe(true);
      expect(mapMissing?.warnings[0]).toContain("chord source map");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns the timeline directly for simple callers", async () => {
    const timeline = await loadChordTimeline(YOUR_SONG);
    expect(timeline?.schemaVersion).toBe(1);
    expect(timeline?.provenance.sourceId).toBe("ug-your-song");
  });
});
