import { it, expect } from "vitest";
import {
  gradeAcousticCase,
  summarizeCandidate,
  groupAttacks,
  DEFAULT_MATCH_POLICY,
} from "../src/music-benchmark.js";
import { sampleReceipt } from "./music-fixtures.js";
const truth = () => ({
  id: "case",
  split: "heldout" as const,
  category: "clean" as const,
  critical: true,
  audioSha256: "a".repeat(64),
  notes: [
    {
      id: "t",
      midi: 60,
      onsetSeconds: 0.2,
      keyOffsetSeconds: null,
      soundingOffsetSeconds: null,
      confidence: null,
    },
  ],
});
it("one-to-one matching cannot reuse a note", () => {
  const t = truth();
  t.notes.push({ ...t.notes[0]!, id: "other" });
  const g = gradeAcousticCase(t, sampleReceipt(), DEFAULT_MATCH_POLICY);
  expect(g.onset50.counts).toEqual({ tp: 1, fp: 0, fn: 1 });
});
it("octave is distinct and cannot be exact", () => {
  const r = sampleReceipt();
  r.notes[0]!.midi = 72;
  const g = gradeAcousticCase(truth(), r, DEFAULT_MATCH_POLICY);
  expect(g.onset50.counts.tp).toBe(0);
  expect(g.octaveErrors).toBe(1);
});
it("groups chords once but repeated attacks twice without transitive chaining", () => {
  expect(groupAttacks([0, 0.01, 0.019, 0.03], 0.02)).toEqual([0, 0.03]);
  expect(groupAttacks([0, 0.3], 0.02)).toHaveLength(2);
});
it("zero denominator remains null", () => {
  const t = truth();
  t.notes = [];
  const r = sampleReceipt();
  r.notes = [];
  expect(
    gradeAcousticCase(t, r, DEFAULT_MATCH_POLICY).onset50.precision,
  ).toBeNull();
  expect(summarizeCandidate([]).qualification).toBe("diagnostic-only");
});
it("keeps 50/100ms metrics separate and shifts visible", () => {
  const r = sampleReceipt();
  r.notes[0]!.onsetSeconds = 0.28;
  const g = gradeAcousticCase(truth(), r, DEFAULT_MATCH_POLICY);
  expect(g.onset50.counts.tp).toBe(0);
  expect(g.onset100.counts.tp).toBe(1);
});
it("failure is not excluded from qualification", () => {
  const r = sampleReceipt();
  r.status = "unavailable";
  r.notes = [];
  const g = gradeAcousticCase(truth(), r, DEFAULT_MATCH_POLICY);
  expect(summarizeCandidate([g]).unavailable).toBe(1);
  expect(summarizeCandidate([g]).qualification).toBe("diagnostic-only");
});

it("missing input must refuse as unavailable, not silently count a failed worker", () => {
  const r = sampleReceipt();
  r.notes = [];
  r.status = "failed";
  const t = { ...truth(), notes: [], expectedRefusal: true };
  expect(
    summarizeCandidate([gradeAcousticCase(t, r, DEFAULT_MATCH_POLICY)])
      .criticalFailures,
  ).toEqual(["case"]);
  r.status = "unavailable";
  expect(
    summarizeCandidate([gradeAcousticCase(t, r, DEFAULT_MATCH_POLICY)])
      .expectedRefusals,
  ).toBe(1);
});

it("short-clip latency cannot qualify the separate thirty-second resource profile", () => {
  const g = gradeAcousticCase(truth(), sampleReceipt(), DEFAULT_MATCH_POLICY);
  const result = summarizeCandidate([g]);
  expect(result.p95Seconds).not.toBeNull();
  expect(result.thirtySecondProfile.status).toBe("unqualified");
  expect(result.qualification).toBe("diagnostic-only");
});
