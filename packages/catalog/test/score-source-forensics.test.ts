import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  inspectScoreSourceForensics,
  scoreSourceForensicsJson,
  type ScoreSourceForensicsDependencies,
} from "../src/score-source-forensics.js";
import {
  inspectScoreSourceForensics as inspectFromIndex,
  scoreSourceForensicsJson as jsonFromIndex,
} from "../src/index.js";

const repoRoot = resolve(process.cwd());

function syntheticPdf(): Uint8Array {
  const xmp = `<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><rdf:Description><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Moonlight Sonata</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>Ludwig van Beethoven</rdf:li></rdf:Seq></dc:creator><xmp:CreatorTool>Synthetic Score Maker 2</xmp:CreatorTool><xmp:CreateDate>2024-01-02T03:04:05Z</xmp:CreateDate><xmp:ModifyDate>2024-01-03T03:04:05Z</xmp:ModifyDate><pdf:Keywords>piano, sonata</pdf:Keywords><xmpMM:DocumentID>uuid:document-123</xmpMM:DocumentID></rdf:Description></rdf:RDF></x:xmpmeta>`;
  const pdf = `%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >> endobj\n3 0 obj << /Type /Page >> endobj\n4 0 obj << /Type /Page >> endobj\n5 0 obj << /Title (Moonlight Sonata) /Author (Ludwig van Beethoven) /Subject (Piano score) /Keywords (piano, sonata) /Creator (Synthetic Score Maker) /Producer (Synthetic PDF Producer) /CreationDate (D:20240102030405Z) /ModDate (D:20240103030405Z) >> endobj\n6 0 obj << /Subtype /XML /Type /Metadata /Length ${xmp.length} >> stream\n${xmp}\nendstream endobj\n7 0 obj << /Type /Annot /Subtype /Link /A << /S /URI /URI (https://example.test/scores/moonlight?token=secret#page=1) >> >> endobj\ntrailer << /Root 1 0 R /Info 5 0 R >>\n%%EOF\n`;
  return new TextEncoder().encode(pdf.replaceAll("\\\\n", "\n"));
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "keyspilli-score-forensics-"));
}

