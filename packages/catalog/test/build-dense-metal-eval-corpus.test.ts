import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditMidiBytes } from "../src/midi-corpus.js";
import { buildDenseMetalEvalCorpus } from "../scripts/build-dense-metal-eval-corpus.js";

describe("dense-metal AMT evaluation corpus", () => {
  it("builds three deterministic, full-reference, project-owned fixtures", async () => {
    const root = await mkdtemp(join(tmpdir(), "keyspilli-dense-metal-corpus-"));
    const first = await buildDenseMetalEvalCorpus({ out: join(root, "a"), sampleRate: 8_000 });
    const second = await buildDenseMetalEvalCorpus({ out: join(root, "b"), sampleRate: 8_000 });

    expect(first).toEqual(second);
    expect(first.fixtures.map((fixture) => fixture.id)).toEqual([
      "METAL_A_TIGHT_RIFF",
      "METAL_B_DENSE_EXTREME",
      "METAL_C_LAYERED_MELODIC",
    ]);
    expect(first.fixtures.reduce((sum, fixture) => sum + fixture.durationSeconds, 0)).toBeGreaterThanOrEqual(90);
    for (const fixture of first.fixtures) {
      expect(fixture.durationSeconds).toBeGreaterThanOrEqual(20);
      expect(fixture.durationSeconds).toBeLessThanOrEqual(45);
      expect(fixture.roles.length).toBeGreaterThanOrEqual(4);
      expect(fixture.metrics.maxSimultaneousPitchedNotes).toBeGreaterThanOrEqual(3);
      expect(fixture.artifacts.canonicalEvents.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fixture.artifacts.fullMix.canonicalPcmSha256).toMatch(/^[a-f0-9]{64}$/);
      const midi = await readFile(join(root, "a", fixture.artifacts.midi.logicalRef));
      const audited = auditMidiBytes(midi);
      expect(audited.status).toBe("valid");
      if (audited.status === "valid") expect(audited.canonical.notes.some((note) => note.percussion)).toBe(true);
    }
    expect(first.fixtures.find((fixture) => fixture.id === "METAL_B_DENSE_EXTREME")!.metrics.notesPerSecond).toBeGreaterThan(30);
    expect(first.firewall).toEqual({ classification: "EVAL_ONLY", generation: false, training: false, tuning: false });
  });
});
