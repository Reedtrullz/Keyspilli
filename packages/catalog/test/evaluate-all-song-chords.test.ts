import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateVisibleAdvanced } from "../scripts/evaluate-all-song-chords.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("evaluates visible Advanced fixtures through both note streams and preserves catalog timeline context", async () => {
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
  const report = await evaluateVisibleAdvanced(
    [{ baseId: "visible" }, { baseId: "hidden" }], new Set(["hidden"]), root,
    (source, duration, catalogTimeline) => {
      resolverCalls++;
      expect(source.notes).toHaveLength(2);
      expect(duration).toBe(5);
      expect(catalogTimeline?.coverage).toBe("opening-section");
      return {
        notes: [
          { midi: 48, start: 1, dur: 1, vel: 70, hand: "L" },
          { midi: 36, start: 1, dur: 0.5, vel: 70, hand: "L" },
        ],
        chords: [{ beat: 1, durationBeats: 1, notes: [48, 52, 55], suggestedHands: ["L", "R", "R"] }],
        fallbackSpans: [{ startBeat: 2, endBeat: 5, reason: "no chord coverage" }],
      } as never;
    },
    async () => ({
      chords: [{ beat: 1, durationBeats: 1, name: "C", notes: [48, 52, 55], sourceKind: "authored" }],
      coverage: "opening-section", usedFallback: true,
      provenance: { sourceId: "fixture", provider: "fixture", kind: "chart", sourceRef: "fixture-chart" },
    }),
  );
  expect(resolverCalls).toBe(1);
  expect(report.summary).toEqual({ visibleBases: 1, hiddenBases: 1, orphanAdvancedArtifacts: 1, songsWithUnsupportedSpans: 1 });
  expect(report.rows[0]).toMatchObject({
    source: { chordProvenance: { authored: 1 }, pickupOrOffset: true, unusualMeter: true, sourceRestBeats: 3 },
    evaluationInput: {
      chordTimeline: "raw-advanced-artifact", exactPlayerTimeline: false,
      catalogChordTimeline: { chordCount: 1, coverage: "opening-section", usedFallback: true, provenance: { sourceId: "fixture", provider: "fixture", kind: "chart", sourceRef: "fixture-chart" } },
    },
    timelineEvaluation: {
      input: "injectedCandidate",
      chordEvents: 1, audioNoteStreamAttacks: 2, chordVoicingAttacks: 3, audioAttacks: 5, duplicateAudioAttacks: 1,
      coveredBeats: 1, maximumHeldOverlap: 5,
      onsetGeometryByHand: { L: { maxSimultaneousSpanSemitones: 12, maxRepresentativeLeapSemitones: 0 }, R: { maxSimultaneousSpanSemitones: 3, maxRepresentativeLeapSemitones: 0 } },
      unsupportedSpans: [{ startBeat: 2, endBeat: 5 }],
    },
  });
  expect(report.rows[0]?.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
});
