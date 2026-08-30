import { mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeMidi } from "@keyspilli/midi";
import {
  buildLocalReference,
  localReferenceBuilderJson,
  type LocalReferenceBuildInput,
} from "../src/local-reference-builder.js";
import type { OmrScoreInput } from "../src/omr-consensus.js";

function pdfBytes(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
}

function nativePdfBytes(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Page /Parent 2 0 R >> endobj\n2 0 obj << /Title (Native Score) >> endobj\n%%EOF\n");
}

function score(title = "Synthetic score"): OmrScoreInput {
  return {
    title,
    tempoBpm: 110,
    timeSignature: [4, 4] as [number, number],
    keySignature: 0,
    parts: [{
      id: "P1",
      name: "Melody",
      role: "melody" as const,
      measures: [{
        id: "P1-m1",
        number: "1",
        page: 1,
        startBeat: 0,
        durationBeats: 4,
        timeSignature: [4, 4] as [number, number],
        keySignature: 0,
        events: [
          { onset: 0, duration: 1, pitch: 60, role: "melody" as const },
          { onset: 1, duration: 1, pitch: 62, role: "melody" as const },
          { onset: 2, duration: 2, pitch: 64, role: "melody" as const },
        ],
      }],
    }],
  };
}

async function outputDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "keyspilli-local-reference-"));
}

