import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMidi, type Note } from "@keyspilli/midi";
import {
  canonicalPianoEvaluationJson,
  evaluatePianoCandidates,
  writePianoPreviews,
  type PianoCandidateInput,
} from "../src/piano-evaluation.js";
import { runPianoEvaluationCli } from "../scripts/evaluate-piano-candidates.js";

const notes: Note[] = [
  { midi: 60, start: 0, dur: 1, vel: 90, hand: "R", identitySource: "vocals" },
  { midi: 64, start: 1, dur: 1, vel: 90, hand: "R", identitySource: "vocals" },
  { midi: 48, start: 0, dur: 2, vel: 65, hand: "L", identitySource: "other" },
  { midi: 52, start: 0, dur: 2, vel: 65, hand: "L", identitySource: "other" },
];

const candidate = (overrides: Partial<PianoCandidateInput> = {}): PianoCandidateInput => ({
  id: "clean-piano",
  selector: "/private/user/secret/clean-piano.mid",
  notes,
  tempoBpm: 120,
  durationBeats: 2,
  metadata: { instrument: "acoustic piano", source: "piano cover" },
  ...overrides,
});

describe("piano candidate evaluation", () => {
  it("classifies piano purity and reports structural metrics", () => {
    const report = evaluatePianoCandidates({
      candidates: [candidate()],
      reference: { id: "ref", notes, tempoBpm: 120, durationBeats: 2 },
    });

    expect(report.candidates[0]?.purity.classification).toBe("piano");
    expect(report.candidates[0]?.purity.overlayRisk).toBe("low");
    const evaluated = report.candidates[0]!;
    expect(evaluated.metrics).not.toBeNull();
    expect(evaluated.metrics!.coverage.ratio).toBe(1);
    expect(evaluated.metrics!.polyphony.max).toBe(3);
    expect(evaluated.metrics!.attack.onsetCount).toBe(2);
    expect(evaluated.metrics!.isolatedNote.count).toBe(0);
    expect(report.candidates[0]?.reference?.metrics.exactPitch.f1).toBe(1);
  });

  it("detects overlay risk from explicit role notes and metadata", () => {
    const report = evaluatePianoCandidates({
      candidates: [candidate({
        id: "overlay",
        notes: [...notes, { midi: 72, start: 0, dur: 1, vel: 70, identitySource: "guitar" }],
        metadata: { instrument: "piano", stems: ["piano", "vocals"], role: "mixed" },
      })],
    });
    expect(report.candidates[0]?.purity.classification).toBe("piano-overlay");
    expect(report.candidates[0]?.purity.overlayRisk).toBe("high");
    expect(report.candidates[0]?.purity.signals).toContain("non-piano role notes present");
  });

  it("ranks by structural/reference evidence without recognizability claims", () => {
    const report = evaluatePianoCandidates({
      candidates: [
        candidate({ id: "mismatch", notes: [{ midi: 61, start: 0, dur: 1, vel: 90 }] }),
        candidate({ id: "match" }),
      ],
      reference: { id: "ref", notes, tempoBpm: 120, durationBeats: 2 },
    });
    expect(report.ranking.map((entry) => entry.id)).toEqual(["match", "mismatch"]);
    expect(report.ranking[0]).not.toHaveProperty("recognizability");
    expect(report.disclaimer).toMatch(/does not claim recognizability/i);
  });

  it("fails cleanly for unavailable media/backend and redacts paths", () => {
    const report = evaluatePianoCandidates({
      candidates: [{ id: "missing", selector: "/Users/reidar/private/missing.mid", mediaAvailable: false }],
    });
    expect(report.candidates[0]).toMatchObject({ status: "unavailable" });
    expect(report.candidates[0]?.diagnostics).toContain("media unavailable");
    expect(canonicalPianoEvaluationJson(report)).not.toContain("/Users/reidar");
    expect(canonicalPianoEvaluationJson(report)).not.toContain("selector");
  });

  it("fails closed for empty and all-invalid symbolic candidates", () => {
    const report = evaluatePianoCandidates({
      candidates: [
        candidate({ id: "empty", notes: [] }),
        candidate({ id: "invalid", notes: [{ midi: 300, start: 0, dur: 1, vel: 90 } as Note] }),
      ],
    });

    expect(report.candidates.every((entry) => entry.status === "unavailable")).toBe(true);
    expect(report.candidates.every((entry) => entry.metrics === null && entry.rankScore === null)).toBe(true);
    expect(report.candidates.flatMap((entry) => entry.diagnostics)).toEqual(expect.arrayContaining([
      "candidate contains no valid symbolic notes",
    ]));
  });

  it("makes duplicate candidate IDs unique without depending on input order", () => {
    const first = evaluatePianoCandidates({ candidates: [candidate({ id: "same" }), candidate({ id: "same" })] });
    const second = evaluatePianoCandidates({ candidates: [candidate({ id: "same" }), candidate({ id: "same" })] });
    expect(first.candidates.map((entry) => entry.id)).toEqual(["same", "same-2"]);
    expect(canonicalPianoEvaluationJson(first)).toBe(canonicalPianoEvaluationJson(second));
    expect(first.determinism.canonicalSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("distinguishes a missing reference from an omitted reference in the CLI", async () => {
    const out: string[] = [];
    const errors: string[] = [];
    const code = await runPianoEvaluationCli(["--candidate", "/private/clean-piano.mid", "--reference", "/private/missing-reference.mid"], {
      stdout: (value) => out.push(value),
      stderr: (value) => errors.push(value),
    });
    expect(code).toBe(0);
    expect(errors.join("")).toMatch(/reference unavailable/i);
    expect(errors.join("")).not.toContain("/private/missing-reference.mid");
    expect(out.join("")).toMatch(/"referenceStatus"\s*:\s*"missing"/);
    expect(out.join("")).not.toContain("/private/clean-piano.mid");
  });

  it("uses a collision-resistant real SHA-256 canonical hash", () => {
    const left = evaluatePianoCandidates({ candidates: [candidate({ id: "left" })] });
    const right = evaluatePianoCandidates({ candidates: [candidate({ id: "right" })] });
    expect(left.determinism.canonicalSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(left.determinism.canonicalSha256).not.toBe(right.determinism.canonicalSha256);
  });

  it("is deterministic independent of candidate order and writes four local previews", async () => {
    const a = evaluatePianoCandidates({ candidates: [candidate({ id: "b" }), candidate({ id: "a" })] });
    const b = evaluatePianoCandidates({ candidates: [candidate({ id: "a" }), candidate({ id: "b" })] });
    expect(canonicalPianoEvaluationJson(a)).toBe(canonicalPianoEvaluationJson(b));

    const out = await mkdtemp(join(tmpdir(), "keyspilli-piano-evaluation-"));
    const previews = await writePianoPreviews(a.candidates[0]!, out);
    expect(Object.keys(previews.files)).toEqual(["raw", "aligned", "easy", "medium"]);
    for (const path of Object.values(previews.files)) {
      const parsed = parseMidi(new Uint8Array(await readFile(path)));
      expect(parsed.notes.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(previews)).not.toContain(out);
  });
});
