import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanBackingCoverage } from "../scripts/chords-coverage.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("reports only visible Advanced bases and distinguishes hidden/orphan artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "keyspilli-chords-coverage-"));
  roots.push(root);
  const visible = JSON.stringify({ notes: [
    { midi: 48, start: 0, dur: 1, vel: 80, hand: "L" },
    { midi: 64, start: 0, dur: 1, vel: 80, hand: "R", identitySource: "vocals" },
  ], chords: [{ beat: 0, name: "C", notes: [48, 52, 55], sourceKind: "generated" }], measures: [{ index: 0, startBeat: 0, endBeat: 4 }], timeSig: [4, 4] });
  for (const base of ["visible", "hidden", "orphan"]) {
    const path = join(root, base, "a");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "notes.json"), visible);
  }
  const result = scanBackingCoverage([
    { baseId: "visible", acquiredVia: "midi-pack" },
    { baseId: "hidden", acquiredVia: null },
  ], new Set(["hidden"]), root);
  expect(result.summary).toMatchObject({ visibleBases: 1, hiddenBases: 1, orphanAdvancedArtifacts: 1, generatedOnlyBases: 1, roleLabeledBases: 1, fullyRoleLabeledBases: 0 });
  expect(result.rows).toEqual([expect.objectContaining({
    baseId: "visible", acquiredVia: "midi-pack", noteCount: 2, chordCount: 1,
    notesSha256: createHash("sha256").update(visible).digest("hex"),
  })]);
});