describe("score source forensics", () => {
  it("re-exports the inspector and deterministic serializer from the catalog index", () => {
    expect(inspectFromIndex).toBe(inspectScoreSourceForensics);
    expect(jsonFromIndex).toBe(scoreSourceForensicsJson);
  });

  it("extracts Info, XMP, links, page/byte/hash identity through injected bytes", async () => {
    const bytes = syntheticPdf();
    const dependencies: ScoreSourceForensicsDependencies = {
      readBytes: async () => bytes,
    };
    const report = await inspectScoreSourceForensics("/private/external/Moonlight.pdf", {
      dependencies,
      repositoryRoot: "/private/repository",
      includeLogicalBasename: true,
    });

    expect(report.schemaVersion).toBe(1);
    expect(report.status).toBe("ok");
    expect(report.identity).toMatchObject({
      logicalBasename: "Moonlight.pdf",
      bytes: bytes.byteLength,
      pages: 2,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(report.metadata).toMatchObject({
      title: "Moonlight Sonata",
      author: "Ludwig van Beethoven",
      subject: "Piano score",
      keywords: ["piano", "sonata"],
      creator: "Synthetic Score Maker",
      producer: "Synthetic PDF Producer",
      creationDate: "2024-01-02T03:04:05Z",
      modificationDate: "2024-01-03T03:04:05Z",
    });
    expect(report.xmp).toMatchObject({
      present: true,
      creatorTool: "Synthetic Score Maker 2",
      documentId: "uuid:document-123",
    });
    expect(report.links).toEqual([{ kind: "annotation", url: "https://example.test/scores/moonlight" }]);
    expect(JSON.stringify(report)).not.toContain("token");
    expect(report.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "metadata.title", source: "pdf-info", confidence: "high" }),
      expect.objectContaining({ field: "xmp.creatorTool", source: "xmp", confidence: "medium" }),
      expect.objectContaining({ field: "links", source: "pdf-annotation", confidence: "medium" }),
    ]));
  });

  it("redacts paths and produces byte/hash stable JSON without timestamps", async () => {
    const bytes = syntheticPdf();
    const dependencies: ScoreSourceForensicsDependencies = { readBytes: async () => bytes };
    const first = await inspectScoreSourceForensics("/private/external/one.pdf", {
      dependencies,
      repositoryRoot: "/private/repository",
    });
    const second = await inspectScoreSourceForensics("/different/absolute/two.pdf", {
      dependencies,
      repositoryRoot: "/private/repository",
    });
    expect(first.identity).not.toHaveProperty("logicalBasename");
    expect(scoreSourceForensicsJson(first)).toBe(scoreSourceForensicsJson(second));
    expect(scoreSourceForensicsJson(first)).not.toMatch(/\/private\/|one\.pdf|two\.pdf|timestamp|observedAt/);
  });

  it("returns structured errors for malformed and missing PDFs", async () => {
    const malformed = await inspectScoreSourceForensics("/private/external/bad.pdf", {
      dependencies: { readBytes: async () => new TextEncoder().encode("not a pdf") },
      repositoryRoot: "/private/repository",
    });
    expect(malformed.status).toBe("error");
    expect(malformed.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "malformed-pdf" }),
    ]));

    const missing = await inspectScoreSourceForensics("/private/external/missing.pdf", {
      repositoryRoot: "/private/repository",
    });
    expect(missing.status).toBe("error");
    expect(missing.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-file" }),
    ]));
  });

  it("rejects repository realpaths, directories, NUL/newline paths, and oversized input", async () => {
    const directory = await tempDir();
    const inside = join(repoRoot, ".tmp-forensics-repository.pdf");
    await writeFile(inside, syntheticPdf());
    try {
      const repository = await inspectScoreSourceForensics(inside, { repositoryRoot: repoRoot });
      expect(repository.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "repository-path" }),
      ]));

      const dir = await inspectScoreSourceForensics(directory, { repositoryRoot: "/private/repository" });
      expect(dir.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "not-regular-file" }),
      ]));

      for (const unsafe of ["/private/external/a\u0000.pdf", "/private/external/a\n.pdf"]) {
        const result = await inspectScoreSourceForensics(unsafe, { repositoryRoot: "/private/repository" });
        expect(result.errors).toEqual(expect.arrayContaining([
          expect.objectContaining({ code: "unsafe-path" }),
        ]));
      }

      const oversized = await inspectScoreSourceForensics("/private/external/large.pdf", {
        repositoryRoot: "/private/repository",
        maxBytes: 4,
        dependencies: {
          readBytes: async () => syntheticPdf(),
          stat: async () => ({ isFile: () => true, size: 5 }),
        },
      });
      expect(oversized.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "oversized-input" }),
      ]));
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(inside, { force: true });
    }
  });

  it("rejects a symlink whose realpath is inside the repository", async () => {
    const target = join(repoRoot, ".tmp-forensics-link-target.pdf");
    const link = join(await tempDir(), "linked.pdf");
    await writeFile(target, syntheticPdf());
    try {
      await symlink(target, link);
      const report = await inspectScoreSourceForensics(link, { repositoryRoot: repoRoot });
      expect(report.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "repository-path" }),
      ]));
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(target, { force: true });
      await rm(link, { force: true });
    }
  });

  it("uses the injected realpath seam before accepting a custom byte reader", async () => {
    const report = await inspectScoreSourceForensics("/private/external/link.pdf", {
      repositoryRoot: repoRoot,
      dependencies: {
        realpath: async () => join(repoRoot, "inside.pdf"),
        readBytes: async () => syntheticPdf(),
      },
    });

    expect(report.status).toBe("error");
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "repository-path" }),
    ]));
  });

  it("does not expose credentials from unknown metadata URL values", async () => {
    const bytes = new TextEncoder().encode(
      "%PDF-1.7\n1 0 obj << /SourceURL (https://u:p@example.test/score?q=xyz) >> endobj\n%%EOF\n",
    );
    const report = await inspectScoreSourceForensics("/private/external/score.pdf", {
      repositoryRoot: repoRoot,
      dependencies: { readBytes: async () => bytes },
    });
    const json = scoreSourceForensicsJson(report);

    expect(report.status).toBe("ok");
    expect(json).not.toContain("u:p@");
  });
});
