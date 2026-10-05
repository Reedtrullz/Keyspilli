import { describe, it, expect } from "vitest";
import {
  parseAcousticReceipt,
  acousticCacheKey,
  type AcousticReceipt,
} from "../src/acoustic-receipt.js";
import { sampleReceipt } from "./music-fixtures.js";
describe("raw acoustic receipt", () => {
  it("unknown_metadata_stays_unknown", () => {
    expect(parseAcousticReceipt(sampleReceipt()).metadata.tempoBpm).toBeNull();
  });
  it("checkpoint_changes_cache", () => {
    const a = sampleReceipt().analyzer;
    expect(acousticCacheKey(a)).not.toBe(
      acousticCacheKey({ ...a, checkpointSha256: "0".repeat(64) }),
    );
  });
  it.each([NaN, -1, 2.1])("reject_invalid_events %s", (onsetSeconds) => {
    const a = sampleReceipt();
    a.notes[0]!.onsetSeconds = onsetSeconds;
    expect(() => parseAcousticReceipt(a)).toThrow();
  });
  it("rejects rounded pitch and inverted offsets", () => {
    const a = sampleReceipt();
    a.notes[0]!.midi = 60.1;
    expect(() => parseAcousticReceipt(a)).toThrow();
    a.notes[0]!.midi = 60;
    a.notes[0]!.keyOffsetSeconds = 0.1;
    expect(() => parseAcousticReceipt(a)).toThrow();
  });
  it("legacy_normalization_is_not_measurement", () => {
    const a = sampleReceipt();
    a.metadata = {
      tempoBpm: 120,
      key: "C",
      meter: [4, 4],
      origin: "container-default",
    };
    expect(parseAcousticReceipt(a).metadata.origin).toBe("container-default");
  });
  it("failed receipt cannot contain successful notes", () => {
    const a = sampleReceipt();
    a.status = "failed";
    expect(() => parseAcousticReceipt(a)).toThrow();
  });
});
