import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  discoverNativeScoreArtifacts,
  nativeScoreDiscoveryJson,
  type NativeScoreArtifactInput,
} from "../src/native-score-discovery.js";
import { discoverNativeScoreArtifacts as discoverNativeScoreArtifactsFromIndex } from "../src/index.js";

function minimalMidi(): Buffer {
  const header = Buffer.alloc(14);
  header.write("MThd", 0, "ascii");
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(1, 10);
  header.writeUInt16BE(480, 12);
  const track = Buffer.alloc(8);
  track.write("MTrk", 0, "ascii");
  track.writeUInt32BE(0, 4);
  return Buffer.concat([header, track]);
}

function minimalMxl(label: string): Uint8Array {
  const xml = `<score-partwise version="4.0"><work><work-title>${label}</work-title></work><part-list><score-part id="P1"/></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;
  return zipSync({
    "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>'),
    "score.xml": strToU8(xml),
  });
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "keyspilli-native-score-"));
}

describe("native symbolic score discovery", () => {
  it("exports the discovery API from the catalogue package index", () => {
    expect(discoverNativeScoreArtifactsFromIndex).toBe(discoverNativeScoreArtifacts);
  });

  it("reads a permitted local artifact and sidecar, hashes it, and ranks it above OMR", async () => {
    const directory = await tempDir();
    const artifactPath = join(directory, "Defence Of Moscow.mid");
    const sidecarPath = join(directory, "Defence Of Moscow.mid.json");
    await writeFile(artifactPath, minimalMidi());
    await writeFile(sidecarPath, JSON.stringify({
      sourcePage: "https://example.test/scores/defence-of-moscow",
      artifactType: "midi",
      provenance: "artist-authorized score page",
      version: "2024-revision",
      accessMethod: "source-page",
      page: 3,
    }));

    const report = await discoverNativeScoreArtifacts({
      pdfMetadata: { title: "Defence Of Moscow", pages: 3 },
      sidecars: [sidecarPath],
      nativeArtifacts: [{ path: artifactPath, permitted: true }],
      omr: [{ id: "audiveris", version: "5.11.0", status: "review-required" }],
    });

    expect(report.status).toBe("native-symbolic");
    expect(report.selected?.artifactType).toBe("midi");
    expect(report.selected?.access).toBe("local-file");
    expect(report.selected?.sourcePage).toBe("https://example.test/scores/defence-of-moscow");
    expect(report.selected?.version).toBe("2024-revision");
    expect(report.selected?.page).toBe(3);
    expect(report.selected?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.selected?.bytes).toBe(22);
    expect(report.omr).toHaveLength(1);
    expect(report.rejected).toEqual([]);
    expect(JSON.stringify(report)).not.toContain(directory);
  });

  it("accepts sidecar metadata without treating a sidecar as musical truth", async () => {
    const directory = await tempDir();
    const sidecarPath = join(directory, "score.json");
    await writeFile(sidecarPath, JSON.stringify({
      candidates: [{
        artifactType: "musicxml",
        sourcePage: "https://scores.example.test/song",
        provenance: "publisher export",
        version: "v2",
        accessMethod: "source-research",
        page: 8,
      }],
    }));

    const report = await discoverNativeScoreArtifacts({ sidecars: [sidecarPath] });

    expect(report.status).toBe("review-required");
    expect(report.selected).toBeNull();
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0]).toMatchObject({
      artifactType: "musicxml",
      provenance: "publisher export",
      version: "v2",
      access: "source-research",
      page: 8,
    });
    expect(report.candidates[0]?.hashStatus).toBe("unavailable");
  });

  it("fails closed for remote, unpermitted, and protected artifact paths", async () => {
    const directory = await tempDir();
    const localPath = join(directory, "candidate.mid");
    await writeFile(localPath, Buffer.from("not actually a score"));

    const artifacts: NativeScoreArtifactInput[] = [
      { url: "https://downloads.example.test/song.mid", artifactType: "midi", permitted: true },
      { path: localPath, artifactType: "midi" },
      { path: "/Users/reidar/.ssh/id_rsa", artifactType: "midi", permitted: true },
    ];
    const report = await discoverNativeScoreArtifacts({ nativeArtifacts: artifacts });

    expect(report.status).toBe("failed");
    expect(report.selected).toBeNull();
    expect(report.candidates).toEqual([]);
    expect(report.rejected).toHaveLength(3);
    expect(report.rejected.map((item) => item.reason)).toEqual([
      "remote artifact access is disabled",
      "local artifact is not explicitly permitted",
      "protected artifact path",
    ]);
    expect(JSON.stringify(report)).not.toMatch(/Users\/reidar|id_rsa|downloads\.example/);
  });

  it("does not select ambiguous native versions and keeps ordering deterministic", async () => {
    const directory = await tempDir();
    const firstPath = join(directory, "first.mxl");
    const secondPath = join(directory, "second.mxl");
    await writeFile(firstPath, minimalMxl("version-a"));
    await writeFile(secondPath, minimalMxl("version-b"));
    const artifacts: NativeScoreArtifactInput[] = [
      {
        id: "version-b",
        path: secondPath,
        artifactType: "mxl",
        permitted: true,
        sourcePage: "https://example.test/b",
        provenance: "publisher export",
        version: "B",
      },
      {
        id: "version-a",
        path: firstPath,
        artifactType: "mxl",
        permitted: true,
        sourcePage: "https://example.test/a",
        provenance: "publisher export",
        version: "A",
      },
    ];

    const left = await discoverNativeScoreArtifacts({ nativeArtifacts: artifacts });
    const right = await discoverNativeScoreArtifacts({ nativeArtifacts: [...artifacts].reverse() });

    expect(left.status).toBe("ambiguous");
    expect(left.selected).toBeNull();
    expect(left.candidates).toEqual(right.candidates);
    expect(nativeScoreDiscoveryJson(left)).toBe(nativeScoreDiscoveryJson(right));
  });

  it("redacts absolute paths and rejects malformed sidecars without throwing", async () => {
    const directory = await tempDir();
    const sidecarPath = join(directory, "malformed.json");
    await writeFile(sidecarPath, "{not-json");
    const report = await discoverNativeScoreArtifacts({
      pdfPath: "/Users/reidar/Downloads/Defence Of Moscow.pdf",
      sidecars: [sidecarPath, "/Users/reidar/private/secret.json"],
    });

    expect(report.status).toBe("failed");
    expect(report.errors).toContain("sidecar metadata is malformed");
    expect(JSON.stringify(report)).not.toMatch(/Users\/reidar|secret\.json|malformed\.json/);
  });

  it("extracts safe PDF info metadata and falls back to explicit OMR evidence", async () => {
    const directory = await tempDir();
    const pdfPath = join(directory, "source-score.pdf");
    await writeFile(pdfPath, Buffer.from("%PDF-1.7 /Title (Native Score) /Author (Publisher) /Type /Page /Type /Page"));

    const report = await discoverNativeScoreArtifacts({
      pdfPath,
      omr: [
        { id: "audiveris", backend: "Audiveris", version: "5.11.0", status: "pass" },
        { id: "homr", backend: "homr", version: "0.1.0", status: "pass" },
      ],
    });

    expect(report.status).toBe("omr-consensus");
    expect(report.pdf).toMatchObject({ title: "Native Score", author: "Publisher", pages: 2 });
    expect(report.pdf?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.selected).toBeNull();
    expect(JSON.stringify(report)).not.toContain(pdfPath);
  });

  it("keeps unpermitted source-research paths out of native selection", async () => {
    const directory = await tempDir();
    const artifactPath = join(directory, "source.musicxml");
    await writeFile(artifactPath, "<score-partwise version=\"4.0\" />");

    const report = await discoverNativeScoreArtifacts({
      sourceResearchCandidates: [{
        id: "research-fallback",
        sourceType: "musicxml",
        localPath: artifactPath,
        provenance: "unknown mirror",
      }],
    });

    expect(report.status).toBe("failed");
    expect(report.selected).toBeNull();
    expect(report.rejected).toEqual([{ id: "research-fallback", reason: "local artifact is not explicitly permitted" }]);
  });

  it("does not trust permitted bytes without provenance/version or a native format signature", async () => {
    const directory = await tempDir();
    const missingMetadataPath = join(directory, "missing-metadata.mid");
    const malformedPath = join(directory, "malformed.mid");
    await writeFile(missingMetadataPath, minimalMidi());
    await writeFile(malformedPath, Buffer.concat([Buffer.from("MThd"), Buffer.alloc(10)]));

    const report = await discoverNativeScoreArtifacts({
      nativeArtifacts: [
        { id: "missing-metadata", path: missingMetadataPath, artifactType: "midi", permitted: true },
        { id: "malformed", path: malformedPath, artifactType: "midi", permitted: true, provenance: "publisher export", version: "v1" },
      ],
    });

    expect(report.status).toBe("failed");
    expect(report.selected).toBeNull();
    expect(report.rejected).toEqual([
      { id: "malformed", reason: "invalid artifact format" },
      { id: "missing-metadata", reason: "native artifact requires provenance and version" },
    ]);
  });

  it("rejects a header-valid MIDI whose track data cannot be parsed", async () => {
    const directory = await tempDir();
    const artifactPath = join(directory, "truncated.mid");
    const bytes = Buffer.alloc(23);
    bytes.write("MThd", 0, "ascii");
    bytes.writeUInt32BE(6, 4);
    bytes.writeUInt16BE(0, 8);
    bytes.writeUInt16BE(1, 10);
    bytes.writeUInt16BE(480, 12);
    bytes.write("MTrk", 14, "ascii");
    bytes.writeUInt32BE(1, 18);
    bytes[22] = 0;
    await writeFile(artifactPath, bytes);

    const report = await discoverNativeScoreArtifacts({
      nativeArtifacts: [{
        id: "truncated",
        path: artifactPath,
        artifactType: "midi",
        permitted: true,
        provenance: "publisher export",
        version: "v1",
      }],
    });

    expect(report.selected).toBeNull();
    expect(report.candidates).toEqual([]);
    expect(report.rejected).toEqual([{ id: "truncated", reason: "invalid artifact format" }]);
    expect(JSON.stringify(report)).not.toContain(directory);
  });

  it("recognizes namespaced MusicXML roots even after a long XML preamble", async () => {
    const directory = await tempDir();
    const artifactPath = join(directory, "namespaced.musicxml");
    await writeFile(artifactPath, `${" ".repeat(4096)}<m:score-partwise xmlns:m="http://www.musicxml.org/xsd/musicxml"><m:part-list><m:score-part id="P1"/></m:part-list><m:part id="P1"><m:measure number="1"><m:attributes><m:divisions>1</m:divisions></m:attributes><m:note><m:pitch><m:step>C</m:step><m:octave>4</m:octave></m:pitch><m:duration>1</m:duration></m:note></m:measure></m:part></m:score-partwise>`);

    const report = await discoverNativeScoreArtifacts({
      nativeArtifacts: [{
        id: "namespaced",
        path: artifactPath,
        artifactType: "musicxml",
        permitted: true,
        provenance: "publisher export",
        version: "v1",
      }],
    });

    expect(report.status).toBe("native-symbolic");
    expect(report.selected?.artifactType).toBe("musicxml");
  });
});
