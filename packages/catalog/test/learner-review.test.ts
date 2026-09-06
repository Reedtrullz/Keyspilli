import { describe, expect, it } from "vitest";
import { blockedLearnerBases, isLearnerBlocked } from "../src/learner-review.js";

describe("learner review gates", () => {
  it("loads owner-blocked source failures from the review data", () => {
    const blocked = blockedLearnerBases();
    expect(blocked).toContain("pink-just-give-me-a-reason");
    expect(blocked).toContain("abba-lay-all-your-love-on-me");
    expect(blocked).toContain("olectralab-katyusha-piano-cover-mslzvw9f");
    expect(blocked).toContain("red-sun-in-the-sky");
    expect(blocked).toContain("sabaton-livgardet-organ-pianopaul05-dxhpyinsbdw");
    expect(blocked).toContain("sheet-music-boss-sabaton-the-last-stand-piano-tutorial-mslzz1c3");
    expect(blocked).toContain("sabaton-sabaton-defence-of-moscow-official-music-video-mte172p8");
    expect(blocked).not.toContain("piano-free-sheet-music-sabaton-the-final-solution-mslzzcr5");
    expect(isLearnerBlocked("taylor-swift-shake-it-off")).toBe(false);
  });
});
