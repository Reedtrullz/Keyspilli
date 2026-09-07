import { describe, expect, it, vi } from "vitest";
import { writeMidi } from "@keyspilli/midi";
import { sha256Hex } from "@keyspilli/catalog/src/fixture-evidence.js";
import { parseAutomaticSourceIndex, resolveAutomaticSymbolic, type AutomaticSymbolicSource } from "../src/automatic-symbolic.js";
const bytes = writeMidi(Array.from({ length: 32 }, (_, i) => ({ midi: 60 + i % 5, start: i, dur: .75, vel: 90, hand: "R" as const })), { tempoBpm: 90, title: "Native source" });
const source: AutomaticSymbolicSource = { id: "verified-fixture", recordingIds: ["abcdefghijk"], artist: "Synthetic", title: "Fixture", arrangementTitle: "Fixture Piano",
  sourceUrl: "https://scores.example/fixture.mid", sourceSha256: sha256Hex(bytes), license: "CC0-1.0", licenseEvidenceUrl: "https://scores.example/license", verificationEvidenceUrl: "https://scores.example/fixture", containsMelody: true, completeArrangement: true };
const requestUrl = "https://www.youtube.com/watch?v=abcdefghijk";
const fetch = vi.fn(async () => new Response(bytes, { headers: { "content-type": "audio/midi" } }));
describe("automatic verified native source", () => {
  it("resolves requested recording identity through acquisition, parser and frozen arrangement", async () => {
    const result = await resolveAutomaticSymbolic(requestUrl, [source], { fetch });
    expect(result.status, JSON.stringify(result.status === "review" ? result : result.attempts)).toBe("candidate");
    if (result.status !== "candidate") return;
    expect(result.provenance.actualSourceUrl).toBe(source.sourceUrl);
    expect(result.provenance.timingOwner).toBe("selected-arrangement");
    expect(result.arrangement.canonical!.notes.length).toBeGreaterThan(0);
    expect(result.arrangement.canonical!.tempoBpm).toBe(120);
    expect(result.arrangement.canonical!.durationBeats * .5).toBeCloseTo(31.75 * 60 / 90, 1);
  });
  it("preserves every native-time event across a tempo change", async () => {
    const track = [0, 255, 81, 3, 7, 161, 32];
    for (let i = 0; i < 16; i++) {
      if (i === 8) track.push(0, 255, 81, 3, 15, 66, 64);
      track.push(0, 144, 60 + i % 5, 90, 131, 96, 128, 60 + i % 5, 0);
    }
    track.push(0, 255, 47, 0);
    const variable = new Uint8Array([77,84,104,100,0,0,0,6,0,1,0,1,1,224,77,84,114,107,0,0,track.length >> 8,track.length & 255,...track]);
    const result = await resolveAutomaticSymbolic(requestUrl, [{ ...source, sourceSha256: sha256Hex(variable) }], { fetch: async () => new Response(variable, { headers: { "content-type": "audio/midi" } }) });
    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") return;
    const notes = result.arrangement.canonical!.notes;
    expect(notes).toHaveLength(16);
    notes.forEach((note, i) => {
      expect(note.midi).toBe(60 + i % 5);
      expect(note.start * .5).toBeCloseTo(i < 8 ? i * .5 : 4 + i - 8, 3);
      expect(note.dur * .5).toBeCloseTo(i < 8 ? .5 : 1, 3);
    });
  });

  it("rejects changed bytes, protected references, and accompaniment without pretending success", async () => {
    const changed = await resolveAutomaticSymbolic(requestUrl, [{ ...source, sourceSha256: "a".repeat(64) }], { fetch });
    expect(changed.status).toBe("review");
    expect(changed.attempts[0]?.reason).toMatch(/hash/);
    const protectedResult = await resolveAutomaticSymbolic(requestUrl, [source], { fetch, firewall: { benchmarkReferenceManifest: { sha256: [source.sourceSha256] } } });
    expect(protectedResult.status).toBe("review");
    expect(protectedResult.attempts[0]?.reason).toMatch(/benchmark|protected/);
    expect((await resolveAutomaticSymbolic(requestUrl, [{ ...source, containsMelody: false }], { fetch })).status).toBe("review");
  });
  it("does not acquire wrong-song or ambiguous index entries, and rejects unknown rights", async () => {
    const unused = vi.fn();
    expect((await resolveAutomaticSymbolic(requestUrl, [{ ...source, recordingIds: ["lmnopqrstuv"] }], { fetch: unused })).status).toBe("review");
    expect((await resolveAutomaticSymbolic(requestUrl, [source, { ...source, id: "other" }], { fetch: unused })).status).toBe("review");
    expect(unused).not.toHaveBeenCalled();
    expect(() => parseAutomaticSourceIndex([{ ...source, license: "unknown" }])).toThrow();
  });
});
