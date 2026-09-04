import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { ingestSource } from "../src/ingest.js";
import { getSongsByBase } from "../src/db.js";
import { artifactsDir, uploadsDir } from "../src/paths.js";
import { maxDurationBeatsForTempo, writeMidi } from "@keyspilli/midi";

const tmp = mkdtempSync(join(tmpdir(), "keyspilli-catalog-"));
const OLD_DATA_DIR = process.env.KEYSPILLI_DATA_DIR;

function scoreXml(notes: number[]): string {
  const noteXmls = notes
    .map((midi) => {
      const step = ["C", "D", "E", "F", "G", "A", "B"][midi % 7]!;
      return `<note><pitch><step>${step}</step><octave>${Math.floor(midi / 12)}</octave></pitch>` +
        `<duration>480</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>480</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${noteXmls}</measure></part></score-partwise>`;
}

// A minimal zip whose central directory claims the given uncompressed sizes,
// used to exercise the pre-inflate guard without actually inflating anything.
function craftZip(entries: Array<{ name: string; uncompressed: number }>): Uint8Array {
  const parts: Buffer[] = [];
  let cdSize = 0;
  for (const e of entries) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); // central directory header signature
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt32LE(e.uncompressed, 24);
    const nameBuf = Buffer.from(e.name);
    h.writeUInt16LE(nameBuf.length, 28);
    parts.push(h, nameBuf);
    cdSize += 46 + nameBuf.length;
  }
  const cd = Buffer.concat(parts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(4, 16); // central directory starts after the 4-byte local-header prefix
  return new Uint8Array(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), cd, eocd]));
}

function ingest(buf: Uint8Array, title = "MXL Song"): Promise<{ baseId: string; songIds: string[]; error?: string }> {
  return ingestSource({
    buf,
    title,
    artist: "Tester",
    category: "Upload",
    contentType: "upload",
    acquiredVia: "upload",
  });
}

