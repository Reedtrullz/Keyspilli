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
