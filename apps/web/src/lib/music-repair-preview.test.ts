import { it, expect } from "vitest";
import {
  previewMusicRepair,
  type RepairProposal,
} from "./music-repair-preview.js";
import { identityHash } from "@keyspilli/catalog/src/acoustic-receipt.js";
import type { ReplaySnapshot } from "./music-correspondence.js";
const snapshot = (): ReplaySnapshot => {
  const events = [
    {
      id: "e1",
      phraseId: "p1",
      occurrenceId: "o1",
      role: "melody" as const,
      midi: 61,
      onsetSeconds: 0.2,
      durationSeconds: 0.3,
    },
    {
      id: "e2",
      phraseId: "p2",
      occurrenceId: "o1",
      role: "bass" as const,
      midi: 48,
      onsetSeconds: 2,
      durationSeconds: 0.5,
    },
  ];
  return { schemaVersion: 1, sourceSha256: identityHash(events), events };
};
const proposal = (): RepairProposal => ({
  sourceSha256: snapshot().sourceSha256,
  findingId: "finding",
  findingKind: "authored-discrepancy",
  phrase: { id: "p1", startSeconds: 0, endSeconds: 1 },
  targetEventIds: ["e1"],
  operations: [{ kind: "replace-pitch", eventId: "e1", midi: 60 }],
  evidenceRefs: ["a".repeat(64)],
  sourceAuthority: "self-authored",
  preservePhraseIds: ["p2"],
});
it("isolated preview fixes seed and preserves original and neighbor", () => {
  const s = snapshot();
  const before = JSON.stringify(s);
  const p = previewMusicRepair(s, proposal());
  expect(p.snapshot.events[0]!.midi).toBe(60);
  expect(p.snapshot.events[1]).toEqual(s.events[1]);
  expect(JSON.stringify(s)).toBe(before);
  expect(p.requiredRechecks).toContain("fresh-audio-capture");
  expect(p.musicalAcceptance).toBe("not-established");
});
it.each([
  "stale",
  "unknown",
  "duplicate",
  "too-many",
  "playback",
  "authority",
  "neighbor",
])("refuses %s", (kind) => {
  const p = proposal();
  if (kind === "stale") p.sourceSha256 = "0".repeat(64);
  if (kind === "unknown") p.targetEventIds = ["unknown"];
  if (kind === "duplicate") p.targetEventIds = ["e1", "e1"];
  if (kind === "too-many") p.operations = Array(9).fill(p.operations[0]);
  if (kind === "playback") p.findingKind = "playback-realization";
  if (kind === "authority") p.sourceAuthority = "unknown";
  if (kind === "neighbor") {
    p.targetEventIds = ["e2"];
    p.operations = [{ kind: "replace-pitch", eventId: "e2", midi: 60 }];
  }
  expect(() => previewMusicRepair(snapshot(), p)).toThrow();
});
