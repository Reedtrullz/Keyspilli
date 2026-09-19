import { describe, expect, it } from "vitest";
import { beatGridPoints } from "./FallingCanvas";

describe("falling canvas beat grid", () => {
  it("includes fractional validated measure boundaries", () => {
    expect(beatGridPoints(0, 3, [
      { startBeat: 0.5, endBeat: 2.5 },
    ])).toEqual([0, 0.5, 1, 2, 2.5, 3]);
  });
});
