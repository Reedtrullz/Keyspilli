import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeMidi, type Note } from "@keyspilli/midi";
import { runRedBaronSurvivalCli } from "../scripts/evaluate-red-baron-survival.js";
import {
  canonicalStageSurvivalJson,
  classifyStageLoss,
  evaluateStageSurvival,
  genericDecoderFixDecision,
  type DecoderFixEvidence,
  type StageInput,
  type StageSurvivalReport,
} from "../src/red-baron-survival.js";

const note = (id: string, midi: number, start: number, overrides: Record<string, unknown> = {}) => ({
  id,
  midi,
  start,
  dur: 0.5,
  vel: 90,
  ...overrides,
});

const stage = (notes: readonly unknown[], extra: Record<string, unknown> = {}): StageInput => ({
  status: "available",
  notes,
  ...extra,
});

const fullStages = (overrides: Partial<Record<"raw" | "decoder" | "semantic" | "canonical" | "easy", StageInput>> = {}) => ({
  raw: stage([note("a", 60, 0), note("dup-1", 64, 1), note("dup-2", 64, 1)]),
  decoder: stage([note("a", 60, 0), note("dup-1", 65, 1), note("dup-2", 76, 1.2)]),
  semantic: stage([note("a", 60, 0), note("dup-1", 65, 1.3)], { provenance: { sourceRef: "/Users/reidar/private/red-baron.mid" } }),
  canonical: stage([note("a", 60, 0), note("dup-1", 65, 1.3), note("canon-extra", 50, 2, { unsupported: true })]),
  easy: stage([note("a", 60, 0), note("dup-1", 65, 1.3)]),
  ...overrides,
});

const reference = stage([note("ref-a", 60, 0), note("ref-b", 64, 1)]);
const windows = [{ id: "main", reference: [0, 4] as [number, number], stages: {
  raw: [0, 4] as [number, number], decoder: [0, 4] as [number, number], semantic: [0, 4] as [number, number], canonical: [0, 4] as [number, number], easy: [0, 4] as [number, number],
} }];

