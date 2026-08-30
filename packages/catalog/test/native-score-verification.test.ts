import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeMidi, type Note } from "@keyspilli/midi";
import {
  nativeScoreVerificationJson,
  verifyNativeScoreIdentity,
  type NativeScoreVerificationCandidate,
  type NativeScoreVerificationOmrSummary,
  type PdfForensicsReportLike,
} from "../src/native-score-verification.js";

function notes(count = 8, startPitch = 60): Note[] {
  return Array.from({ length: count }, (_, index) => ({
    midi: startPitch + (index % 5),
    start: index,
    dur: 1,
    vel: 90,
  }));
}

function forensics(title: string | null, pages = 2): PdfForensicsReportLike {
  return {
    schemaVersion: 1,
    status: "ok",
    identity: { bytes: 1234, pages, sha256: "a".repeat(64) },
    metadata: {
      title,
      author: "Composer",
      composerHints: ["Composer"],
      subject: "Piano score",
      keywords: ["piano"],
      creator: null,
      producer: null,
      creationDate: null,
      modificationDate: null,
      sourceApplication: null,
      sourceIds: [],
      downloadIdentifiers: [],
      unknown: [],
    },
    xmp: { present: false, title: null, creator: null, creatorTool: null, createDate: null, modifyDate: null, documentId: null, instanceId: null },
    links: [],
    evidence: [],
    errors: [],
  };
}

function weakForensics(title: string | null): PdfForensicsReportLike {
  return {
    schemaVersion: 1,
    status: "ok",
    identity: { bytes: null, pages: null, sha256: null },
    metadata: { title, author: null, composerHints: [], subject: null, keywords: [] },
    xmp: null,
  };
}

async function candidate(directory: string, title: string, extra: Partial<NativeScoreVerificationCandidate> = {}): Promise<NativeScoreVerificationCandidate> {
  const path = join(directory, "native-score.mid");
  await writeFile(path, writeMidi(notes(), { tempoBpm: 120, timeSig: [4, 4], title }));
  return {
    id: "native-score",
    path,
    artifactType: "midi",
    permitted: true,
    provenance: "publisher export",
    version: "v1",
    label: title,
    ...extra,
  };
}

