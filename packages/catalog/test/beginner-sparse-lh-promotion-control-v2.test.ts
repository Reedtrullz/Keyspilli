import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildVariants, validateVariants, type Note, type ParsedMidi } from "@keyspilli/midi";
import { evaluateBeginnerGates, selectAnchors, structuralClass } from "../scripts/lower-tier-task2-evaluator.js";

const fixturePath = new URL("./fixtures/beginner-sparse-lh-promotion-control-v2.json", import.meta.url);
type FixtureNote = Note & { role: "melody" | "structural-lh" | "repeated-filler" | "decorative" | "unknown" };
type Fixture = ParsedMidi & { id: string; sections: string[]; chords: Array<{ beat: number; name: string }>; drums: Array<{ start: number; midi: number }> };

const readFixture = (): { bytes: Buffer; fixture: Fixture } => {
  const bytes = readFileSync(fixturePath);
  return { bytes, fixture: JSON.parse(bytes.toString()) as Fixture };
};

const frozenSparseCandidate = (notes: FixtureNote[]): Note[] => {
  const melody = notes.filter((n) => n.role === "melody" && n.hand === "R");
  const output = [...melody];
  for (const { alternatives } of selectAnchors(notes.filter((n) => n.hand === "L"), 4)) {
    const anchor = alternatives.find((candidate) => {
      const fixtureCandidate = candidate as FixtureNote;
      if (fixtureCandidate.role !== "structural-lh") return false;
      const soundingRh = notes.filter((n) => n.hand !== "L" && n.start <= candidate.start && n.start + n.dur > candidate.start);
      return soundingRh.length < 2 && structuralClass(candidate, true) === "STRUCTURAL_LH";
    });
    if (anchor) output.push(anchor as unknown as Note);
  }
  return output.sort((a, b) => a.start - b.start || (a.hand === "L" ? 1 : 0) - (b.hand === "L" ? 1 : 0) || a.midi - b.midi);
};

describe("beginner sparse-LH promotion control V2", () => {
  it("exercises LH filler before filtering and preserves every safety case", () => {
    const first = readFixture();
    const second = readFixture();
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(createHash("sha256").update(first.bytes).digest("hex"))
      .toBe(createHash("sha256").update(second.bytes).digest("hex"));

    const notes = first.fixture.notes as FixtureNote[];
    const lh = notes.filter((n) => n.hand === "L");
    const filler = lh.filter((n) => n.role === "repeated-filler" || n.role === "decorative");
    const at = (start: number) => notes.filter((n) => Number(n.start.toFixed(3)) === start);
    expect(at(0).filter((n) => n.hand === "R")).toHaveLength(1);
    expect(at(0).filter((n) => n.hand === "L")).toHaveLength(1);
    expect(at(8).filter((n) => n.hand === "R")).toHaveLength(2);
    expect(at(8).filter((n) => n.hand === "L")).toHaveLength(2);
    expect(filler).toHaveLength(4);
    expect(filler.filter((n) => n.role === "repeated-filler")).toHaveLength(3);
    expect(filler.filter((n) => n.role === "decorative")).toHaveLength(1);
    expect(selectAnchors(lh, 4).flatMap(({ alternatives }) => alternatives).some((n) => ["repeated-filler", "decorative"].includes((n as FixtureNote).role))).toBe(true);

    const candidate = frozenSparseCandidate(notes);
    expect(candidate.filter((n) => n.hand === "L" && ["repeated-filler", "decorative"].includes((n as FixtureNote).role))).toHaveLength(0);
    expect(candidate.filter((n) => n.hand === "L")).toHaveLength(6);
    expect(candidate.filter((n) => n.hand !== "L")).toEqual(notes.filter((n) => n.role === "melody"));
    expect(candidate.filter((n) => n.start === 0 && n.hand === "L")).toHaveLength(1);
    expect(candidate.filter((n) => n.start >= 12 && n.start < 16)).toHaveLength(0);
    expect(candidate.filter((n) => n.start === 8 && n.hand === "L")).toHaveLength(0);
    expect(candidate.filter((n) => n.start === 10 && n.hand === "L")).toHaveLength(1);
    expect(candidate.some((n) => n.hand === "L" && n.start === 6)).toBe(true);
    expect(candidate.some((n) => n.hand === "L" && n.identitySource === "other")).toBe(false);
    expect(first.fixture.drums).toHaveLength(8);
    expect(first.fixture.drums.every((drum) => drum.midi < 40)).toBe(true);
    expect(notes.some((n) => n.identitySource === ("drums" as never))).toBe(false);
    expect(candidate.every((n) => notes.some((source) => JSON.stringify(source) === JSON.stringify(n)))).toBe(true);
    expect(frozenSparseCandidate([...notes].reverse())).toEqual(candidate);
    expect(evaluateBeginnerGates(candidate, 100).allPass).toBe(true);

    const variants = buildVariants(first.fixture, { title: "Synthetic sparse LH V2", artist: "Keyspilli", key: "C major" }, { arrangementProfile: "learner", maxDurBeats: null });
    expect(validateVariants(variants, { maxDurBeats: null })).toEqual([]);
  });
});