describe("red baron stage survival", () => {
  it("accounts for duplicate onsets one-to-one and classifies stage losses", () => {
    const report = evaluateStageSurvival(fullStages(), reference, windows);
    expect(report.status).toBe("ready");
    expect(report.transitions).toHaveLength(4);
    const rawDecoder = report.transitions[0]!;
    expect(rawDecoder.matches).toHaveLength(3);
    expect(rawDecoder.loss.retained).toBe(1);
    expect(rawDecoder.loss.pitchModified).toBe(1);
    expect(rawDecoder.loss.octaveShifted).toBe(1);
    expect(rawDecoder.loss.rejected + rawDecoder.loss.replaced + rawDecoder.loss.obscured).toBe(0);
    const decoderSemantic = report.transitions[1]!;
    expect(decoderSemantic.loss.timingShifted).toBe(1);
    expect(decoderSemantic.loss.rejected).toBe(1);
    expect(report.transitions[2]!.loss.unsupportedCanonicalExpansions).toBe(1);
  });

  it("retains parent and provenance only as redacted diagnostics", () => {
    const report = evaluateStageSurvival({
      ...fullStages({
        semantic: stage([note("a", 60, 0, { parentIds: ["raw-a"], provenance: { file: "/Users/reidar/secret.mid", source: "logical" } })]),
      }),
    }, reference, windows);
    const json = canonicalStageSurvivalJson(report);
    expect(json).not.toContain("/Users/reidar");
    expect(json).not.toContain("secret.mid");
    expect(json).toContain("parentIds");
    expect(json).toContain("logical");
    expect(json).not.toContain('"notes"');
    expect(json).not.toContain('"midi"');
  });

  it("is invariant to stage and note input permutation", () => {
    const first = evaluateStageSurvival(fullStages(), reference, windows);
    const permuted = evaluateStageSurvival({
      easy: stage([...fullStages().easy!.notes!].reverse()),
      canonical: stage([...fullStages().canonical!.notes!].reverse()),
      semantic: stage([...fullStages().semantic!.notes!].reverse()),
      decoder: stage([...fullStages().decoder!.notes!].reverse()),
      raw: stage([...fullStages().raw!.notes!].reverse()),
    }, { ...reference, notes: [...reference.notes!].reverse() }, [...windows].reverse());
    expect(canonicalStageSurvivalJson(first)).toBe(canonicalStageSurvivalJson(permuted));
  });

  it("fails closed for missing or invalid stages, reference, and windows", () => {
    const missing = evaluateStageSurvival({ ...fullStages(), easy: undefined }, reference, windows);
    expect(missing.status).toBe("blocked");
    expect(missing.diagnostics.join(" ")).toMatch(/easy.*missing/i);
    const invalid = evaluateStageSurvival({ ...fullStages(), decoder: { status: "invalid", notes: [] } }, reference, windows);
    expect(invalid.status).toBe("blocked");
    expect(invalid.diagnostics.join(" ")).toMatch(/decoder.*invalid/i);
    const noReference = evaluateStageSurvival(fullStages(), undefined, windows);
    expect(noReference.status).toBe("blocked");
    expect(noReference.diagnostics.join(" ")).toMatch(/reference/i);
    expect(evaluateStageSurvival(fullStages(), reference, undefined).diagnostics.join(" ")).toMatch(/window/i);
    expect(() => evaluateStageSurvival(fullStages(), reference, [{ id: "x", reference: [-1, 2] }])).toThrow(/window/i);
    expect(() => evaluateStageSurvival(fullStages(), reference, [{ id: "x", reference: [0, 1] }, { id: "x", reference: [1, 2] }])).toThrow(/duplicate/i);
  });

  it("retains invalid and rejection counts without normalizing them into notes", () => {
    const report = evaluateStageSurvival({
      raw: stage([note("valid", 60, 0), { midi: Number.NaN, start: 1 }, note("rejected", 64, 2, { rejected: true, rejectionReason: "decoder-filter" })]),
      decoder: stage([note("valid", 60, 0)]),
      semantic: stage([note("valid", 60, 0)]),
      canonical: stage([note("valid", 60, 0)]),
      easy: stage([note("valid", 60, 0)]),
    }, reference, windows);
    expect(report.stages.raw.invalidNoteCount).toBe(1);
    expect(report.stages.raw.rejectedNoteCount).toBe(1);
    expect(report.transitions[0]!.loss.rejected).toBe(1);
  });

  it("classifies explicit replaced and obscured transition metadata", () => {
    const report = evaluateStageSurvival({
      raw: stage([note("r", 60, 0, { status: "replaced" }), note("o", 62, 1, { status: "obscured" })]),
      decoder: stage([]), semantic: stage([]), canonical: stage([]), easy: stage([]),
    }, reference, windows);
    expect(report.transitions[0]!.loss.replaced).toBe(1);
    expect(report.transitions[0]!.loss.obscured).toBe(1);
  });

  it("gates generic decoder fixes on four independent evidence booleans", () => {
    const base = evaluateStageSurvival(fullStages(), reference, windows);
    const evidence: DecoderFixEvidence = {
      sourceIndependentInvariant: true,
      syntheticRegression: true,
      crossSongImprovement: true,
      noMaterialRegression: true,
    };
    expect(genericDecoderFixDecision({ ...base, evidence })).toEqual({ decision: "apply", eligible: true, blockers: [] });
    for (const key of Object.keys(evidence) as (keyof DecoderFixEvidence)[]) {
      expect(genericDecoderFixDecision({ ...base, evidence: { ...evidence, [key]: false } })).toMatchObject({ decision: "defer", eligible: false });
      expect(genericDecoderFixDecision({ ...base, evidence: { ...evidence, [key]: false } }).blockers.join(" ")).toMatch(/required|regression|improvement|invariant/i);
    }
    expect(genericDecoderFixDecision(base).decision).toBe("defer");
    expect(genericDecoderFixDecision({ ...base, status: "partial", evidence }).decision).toBe("defer");
  });

  it("supports direct classification of a transition with explicit counts", () => {
    const transition = {
      from: "raw" as const,
      to: "decoder" as const,
      matches: [],
      sourceNotes: [note("r", 60, 0, { status: "rejected" })],
      targetNotes: [],
    };
    const loss = classifyStageLoss(transition);
    expect(loss.rejected).toBe(1);
  });

  it("accepts only explicit local CLI inputs and emits path-redacted deterministic JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-red-baron-survival-"));
    try {
      const midi: Note[] = [note("a", 60, 0) as Note];
      const paths = Object.fromEntries([...(["raw", "decoder", "semantic", "canonical", "easy"] as const), "reference"].map((name) => [name, join(directory, `${name}.mid`)]));
      for (const path of Object.values(paths)) await writeFile(path!, writeMidi(midi, { tempoBpm: 120 }));
      let output = "";
      let errors = "";
      const args = ["--stage", `raw=${paths.raw}`, "--stage", `decoder=${paths.decoder}`, "--stage", `semantic=${paths.semantic}`, "--stage", `canonical=${paths.canonical}`, "--stage", `easy=${paths.easy}`, "--reference", paths.reference!, "--window", "main:0:2"];
      expect(await runRedBaronSurvivalCli(args, { stdout: (value) => { output += value; }, stderr: (value) => { errors += value; } })).toBe(0);
      expect(errors).toBe("");
      expect(output).not.toContain(directory);
      expect(JSON.parse(output).status).toBe("ready");
      expect(await runRedBaronSurvivalCli(["--stage", `raw=${paths.raw}`, "--stage", `raw=${paths.raw}`, "--reference", paths.reference!, "--window", "main:0:2"], { stdout: () => {}, stderr: (value) => { errors += value; } })).toBe(2);
      expect(errors).toMatch(/duplicate/i);
      expect(await runRedBaronSurvivalCli(["--stage", "raw=https://example.test/raw.mid", "--reference", paths.reference!, "--window", "main:0:2"], { stdout: () => {}, stderr: (value) => { errors += value; } })).toBe(2);
      expect(errors).toMatch(/local/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