describe("native symbolic score verification", () => {
  it("gives an eligible native match priority over contradictory OMR", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-native-verification-"));
    const native = await candidate(directory, "Moonlight Sonata");
    const omr: NativeScoreVerificationOmrSummary = {
      id: "wrong-omr",
      title: "Different Song",
      measureCount: 99,
      staffCount: 7,
      partCount: 4,
      confidence: 0.99,
    };

    const result = await verifyNativeScoreIdentity(forensics("Moonlight Sonata"), native, omr);

    expect(result.classification).toBe("EXACT_OR_HIGH_CONFIDENCE_MATCH");
    expect(result.eligibleAsReference).toBe(true);
    expect(result.nativePriority).toBe(true);
    expect(result.symbolic).toMatchObject({ format: "midi", measureCount: 2, partCount: null, staffCount: null, tempoBpm: 120, timeSignature: [4, 4] });
    expect(result.omr?.title).toBe("Different Song");
    expect(JSON.stringify(result)).not.toContain(directory);
    expect(JSON.stringify(result)).not.toContain("notes");
  });

  it("does not promote a title-only mismatch to a reference", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-native-verification-"));
    const native = await candidate(directory, "Other Song");

    const result = await verifyNativeScoreIdentity(forensics("Moonlight Sonata"), native);

    expect(result.classification).toBe("UNKNOWN");
    expect(result.eligibleAsReference).toBe(false);
    expect(result.reasons).toContain("symbolic title does not match PDF title");
  });

  it("keeps a title-only PDF identity review-required even when the MIDI parses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-native-verification-"));
    const native = await candidate(directory, "Moonlight Sonata");

    const result = await verifyNativeScoreIdentity(weakForensics("Moonlight Sonata"), native);

    expect(result.symbolic).not.toBeNull();
    expect(result.classification).toBe("UNKNOWN");
    expect(result.eligibleAsReference).toBe(false);
    expect(result.reasons).toContain("insufficient independent identity evidence for automatic reference use");
  });

  it("classifies a structurally disagreeing candidate as the wrong arrangement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-native-verification-"));
    const native = await candidate(directory, "Moonlight Sonata");
    const omr: NativeScoreVerificationOmrSummary = {
      id: "audiveris",
      title: "Moonlight Sonata",
      measureCount: 7,
      staffCount: 2,
      partCount: 1,
      tempoBpm: 120,
      timeSignature: [4, 4],
      confidence: 0.9,
    };

    const result = await verifyNativeScoreIdentity(forensics("Moonlight Sonata"), native, omr);

    expect(result.classification).toBe("WRONG_ARRANGEMENT");
    expect(result.eligibleAsReference).toBe(false);
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ signal: "measure-count", outcome: "mismatch" }),
    ]));
  });

  it("fails closed when provenance or version is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-native-verification-"));
    const native = await candidate(directory, "Moonlight Sonata", { provenance: null, version: null });

    const result = await verifyNativeScoreIdentity(forensics("Moonlight Sonata"), native);

    expect(result.classification).toBe("UNKNOWN");
    expect(result.eligibleAsReference).toBe(false);
    expect(result.discovery.rejected).toEqual([
      { id: "native-score", reason: "native artifact requires provenance and version" },
    ]);
  });

  it("fails closed for malformed symbolic bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-native-verification-"));
    const native = await candidate(directory, "Moonlight Sonata");
    await writeFile(native.path!, Buffer.from("not a MIDI file"));

    const result = await verifyNativeScoreIdentity(forensics("Moonlight Sonata"), native);

    expect(result.classification).toBe("UNKNOWN");
    expect(result.eligibleAsReference).toBe(false);
    expect(result.discovery.rejected).toEqual([
      { id: "native-score", reason: "invalid artifact format" },
    ]);
  });

  it("fails closed when a native header is valid but symbolic parsing fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-native-verification-"));
    const native = await candidate(directory, "Moonlight Sonata");
    const bytes = Buffer.alloc(23);
    bytes.write("MThd", 0, "ascii");
    bytes.writeUInt32BE(6, 4);
    bytes.writeUInt16BE(0, 8);
    bytes.writeUInt16BE(1, 10);
    bytes.writeUInt16BE(480, 12);
    bytes.write("MTrk", 14, "ascii");
    bytes.writeUInt32BE(1, 18);
    bytes[22] = 0;
    await writeFile(native.path!, bytes);

    const result = await verifyNativeScoreIdentity(forensics("Moonlight Sonata"), native);

    expect(result.classification).toBe("UNKNOWN");
    expect(result.eligibleAsReference).toBe(false);
    expect(result.discovery.rejected).toEqual([
      { id: "native-score", reason: "invalid artifact format" },
    ]);
    expect(JSON.stringify(result)).not.toContain(directory);
  });

  it("extracts MusicXML parts, measures, staves, and score metadata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-native-verification-"));
    const path = join(directory, "native-score.musicxml");
    const xml = `<score-partwise version="4.0"><work><work-title>Moonlight Sonata</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><direction-type><metronome><per-minute>120</per-minute></metronome></direction-type></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note></measure><measure number="2"><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><staff>2</staff></note></measure></part></score-partwise>`;
    await writeFile(path, xml, "utf8");
    const result = await verifyNativeScoreIdentity(forensics("Moonlight Sonata"), {
      id: "native-score",
      path,
      artifactType: "musicxml",
      permitted: true,
      provenance: "publisher export",
      version: "v1",
    });

    expect(result.classification).toBe("EXACT_OR_HIGH_CONFIDENCE_MATCH");
    expect(result.symbolic).toMatchObject({ format: "musicxml", measureCount: 2, partCount: 1, staffCount: 2, tempoBpm: 120, durationBeats: 8, title: "Moonlight Sonata" });
  });

  it("serializes deterministically regardless of OMR input order", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-native-verification-"));
    const native = await candidate(directory, "Moonlight Sonata");
    const left = await verifyNativeScoreIdentity(forensics("Moonlight Sonata"), native, {
      id: "omr", title: "Moonlight Sonata", measureCount: 2, confidence: 0.6,
    });
    const right = await verifyNativeScoreIdentity(forensics("Moonlight Sonata"), native, {
      confidence: 0.6, measureCount: 2, title: "Moonlight Sonata", id: "omr",
    });

    expect(nativeScoreVerificationJson(left)).toBe(nativeScoreVerificationJson(right));
    expect(nativeScoreVerificationJson(left)).not.toMatch(/absolute|path|observedAt|timestamp/);
  });
});
