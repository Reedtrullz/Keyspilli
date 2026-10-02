import { afterAll, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { NextRequest } from "next/server";
import { ingestSource, readArrangementManifest } from "@keyspilli/catalog";
import type { SourceArrangement } from "@keyspilli/catalog/src/source-arrangement";
import { writeMidi, writeMusicXml, type Note, type Variant } from "@keyspilli/midi";
import { DEFAULT_SETTINGS, PlaybackEngine, resolveTimedNotes } from "@keyspilli/player-core";
import { POST } from "../app/api/uploads/route";
import { getSongDetail } from "./catalog-api";
import { replayChordsBacking } from "../components/player/chords-backing";

const root = mkdtempSync(join(tmpdir(), "keyspilli-upload-chords-"));
const oldRoot = process.env.KEYSPILLI_DATA_DIR, oldToken = process.env.KEYSPILLI_API_TOKEN;
process.env.KEYSPILLI_DATA_DIR = root;
process.env.KEYSPILLI_API_TOKEN = "local-fixture-only";
afterAll(() => {
  if (oldRoot === undefined) delete process.env.KEYSPILLI_DATA_DIR; else process.env.KEYSPILLI_DATA_DIR = oldRoot;
  if (oldToken === undefined) delete process.env.KEYSPILLI_API_TOKEN; else process.env.KEYSPILLI_API_TOKEN = oldToken;
  rmSync(root, { recursive: true, force: true });
});

const notes: Note[] = Array.from({ length: 16 }, (_, i) => [[48, 52, 55], [41, 45, 48], [43, 47, 50], [48, 52, 55]][i % 4]!).flatMap((pitches, i) =>
  pitches.map(midi => ({ midi, start: i * 4 + 0.5, dur: 1, vel: 80, hand: i < 8 ? "L" : "R" })));
const midi = writeMidi(notes, { tempoBpm: 120, timeSig: [4, 4], tracks: [
  { name: "Left Hand", notes: notes.filter(n => n.hand === "L") },
  { name: "Right Hand", notes: notes.filter(n => n.hand === "R") },
] });
const xml = new TextEncoder().encode(writeMusicXml({ notes, chords: [], key: "C", tempoBpm: 120, timeSig: [4, 4],
  level: "advanced", difficultyScore: 1, bassPattern: "block", measures: Array.from({ length: 16 }, (_, index) => ({ index, startBeat: index * 4, endBeat: index * 4 + 4 })),
} as Variant, "Original source-rest study", "Test"));
const mxl = zipSync({ "score.musicxml": xml });

// Add a real conductor track: 120 BPM for 8 beats, then 60. This independently
// checks the parser/integrator rather than feeding already flattened beat data.
function withTempoChange(bytes: Uint8Array): Uint8Array {
  const header = Buffer.from(bytes.slice(0, 14));
  header.writeUInt16BE(header.readUInt16BE(10) + 1, 10);
  const body = Buffer.from([0, 255, 81, 3, 7, 161, 32, 0x9e, 0, 255, 81, 3, 15, 66, 64, 0, 255, 47, 0]);
  const chunk = Buffer.alloc(8); chunk.write("MTrk"); chunk.writeUInt32BE(body.length, 4);
  return new Uint8Array(Buffer.concat([header, bytes.slice(14), chunk, body]));
}

it("takes MIDI, MusicXML, MXL and all three worker ingest contracts through real Player playback reproducibly", async () => {
  const cases = [
    { name: "midi", buf: midi }, { name: "musicxml", buf: xml }, { name: "mxl", buf: mxl },
    { name: "tempo-map", buf: withTempoChange(midi) },
    { name: "transcription", buf: midi, acquiredVia: "youtube" },
    { name: "tutorial", buf: midi, acquiredVia: "colored-keyboard-video" },
    { name: "native", buf: midi, acquiredVia: "verified-native-midi" },
  ];
  for (const c of cases) {
    const hash = createHash("sha256").update(c.buf).digest("hex");
    const sourceKind = c.name === "tutorial" ? "tutorial-preview" : "verified-native-midi";
    const sourceArrangement: SourceArrangement = {
      beta: true, sourceKind, sourceSha256: hash, realizationSha256: hash, candidateSetDigest: hash,
      requestedUrl: "https://example.org/requested", actualSourceUrl: "https://example.org/fixture",
      arrangementTitle: "Original source-rest study", artist: "Test", title: "Study", timingOwner: "selected-arrangement",
      containsMelody: c.name === "tutorial" ? null : false, license: c.name === "tutorial" ? "unverified" : "CC0-1.0",
      licenseEvidenceUrl: "https://example.org/fixture", verificationEvidenceUrl: "https://example.org/fixture",
    };
    const run = async () => {
      if (!c.acquiredVia) {
        const response = await POST(new NextRequest("http://localhost/api/uploads?title=Study&artist=Test", {
          method: "POST", headers: { authorization: "Bearer local-fixture-only" }, body: Buffer.from(c.buf),
        }));
        expect(response.status, c.name + ": " + await response.clone().text()).toBe(200);
        return await response.json() as { baseId: string; songIds: string[] };
      }
      const sourceRoute = c.name !== "transcription";
      const result = await ingestSource({ buf: c.buf, baseId: `test-${c.name}`, title: "Study", artist: "Test",
        contentType: "youtube", acquiredVia: c.acquiredVia, sourceYoutubeUrl: "https://www.youtube.com/watch?v=abcdefghijk",
        ...(sourceRoute ? { sourceArrangement, sourceArtifactHash: hash, cleanTranscription: false, maxDurBeats: null, arrangementProfile: "source" as const } : {}),
      });
      expect(result.error, c.name).toBeUndefined();
      return result;
    };
    const first = await run();
    expect(first.songIds, c.name).toHaveLength(6);
    const detail = await getSongDetail(first.songIds.find(id => id.endsWith("-e"))!);
    expect(detail?.chordUnavailableReason, c.name).toBeNull();
    const data = (detail!.chordData ?? detail!.data)!;
    const replay = replayChordsBacking(data);
    expect(replay.resolution.notes, c.name).toEqual([]);
    expect(replay.resolution.chords.map(chord => chord.name), c.name).toEqual(Array.from({ length: 16 }, (_, i) => ["C", "F", "G", "C"][i % 4]));
    const times = replay.resolution.chords.map(chord => [chord.beat * 60 / data.tempoBpm, chord.durationBeats! * 60 / data.tempoBpm]);
    expect(times, c.name).toEqual(Array.from({ length: 16 }, (_, i) => c.name === "tempo-map" && i >= 2 ? [i * 4 - 3.5, 1] : [i * 2 + 0.25, 0.5]));
    const heard: number[][] = [];
    let engine: PlaybackEngine;
    engine = new PlaybackEngine({ ensure() {}, noteOn() { throw new Error("source melody leaked"); }, noteOff() {},
      playChord(_notes, when, duration) { heard.push([Number((engine.time + when).toFixed(6)), duration]); },
      cancelAll() {}, setGains() {}, dispose() {}, metronomeClick() {}, sustainPedal: true,
    }, resolveTimedNotes({ ...data, notes: replay.resolution.notes }, 1, 0), replay.arrangementEnd * 60 / data.tempoBpm,
    data, { ...DEFAULT_SETTINGS, backgroundMode: "chord" }, replay.resolution.chords);
    engine.start(); while (engine.playing) engine.tick(1 / 60);
    expect(heard, c.name).toEqual(times);
    const artifact = readFileSync(join(root, "artifacts", first.baseId, "a", "variant.mid"));
    const manifest = await readArrangementManifest(first.baseId);
    const second = await run();
    const again = await getSongDetail(second.songIds.find(id => id.endsWith("-e"))!);
    expect(second, c.name).toEqual({ ...first, ...("reused" in first ? { reused: true } : {}) });
    expect(replayChordsBacking((again!.chordData ?? again!.data)!).resolution, c.name).toEqual(replay.resolution);
    expect(readFileSync(join(root, "artifacts", first.baseId, "a", "variant.mid")), c.name).toEqual(artifact);
    const after = await readArrangementManifest(first.baseId);
    expect(after.status).toBe("valid");
    if (manifest.status === "valid" && after.status === "valid") {
      expect(after.manifest.configFingerprint).toBe(manifest.manifest.configFingerprint);
      expect(after.manifest.sourceArtifactHash).toBe(hash);
    }
  }
}, 60_000);

it("keeps an ingested solo line silent even when the arranger assigns it to the left hand", async () => {
  const buf = writeMidi(Array.from({ length: 32 }, (_, i) => ({ midi: [48, 50, 52, 53, 55, 57, 59, 60][i % 8]!, start: i, dur: 0.75, vel: 80 })), { tempoBpm: 120 });
  const result = await ingestSource({ buf, baseId: "solo-line", title: "Solo line", artist: "Test", contentType: "upload" });
  expect(result.error).toBeUndefined();
  const detail = (await getSongDetail("solo-line-e"))!;
  const replay = replayChordsBacking((detail.chordData ?? detail.data)!);
  expect(replay.resolution.chords).toEqual([]);
  expect(replay.resolution.notes).toEqual([]);
  expect(replay.selected.source?.chords.some(c => c.reviewReason)).toBe(true);
});
