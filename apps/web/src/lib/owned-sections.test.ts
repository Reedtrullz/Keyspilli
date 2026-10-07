import { describe, expect, it } from "vitest";
import { parseOwnedSections, validateOwnedSections } from "./owned-sections";

const valid = [
  { id: "owner-1", label: "Intro", startBeat: 0, endBeat: 24 },
  { id: "owner-2", label: "Verse 1", startBeat: 24, endBeat: 72 },
];

describe("owned sections", () => {
  it("accepts a well-formed authored map", () => {
    expect(validateOwnedSections(valid)).toBeNull();
    expect(parseOwnedSections(JSON.stringify(valid))).toEqual(valid);
  });

  it("treats missing, corrupt or invalid stored data as absent", () => {
    expect(parseOwnedSections(null)).toBeNull();
    expect(parseOwnedSections(undefined)).toBeNull();
    expect(parseOwnedSections("not json")).toBeNull();
    expect(parseOwnedSections(JSON.stringify({ label: "Intro" }))).toBeNull();
    expect(parseOwnedSections(JSON.stringify([{ id: "x", label: "", startBeat: 0, endBeat: 4 }]))).toBeNull();
  });

  it("rejects overlaps, duplicate ids and unknown roles", () => {
    expect(validateOwnedSections([
      { id: "a", label: "Intro", startBeat: 0, endBeat: 24 },
      { id: "b", label: "Verse", startBeat: 20, endBeat: 40 },
    ])).toMatch(/overlap/);
    expect(validateOwnedSections([
      { id: "a", label: "Intro", startBeat: 0, endBeat: 8 },
      { id: "a", label: "Verse", startBeat: 8, endBeat: 16 },
    ])).toMatch(/unique/);
    expect(validateOwnedSections([{ id: "a", label: "Intro", startBeat: 0, endBeat: 8, type: "wat" }])).toMatch(/form role/);
    expect(validateOwnedSections([])).toMatch(/at least one/);
    expect(validateOwnedSections("nope")).toMatch(/array/);
    expect(validateOwnedSections(null)).toBeNull();
  });
});
