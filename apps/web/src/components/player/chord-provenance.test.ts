import { describe, expect, it } from "vitest";
import { chordProvenance } from "./chord-provenance";

describe("chordProvenance", () => {
  it("keeps authored chords visually authoritative", () => {
    expect(chordProvenance({ sourceKind: "authored" })).toMatchObject({
      kind: "authored",
      dotted: false,
      label: "Authored chord",
    });
  });

  it("marks inferred events amber and dotted with the inference reason", () => {
    expect(chordProvenance({ sourceKind: "inferred", inferenceType: "dyad-completion" })).toMatchObject({
      kind: "inferred",
      dotted: true,
      label: "Inferred chord (dyad completion)",
      textClass: "text-amber-800",
    });
  });

  it("treats missing or unknown legacy provenance as gray and dotted", () => {
    expect(chordProvenance({})).toMatchObject({ kind: "unknown", dotted: true, textClass: "text-zinc-500" });
    expect(chordProvenance({ sourceKind: "unknown" })).toMatchObject({ kind: "unknown", dotted: true });
  });

  it("lets an inference flag win over a contradictory source label", () => {
    expect(chordProvenance({ sourceKind: "authored", inferred: true })).toMatchObject({ kind: "inferred", dotted: true });
  });
});
