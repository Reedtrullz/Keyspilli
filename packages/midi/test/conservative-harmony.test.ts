import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inferHarmonyTimeline, type Note } from "../src/index.js";

const corpus = JSON.parse(readFileSync(new URL("./fixtures/ks09-harmony-pilot-v1.json", import.meta.url), "utf8")) as {
  cases: Array<{ id: string; split: string; key: string; durationBeats: number; notes: Note[] }>;
};
const development = corpus.cases.filter(item => item.split === "development");
const fixture = (id: string) => development.find(item => item.id === id)!;
const infer = (id: string) => {
  const item = fixture(id);
  return inferHarmonyTimeline(item.notes, [{ startBeat: 0, endBeat: item.durationBeats }], {
    key: item.key, backingOnly: true, policy: "conservative-backing-v1",
  });
};
const audible = (id: string) => infer(id).filter(chord => chord.notes.length).map(chord => [chord.beat, chord.name, chord.durationBeats]);
const pcs = (notes: readonly number[]) => [...new Set(notes.map(midi => midi % 12))].sort((a, b) => a - b);

describe("conservative-backing-v1 development contracts", () => {
  it("admits a supported root/fifth without inventing either third", () => {
    expect(audible("dev-open-fifth")).toEqual([[0, "C5", 4]]);
    expect(pcs(infer("dev-open-fifth")[0]!.notes)).toEqual([0, 7]);
  });

  it("leaves a semitone dyad unknown with a reason, keeping real rests distinct", () => {
    expect(infer("dev-semitone")).toEqual([
      expect.objectContaining({ beat: 0, durationBeats: 0.5, name: "N.C.", notes: [] }),
      expect.objectContaining({ beat: 0.5, durationBeats: 2.5, name: "N.C.", notes: [], reviewReason: expect.stringMatching(/support|uncertain/i) }),
      expect.objectContaining({ beat: 3, durationBeats: 1, name: "N.C.", notes: [] }),
    ]);
    expect(infer("dev-semitone")[0]!.reviewReason).toBeUndefined();
    expect(infer("dev-semitone").at(-1)!.reviewReason).toBeUndefined();
  });

  it.each([
    ["dev-seventh-hold", [[0.5, "C7", 5.5]]],
    ["dev-first-inversion", [[0, "C/E", 4]]],
    ["dev-borrowed-inversion", [[1, "Fm/Ab", 3]]],
    ["dev-suspension-resolution", [[0, "Csus4", 2], [2, "C", 2]]],
  ] as const)("keeps complete source harmony for %s", (id, expected) => {
    expect(audible(id)).toEqual(expected);
  });

  it("excludes both explicit vocal and lyric-bearing notes without a separate backingOnly flag", () => {
    const item = fixture("dev-sung-thirds");
    const chords = inferHarmonyTimeline(item.notes, [{ startBeat: 0, endBeat: 4 }], { key: "C", policy: "conservative-backing-v1" });
    expect(chords.map(chord => [chord.beat, chord.name, chord.durationBeats])).toEqual([[0, "A5", 4]]);
    expect(pcs(chords[0]!.notes)).toEqual([4, 9]);
    expect(chords[0]).toMatchObject({ sourceKind: "generated", inferred: true, inferenceType: "harmony-window" });
  });

  it("abstains instead of replacing an incompatible played bass with the chord root", () => {
    expect(audible("dev-foreign-pedal")).toEqual([]);
    expect(infer("dev-foreign-pedal")[0]!.reviewReason).toMatch(/bass|support|uncertain/i);
  });

  it("waits for actual arpeggio support instead of inferring an unheard third from pedal extension", () => {
    expect(audible("dev-overlap-arpeggio")).toEqual([[1, "C", 2]]);
    expect(infer("dev-overlap-arpeggio").filter(chord => chord.beat < 1).every(chord => chord.notes.length === 0)).toBe(true);
  });

  it("retains fifth-only harmony across repeated articulation gaps and ends at the final release", () => {
    expect(audible("dev-repeated-fifths")).toEqual([[0, "C5", 4.25]]);
    expect(infer("dev-repeated-fifths").at(-1)).toMatchObject({ beat: 4.25, name: "N.C.", notes: [] });
  });

  it("removes the released third from the supported label", () => {
    expect(audible("dev-third-release")).toEqual([[0, "C", 1.5], [1.5, "C5", 2.5]]);
  });

  it("does not infer a backing role from a dry LH solo line", () => {
    expect(audible("dev-solo-register")).toEqual([]);
    expect(infer("dev-solo-register").every(chord => chord.reviewReason)).toBe(true);
  });

  it("leaves the legacy default unchanged until wider admission is supported", () => {
    const item = fixture("dev-open-fifth");
    for (const options of [{ key: "C" }, { key: "C", backingOnly: true }]) {
      expect(inferHarmonyTimeline(item.notes, [{ startBeat: 0, endBeat: 4 }], options)[0]!.name).toBe("C");
    }
  });
});
