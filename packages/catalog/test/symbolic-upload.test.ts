import { describe, expect, it } from "vitest";
import { confirmSymbolicUploadChoice, createSymbolicUploadPreflight, SYMBOLIC_PREFLIGHT_TTL_MS } from "../src/symbolic-upload.js";
import { writeMidi, type Note } from "@keyspilli/midi";

const midi = (notes: Note[], name = "Piano") => writeMidi(notes, {
  tempoBpm: 120,
  tracks: [{ name, notes }],
});
const choice = (id: string, values: Partial<Parameters<typeof confirmSymbolicUploadChoice>[2]> = {}) => ({
  selectedParts: [{ id, role: "melody" as const }],
  arrangementIntent: "original" as const,
  rightsAttested: true,
  ...values,
});

describe("symbolic upload preflight", () => {
  it("binds a confirmed role and arrangement choice to the exact source bytes", () => {
    const bytes = midi([{ midi: 60, start: 0, dur: 1, vel: 80 }]);
    const preflight = createSymbolicUploadPreflight(bytes, 1_000);
    const intent = confirmSymbolicUploadChoice(preflight.preflightId, bytes, choice(preflight.parts[0]!.id), 1_001);
    expect(intent).toMatchObject({
      sourceHash: preflight.sourceHash,
      rightsAttested: true,
      arrangementIntent: "original",
      selectedParts: [{ id: preflight.parts[0]!.id, name: "Piano", role: "melody" }],
    });
  });

  it("rejects missing owner authorization without consuming a valid review", () => {
    const bytes = midi([{ midi: 60, start: 0, dur: 1, vel: 80 }]);
    const preflight = createSymbolicUploadPreflight(bytes, 10_000);
    expect(() => confirmSymbolicUploadChoice(preflight.preflightId, bytes, { ...choice(preflight.parts[0]!.id), rightsAttested: false }, 10_001))
      .toThrow(/authorized/i);
    expect(confirmSymbolicUploadChoice(preflight.preflightId, bytes, choice(preflight.parts[0]!.id), 10_002).sourceHash)
      .toBe(preflight.sourceHash);
  });

  it("rejects expired candidates and changed source bytes", () => {
    const bytes = midi([{ midi: 60, start: 0, dur: 1, vel: 80 }]);
    const expired = createSymbolicUploadPreflight(bytes, 20_000);
    expect(() => confirmSymbolicUploadChoice(expired.preflightId, bytes, choice(expired.parts[0]!.id), 20_000 + SYMBOLIC_PREFLIGHT_TTL_MS))
      .toThrow(/expired/i);
    const fresh = createSymbolicUploadPreflight(bytes, 40_000);
    const replacement = midi([{ midi: 61, start: 0, dur: 1, vel: 80 }]);
    expect(() => confirmSymbolicUploadChoice(fresh.preflightId, replacement, choice(fresh.parts[0]!.id), 40_001))
      .toThrow(/bytes changed/i);
  });

  it("requires a known pitched part and an explicit valid role", () => {
    const piano = [{ midi: 60, start: 0, dur: 0.5, vel: 80 }];
    const drums = [{ midi: 36, start: 0, dur: 0.25, vel: 90 }];
    const bytes = writeMidi([...piano, ...drums], {
      tempoBpm: 120,
      tracks: [{ name: "Piano", notes: piano }, { name: "Kit", notes: drums, percussion: true }],
    });
    const preflight = createSymbolicUploadPreflight(bytes, 50_000);
    expect(preflight.parts.find((part) => part.name === "Kit")).toMatchObject({ percussion: true, noteCount: 1 });
    expect(() => confirmSymbolicUploadChoice(preflight.preflightId, bytes, choice("midi:404"), 50_001)).toThrow(/not present/i);
    expect(() => confirmSymbolicUploadChoice(preflight.preflightId, bytes, choice("midi:1"), 50_001)).toThrow(/percussion/i);
    expect(() => confirmSymbolicUploadChoice(preflight.preflightId, bytes, {
      selectedParts: [{ id: "midi:0", role: "invented" as never }], arrangementIntent: "original", rightsAttested: true,
    }, 50_001)).toThrow(/role/i);
  });

  it("rejects empty and percussion-only uploads before a canonical publication is possible", () => {
    const empty = writeMidi([], { tempoBpm: 120, tracks: [{ name: "Empty", notes: [] }] });
    expect(() => createSymbolicUploadPreflight(empty, 60_000)).toThrow(/no pitched notes/i);
    const drums = writeMidi([{ midi: 36, start: 0, dur: 0.25, vel: 90 }], {
      tempoBpm: 120,
      tracks: [{ name: "Kit", notes: [{ midi: 36, start: 0, dur: 0.25, vel: 90 }], percussion: true }],
    });
    expect(() => createSymbolicUploadPreflight(drums, 60_001)).toThrow(/no pitched notes/i);
  });

  it("records exact owner-authored one-note, triad, and four-note-study availability", () => {
    const studies: Array<[string, Note[]]> = [
      ["one-note", [{ midi: 60, start: 0, dur: 1, vel: 80 }]],
      ["triad", [60, 64, 67].map((midi) => ({ midi, start: 0, dur: 1, vel: 80 }))],
      ["four-note-phrase", [60, 62, 64, 65].map((midi, index) => ({ midi, start: index, dur: 0.5, vel: 80 }))],
    ];
    for (const [kind, notes] of studies) {
      const bytes = midi(notes, `Study ${kind}`);
      const preflight = createSymbolicUploadPreflight(bytes, 70_000);
      const intent = confirmSymbolicUploadChoice(preflight.preflightId, bytes, choice(preflight.parts[0]!.id, { ownerAuthoredStudy: true }), 70_001);
      expect(intent.study).toMatchObject({ ownerAuthored: true, profile: "source", kind, noteCount: notes.length });
      expect(intent.study?.availableLevels.length).toBeGreaterThan(0);
      expect(intent.study?.availableLevels).toEqual([...new Set(intent.study?.availableLevels)]);
    }
  });

  it("does not accept an owner study with backing-only arrangement intent", () => {
    const bytes = midi([{ midi: 60, start: 0, dur: 1, vel: 80 }]);
    const preflight = createSymbolicUploadPreflight(bytes, 80_000);
    expect(() => confirmSymbolicUploadChoice(preflight.preflightId, bytes, choice(preflight.parts[0]!.id, {
      arrangementIntent: "backing-only-chords",
      ownerAuthoredStudy: true,
    }), 80_001)).toThrow(/requires Original/i);
  });

  it("requires backing-only parts to be identified as harmony or bass", () => {
    const bytes = midi([{ midi: 48, start: 0, dur: 1, vel: 80 }]);
    const partId = createSymbolicUploadPreflight(bytes, 90_000).parts[0]!.id;
    for (const role of ["melody", "other"] as const) {
      const preflight = createSymbolicUploadPreflight(bytes, 90_001);
      expect(() => confirmSymbolicUploadChoice(preflight.preflightId, bytes, choice(partId, {
        arrangementIntent: "backing-only-chords",
        selectedParts: [{ id: partId, role }],
      }), 90_002)).toThrow(/only owner-identified harmony or bass/i);
    }
    for (const role of ["harmony", "bass"] as const) {
      const preflight = createSymbolicUploadPreflight(bytes, 90_003);
      expect(confirmSymbolicUploadChoice(preflight.preflightId, bytes, choice(partId, {
        arrangementIntent: "backing-only-chords",
        selectedParts: [{ id: partId, role }],
      }), 90_004).selectedParts[0]?.role).toBe(role);
    }
  });

  it("bounds stored source part counts and identifiers", () => {
    const manyTracks = Array.from({ length: 65 }, (_, index) => ({
      name: `Part ${index + 1}`,
      notes: [{ midi: 48 + (index % 12), start: 0, dur: 0.5, vel: 80 }],
    }));
    expect(() => createSymbolicUploadPreflight(writeMidi(manyTracks.flatMap((track) => track.notes), {
      tempoBpm: 120,
      tracks: manyTracks,
    }), 100_000)).toThrow(/more than 64 parts/i);

    const longId = "P".repeat(129);
    const xml = new TextEncoder().encode(`<score-partwise><part id="${longId}"><measure><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`);
    expect(() => createSymbolicUploadPreflight(xml, 100_001)).toThrow(/part id must be 1-128/i);
  });

  it("does not evict a live preflight while confirming at capacity", () => {
    const bytes = midi([{ midi: 60, start: 0, dur: 1, vel: 80 }]);
    const first = createSymbolicUploadPreflight(bytes, 110_000);
    for (let index = 1; index < 64; index++) createSymbolicUploadPreflight(bytes, 110_000 + index);
    expect(confirmSymbolicUploadChoice(first.preflightId, bytes, choice(first.parts[0]!.id), 110_100).sourceHash)
      .toBe(first.sourceHash);
  });
});
