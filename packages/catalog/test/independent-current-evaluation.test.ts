import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildVariants, type Note, type ParsedMidi } from "@keyspilli/midi";
import {
  DECLARED_RELEASE_GATES,
  applyCollisionAwareSparseLh,
  buildCandidateLadder,
  compareEventSets,
  evaluateCurrentFixture,
  evaluateDeclaredGates,
  generateCurrentVariants,
  type CurrentFixture,
} from "../src/independent-current-evaluation.js";

const fixturePath = new URL("./fixtures/beginner-sparse-lh-promotion-control-v2.json", import.meta.url);

const parsed = (notes: Note[], durationBeats = 8): ParsedMidi => ({
  format: 1,
  division: 480,
  tempoBpm: 120,
  keySig: 0,
  keyMode: 0,
  timeSig: [4, 4],
  notes,
  trackNames: ["test"],
  durationBeats,
});

const fixture = (source: ParsedMidi): CurrentFixture => ({
  id: "synthetic-test",
  label: "Synthetic test",
  logicalRef: "synthetic:test",
  bytes: new TextEncoder().encode(JSON.stringify(source)),
  source,
  title: "Synthetic test",
  artist: "Keyspilli",
});

describe("independent current-fixture evaluation", () => {
  it("generates a real six-level candidate ladder and compares event sets", () => {
    const source = parsed([
      { midi: 64, start: 0, dur: 1, vel: 100, hand: "R", identitySource: "vocals" },
      { midi: 48, start: 0, dur: 1, vel: 80, hand: "L", identitySource: "guitar" },
      { midi: 65, start: 2, dur: 1, vel: 100, hand: "R", identitySource: "vocals" },
      { midi: 50, start: 2, dur: 1, vel: 80, hand: "L", identitySource: "guitar" },
      { midi: 67, start: 4, dur: 1, vel: 100, hand: "R", identitySource: "vocals" },
      { midi: 52, start: 4, dur: 1, vel: 80, hand: "L", identitySource: "guitar" },
      { midi: 69, start: 6, dur: 1, vel: 100, hand: "R", identitySource: "vocals" },
      { midi: 53, start: 6, dur: 1, vel: 80, hand: "L", identitySource: "guitar" },
    ]);
    const result = evaluateCurrentFixture(fixture(source));
    expect(result.baseline.levels).toHaveLength(6);
    expect(result.candidate.ladder.map((variant) => variant.level)).toEqual([
      "very-beginner", "beginner", "very-easy", "easy", "medium", "advanced",
    ]);
    expect(result.parity.rh.eventEqual).toBe(true);
    expect(result.parity.nonBeginner.every((entry) => entry.eventEqual && entry.digestEqual)).toBe(true);
    expect(result.candidate.validation.ladder).toBeDefined();
    expect(result.candidate.validation.monotonicity).toBeDefined();
    expect(compareEventSets(result.baseline.levels[1]!.notes.filter((note) => note.hand !== "L"), result.candidate.beginner.notes.filter((note) => note.hand !== "L")).equal).toBe(true);
  });

  it("exercises LH filler, true rest, collisions, defer, and drum provenance in V2", () => {
    const bytes = readFileSync(fixturePath);
    const source = JSON.parse(bytes.toString()) as ParsedMidi;
    const result = evaluateCurrentFixture({
      id: "BEGINNER_SPARSE_LH_PROMOTION_CONTROL_V2",
      label: "Synthetic sparse LH V2",
      logicalRef: "packages/catalog/test/fixtures/beginner-sparse-lh-promotion-control-v2.json",
      bytes,
      source,
      title: "Synthetic sparse LH V2",
      artist: "Keyspilli",
    });
    expect(result.synthetic).toMatchObject({
      fillerEnteredPath: true,
      pitchedDrumOutputs: 0,
      trueRestWindows: expect.arrayContaining([3]),
      lhOnlyWindows: expect.arrayContaining([6]),
    });
    expect(result.synthetic.filler.suppressed).toBeGreaterThan(0);
    expect(result.synthetic.control).toMatchObject({
      requiredPhenomena: {
        fillerEnteredPath: true,
        trueRest: true,
        lhOnlyPassage: true,
        oneRhCollision: true,
        twoRhCollision: true,
        deferOpportunity: true,
        noDeferOpportunity: true,
        drumProvenance: true,
        harmonicChange: true,
      },
      observed: {
        oneRhAllowed: true,
        twoRhSuppressedOrDeferred: true,
        deferUsed: true,
        noDeferSuppressed: true,
        trueRestSilent: true,
        lhOnlyEmitted: true,
        pitchedDrumOutputs: 0,
      },
      deterministic: true,
      pass: true,
    });
  });

  it("includes every declared release gate in the final predicate", () => {
    const table = evaluateDeclaredGates(Object.fromEntries(DECLARED_RELEASE_GATES.map((id) => [id, true])));
    expect(table).toHaveLength(DECLARED_RELEASE_GATES.length);
    expect(table.every((gate) => gate.includedInDecisionPredicate)).toBe(true);
    expect(new Set(table.map((gate) => gate.id))).toEqual(new Set(DECLARED_RELEASE_GATES));
  });

  it("keeps current generation independent of historical report names", () => {
    const source = parsed([
      { midi: 64, start: 0, dur: 1, vel: 100, hand: "R", identitySource: "vocals" },
      { midi: 48, start: 0, dur: 1, vel: 80, hand: "L", identitySource: "guitar" },
      { midi: 65, start: 2, dur: 1, vel: 100, hand: "R", identitySource: "vocals" },
      { midi: 50, start: 2, dur: 1, vel: 80, hand: "L", identitySource: "guitar" },
      { midi: 67, start: 4, dur: 1, vel: 100, hand: "R", identitySource: "vocals" },
      { midi: 52, start: 4, dur: 1, vel: 80, hand: "L", identitySource: "guitar" },
      { midi: 69, start: 6, dur: 1, vel: 100, hand: "R", identitySource: "vocals" },
      { midi: 53, start: 6, dur: 1, vel: 80, hand: "L", identitySource: "guitar" },
    ]);
    const variants = generateCurrentVariants(fixture(source));
    const ladder = buildCandidateLadder(variants, applyCollisionAwareSparseLh(variants[1]!, variants[2]!, source).variant);
    expect(ladder).toHaveLength(6);
    expect(JSON.stringify(variants)).not.toContain("legacy-eval");
    expect(JSON.stringify(variants)).not.toContain("calibration");
  });
});
