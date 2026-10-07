import { describe, expect, it } from "vitest";
import { inferSongForm, overlaySourceSections } from "../src/song-form.js";

function fixture(pattern: number[], classical = false) {
  const measures = pattern.flatMap((_, block) => Array.from({ length: 8 }, (_, bar) => ({ index: block * 8 + bar, startBeat: (block * 8 + bar) * 4, endBeat: (block * 8 + bar + 1) * 4 })));
  const notes = pattern.flatMap((theme, block) => Array.from({ length: theme === 2 ? 64 : 32 }, (_, index) => ({ midi: 60 + theme * 3 + index % 3, start: block * 32 + index / (theme === 2 ? 2 : 1), dur: .5, vel: 80, hand: "R" as const })));
  return { notes, measures, classical };
}

describe("song form", () => {
  it("finds recurring contrasting material and labels every inferred role as estimated", () => {
    const data = fixture([1, 2, 1, 2, 3, 2]);
    const sections = inferSongForm(data.notes, data.measures);
    expect(sections.map(s => s.type)).toEqual(["verse", "chorus", "verse", "chorus", "bridge", "chorus"]);
    expect(sections.map(s => s.label)).toEqual(["Verse 1 · estimated", "Chorus 1 · estimated", "Verse 2 · estimated", "Chorus 2 · estimated", "Bridge · estimated", "Chorus 3 · estimated"]);
    expect(sections.every(s => s.evidence === "estimated")).toBe(true);
    expect(sections[0]!.startBeat).toBe(0);
    expect(sections.at(-1)!.endBeat).toBe(192);
  });

  it("does not call a uniform arpeggio a verse/chorus alternation", () => {
    const data = fixture([1, 1, 1, 1]);
    expect(inferSongForm(data.notes, data.measures).map(s => s.label)).toEqual(["Main section · estimated"]);
  });

  it("uses theme language for classical repertoire", () => {
    const data = fixture([1, 2, 1], true);
    const sections = inferSongForm(data.notes, data.measures, { classical: true });
    expect(sections.map(s => s.label)).toEqual(["Theme A · estimated", "Theme B · estimated", "Theme A return · estimated"]);
    expect(sections.some(s => /Verse|Chorus/.test(s.label))).toBe(false);
  });

  it("preserves source labels, covers an unlabelled pickup and rejects malformed maps", () => {
    const data = fixture([1, 2, 1]);
    const estimated = inferSongForm(data.notes, data.measures);
    const source = [{ id: "verse-1", label: "Verse 1", startBeat: 4, endBeat: 40, type: "verse" as const, evidence: "source" as const }, { id: "chorus-1", label: "Chorus", startBeat: 40, endBeat: 96, type: "chorus" as const, evidence: "source" as const }];
    const result = overlaySourceSections(estimated, source, 96);
    expect(result.map(s => [s.startBeat, s.endBeat])).toEqual([[0,4],[4,40],[40,96]]);
    expect(result[1]!.label).toBe("Verse 1");
    expect(result[1]!.evidence).toBe("source");
    expect(overlaySourceSections(estimated, [{ ...source[0]!, endBeat: NaN }],96)).toEqual(estimated);
    expect(overlaySourceSections(estimated, [{ ...source[0]!, startBeat: -1 }],96)).toEqual(estimated);
    expect(overlaySourceSections(estimated, [...source, { ...source[0]!, id:"overlap" }],96)).toEqual(estimated);
  });

  it("uses actual bar boundaries in a pickup/compound-meter excerpt and handles silence", () => {
    const measures = [{ index:0,startBeat:0,endBeat:1 }, ...Array.from({length:9},(_,i)=>({index:i+1,startBeat:1+i*3,endBeat:4+i*3}))];
    const sections = inferSongForm([], measures);
    expect(sections[0]!.startBeat).toBe(0);
    expect(sections.at(-1)!.endBeat).toBe(28);
    expect(sections.every(s=>Number.isFinite(s.endBeat) && s.endBeat>s.startBeat)).toBe(true);
    expect(inferSongForm([],[])).toEqual([]);
  });
});
