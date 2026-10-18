import { describe, expect, it } from "vitest";
import { stripTags } from "../src/markup-text.js";

describe("plain-text markup labels", () => {
  it.each([
    ["Lead <b>Voice</b>", "Lead Voice"],
    ["<scr<script>ipt>", "ipt>"],
    ["left<>right", "leftright"],
    ["Lead <unfinished", "Lead <unfinished"],
    ["R&amp;B &#65;", "R&amp;B &#65;"],
  ])("strips complete tags and preserves literal text: %s", (source, expected) => {
    expect(stripTags(source)).toBe(expected);
  });

  it("handles an unterminated hostile label within the existing 1-second parsing bound", () => {
    const source = "<".repeat(100_000);
    const start = performance.now();
    expect(stripTags(source)).toBe(source);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