describe("ingestSource .mxl", () => {
  beforeAll(() => {
    process.env.KEYSPILLI_DATA_DIR = tmp;
  });
  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (OLD_DATA_DIR === undefined) delete process.env.KEYSPILLI_DATA_DIR;
    else process.env.KEYSPILLI_DATA_DIR = OLD_DATA_DIR;
  });

  it("unzips a compressed MusicXML score and ingests it", async () => {
    const xml = scoreXml([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]);
    const mxl = zipSync({
      "META-INF/container.xml": new TextEncoder().encode(
        `<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>`,
      ),
      "score.xml": new TextEncoder().encode(xml),
    });
    const res = await ingest(new Uint8Array(mxl));
    expect(res.error).toBeUndefined();
    expect(res.songIds).toHaveLength(6);
    const manifest = JSON.parse(readFileSync(join(tmp, "artifacts", res.baseId, "manifest.json"), "utf8")) as {
      identityStatus: string;
      sourceArtifactHash: string;
      configFingerprint: string;
      tempo: { calibration: { bpm: number }; playback: { bpm: number } };
      candidate: {
        candidateId: string;
        candidateClass: string;
        provenanceClass: string;
        timingAuthority: string;
        alignmentState: string;
        generationEligibility: { eligible: boolean; code: string };
      };
    };
    expect(manifest.identityStatus).toBe("current");
    expect(manifest.sourceArtifactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.configFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.tempo.calibration.bpm).toBe(manifest.tempo.playback.bpm);
    expect(manifest.candidate).toEqual({
      candidateId: res.baseId,
      candidateClass: "GENERATION_CANDIDATE",
      provenanceClass: "USER_SUPPLIED_PRIVATE",
      timingAuthority: "NATIVE_AUTHORITATIVE",
      alignmentState: "NATIVE_AUTHORITATIVE",
      generationEligibility: { eligible: true, code: "READY_FOR_GENERATION" },
    });
    const sidecar = JSON.parse(readFileSync(join(artifactsDir(res.baseId, "a"), "notes.json"), "utf8")) as {
      provenance: { candidate: typeof manifest.candidate };
    };
    expect(sidecar.provenance.candidate).toEqual(manifest.candidate);
  });

  it("bounds generated ids when display metadata is empty or unusually long", async () => {
    const xml = new Uint8Array(new TextEncoder().encode(scoreXml([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79])));
    const result = await ingestSource({
      buf: xml,
      title: "!!!",
      artist: "A".repeat(200),
      contentType: "upload",
    });
    expect(result.error).toBeUndefined();
    expect(result.baseId).toMatch(/^[a-z0-9][a-z0-9-]{0,119}$/);
    expect(result.baseId.length).toBeLessThanOrEqual(120);
  });

  it("prefers a .musicxml entry over META-INF files when container has no rootfile", async () => {
    const xml = scoreXml([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]);
    const mxl = zipSync({
      "META-INF/signatures.xml": new TextEncoder().encode("<Signature/>"),
      "META-INF/container.xml": new TextEncoder().encode('<?xml version="1.0"?><container><rootfiles/></container>'),
      "score.musicxml": new TextEncoder().encode(xml),
    });
    const res = await ingest(new Uint8Array(mxl));
    expect(res.error).toBeUndefined();
    expect(res.songIds).toHaveLength(6);
  });

  it("rejects a zip with more than 200 entries before inflating", async () => {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < 201; i++) entries[`f${i}.xml`] = new TextEncoder().encode("x");
    const res = await ingest(new Uint8Array(zipSync(entries)));
    expect(res.error).toContain("too many entries");
  });

  it("rejects a crafted central directory whose entries exceed the 64MB cap", async () => {
    const res = await ingest(craftZip([{ name: "score.musicxml", uncompressed: 65 * 1024 * 1024 }]));
    expect(res.error).toContain("expands beyond");
  });

  it("uses the variant tempo for duration when a tempo override is forwarded", async () => {
    const xml = new Uint8Array(new TextEncoder().encode(scoreXml([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79])));
    const slow = await ingestSource({ buf: xml, title: "Tempo Slow", artist: "Tester", contentType: "standard", tempo: 120 });
    const fast = await ingestSource({ buf: xml, title: "Tempo Fast", artist: "Tester", contentType: "standard", tempo: 240 });
    expect(slow.error).toBeUndefined();
    expect(fast.error).toBeUndefined();
    const slowDur = getSongsByBase(slow.baseId)[0]!.duration;
    const fastDur = getSongsByBase(fast.baseId)[0]!.duration;
    expect(fastDur).toBeLessThan(slowDur);
    expect(Math.abs(fastDur - slowDur / 2)).toBeLessThanOrEqual(1);
  });

  it("keeps the generated MIDI tempo when replacing an existing transcription", async () => {
    const notes = Array.from({ length: 12 }, (_, i) => ({
      midi: 60 + i,
      start: i * 0.5,
      dur: 0.5,
      vel: 80,
    }));
    const baseId = "transcription-tempo-refresh";
    const first = await ingestSource({
      buf: writeMidi(notes, { tempoBpm: 75 }),
      title: "Tempo refresh",
      artist: "Tester",
      contentType: "youtube",
      acquiredVia: "youtube",
      baseId,
      cleanTranscription: false,
    });
    expect(first.error).toBeUndefined();

    // A worker replacement receives a newly generated MIDI whose beat grid
    // is authoritative. Omitting the old row tempo must therefore publish
    // the parsed 120 BPM value rather than stretching the new timeline with
    // the stale 75 BPM metadata from the first run.
    const second = await ingestSource({
      buf: writeMidi(notes, { tempoBpm: 120 }),
      title: "Tempo refresh",
      artist: "Tester",
      contentType: "youtube",
      acquiredVia: "youtube",
      baseId,
      cleanTranscription: false,
    });
    expect(second.error).toBeUndefined();
    expect(getSongsByBase(baseId).every((row) => row.tempo === 120)).toBe(true);
  });

  it("does not let temporary cleanup hand labels suppress learner voice redistribution", async () => {
    const notes = Array.from({ length: 24 }, (_, i) => {
      const start = i * 0.5;
      return [
        { midi: 35, start, dur: 0.4, vel: 70 },
        { midi: 47, start, dur: 0.4, vel: 70 },
        { midi: 54, start, dur: 0.4, vel: 68 },
        { midi: 59, start, dur: 0.4, vel: 66 },
        { midi: 64, start, dur: 0.4, vel: 64 },
        { midi: 72 + (i % 5), start, dur: 0.35, vel: 90 },
      ];
    }).flat();
    const baseId = "learner-cleanup-hands";
    const result = await ingestSource({
      buf: writeMidi(notes, { tempoBpm: 100 }),
      title: "Learner cleanup hands",
      artist: "Tester",
      contentType: "youtube",
      acquiredVia: "youtube",
      baseId,
      cleanTranscription: true,
    });
    expect(result.error).toBeUndefined();
    const advanced = JSON.parse(readFileSync(join(artifactsDir(baseId, "a"), "notes.json"), "utf8")) as {
      notes: { midi: number; start: number; hand?: "L" | "R" }[];
      warnings?: string[];
    };
    expect(advanced.warnings).toContain("learner inner-voice redistribution applied (inferred staff assignment)");
    const leftGroups = new Map<number, number>();
    for (const note of advanced.notes.filter((n) => n.hand === "L")) {
      leftGroups.set(note.start, (leftGroups.get(note.start) ?? 0) + 1);
    }
    expect([...leftGroups.values()].some((size) => size >= 3)).toBe(true);
  });

  it("publishes metal profile chords and path-free separation provenance at every level", async () => {
    const melody = Array.from({ length: 24 }, (_, index) => ({
      midi: 67 + (index % 5),
      start: index * 0.5,
      dur: 0.4,
      vel: 90,
      hand: "R" as const,
    }));
    const bass = Array.from({ length: 12 }, (_, index) => ({
      midi: [40, 43, 45][index % 3]!,
      start: index,
      dur: 0.8,
      vel: 72,
      hand: "L" as const,
    }));
    const chords = [
      { beat: 0, name: "E5", notes: [40, 47], sourceKind: "authored" as const, durationBeats: 4 },
      { beat: 4, name: "G5", notes: [43, 50], sourceKind: "authored" as const, durationBeats: 4 },
      { beat: 8, name: "A5", notes: [45, 52], sourceKind: "authored" as const, durationBeats: 4 },
    ];
    const baseId = "metal-provenance-fixture";
    const result = await ingestSource({
      buf: writeMidi([...melody, ...bass], {
        tempoBpm: 120,
        tracks: [
          { name: "RH", notes: melody },
          { name: "LH", notes: bass },
        ],
      }),
      title: "Synthetic Metal Fixture",
      artist: "Keyspilli Tests",
      contentType: "youtube",
      acquiredVia: "youtube",
      sourceYoutubeUrl: "https://www.youtube.com/watch?v=m3talT3st01",
      baseId,
      cleanTranscription: false,
      arrangementProfile: "metal",
      chords,
      transcription: {
        basicPitchVersion: "0.4.0",
        modelSerialization: "default",
        onsetThreshold: 0.5,
        frameThreshold: 0.35,
        tempo: 120,
        tempoSource: "detected",
        audioSource: "youtube",
        transcribedAt: "2026-08-27T08:00:00.000Z",
        separation: {
          separator: "demucs",
          version: "4.0.1",
          model: "htdemucs",
          stems: [
            { role: "vocals", noteCount: melody.length, confidence: 0.86 },
            { role: "bass", noteCount: bass.length, confidence: 0.79 },
            { role: "drums", noteCount: 0 },
            { role: "other", noteCount: 18, confidence: 0.74 },
          ],
        },
        metalArrangement: {
          arranger: "keyspilli-metal",
          version: "metal-arranger-v1",
          strategy: "vocal-then-riff",
          identitySource: "mixed",
          confidence: 0.81,
        },
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.songIds).toHaveLength(6);

    const manifest = JSON.parse(readFileSync(join(tmp, "artifacts", baseId, "manifest.json"), "utf8")) as {
      arrangementProfile: string;
      transcription: { separation: { stems: Array<Record<string, unknown>> }; metalArrangement: { strategy: string } };
    };
    expect(manifest.arrangementProfile).toBe("metal");
    expect(manifest.transcription.metalArrangement.strategy).toBe("vocal-then-riff");
    expect(manifest.transcription.separation.stems.every((stem) => !("path" in stem))).toBe(true);

    for (const level of ["vb", "b", "ve", "e", "m", "a"]) {
      const notes = JSON.parse(readFileSync(join(artifactsDir(baseId, level), "notes.json"), "utf8")) as {
        chords: typeof chords;
        provenance: { transcription: { separation: { model: string }; metalArrangement: { arranger: string } } };
      };
      expect(notes.chords).toEqual(chords);
      expect(notes.provenance.transcription.separation.model).toBe("htdemucs");
      expect(notes.provenance.transcription.metalArrangement.arranger).toBe("keyspilli-metal");
    }
  });

  it("keeps canonical metal tails and source-audio identity out of the YouTube cap", async () => {
    const sourceArtifactHash = "a".repeat(64);
    const source = writeMidi(
      Array.from({ length: 12 }, (_, index) => ({
        midi: 60 + index,
        start: index,
        dur: 3,
        vel: 84,
        hand: "R" as const,
      })),
      { tempoBpm: 120 },
    );
    const baseId = "metal-duration-policy";
    const result = await ingestSource({
      buf: source,
      sourceArtifactHash,
      title: "Metal Duration Policy",
      artist: "Keyspilli Tests",
      contentType: "youtube",
      acquiredVia: "youtube",
      sourceYoutubeUrl: "https://www.youtube.com/watch?v=metalDuration01",
      baseId,
      cleanTranscription: false,
      arrangementProfile: "metal",
    });
    expect(result.error).toBeUndefined();
    const manifest = JSON.parse(readFileSync(join(tmp, "artifacts", baseId, "manifest.json"), "utf8")) as {
      sourceArtifactHash: string;
    };
    expect(manifest.sourceArtifactHash).toBe(sourceArtifactHash);
    expect(getSongsByBase(baseId).every((song) => song.style === "metal")).toBe(true);
    const advanced = JSON.parse(readFileSync(join(artifactsDir(baseId, "a"), "notes.json"), "utf8")) as {
      notes: { dur: number }[];
    };
    expect(Math.max(...advanced.notes.map((note) => note.dur))).toBeGreaterThan(1.5);
  });

  it("reattaches metal identity sources after the arranged MIDI roundtrip", async () => {
    const rh = Array.from({ length: 32 }, (_, index) => ({
      midi: index === 1 ? 72 : index === 9 ? 74 : index === 17 ? 76 : 64 + (index % 4),
      start: index * 0.25,
      dur: 0.2,
      vel: 84,
      hand: "R" as const,
    }));
    const lh = Array.from({ length: 8 }, (_, start) => ({ midi: 40, start, dur: 0.8, vel: 72, hand: "L" as const }));
    const identitySources = rh.map((note, index) => ({
      start: note.start,
      midi: note.midi,
      identitySource: index === 1 || index === 9 || index === 17 ? "vocals" as const : "guitar" as const,
    }));
    const baseId = "metal-identity-roundtrip";
    const result = await ingestSource({
      buf: writeMidi([...rh, ...lh], {
        tempoBpm: 120,
        tracks: [
          { name: "Right Hand Vocals", notes: rh.filter((_, index) => index === 1 || index === 9 || index === 17) },
          { name: "Right Hand Guitar", notes: rh.filter((_, index) => index !== 1 && index !== 9 && index !== 17) },
          { name: "Left Hand", notes: lh },
        ],
      }),
      title: "Metal Identity Roundtrip",
      artist: "Keyspilli Tests",
      contentType: "youtube",
      baseId,
      cleanTranscription: false,
      arrangementProfile: "metal",
    });
    expect(result.error).toBeUndefined();
    const medium = JSON.parse(readFileSync(join(artifactsDir(baseId, "m"), "notes.json"), "utf8")) as {
      notes: Array<{ start: number; midi: number; identitySource?: string }>;
    };
    for (const anchor of identitySources.filter((source) => source.identitySource === "vocals")) {
      expect(medium.notes.some((note) => note.start === anchor.start && note.midi === anchor.midi
        && note.identitySource === "vocals")).toBe(true);
    }
  });

  it("preserves a persisted metal profile when a rebuild omits the profile option", async () => {
    const source = writeMidi(
      Array.from({ length: 12 }, (_, index) => ({
        midi: 48 + index,
        start: index,
        dur: 3,
        vel: 84,
        hand: "R" as const,
      })),
      { tempoBpm: 120 },
    );
    const baseId = "metal-profile-rebuild";
    const first = await ingestSource({
      buf: source,
      title: "Metal profile rebuild",
      artist: "Keyspilli Tests",
      contentType: "youtube",
      acquiredVia: "youtube",
      sourceYoutubeUrl: "https://www.youtube.com/watch?v=metalRebuild01",
      baseId,
      cleanTranscription: false,
      arrangementProfile: "metal",
    });
    expect(first.error).toBeUndefined();

    // A catalog maintenance caller that only knows the stable base id must
    // not silently reintroduce the legacy YouTube sustain cap.
    const rebuilt = await ingestSource({
      buf: source,
      title: "Metal profile rebuild",
      artist: "Keyspilli Tests",
      contentType: "youtube",
      acquiredVia: "youtube",
      sourceYoutubeUrl: "https://www.youtube.com/watch?v=metalRebuild01",
      baseId,
      cleanTranscription: false,
    });
    expect(rebuilt.error).toBeUndefined();
    const manifest = JSON.parse(readFileSync(join(tmp, "artifacts", baseId, "manifest.json"), "utf8")) as {
      arrangementProfile: string;
    };
    expect(manifest.arrangementProfile).toBe("metal");
    const advanced = JSON.parse(readFileSync(join(artifactsDir(baseId, "a"), "notes.json"), "utf8")) as {
      notes: { dur: number }[];
    };
    expect(Math.max(...advanced.notes.map((note) => note.dur))).toBeGreaterThan(1.5);
  });

  it("falls back to a safe tempo when the source MIDI tempo is invalid", async () => {
    // Build a valid note stream whose tempo meta is zero.  The parser treats
    // that malformed meta as an unknown tempo; ingestion must normalize it to
    // the publish-safe 120 BPM fallback rather than persisting NaN/Infinity.
    const source = writeMidi(
      Array.from({ length: 12 }, (_, i) => ({ midi: 60 + i, start: i, dur: 0.5, vel: 80 })),
      { tempoBpm: 0 },
    );
    const res = await ingestSource({
      buf: source,
      title: "As Time Goes By",
      artist: "Tester",
      contentType: "standard",
      baseId: "invalid-source-tempo",
    });
    expect(res.error).toBeUndefined();
    expect(getSongsByBase("invalid-source-tempo").every((row) => row.tempo === 120)).toBe(true);
  });

  it("rejects invalid variants before publishing any artifacts or rows", async () => {
    const xml = new Uint8Array(new TextEncoder().encode(
      scoreXml([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]).replace(
        "<beat-type>4</beat-type>",
        "<beat-type>3</beat-type>",
      ),
    ));
    const baseId = "atomic-invalid";
    const res = await ingestSource({
      buf: xml,
      title: "Invalid",
      artist: "Tester",
      contentType: "upload",
      baseId,
    });
    expect(res.error).toContain("bad time signature");
    expect(getSongsByBase(baseId)).toEqual([]);
    expect(existsSync(artifactsDir(baseId, "vb"))).toBe(false);
  });

  it("restores artifacts and rows when publication fails after rename", async () => {
    const xml = new Uint8Array(new TextEncoder().encode(scoreXml([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79])));
    const baseId = "atomic-rollback";
    const first = await ingestSource({
      buf: xml,
      title: "Before",
      artist: "Tester",
      contentType: "upload",
      baseId,
    });
    expect(first.error).toBeUndefined();
    const beforeRows = getSongsByBase(baseId);
    const beforeFiles = ["vb", "b", "ve", "e", "m", "a"].flatMap((level) => [
      join(artifactsDir(baseId, level), "variant.mid"),
      join(artifactsDir(baseId, level), "variant.xml"),
      join(artifactsDir(baseId, level), "notes.json"),
    ]).map((path) => [path, readFileSync(path)] as const);
    const uploadPath = join(uploadsDir(), `${baseId}.xml`);
    beforeFiles.push([uploadPath, readFileSync(uploadPath)]);

    const failed = await ingestSource(
      { buf: xml, title: "After", artist: "Tester", contentType: "upload", baseId },
      { beforeReplace: () => { throw new Error("injected publication failure"); } },
    );
    expect(failed.error).toContain("publish failed");
    expect(getSongsByBase(baseId)).toEqual(beforeRows);
    for (const [path, bytes] of beforeFiles) expect(readFileSync(path)).toEqual(bytes);
  });

  it("preserves engagement metadata when an existing base is re-ingested", async () => {
    const xml = new Uint8Array(new TextEncoder().encode(scoreXml([60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79])));
    const baseId = "preserve-metadata";
    const first = await ingestSource({
      buf: xml,
      title: "Before",
      artist: "Tester",
      contentType: "upload",
      baseId,
    });
    expect(first.error).toBeUndefined();
    const before = getSongsByBase(baseId);
    const createdAt = before[0]!.createdAt;
    const db = (await import("../src/db.js")).getDb();
    db.prepare("UPDATE songs SET plays = 17 WHERE base_id = ?").run(baseId);

    const second = await ingestSource({
      buf: xml,
      title: "After",
      artist: "Tester",
      contentType: "upload",
      baseId,
    });
    expect(second.error).toBeUndefined();
    const after = getSongsByBase(baseId);
    expect(after.every((row) => row.plays === 17)).toBe(true);
    expect(after.every((row) => row.createdAt === createdAt)).toBe(true);
    expect(after.every((row) => row.title === "After")).toBe(true);
  });

  it("can preserve a curated YouTube MIDI without transcription cleanup", async () => {
    const notes = Array.from({ length: 12 }, (_, i) => ({
      midi: 60 + i,
      start: i,
      dur: 0.5,
      vel: i === 0 ? 10 : 80,
    }));
    const buf = writeMidi(notes, { tempoBpm: 120 });
    const baseId = "curated-youtube-raw";
    const res = await ingestSource({
      buf,
      title: "Curated",
      artist: "Tester",
      contentType: "youtube",
      acquiredVia: "youtube",
      sourceRef: "seed:curated-youtube-raw.mid",
      baseId,
      cleanTranscription: false,
    });
    expect(res.error).toBeUndefined();
    const advanced = JSON.parse(readFileSync(join(artifactsDir(baseId, "a"), "notes.json"), "utf8")) as { notes: { midi: number }[] };
    expect(advanced.notes.some((n) => n.midi === 60)).toBe(true);
    const artifact = JSON.parse(readFileSync(join(artifactsDir(baseId, "a"), "notes.json"), "utf8")) as {
      provenance: { kind: string; acquiredVia: string; sourceRef: string };
    };
    expect(artifact.provenance).toMatchObject({
      kind: "youtube",
      acquiredVia: "youtube",
      sourceRef: "seed:curated-youtube-raw.mid",
    });
  });

  it("persists effective audio transcription settings in the manifest and notes sidecar", async () => {
    const transcription = {
      basicPitchVersion: "0.3.0",
      modelSerialization: "onnx",
      onsetThreshold: 0.65,
      frameThreshold: 0.45,
      tempo: 142,
      tempoSource: "detected" as const,
      audioSource: "youtube",
      transcribedAt: "2026-08-16T17:30:00.000Z",
      pipeline: {
        filterVersion: "audio-onset-filter-v1",
        normalizerId: "midi-normalizer-v2",
        gridPolicyId: "beat-grid-v2",
        variantPolicyId: "learner-variant-ladder-v3",
      },
      postProcessing: {
        filterApplied: true,
        cleanupApplied: true,
        onsetMatchSec: 0.15,
        onsetDetector: { sampleRate: 22050, hopLength: 512, backtrack: true, delta: 0.07 },
        minVelocity: 30,
        minDurationBeats: 0.14,
        mergeWindowBeats: 0.125,
        maxPolyphony: 6,
        maxSounding: 8,
        maxDurationSec: 2.5,
        maxDurationBeats: 5,
        importedMaxDurationBeats: 1.5,
        importedMaxSounding: 12,
      },
    };
    const buf = writeMidi(
      Array.from({ length: 12 }, (_, i) => ({ midi: 60 + i, start: i * 0.5, dur: 0.5, vel: 80 })),
      { tempoBpm: 142 },
    );
    const withProvenance = await ingestSource({
      buf,
      title: "Provenance song",
      artist: "Tester",
      contentType: "youtube",
      acquiredVia: "youtube",
      sourceYoutubeUrl: "https://youtube.example/video",
      baseId: "transcription-provenance",
      cleanTranscription: false,
      transcription,
    });
    expect(withProvenance.error).toBeUndefined();

    const manifest = JSON.parse(readFileSync(join(tmp, "artifacts", withProvenance.baseId, "manifest.json"), "utf8")) as {
      transcription?: typeof transcription;
      configFingerprint: string;
    };
    const notes = JSON.parse(readFileSync(join(artifactsDir(withProvenance.baseId, "a"), "notes.json"), "utf8")) as {
      provenance: {
        transcription?: typeof transcription;
        tempo: {
          calibration: { bpm: number; source: string; resolvedAt: string; role: string };
          playback: { bpm: number; source: string; resolvedAt: string; role: string };
        };
      };
    };
    expect(manifest.transcription).toEqual(transcription);
    expect(notes.provenance.transcription).toEqual(transcription);
    expect(notes.provenance.tempo).toEqual({
      calibration: expect.objectContaining({ bpm: 142, source: "detected", role: "source-calibration" }),
      playback: expect.objectContaining({ bpm: 142, source: "detected", role: "playback" }),
    });
    expect(notes.provenance.tempo.calibration.resolvedAt).toBe(notes.provenance.tempo.playback.resolvedAt);

    const standard = await ingestSource({
      buf,
      title: "Provenance song",
      artist: "Tester",
      contentType: "standard",
      baseId: "standard-without-transcription",
    });
    expect(standard.error).toBeUndefined();
    const standardManifest = JSON.parse(readFileSync(join(tmp, "artifacts", standard.baseId, "manifest.json"), "utf8")) as {
      transcription?: unknown;
      configFingerprint: string;
    };
    const standardNotes = JSON.parse(readFileSync(join(artifactsDir(standard.baseId, "a"), "notes.json"), "utf8")) as {
      provenance: { transcription?: unknown; tempo?: unknown };
    };
    expect(standardManifest.transcription).toBeUndefined();
    expect(standardNotes.provenance.transcription).toBeUndefined();
    expect(standardNotes.provenance.tempo).toEqual({
      calibration: expect.objectContaining({ bpm: 142, source: "midi-meta", role: "source-calibration" }),
      playback: expect.objectContaining({ bpm: 142, source: "midi-meta", role: "playback" }),
    });
    expect(standardManifest.configFingerprint).not.toBe(manifest.configFingerprint);
  });

  it("keeps the processing fingerprint stable when display and source labels change", async () => {
    const buf = writeMidi(
      Array.from({ length: 12 }, (_, i) => ({ midi: 60 + i, start: i * 0.5, dur: 0.5, vel: 80 })),
      { tempoBpm: 120 },
    );
    const first = await ingestSource({
      buf,
      title: "Original display title",
      artist: "Original display artist",
      contentType: "youtube",
      acquiredVia: "youtube",
      sourceRef: "source:original",
      sourceYoutubeUrl: "https://youtube.example/original",
      baseId: "fingerprint-display-original",
      cleanTranscription: false,
      maxDurBeats: 1.5,
      key: "C",
      tempo: 120,
    });
    const second = await ingestSource({
      buf,
      title: "Corrected display title",
      artist: "Corrected display artist",
      contentType: "youtube",
      acquiredVia: "catalog-relabel",
      sourceRef: "source:corrected",
      sourceYoutubeUrl: "https://youtube.example/corrected",
      baseId: "fingerprint-display-corrected",
      cleanTranscription: false,
      maxDurBeats: 1.5,
      key: "C",
      tempo: 120,
    });
    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();

    const readFingerprint = (baseId: string): string => {
      const manifest = JSON.parse(
        readFileSync(join(tmp, "artifacts", baseId, "manifest.json"), "utf8"),
      ) as { configFingerprint: string };
      return manifest.configFingerprint;
    };
    expect(readFingerprint(first.baseId)).toBe(readFingerprint(second.baseId));
  });

  it("caps long YouTube transcription tails before publishing variants", async () => {
    const notes = Array.from({ length: 24 }, (_, i) => ({
      midi: 60 + (i % 8),
      start: i * 0.5,
      dur: 3,
      vel: 80,
    }));
    const baseId = "youtube-duration-cap";
    const res = await ingestSource({
      buf: writeMidi(notes, { tempoBpm: 75 }),
      title: "Transcription duration cap",
      artist: "Tester",
      contentType: "youtube",
      acquiredVia: "youtube",
      baseId,
      cleanTranscription: false,
    });
    expect(res.error).toBeUndefined();
    const advanced = JSON.parse(readFileSync(join(artifactsDir(baseId, "a"), "notes.json"), "utf8")) as {
      notes: { start: number; dur: number }[];
    };
    expect(Math.max(...advanced.notes.map((n) => n.dur))).toBeLessThanOrEqual(1.5);
    expect(advanced.notes.some((n) => n.start === 0)).toBe(true);
  });

  it("preserves long human-authored sustains in standard imports", async () => {
    const notes = [
      { midi: 48, start: 0, dur: 100, vel: 80 },
      ...Array.from({ length: 11 }, (_, i) => ({ midi: 72 + i, start: i, dur: 0.75, vel: 80 })),
    ];
    const res = await ingestSource({
      buf: writeMidi(notes, { tempoBpm: 120 }),
      title: "Standard sustain wall",
      artist: "Tester",
      contentType: "standard",
      baseId: "standard-sustain-wall",
    });
    expect(res.error).toBeUndefined();
    expect(res.songIds).toHaveLength(6);
    const maxDur = maxDurationBeatsForTempo(120);
    const advanced = JSON.parse(readFileSync(join(artifactsDir("standard-sustain-wall", "a"), "notes.json"), "utf8")) as {
      notes: { start: number; dur: number }[];
    };
    // A standard MIDI/MusicXML source may intentionally hold a pedal/bass
    // note for many measures. The default standard path must not rewrite it
    // with the transcription tail ceiling.
    expect(Math.max(...advanced.notes.map((n) => n.dur))).toBeGreaterThan(maxDur);
  });

  it("caps staggered sounding walls in standard imports", async () => {
    const notes = Array.from({ length: 16 }, (_, i) => ({
      midi: 48 + i,
      start: i * 0.5,
      dur: 8,
      vel: 80,
    }));
    const res = await ingestSource({
      buf: writeMidi(notes, { tempoBpm: 120 }),
      title: "Staggered wall",
      artist: "Tester",
      contentType: "standard",
      baseId: "standard-staggered-wall",
    });
    expect(res.error).toBeUndefined();
    const advanced = JSON.parse(readFileSync(join(artifactsDir("standard-staggered-wall", "a"), "notes.json"), "utf8")) as {
      notes: { start: number; dur: number }[];
    };
    const events = advanced.notes.flatMap((n) => [[n.start, 1], [n.start + n.dur, -1]] as [number, number][])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let sounding = 0;
    let maxSounding = 0;
    for (const [, delta] of events) {
      sounding += delta;
      maxSounding = Math.max(maxSounding, sounding);
    }
    expect(maxSounding).toBeLessThanOrEqual(12);
  });
});
