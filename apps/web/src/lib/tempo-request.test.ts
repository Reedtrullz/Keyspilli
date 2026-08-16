import { describe, expect, it } from "vitest";
import { parseTempoRequest, TempoRequestError } from "./tempo-request";

describe("parseTempoRequest", () => {
  it("keeps the legacy tempo field as a playback alias", () => {
    expect(parseTempoRequest({ tempo: 96 })).toEqual({
      patch: { tempo: 96 },
      role: "playback",
      hasTempo: true,
    });
  });

  it("requires explicit source calibration for a rebuild", () => {
    expect(parseTempoRequest({ calibrationTempo: 128 })).toEqual({
      patch: { calibrationTempo: 128 },
      role: "source-calibration",
      hasTempo: true,
    });
  });

  it("rejects ambiguous role combinations", () => {
    expect(() => parseTempoRequest({ playbackTempo: 100, calibrationTempo: 120 })).toThrow(
      "choose one tempo role per update",
    );
    expect(() => parseTempoRequest({ tempo: 100, playbackTempo: 110 })).toThrow("either tempo or playbackTempo");
  });

  it("rejects non-finite values before they reach the update layer", () => {
    expect(() => parseTempoRequest({ playbackTempo: Number.NaN })).toThrow(TempoRequestError);
    expect(() => parseTempoRequest({ calibrationTempo: "120" })).toThrow("calibrationTempo must be a finite number");
  });
});
