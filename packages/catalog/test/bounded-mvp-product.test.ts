import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { writeMidi } from "@keyspilli/midi";
import { getSongsByBase } from "../src/db.js";
import { artifactsDir, uploadsDir } from "../src/paths.js";
import { groupSongs } from "../src/group.js";
import { ingestSource } from "../src/ingest.js";
import { projectPublicGroupedSongs, projectPublicSongRows } from "../src/public-difficulty.js";

const root = mkdtempSync(join(tmpdir(), "keyspilli-bounded-mvp-"));
const previousDataDir = process.env.KEYSPILLI_DATA_DIR;
const levels = ["vb", "b", "ve", "e", "m", "a"] as const;

function scoreXml(): Uint8Array {
  const notes = Array.from({ length: 12 }, (_, index) => {
    const midi = 60 + index;
    const step = ["C", "D", "E", "F", "G", "A", "B"][midi % 7]!;
    return `<note><pitch><step>${step}</step><octave>${Math.floor(midi / 12)}</octave></pitch>`
      + `<duration>480</duration><voice>1</voice><type>quarter</type></note>`;
  }).join("");
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>480</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${notes}</measure></part></score-partwise>`);
}

function midiSource(): Uint8Array {
  return writeMidi(
    Array.from({ length: 16 }, (_, index) => ({
      midi: 60 + (index % 8),
      start: index * 0.5,
      dur: 0.4,
      vel: 80,
    })),
    { tempoBpm: 120 },
  );
}

function mxlSource(xml: Uint8Array): Uint8Array {
  return new Uint8Array(zipSync({
    "META-INF/container.xml": new TextEncoder().encode(
      `<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>`,
    ),
    "score.xml": xml,
  }));
}

async function ingestUpload(baseId: string, bytes: Uint8Array) {
  return ingestSource({
    baseId,
    buf: bytes,
    title: "Bounded MVP upload",
    artist: "Keyspilli test",
    category: "Upload",
    contentType: "upload",
    acquiredVia: "upload",
  });
}

describe("bounded symbolic upload product path", () => {
  beforeAll(() => {
    process.env.KEYSPILLI_DATA_DIR = root;
  });

  afterAll(() => {
    if (previousDataDir === undefined) delete process.env.KEYSPILLI_DATA_DIR;
    else process.env.KEYSPILLI_DATA_DIR = previousDataDir;
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ["midi", "upload-mvp-midi", () => midiSource()],
    ["musicxml", "upload-mvp-musicxml", () => scoreXml()],
    ["mxl", "upload-mvp-mxl", () => mxlSource(scoreXml())],
  ] as const)("publishes six physical levels and five public levels for %s", async (format, baseId, makeBytes) => {
    const bytes = makeBytes();
    const result = await ingestUpload(baseId, bytes);

    expect(result).toEqual({ baseId, songIds: levels.map((level) => `${baseId}-${level}`) });
    const rows = getSongsByBase(baseId);
    expect(rows).toHaveLength(6);
    expect(projectPublicSongRows(rows).map((row) => row.level)).toEqual(["vb", "b", "e", "m", "a"]);
    const publicGroup = projectPublicGroupedSongs(groupSongs(rows));
    expect(publicGroup).toHaveLength(1);
    expect(publicGroup[0]!.representative.level).toBe("e");
    expect(publicGroup[0]!.levels.map((row) => row.level)).toEqual(["vb", "b", "e", "m", "a"]);

    for (const level of levels) {
      const dir = artifactsDir(baseId, level);
      expect(existsSync(join(dir, "variant.mid"))).toBe(true);
      expect(existsSync(join(dir, "variant.xml"))).toBe(true);
      expect(existsSync(join(dir, "notes.json"))).toBe(true);
    }

    const manifest = JSON.parse(readFileSync(join(root, "artifacts", baseId, "manifest.json"), "utf8")) as {
      sourceArtifactHash: string;
      candidate: {
        candidateId: string;
        candidateClass: string;
        provenanceClass: string;
        timingAuthority: string;
        alignmentState: string;
        generationEligibility: { eligible: boolean; code: string };
      };
    };
    expect(manifest.sourceArtifactHash).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(manifest.candidate).toEqual({
      candidateId: baseId,
      candidateClass: "GENERATION_CANDIDATE",
      provenanceClass: "USER_SUPPLIED_PRIVATE",
      timingAuthority: "NATIVE_AUTHORITATIVE",
      alignmentState: "NATIVE_AUTHORITATIVE",
      generationEligibility: { eligible: true, code: "READY_FOR_GENERATION" },
    });

    const extension = format === "midi" ? "mid" : format === "musicxml" ? "xml" : "mxl";
    expect(readFileSync(join(uploadsDir(), `${baseId}.${extension}`))).toEqual(Buffer.from(bytes));
  });

  it("retries the same native source against one stable base without duplicating rows", async () => {
    const bytes = midiSource();
    const baseId = "upload-mvp-retry";
    const first = await ingestUpload(baseId, bytes);
    const second = await ingestUpload(baseId, bytes);

    expect(first).toEqual(second);
    expect(getSongsByBase(baseId)).toHaveLength(6);
    expect(readFileSync(join(uploadsDir(), `${baseId}.mid`))).toEqual(Buffer.from(bytes));
  });

  it("fails closed for malformed input and invalid variants without a row or artifact tree", async () => {
    const malformedBase = "upload-mvp-malformed";
    const malformed = await ingestUpload(malformedBase, new TextEncoder().encode("<html>not a score</html>"));
    expect(malformed.error).toMatch(/parse failed|too few notes/i);
    expect(getSongsByBase(malformedBase)).toEqual([]);
    expect(existsSync(join(root, "artifacts", malformedBase))).toBe(false);

    const invalidBase = "upload-mvp-invalid-variant";
    const invalidXml = new TextDecoder().decode(scoreXml()).replace("<beat-type>4</beat-type>", "<beat-type>3</beat-type>");
    const invalid = await ingestUpload(invalidBase, new TextEncoder().encode(invalidXml));
    expect(invalid.error).toMatch(/validation failed|bad time signature/i);
    expect(getSongsByBase(invalidBase)).toEqual([]);
    expect(existsSync(join(root, "artifacts", invalidBase))).toBe(false);
  });
});
