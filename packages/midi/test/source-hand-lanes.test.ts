import { describe, expect, it } from "vitest";
import { buildVariants, inferSourceHandLanes, parseMidi, writeMidi, type Note } from "../src/index.js";

const lane = (sourceLane: string, pitches: number[]): Note[] => pitches.map((midi, index) => ({
  midi, start: index, dur: .5, vel: 80, sourceLane,
}));
const lower = lane("green keys", [48, 48, 52, 52, 55, 55, 59, 76]);
const upper = lane("blue keys", [66, 67, 71, 72, 72, 79, 84, 95]);
const notes = [...lower, ...upper];
const midi = () => writeMidi([], { tempoBpm: 120, tracks: [
  { name: "green keys", notes: lower }, { name: "blue keys", notes: upper },
] });

describe("opt-in tutorial source hand lanes", () => {
  it("retains neutral lane provenance and infers by pitch evidence, not palette order", () => {
    const parsed = parseMidi(midi());
    expect(parsed.notes.every(note => note.hand === undefined)).toBe(true);
    expect(new Set(parsed.notes.map(note => note.sourceLane))).toEqual(new Set(["green keys", "blue keys"]));
    const result = inferSourceHandLanes(parsed.notes);
    expect(result.applied).toBe(true);
    expect(result.notes.filter(note => note.sourceLane === "green keys").every(note => note.hand === "L")).toBe(true);
    expect(result.notes.find(note => note.midi === 76)?.hand).toBe("L");
    expect(result.notes.filter(note => note.sourceLane === "blue keys").every(note => note.hand === "R")).toBe(true);
    expect(result.notes.map(({ hand, ...note }) => note)).toEqual(parsed.notes);
    expect(parsed.notes.every(note => note.hand === undefined)).toBe(true);
    expect(inferSourceHandLanes([...parsed.notes].reverse()).notes.reverse()).toEqual(result.notes);
  });

  it("abstains on explicit hands, missing lanes, sparse, overlapping or invalid pitch evidence", () => {
    for (const input of [
      [{ ...notes[0]!, hand: "R" as const }, ...notes.slice(1)],
      notes.map(({ sourceLane, ...note }) => note),
      [...lower.slice(0, 2), ...upper],
      [...lower, ...lane("blue keys", [50, 52, 55, 56, 57, 60, 61, 64])],
      [...lane("green keys", [40, 45, 48, 50, 52, 70, 80, 90]), ...lane("blue keys", [50, 52, 60, 70, 75, 80, 90, 95])],
      [...notes, { ...notes[0]!, midi: Number.NaN }],
      [...notes, { ...notes[0]!, sourceLane: "yellow keys" }],
    ]) {
      const result = inferSourceHandLanes(input);
      expect(result.applied).toBe(false);
      expect(result.notes).toBe(input);
    }
    const generic = parseMidi(writeMidi([], { tempoBpm: 120, tracks: [{ name: "piano keys", notes }] }));
    expect(generic.notes.every(note => note.sourceLane === undefined)).toBe(true);
  });

  it("leaves existing/default and non-source reduction events unchanged; source opt-in reports inference", () => {
    const parsed = parseMidi(midi());
    const withoutLanes = { ...parsed, notes: parsed.notes.map(({ sourceLane, ...note }) => note) };
    const events = (variants: ReturnType<typeof buildVariants>) => variants.map(variant => ({
      level: variant.level, notes: variant.notes.map(({ sourceLane, ...note }) => note),
    }));
    const meta = { title: "Source lane fixture", artist: "Test" };
    for (const arrangementProfile of [undefined, "source", "learner"] as const) {
      expect(events(buildVariants(parsed, meta, { arrangementProfile })))
        .toEqual(events(buildVariants(withoutLanes, meta, { arrangementProfile })));
    }
    expect(events(buildVariants(parsed, meta, { inferSourceHands: true })))
      .toEqual(events(buildVariants(parsed, meta)));
    const candidate = buildVariants(parsed, meta, { arrangementProfile: "source", inferSourceHands: true });
    expect(candidate.every(variant => variant.warnings?.some(warning => warning.includes("tutorial source hand inference: inferred")))).toBe(true);
  });
});

it('retains red tutorial lane provenance without assigning a hand',()=>{
 const parsed=parseMidi(writeMidi([],{tempoBpm:120,tracks:[{name:'red keys',notes:lower}]}));
 expect(parsed.notes.every(note=>note.sourceLane==='red keys' && note.hand===undefined)).toBe(true);
});
