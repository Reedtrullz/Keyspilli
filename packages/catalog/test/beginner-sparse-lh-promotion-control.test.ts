import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildVariants, validateVariants, type Note, type ParsedMidi } from "@keyspilli/midi";
import { evaluateBeginnerGates, selectAnchors, structuralClass } from "../scripts/lower-tier-task2-evaluator.js";

const fixturePath = new URL("./fixtures/beginner-sparse-lh-promotion-control.json", import.meta.url);
type FixtureNote = Note & { role: "melody" | "structural-lh" | "filler" };
type Fixture = ParsedMidi & { id: string; sections: string[]; chords: Array<{ beat: number; name: string }>; drums: Array<{ start: number; midi: number }> };

const readFixture = (): { bytes: Buffer; fixture: Fixture } => {
  const bytes = readFileSync(fixturePath);
  return { bytes, fixture: JSON.parse(bytes.toString()) as Fixture };
};

// Test-local copy of the frozen scratch policy: preserve principal RH, then
// take the first eligible LH anchor per 4-beat window unless two RH notes block
// it. This deliberately does not alter the production arranger.
const frozenSparseCandidate = (notes: FixtureNote[]): Note[] => {
  const melody = notes.filter((n) => n.role === "melody" && n.hand === "R");
  const output = [...melody];
  for (const { alternatives } of selectAnchors(notes.filter((n) => (n as FixtureNote).role === "structural-lh"), 4)) {
    const anchor = alternatives.find((candidate) => {
      const soundingRh = notes.filter((n) => n.hand !== "L" && n.start <= candidate.start && n.start + n.dur > candidate.start);
      return soundingRh.length < 2 && structuralClass(candidate as never, true) === "STRUCTURAL_LH";
    });
    if (anchor) output.push(anchor as FixtureNote);
  }
  return output.sort((a, b) => a.start - b.start || (a.hand === "L" ? 1 : -1) || a.midi - b.midi);
};

describe("beginner sparse-LH promotion control", () => {
  it("is deterministic and covers every evaluator safety case", () => {
    const first = readFixture();
    const second = readFixture();
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(createHash("sha256").update(first.bytes).digest("hex"))
      .toBe(createHash("sha256").update(second.bytes).digest("hex"));

    const notes = first.fixture.notes as FixtureNote[];
    expect(notes.length).toBeGreaterThanOrEqual(16);
    expect(first.fixture.tempoBpm).toBe(100);
    expect(first.fixture.timeSig).toEqual([4, 4]);
    expect(first.fixture.durationBeats).toBe(32);
    expect(first.fixture.sections).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    expect(notes.filter((n) => n.hand === "R")).toHaveLength(12);
    expect(notes.filter((n) => n.hand === "L")).toHaveLength(8);
    expect(notes.filter((n) => n.role === "melody")).toHaveLength(8);
    expect(notes.filter((n) => n.role === "structural-lh")).toHaveLength(8);
    expect(notes.filter((n) => n.role === "filler")).toHaveLength(4);

    const onset = (start: number) => Number(start.toFixed(3));
    const at = (start: number) => notes.filter((n) => onset(n.start) === start);
    expect(at(0).filter((n) => n.hand === "R")).toHaveLength(1);
    expect(at(0).filter((n) => n.hand === "L")).toHaveLength(1);
    expect(at(8).filter((n) => n.hand === "R")).toHaveLength(2);
    expect(at(8).filter((n) => n.hand === "L")).toHaveLength(1);
    expect(at(6).every((n) => n.hand === "L")).toBe(true);
    expect(notes.filter((n) => n.start >= 12 && n.start < 16)).toHaveLength(0);
    expect(first.fixture.chords.map((chord) => chord.name)).toEqual(["C", "F", "G", "Am"]);
    expect(selectAnchors(notes, 4).every(({ first: anchor }) => (anchor as FixtureNote).role !== "filler")).toBe(true);
    expect(first.fixture.drums).toHaveLength(8);
    expect(first.fixture.drums.every((drum) => drum.midi < 40)).toBe(true);
    expect(notes.every((n) => n.identitySource === "guitar" || n.identitySource === "vocals")).toBe(true);
    expect(notes.some((n) => n.identitySource === "drums" as never)).toBe(false);

    const candidate = frozenSparseCandidate(notes);
    const candidateAt = (start: number) => candidate.filter((n) => Number(n.start.toFixed(3)) === start);
    expect(candidateAt(0).filter((n) => n.hand === "L")).toHaveLength(1);
    expect(candidateAt(6).filter((n) => n.hand === "L")).toHaveLength(1);
    expect(candidate.filter((n) => n.start >= 12 && n.start < 16)).toHaveLength(0);
    expect(candidateAt(8).filter((n) => n.hand === "L")).toHaveLength(0);
    expect(candidateAt(10).filter((n) => n.hand === "L")).toHaveLength(1);
    expect(candidate.filter((n) => n.hand === "R")).toEqual(expect.arrayContaining(melodyShape(notes)));
    expect(candidate.filter((n) => n.hand === "R").some((n) => (n as FixtureNote).role === "filler")).toBe(false);
    expect(candidate.filter((n) => n.hand === "L").every((n) => n.identitySource === "guitar")).toBe(true);
    expect(candidate.filter((n) => n.hand === "R")).toEqual(notes.filter((n) => n.role === "melody"));
    expect(frozenSparseCandidate([...notes].reverse())).toEqual(candidate);
    const unknown = { ...notes.find((n) => n.hand === "L")!, start: 30, midi: 41, identitySource: "other", role: "structural-lh" } as FixtureNote;
    expect(frozenSparseCandidate([...notes, unknown])).toEqual(candidate);
    expect(Math.max(...new Set(candidate.map((n) => Number(n.start.toFixed(3)))).values(), 0)).toBe(31);
    expect(evaluateBeginnerGates(candidate, 100).allPass).toBe(true);

    const source: ParsedMidi = first.fixture;
    const variants = buildVariants(source, { title: "Synthetic sparse LH", artist: "Keyspilli", key: "C major" }, { arrangementProfile: "learner", maxDurBeats: null });
    expect(variants.find((v) => v.level === "very-beginner")?.notes.length).toBeGreaterThanOrEqual(8);
    expect(variants.find((v) => v.level === "beginner")?.notes.length).toBeGreaterThanOrEqual(8);
    expect(validateVariants(variants, { maxDurBeats: null })).toEqual([]);
    expect(evaluateBeginnerGates(variants.find((v) => v.level === "beginner")!.notes, 100).allPass).toBe(true);
  });
});

function melodyShape(notes: FixtureNote[]): Note[] {
  return notes.filter((n) => n.role === "melody");
}
