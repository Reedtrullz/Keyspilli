import { it, expect } from "vitest";
import { makeMusicCorpus } from "./music-review-corpus.js";
it("builds reproducible balanced disjoint neutral cases", () => {
  const a = makeMusicCorpus(51);
  expect(a).toEqual(makeMusicCorpus(51));
  expect(a.cases.filter((c) => c.split === "development")).toHaveLength(24);
  const held = a.cases.filter((c) => c.split === "heldout");
  expect(held).toHaveLength(96);
  for (const category of ["clean", "fault", "valid"])
    expect(
      a.key.filter((c) => c.split === "heldout" && c.category === category),
    ).toHaveLength(32);
  const dev = new Set(
    a.cases.filter((c) => c.split === "development").map((c) => c.lineage),
  );
  expect(held.every((c) => !dev.has(c.lineage))).toBe(true);
  expect(new Set(a.cases.map((c) => c.id)).size).toBe(120);
  expect(a.cases.every((c) => !/(fault|missing|repeat|clean)/.test(c.id))).toBe(
    true,
  );
  expect(JSON.stringify(a.cases)).not.toContain("category");
});
