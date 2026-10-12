import { expect, it } from "vitest";
import { sanitizeImportedNotes, quantize, writeMidi, parseMidi, buildVariants, writeVariantArtifacts, validateArtifactRoundtrip, type Note, type ParsedMidi } from "../src/index.js";
import type { ImportedNoteTransformation } from "../src/clean.js";

const quiet = (): Note => ({ midi: 72, start: 0, dur: 8, vel: 20, hand: "R", sourceOrigins: [{ id: "source-quiet", track: 0 }] });
const dense = (): Note[] => Array.from({ length: 12 }, (_, i) => ({ midi: 36 + i, start: 7, dur: 0.5, vel: 100, hand: "L", sourceOrigins: [{ id: `source-dense-${i}`, track: 1 }] }));
const sounding = (notes: Note[], beat: number) => notes.filter(n => n.start <= beat && n.start + n.dur > beat);

it("late density preserves the valid seven-beat source prefix and its original identity", () => {
  const input = [quiet(), ...dense()];
  const before = structuredClone(input);
  const changes: ImportedNoteTransformation[] = [];
  const cleaned = sanitizeImportedNotes(input, { maxDurBeats: null, onTransformation: change => changes.push(change) });
  const kept = cleaned.find(n => n.start === 0);
  expect(kept).toMatchObject({ midi: 72, start: 0, dur: 7, sourceOrigins: before[0]!.sourceOrigins });
  expect(input).toEqual(before);
  for (const beat of [0, 0.125, 1, 6.999]) expect(sounding(cleaned, beat).map(n => n.midi)).toEqual([72]);
  expect(sounding(cleaned, 7)).toHaveLength(12);
  expect(sounding(cleaned, 7.5)).toHaveLength(0);
  const reparsed = parseMidi(writeMidi(cleaned, { tempoBpm: 120 }));
  expect(reparsed.notes.find(n => n.midi === 72)).toMatchObject({ start: 0, dur: 7 });
  expect(changes).toEqual([{ reason: "sounding-limit", before: before[0], after: { ...before[0], dur: 7 } }]);
  kept!.sourceOrigins![0]!.id = "changed-consumer-copy";
  changes[0]!.before.sourceOrigins![0]!.id = "changed-report-copy";
  expect(input).toEqual(before);
});

it("source variants retain the recovered earlier note without allowing excess sounding density", () => {
  const input: ParsedMidi = { notes: [quiet(), ...dense()], format: 1, division: 480, tempoBpm: 120, keySig: 0, keyMode: 0, timeSig: [4, 4], trackNames: ["Piano"], durationBeats: 8 };
  const variants = buildVariants(input, { title: "Synthetic prefix control", artist: "Test" }, { arrangementProfile: "source", maxDurBeats: null, normalizeRange: false });
  expect(variants).toHaveLength(6);
  const advanced = variants.find(v => v.level === "advanced")!;
  expect(advanced.notes.find(n => n.midi === 72 && n.start === 0)?.dur).toBe(7);
  expect(advanced.sourcePreparation?.changes).toContainEqual({ reason: "sounding-limit", before: [quiet()], after: [{ ...quiet(), dur: 7 }] });
  expect(advanced.warnings?.some(w => w.includes("sourcePreparation"))).toBe(true);
  expect(input.notes[0]).toEqual(quiet());
  const artifacts = writeVariantArtifacts(advanced, "Synthetic prefix", "Test");
  expect(parseMidi(artifacts.midi).notes.find(n => n.midi === 72 && n.start === 0)?.dur).toBe(7);
  for (const variant of variants) for (const note of variant.notes) expect(sounding(variant.notes, note.start).length).toBeLessThanOrEqual(12);
});

it("keeps exact triplets, a pickup rest and grace releases in uncapped source sanitation", () => {
  const notes = [
    { ...quiet(), start: 1 / 3, dur: 1 / 3 },
    { ...quiet(), midi: 74, start: 2 / 3, dur: 1 / 3 },
    { ...quiet(), midi: 76, start: 2, dur: 1 / 32, vel: 4 },
  ];
  const before = structuredClone(notes);
  const changes: ImportedNoteTransformation[] = [];
  const result = sanitizeImportedNotes(notes, { maxDurBeats: null, onTransformation: c => changes.push(c) });
  expect(result).toEqual(before);
  expect(changes).toEqual([]);
  expect(sounding(result, 0.2)).toHaveLength(0);
  expect(sounding(result, 1.5)).toHaveLength(0);
  expect(sounding(result, 2.04)).toHaveLength(0);
});

