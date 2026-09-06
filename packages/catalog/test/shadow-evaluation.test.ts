import { describe, expect, it } from "vitest";
import type { Note, ParsedMidi } from "@keyspilli/midi";
import {
  canonicalShadowEvaluationJson,
  evaluateShadowCorpus,
  evaluateShadowItem,
  type ShadowCorpusManifestInput,
  type ShadowCorpusItemInput,
} from "../src/shadow-evaluation.js";

function parsed(notes: Note[], title = "Synthetic band"): ParsedMidi {
  return {
    format: 1,
    division: 480,
    tempoBpm: 120,
    tempoMetaPresent: true,
    keySig: 0,
    keyMode: 0,
    timeSig: [4, 4],
    notes,
    trackNames: [title],
    durationBeats: Math.max(8, ...notes.map((note) => note.start + note.dur)),
    title,
  };
}

function track(role: NonNullable<ShadowCorpusItemInput["tracks"]>[number]["role"], notes: Note[]) {
  return { id: role, role, notes };
}

function fixture(): ShadowCorpusItemInput {
  const vocalNotes: Note[] = [
    { midi: 64, start: 0, dur: 1.5, vel: 105 },
    { midi: 65, start: 2, dur: 1.5, vel: 102 },
    { midi: 67, start: 4, dur: 1.5, vel: 100 },
    { midi: 69, start: 6, dur: 1.5, vel: 104 },
  ];
  const guitarNotes: Note[] = [
    { midi: 52, start: 0, dur: 0.75, vel: 94 },
    { midi: 59, start: 0.01, dur: 0.75, vel: 88 },
    { midi: 64, start: 0.02, dur: 0.75, vel: 90 },
    { midi: 55, start: 2, dur: 0.75, vel: 94 },
    { midi: 62, start: 2.01, dur: 0.75, vel: 88 },
    { midi: 67, start: 2.02, dur: 0.75, vel: 90 },
    { midi: 57, start: 4, dur: 0.75, vel: 94 },
    { midi: 64, start: 4.01, dur: 0.75, vel: 88 },
    { midi: 69, start: 4.02, dur: 0.75, vel: 90 },
    { midi: 52, start: 6, dur: 0.75, vel: 94 },
    { midi: 59, start: 6.01, dur: 0.75, vel: 88 },
    { midi: 64, start: 6.02, dur: 0.75, vel: 90 },
  ];
  const bassNotes: Note[] = [
    { midi: 40, start: 0, dur: 1.5, vel: 110 },
    { midi: 43, start: 2, dur: 1.5, vel: 110 },
    { midi: 45, start: 4, dur: 1.5, vel: 110 },
    { midi: 40, start: 6, dur: 1.5, vel: 110 },
  ];
  const drumNotes: Note[] = [
    { midi: 36, start: 0, dur: 0.1, vel: 120 },
    { midi: 38, start: 1, dur: 0.1, vel: 115 },
    { midi: 36, start: 2, dur: 0.1, vel: 120 },
    { midi: 38, start: 3, dur: 0.1, vel: 115 },
    { midi: 36, start: 4, dur: 0.1, vel: 120 },
    { midi: 38, start: 5, dur: 0.1, vel: 115 },
    { midi: 36, start: 6, dur: 0.1, vel: 120 },
    { midi: 38, start: 7, dur: 0.1, vel: 115 },
  ];
  return {
    id: "synthetic-full-band",
    label: "Synthetic full-band",
    alignment: { status: "aligned", source: "synthetic-ground-truth" },
    symbolic: { status: "available", logicalRef: "synthetic:full-band" },
    audio: { status: "not-provided", logicalRef: "synthetic:full-band-audio" },
    tracks: [
      track("vocals", vocalNotes),
      track("guitar", guitarNotes),
      track("bass", bassNotes),
      track("drums", drumNotes),
    ],
    parsed: parsed([...vocalNotes, ...guitarNotes, ...bassNotes, ...drumNotes]),
  };
}

function manifest(items: ShadowCorpusItemInput[]): ShadowCorpusManifestInput {
  return {
    schemaVersion: 1,
    corpus: "synthetic-shadow",
    datasetVersion: "fixture-1",
    license: "synthetic-test-data",
    sourceRecord: "synthetic:shadow",
    items,
  };
}

