import { it, expect } from "vitest";
import {
  compareMusicalIntent,
  type SourceAnchors,
  type ReplaySnapshot,
  type ArrangementIntent,
} from "./music-correspondence.js";
import { identityHash } from "@keyspilli/catalog/src/acoustic-receipt.js";
const event = {
  id: "e",
  phraseId: "p",
  occurrenceId: "o",
  role: "melody" as const,
  midi: 60,
  onsetSeconds: 0.2,
  durationSeconds: 0.3,
};
const replay = (): ReplaySnapshot => ({
  schemaVersion: 1,
  sourceSha256: identityHash([event]),
  events: [event],
});
const source = (): SourceAnchors => ({
  sha256: "a".repeat(64),
  authority: "self-authored",
  anchors: [{ ...event, id: "anchor", required: true }],
});
const intent = (): ArrangementIntent => ({
  mode: "original",
  difficulty: "beginner",
  approvedTransformations: [],
  maximumHandSpan: 12,
});
it("backing-only permits melody omission", () => {
  const r = replay();
  r.events = [];
  r.sourceSha256 = identityHash([]);
  expect(
    compareMusicalIntent(source(), r, { ...intent(), mode: "chords" })
      .landmarks[0]!.status,
  ).toBe("changed-permitted");
});
it("required Original landmark is a discrepancy", () => {
  const r = replay();
  r.events = [];
  r.sourceSha256 = identityHash([]);
  expect(compareMusicalIntent(source(), r, intent()).landmarks[0]!.status).toBe(
    "violated",
  );
});
it("approved octave displacement is permitted", () => {
  const r = replay();
  r.events = [{ ...event, midi: 72 }];
  r.sourceSha256 = identityHash(r.events);
  expect(
    compareMusicalIntent(source(), r, {
      ...intent(),
      approvedTransformations: ["octave-displacement"],
    }).landmarks[0]!.status,
  ).toBe("changed-permitted");
});
it("auto-estimated anchors remain unknown", () => {
  expect(
    compareMusicalIntent(
      { ...source(), authority: "model-estimate" },
      replay(),
      intent(),
    ).landmarks[0]!.status,
  ).toBe("unknown");
});
it("does not certify musical acceptance", () => {
  expect(
    compareMusicalIntent(source(), replay(), intent()).musicalAcceptance,
  ).toBe("not-established");
});

it("reuses existing learner audit only with explicit tempo and hands", () => {
  const r = replay();
  r.events = Array.from({ length: 12 }, (_, i) => ({
    ...event,
    id: "fast" + i,
    hand: "R" as const,
    onsetSeconds: i * 0.025,
  }));
  r.sourceSha256 = identityHash(r.events);
  expect(compareMusicalIntent(source(), r, intent()).difficulty.status).toBe(
    "not-assessed",
  );
  r.tempoBpm = 100;
  const result = compareMusicalIntent(source(), r, intent());
  expect(result.difficulty.status).toBe("assessed");
  if (result.difficulty.status === "assessed")
    expect(result.difficulty.assessment.status).toBe("fail");
  expect(result.musicalAcceptance).toBe("not-established");
});