it("records source-profile quantization, grace deletion, unison merge and octave movement explicitly", () => {
  const notes: Note[] = [
    { ...quiet(), start: 1 / 3, dur: 1 / 3 },
    { ...quiet(), midi: 74, start: 2 / 3, dur: 1 / 3, sourceOrigins: [{ id: "triplet-two" }] },
    { ...quiet(), midi: 76, start: 2, dur: 1 / 32, sourceOrigins: [{ id: "grace" }] },
    { ...quiet(), midi: 12, start: 3, dur: 0.5, sourceOrigins: [{ id: "low" }] },
    { ...quiet(), midi: 79, start: 4, dur: 0.5, sourceOrigins: [{ id: "unison-a" }] },
    { ...quiet(), midi: 79, start: 4.01, dur: 0.49, sourceOrigins: [{ id: "unison-b" }] },
  ];
  const input: ParsedMidi = { notes, format: 1, division: 480, tempoBpm: 120, keySig: 0, keyMode: 0, timeSig: [4, 4], trackNames: [], durationBeats: 5 };
  const before = structuredClone(input);
  const variants = buildVariants(input, { title: "Source transformations", artist: "Test" }, { arrangementProfile: "source", maxDurBeats: null });
  for (const v of variants) {
    expect(v.sourcePreparation?.timebase).toBe("variant-beats");
    const changes = v.sourcePreparation!.changes;
    expect(changes.find(c => c.reason === "quantization")?.before[0]?.start).toBe(1 / 3);
    expect(changes.find(c => c.reason === "quantization")?.after[0]?.start).toBe(0.375);
    expect(changes.find(c => c.reason === "quantization-drop")).toMatchObject({ before: [{ midi: 76, dur: 1 / 32 }], after: [] });
    expect(changes.find(c => c.reason === "octave-normalization")).toMatchObject({ before: [{ midi: 12 }], after: [{ midi: 24 }] });
    expect(changes.find(c => c.reason === "unison-merge")?.after[0]?.sourceOrigins?.map(o => o.id)).toEqual(["unison-a", "unison-b"]);
    expect(validateArtifactRoundtrip(v, "Source transformations", "Test")).toEqual([]);
  }
  expect(input).toEqual(before);
});

it("records explicit duration policy and same-onset rejection without zero-length notes", () => {
  const changes: ImportedNoteTransformation[] = [];
  const capped = sanitizeImportedNotes([quiet()], { maxDurBeats: 2, onTransformation: c => changes.push(c) });
  expect(capped[0]?.dur).toBe(2);
  expect(changes).toEqual([{ reason: "duration-policy", before: quiet(), after: { ...quiet(), dur: 2 } }]);
  changes.length = 0;
  const dense = Array.from({ length: 16 }, (_, i) => ({ ...quiet(), midi: 40 + i, vel: 40 + i }));
  const result = sanitizeImportedNotes(dense, { maxDurBeats: null, onTransformation: c => changes.push(c) });
  expect(result).toHaveLength(12);
  expect(result.every(n => n.dur > 0)).toBe(true);
  expect(changes).toHaveLength(4);
  expect(changes.every(c => c.reason === "sounding-limit" && c.after === null)).toBe(true);
});

it("records each quantized unison group once so lineage storage grows with input size", () => {
  const notes = Array.from({ length: 128 }, (_, i) => ({ ...quiet(), start: i / 10000, dur: 1, sourceOrigins: [{ id: `unison-${i}` }] }));
  const changes: Array<{ before: Note[]; after: Note[] }> = [];
  const result = quantize(notes, { grid: 0.125, onTransformation: (before, after) => changes.push({ before, after }) });
  expect(result).toHaveLength(1);
  expect(changes).toHaveLength(1);
  expect(changes[0]?.before).toEqual(notes);
  expect(changes[0]?.after).toEqual(result);
  expect(result[0]?.sourceOrigins).toHaveLength(notes.length);
});
