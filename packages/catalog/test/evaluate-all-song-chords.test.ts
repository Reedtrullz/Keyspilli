import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateVisibleAdvanced } from "../scripts/evaluate-all-song-chords.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("evaluates visible Advanced fixtures through the resolver and excludes hidden and unlisted artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "keyspilli-all-song-chords-"));
  roots.push(root);
  const payload = JSON.stringify({
    notes: [
      { midi: 48, start: 1, dur: 1, vel: 80 },
      { midi: 64, start: 2, dur: 1, vel: 80, identitySource: "vocals" },
    ],
    chords: [{ beat: 1, durationBeats: 1, name: "C", notes: [48, 52, 55], sourceKind: "authored" }],
    measures: [{ index: 0, startBeat: 1, endBeat: 5 }],
    timeSig: [4, 4], timeSigEvents: [{ beat: 0, timeSig: [4, 4] }, { beat: 4, timeSig: [6, 8] }],
  });
  for (const id of ["visible", "hidden", "orphan"]) {
    mkdirSync(join(root, id, "a"), { recursive: true });
    writeFileSync(join(root, id, "a", "notes.json"), payload);
  }
  let resolverCalls = 0;
  const report = evaluateVisibleAdvanced(
    [{ baseId: "visible" }, { baseId: "hidden" }], new Set(["hidden"]), root,
    (source, duration) => {
      resolverCalls++;
      expect(source.notes).toHaveLength(2);
      expect(duration).toBe(5);
      return { chords: [{ beat: 1, durationBeats: 1, notes: [48, 52, 55] }], fallbackSpans: [{ startBeat: 2, endBeat: 5, reason: "no chord coverage" }] } as never;
    },
  );
  expect(resolverCalls).toBe(1);
  expect(report.summary).toEqual({ visibleBases: 1, hiddenBases: 1, orphanAdvancedArtifacts: 1, songsWithUnsupportedSpans: 1 });
  expect(report.rows[0]).toMatchObject({
    source: { chordProvenance: { authored: 1 }, pickupOrOffset: true, unusualMeter: true, sourceRestBeats: 3 },
    candidate: { chordEvents: 1, audioChordNoteAttacks: 3, coveredBeats: 1, unsupportedSpans: [{ startBeat: 2, endBeat: 5 }] },
  });
  expect(report.rows[0]?.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
});