describe("shadow semantic-to-piano evaluation", () => {
  it("preserves lead and harmony roles while keeping drums timing-only", () => {
    const result = evaluateShadowItem(fixture());

    expect(result.status).toBe("SHADOW_ENGINEERING_READY");
    expect(result.input.roles.vocals.noteCount).toBe(4);
    expect(result.input.roles.guitar.noteCount).toBe(12);
    expect(result.input.roles.bass.noteCount).toBe(4);
    expect(result.input.roles.drums.noteCount).toBe(8);
    expect(result.output.drums.pitchedNoteCount).toBe(0);
    expect(result.output.melody.vocalNoteCount).toBeGreaterThan(0);
    expect(result.output.harmony.semanticRootCount).toBeGreaterThan(0);
    expect(result.output.harmony.leftHandRootCount).toBeGreaterThan(0);
    expect(result.failures).toEqual([]);
  });

  it("orders difficulty variants and is deterministic under item reordering", () => {
    const first = evaluateShadowCorpus(manifest([fixture()]));
    const second = evaluateShadowCorpus(manifest([fixture(), { ...fixture(), id: "synthetic-full-band-2" }]), {
      itemIds: ["synthetic-full-band"],
    });

    expect(first.status).toBe("SHADOW_ENGINEERING_READY");
    expect(first.items).toHaveLength(1);
    expect(first.items[0]!.variants.advanced.noteCount)
      .toBeGreaterThanOrEqual(first.items[0]!.variants.medium.noteCount);
    expect(first.items[0]!.variants.medium.noteCount)
      .toBeGreaterThanOrEqual(first.items[0]!.variants.easy.noteCount);
    expect(first.determinism.canonicalSha256).toBe(second.determinism.canonicalSha256);
    expect(first.items[0]!.output.drums.pitchedNoteCount).toBe(0);
  });

  it("fails closed when alignment or role evidence is missing", () => {
    const item = fixture();
    const result = evaluateShadowItem({
      ...item,
      alignment: { status: "missing", source: "synthetic" },
      tracks: item.tracks?.filter((entry) => entry.role !== "drums"),
    });

    expect(result.status).toBe("SHADOW_ENGINEERING_BLOCKED");
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.stringMatching(/alignment/i),
      expect.stringMatching(/drum/i),
    ]));
  });

  it("accepts metadata-only manifest defaults without leaking local provenance paths", () => {
    const item = {
      ...fixture(),
      corpus: "shadow-local",
      datasetVersion: "v1",
      license: { id: "synthetic", sourcePath: "/Users/reidar/private/license.txt" },
      sourceRecord: { id: "fixture-1", path: "/private/tmp/shadow/source.mid" },
    };
    const result = evaluateShadowCorpus({
      schemaVersion: 1,
      items: [item],
    });

    expect(result.status).toBe("SHADOW_ENGINEERING_READY");
    expect(result.corpus.id).toBe("synthetic-shadow");
    expect(result.items[0]?.provenance.corpus).toBe("shadow-local");
    expect(result.items[0]?.provenance.license).toEqual({ id: "synthetic" });
    expect(result.items[0]?.provenance.sourceRecord).toEqual({ id: "fixture-1" });
    const serialized = canonicalShadowEvaluationJson(result);
    expect(serialized).not.toContain("/Users/reidar");
    expect(serialized).not.toContain("/private/tmp");
  });

  it("fails closed for malformed item and manifest containers without throwing", () => {
    const malformedItem = evaluateShadowItem(null as unknown as ShadowCorpusItemInput);
    expect(malformedItem.status).toBe("SHADOW_ENGINEERING_BLOCKED");
    expect(malformedItem.failures).toEqual(expect.arrayContaining([
      "shadow item must be an object",
    ]));

    const malformedTracks = evaluateShadowItem({
      id: "malformed-tracks",
      tracks: { role: "guitar" },
    } as unknown as ShadowCorpusItemInput);
    expect(malformedTracks.status).toBe("SHADOW_ENGINEERING_BLOCKED");
    expect(malformedTracks.failures).toContain("shadow item tracks must be an array");

    const malformedNotes = evaluateShadowItem({
      id: "malformed-notes",
      notes: null,
      tracks: [{ role: "guitar", notes: [] }],
    } as unknown as ShadowCorpusItemInput);
    expect(malformedNotes.status).toBe("SHADOW_ENGINEERING_BLOCKED");
    expect(malformedNotes.failures).toContain("shadow item notes must be an array");

    const malformedManifest = evaluateShadowCorpus({
      schemaVersion: 1,
      items: [null],
    } as unknown as ShadowCorpusManifestInput);
    expect(malformedManifest.status).toBe("SHADOW_ENGINEERING_BLOCKED");
    expect(malformedManifest.items).toHaveLength(0);
    expect(malformedManifest.failures).toEqual([
      "shadow corpus manifest is malformed; expected schemaVersion 1 and valid item objects",
    ]);
  });

  it("redacts embedded, relative, and local path metadata from canonical reports", () => {
    const item = fixture();
    item.id = "fixture /Users/reidar/private/item.mid";
    item.label = "loaded from /private/tmp/Shadow Corpus.mid";
    item.alignment = { status: "aligned", source: "file:///Users/reidar/secret/reference.mid" };
    item.license = { name: "CC BY", sourcePath: "/Users/reidar/private/license.txt" } as unknown as string;
    item.sourceRecord = {
      id: "source-1",
      source: "selected relative/private/source.mid",
      nested: { filePath: "C:\\Users\\reidar\\secret.mid" },
    };
    const report = evaluateShadowItem(item);
    const canonical = canonicalShadowEvaluationJson(report);
    expect(canonical).not.toContain("/Users/reidar");
    expect(canonical).not.toContain("/private/tmp");
    expect(canonical).not.toContain("relative/private/source.mid");
    expect(canonical).not.toContain("secret.mid");
    expect(canonical).toContain("[redacted-path]");
  });
});
