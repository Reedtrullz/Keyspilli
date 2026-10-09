import { it, expect } from "vitest";
import {
  comparePlaybackEvents,
  type CaptureClock,
} from "./music-event-comparison.js";
import { sampleReceipt } from "../../../../packages/catalog/test/music-fixtures.js";
import { identityHash } from "@keyspilli/catalog/src/acoustic-receipt.js";
import { DEFAULT_MATCH_POLICY } from "@keyspilli/catalog/src/music-benchmark.js";
const events = [
  {
    id: "e",
    occurrenceId: "o1",
    midi: 60,
    onsetSeconds: 0.2,
    keyReleaseSeconds: 0.4,
  },
];
const clock = (): CaptureClock => ({
  audioSha256: "a".repeat(64),
  eventsSha256: identityHash(events),
  captureOffsetSeconds: 0,
  speed: 1,
  transpose: 0,
  tempoMapSha256: "c".repeat(64),
  basis: "resolved-playback-seconds",
});
it("missing extra octave and wrong notes remain localized", () => {
  const r = sampleReceipt();
  r.notes[0]!.midi = 72;
  const result = comparePlaybackEvents(
    events,
    r,
    clock(),
    DEFAULT_MATCH_POLICY,
  );
  expect(result.findings.some((f) => f.kind === "octave")).toBe(true);
});
it("200ms shift remains visible rather than alignment erased", () => {
  const r = sampleReceipt();
  r.notes[0]!.onsetSeconds = 0.4;
  const result = comparePlaybackEvents(
    events,
    r,
    clock(),
    DEFAULT_MATCH_POLICY,
  );
  expect(
    result.findings.find((f) => f.kind === "shifted")?.residualSeconds,
  ).toBeCloseTo(0.2);
});
it("unresolved clocks cannot create alignment", () => {
  const c = clock();
  c.captureOffsetSeconds = NaN;
  expect(
    comparePlaybackEvents(events, sampleReceipt(), c, DEFAULT_MATCH_POLICY)
      .status,
  ).toBe("unavailable");
});
it("stale events cannot be trusted", () => {
  expect(() =>
    comparePlaybackEvents(
      [{ ...events[0]!, midi: 61 }],
      sampleReceipt(),
      clock(),
      DEFAULT_MATCH_POLICY,
    ),
  ).toThrow();
});
it("key release and acoustic tail remain distinct", () => {
  const r = sampleReceipt();
  r.notes[0]!.soundingOffsetSeconds = 1.2;
  expect(
    comparePlaybackEvents(events, r, clock(), DEFAULT_MATCH_POLICY)
      .offsetStatus,
  ).toBe("unqualified");
});