describe("local reference builder", () => {
  it("selects a valid single OMR backend and freezes path-safe reference artifacts", async () => {
    const out = await outputDir();
    const input: LocalReferenceBuildInput = {
      id: "synthetic-score",
      artist: "Synthetic Artist",
      title: "Synthetic Score",
      pdfPath: "/private/external/synthetic.pdf",
      backends: [{ id: "audiveris", version: "5.11.0", score: score(), status: "available" }],
    };
    const report = await buildLocalReference(input, {
      outputRoot: out,
      repositoryRoot: "/private/repository",
      forensics: { dependencies: { readBytes: async () => pdfBytes() } },
    });

    const item = report.scores[0]!;
    expect(item.state).toBe("MELODY_READY");
    expect(item.selected.kind).toBe("omr");
    expect(item.selected.backend).toBe("audiveris");
    expect(item.reviewQueue.totalItems).toBe(0);
    expect(item.outputs.referenceMusicXml).toBe("scores/synthetic-score/reference.musicxml");
    expect(item.outputs.referenceMidi).toBe("scores/synthetic-score/reference.mid");
    expect(item.outputs.coverageMask).toBe("scores/synthetic-score/coverage-mask.json");
    expect(item.outputs.manifest).toBe("scores/synthetic-score/reference-manifest.json");
    expect(item.outputs.referenceMusicXml).not.toContain("/private");
    await expect(stat(join(out, item.outputs.referenceMusicXml!))).resolves.toBeTruthy();
    await expect(stat(join(out, item.outputs.referenceMidi!))).resolves.toBeTruthy();
    const xml = await readFile(join(out, item.outputs.referenceMusicXml!), "utf8");
    expect(xml).toContain("<score-partwise");
    expect(JSON.stringify(report)).not.toContain("/private/external");
  });

  it("prefers an eligible native candidate over contradictory OMR and stays deterministic", async () => {
    const out = await outputDir();
    const nativeBytes = writeMidi([
      { midi: 60, start: 0, dur: 1, vel: 100, hand: "R" },
      { midi: 64, start: 1, dur: 1, vel: 100, hand: "R" },
    ], { tempoBpm: 120, title: "Native Score" });
    const first = await buildLocalReference({
      id: "native-score",
      artist: "Synthetic Artist",
      title: "Native Score",
      pdfPath: "/private/external/native.pdf",
      nativeArtifacts: [{
        id: "native-midi",
        path: "/private/external/native.mid",
        artifactType: "midi",
        permitted: true,
        provenance: "publisher export",
        version: "2024.1",
        label: "Native Score",
      }],
      backends: [{ id: "audiveris", version: "5.11.0", score: score("Wrong OMR"), status: "available" }],
    }, {
      outputRoot: out,
      repositoryRoot: "/private/repository",
      forensics: { dependencies: { readBytes: async (path: string) => path.endsWith("native.mid") ? nativeBytes : nativePdfBytes() } },
      native: { artifactBytes: nativeBytes },
    });
    const second = await buildLocalReference({
      id: "native-score",
      artist: "Synthetic Artist",
      title: "Native Score",
      pdfPath: "/different/native.pdf",
      nativeArtifacts: [{
        id: "native-midi",
        path: "/private/external/native.mid",
        artifactType: "midi",
        permitted: true,
        provenance: "publisher export",
        version: "2024.1",
        label: "Native Score",
      }],
      backends: [{ id: "audiveris", version: "5.11.0", score: score("Wrong OMR"), status: "available" }],
    }, {
      outputRoot: out,
      repositoryRoot: "/private/repository",
      forensics: { dependencies: { readBytes: async (path: string) => path.endsWith("native.mid") ? nativeBytes : nativePdfBytes() } },
      native: { artifactBytes: nativeBytes },
    });
    expect(first.scores[0]).toMatchObject({
      state: "MELODY_READY",
      selected: { kind: "native", classification: "EXACT_OR_HIGH_CONFIDENCE_MATCH" },
      nativeVerification: { symbolic: { format: "midi" }, eligibleAsReference: true },
    });
    expect(first.scores[0]?.quality?.measures.length).toBeGreaterThan(0);
    expect(first.scores[0]?.qualitySelection).not.toBeNull();
    expect(localReferenceBuilderJson(first)).toBe(localReferenceBuilderJson(second));
  });

  it("keeps a parseable native candidate review-required when PDF identity is weak", async () => {
    const out = await outputDir();
    const pdfPath = "/private/external/weak.pdf";
    const nativePath = "/private/external/weak.mid";
    const bytes = writeMidi([
      { midi: 60, start: 0, dur: 1, vel: 100, hand: "R" },
      { midi: 64, start: 1, dur: 1, vel: 100, hand: "R" },
    ], { tempoBpm: 120, title: "Weak identity" });
    const report = await buildLocalReference({
      id: "weak-native",
      artist: "Synthetic Artist",
      title: "Weak identity",
      pdfPath,
      nativeArtifacts: [{
        id: "weak-native-midi",
        path: nativePath,
        artifactType: "midi",
        permitted: true,
        provenance: "publisher export",
        version: "v1",
      }],
    }, {
      outputRoot: out,
      repositoryRoot: "/private/repository",
      forensics: { dependencies: { readBytes: async (path: string) => path === pdfPath ? new TextEncoder().encode("%PDF-1.7\\n%%EOF") : bytes } },
      native: { artifactBytes: bytes },
    });

    expect(report.scores[0]).toMatchObject({
      state: "REVIEW_REQUIRED",
      selected: { kind: "native", classification: "UNKNOWN" },
      nativeVerification: { symbolic: { format: "midi" }, eligibleAsReference: false },
    });
    expect(JSON.stringify(report)).not.toContain("/private/external");
  });

  it("fails closed when no symbolic backend is available and preserves a concrete review item", async () => {
    const out = await outputDir();
    const report = await buildLocalReference({
      id: "missing-score",
      artist: "Synthetic Artist",
      title: "Missing Score",
      pdfPath: "/private/external/missing.pdf",
      backends: [{ id: "homr", version: "0.7.0", status: "unavailable", score: null, error: "optional backend unavailable" }],
    }, {
      outputRoot: out,
      repositoryRoot: "/private/repository",
      forensics: { dependencies: { readBytes: async () => pdfBytes() } },
    });
    expect(report.scores[0]?.state).toBe("FAILED");
    expect(report.scores[0]?.reviewQueue.items[0]).toMatchObject({
      scoreId: "missing-score",
      role: "unknown",
      reason: "symbolic backend unavailable",
      priorityClass: "high",
    });
    expect(report.nonClaims).toEqual(expect.arrayContaining([
      expect.stringContaining("no human musical correction"),
    ]));
    const outputs = report.scores[0]!.outputs;
    expect(outputs.referenceMusicXml).toBeNull();
    expect(outputs.referenceMidi).toBeNull();
    expect(outputs.coverageMask).toBeNull();
    await expect(stat(join(out, "scores", "missing-score", "reference.musicxml"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(out, "scores", "missing-score", "reference.mid"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(out, "scores", "missing-score", "coverage-mask.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(out, outputs.manifest))).resolves.toBeTruthy();
    await expect(stat(join(out, outputs.reviewQueue))).resolves.toBeTruthy();
  });

  it("preserves an explicit OMR event role on the localized review queue", async () => {
    const out = await outputDir();
    const roleScore = score("Role-bearing score");
    roleScore.parts[0]!.measures[0]!.events = [
      { onset: 0, duration: 1, pitch: 40, role: "melody" as const },
      { onset: 1, duration: 1, pitch: 100, role: "melody" as const },
      { onset: 2, duration: 2, pitch: 100, role: "melody" as const },
    ];
    const report = await buildLocalReference({
      id: "role-bearing-score",
      artist: "Synthetic Artist",
      title: "Role-bearing score",
      pdfPath: "/private/external/role-bearing.pdf",
      backends: [{ id: "audiveris", version: "5.11.0", score: roleScore, status: "available" }],
    }, {
      outputRoot: out,
      repositoryRoot: "/private/repository",
      forensics: { dependencies: { readBytes: async () => pdfBytes() } },
    });

    expect(report.scores[0]?.reviewQueue.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "melody", reasonCategory: "pitch", priorityClass: "high" }),
    ]));
  });

  it("keeps aggregate diagnostics role-unknown when a measure mixes assigned and unassigned events", async () => {
    const out = await outputDir();
    const roleScore = score("Mixed role score");
    const part = roleScore.parts[0]!;
    part.role = undefined;
    part.measures = [0, 1, 2, 3].map((index) => ({
      id: `m${index + 1}`,
      number: String(index + 1),
      startBeat: index * 4,
      durationBeats: 4,
      events: index === 3
        ? [
          { onset: 0, duration: 1, pitch: 60, role: "melody" as const },
          { onset: 1, duration: 1, pitch: 62 },
          { onset: 2, duration: 1, pitch: 64 },
          { onset: 3, duration: 1, pitch: 65 },
        ]
        : [{ onset: 0, duration: 1, pitch: 60 }],
    }));
    const report = await buildLocalReference({
      id: "mixed-role-score",
      artist: "Synthetic Artist",
      title: "Mixed role score",
      backends: [{ id: "audiveris", version: "5.11.0", score: roleScore, status: "available" }],
    }, { outputRoot: out, repositoryRoot: "/private/repository" });

    expect(report.scores[0]?.reviewQueue.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ measureId: "P1:m4", reasonCategory: "timing", role: "unknown" }),
    ]));
  });

  it("rejects a symlinked output root before writing through it", async () => {
    const parent = await mkdtemp(join(tmpdir(), "keyspilli-local-reference-symlink-"));
    const target = join(parent, "target");
    const link = join(parent, "link");
    await mkdir(target);
    await symlink(target, link, "dir");
    try {
      await expect(buildLocalReference({
        id: "symlink-score",
        artist: "Synthetic Artist",
        title: "Symlink Score",
      }, {
        outputRoot: link,
        repositoryRoot: "/private/repository",
      })).rejects.toThrow(/symbolic link/i);
      await expect(stat(join(target, "scores", "symlink-score", "reference-manifest.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
