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

  it("deduplicates role-lane evidence that repeats candidate notes", () => {
    const repeated = notes[0]!;
    const report = evaluatePianoCandidates({
      candidates: [candidate({
        id: "role-view",
        notes: [repeated],
        roleNotes: { vocals: [repeated], voice: [{ ...repeated }] },
      })],
    });

    // The same physical event is represented by the candidate and two role
    // views, but it must contribute once to the purity denominator/rate.
    expect(report.candidates[0]?.purity.nonPianoNoteRatio).toBe(1);
    expect(report.candidates[0]?.purity.pianoNoteRatio).toBe(0);
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

  it("redacts unavailable reasons before returning the evaluation object", () => {
    const report = evaluatePianoCandidates({
      candidates: [{
        id: "missing-reason",
        mediaAvailable: false,
        unavailableReason: "failed to read /Users/reidar/private/secret-track.mid",
      }],
    });

    const diagnostics = report.candidates[0]?.diagnostics.join(" ") ?? "";
    expect(diagnostics).not.toContain("/Users/reidar");
    expect(diagnostics).toContain("[redacted-path]");
  });

  it("redacts generic POSIX paths while preserving logical URLs", () => {
    const report = evaluatePianoCandidates({
      candidates: [{
        id: "generic-paths",
        mediaAvailable: false,
        unavailableReason: [
          "failed to read /root/keyspilli/secret.mid",
          "fallback /opt/keyspilli/cache.mid",
          "mounted /mnt/private/source.mid",
          "workspace /workspace/project/output.mid",
          "config /etc/keyspilli/config.json",
          "source https://example.test/root/track.mid",
          "logical candidate-42",
        ].join("; "),
      }],
    });

    const diagnostics = report.candidates[0]?.diagnostics.join(" ") ?? "";
    for (const path of [
      "/root/keyspilli/secret.mid",
      "/opt/keyspilli/cache.mid",
      "/mnt/private/source.mid",
      "/workspace/project/output.mid",
      "/etc/keyspilli/config.json",
    ]) {
      expect(diagnostics).not.toContain(path);
    }
    expect(diagnostics).toContain("https://example.test/root/track.mid");
    expect(diagnostics).toContain("candidate-42");
    expect(diagnostics.match(/\[redacted-path\]/g)).toHaveLength(5);
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

  it("redacts generic POSIX paths from CLI failures", async () => {
    const out: string[] = [];
    const errors: string[] = [];
    const code = await runPianoEvaluationCli(["--candidate", "/opt/keyspilli/private-candidate.mid"], {
      stdout: (value) => out.push(value),
      stderr: (value) => errors.push(value),
    });

    expect(code).toBe(0);
    expect(out.join("")).not.toContain("/opt/keyspilli/private-candidate.mid");
    expect(errors.join("")).not.toContain("/opt/keyspilli/private-candidate.mid");
  });

  it("redacts generic POSIX paths from direct CLI diagnostics", async () => {
    const errors: string[] = [];
    const code = await runPianoEvaluationCli([
      "--candidate", "/private/clean-piano.mid",
      "--metadata", "/root/keyspilli/private-metadata.json",
    ], {
      stdout: () => undefined,
      stderr: (value) => errors.push(value),
    });

    expect(code).toBe(2);
    expect(errors.join("")).not.toContain("/root/keyspilli/private-metadata.json");
    expect(errors.join("")).toContain("[redacted-path]");
  });

  it("uses a collision-resistant real SHA-256 canonical hash", () => {
    const left = evaluatePianoCandidates({ candidates: [candidate({ id: "left" })] });
    const right = evaluatePianoCandidates({ candidates: [candidate({ id: "right" })] });
    expect(left.determinism.canonicalSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(left.determinism.canonicalSha256).not.toBe(right.determinism.canonicalSha256);
  });

  it("derives contour direction from the matched groups when an onset is skipped", () => {
    const referenceNotes: Note[] = [
      { midi: 60, start: 0, dur: 1, vel: 90 },
      // This reference onset is intentionally unmatched.
      { midi: 62, start: 1, dur: 1, vel: 90 },
      { midi: 50, start: 2, dur: 1, vel: 90 },
    ];
    const report = evaluatePianoCandidates({
      candidates: [{
        id: "skipped-contour",
        notes: [
          { midi: 60, start: 0, dur: 1, vel: 90 },
          { midi: 50, start: 2, dur: 1, vel: 90 },
        ],
        tempoBpm: 120,
        durationBeats: 3,
      }],
      reference: { id: "reference", notes: referenceNotes, tempoBpm: 120, durationBeats: 3 },
      alignment: { offsetsBeats: [0], beatScales: [1], transpositions: [0] },
    });

    expect(report.candidates[0]?.reference?.metrics.contour).toMatchObject({
      directionAgreement: 1,
      matchedIntervals: 1,
    });
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
