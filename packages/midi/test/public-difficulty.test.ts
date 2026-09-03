import { describe, expect, it } from "vitest";
import { LEVEL_ORDER, PUBLIC_DIFFICULTY_ORDER, isPublicDifficultyLevel } from "../src/index.js";

describe("difficulty orders", () => {
  it("keeps the six physical levels while exposing the five public levels", () => {
    expect(LEVEL_ORDER).toEqual([
      "very-beginner",
      "beginner",
      "very-easy",
      "easy",
      "medium",
      "advanced",
    ]);
    expect(PUBLIC_DIFFICULTY_ORDER).toEqual([
      "very-beginner",
      "beginner",
      "easy",
      "medium",
      "advanced",
    ]);
  });

  it("recognizes only public difficulty values", () => {
    expect(isPublicDifficultyLevel("easy")).toBe(true);
    expect(isPublicDifficultyLevel("very-easy")).toBe(false);
  });
});
