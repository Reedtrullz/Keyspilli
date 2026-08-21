import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { diagnoseBase, runDiagnostic } from "../scripts/chord-diagnostic.js";

let tempRoot: string;

beforeAll(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "keyspilli-chord-diag-"));
});

afterAll(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

async function writeJson(relPath: string, data: unknown): Promise<void> {
  const full = join(tempRoot, relPath);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, JSON.stringify(data), "utf8");
}

describe("diagnoseBase", () => {
  it("reports ok for a base with all healthy artifacts", async () => {
    const base = "healthy-song";
    await writeJson(`artifacts/${base}/chord-source-map.json`, {
      schemaVersion: 1,
      entries: [{ baseId: base, sources: [] }],
    });
    await writeJson(`artifacts/${base}/chord-timeline.json`, {
      chords: [
        { beat: 0, name: "C", notes: [60, 64, 67] },
        { beat: 4, name: "G", notes: [55, 59, 62] },
      ],
    });
    await writeJson(`artifacts/${base}/a/notes.json`, {
      notes: [
        { midi: 60, start: 0, dur: 1, vel: 80 },
        { midi: 64, start: 1, dur: 1, vel: 80 },
      ],
      durationBeats: 8,
    });

    const result = await diagnoseBase(base, tempRoot);
    expect(result.status).toBe("ok");
    expect(result.sourceMapExists).toBe(true);
    expect(result.timelineEventCount).toBe(2);
    expect(result.parseableChords).toBe(2);
    expect(result.unparseableChords).toHaveLength(0);
    expect(result.variantCount).toBe(1);
    expect(result.midiValid).toBe(true);
    expect(result.beatAlignmentIssues).toHaveLength(0);
  });

  it("warns when source map is missing", async () => {
    const base = "no-source-map";
    await writeJson(`artifacts/${base}/chord-timeline.json`, {
      chords: [{ beat: 0, name: "Am", notes: [57, 60, 64] }],
    });

    const result = await diagnoseBase(base, tempRoot);
    expect(result.status).toBe("warning");
    expect(result.sourceMapExists).toBe(false);
  });

  it("warns when chord symbols are unparseable", async () => {
    const base = "bad-chords";
    await writeJson(`artifacts/${base}/chord-source-map.json`, { schemaVersion: 1, entries: [] });
    await writeJson(`artifacts/${base}/chord-timeline.json`, {
      chords: [
        { beat: 0, name: "C", notes: [60, 64, 67] },
        { beat: 4, name: "XYZqqq", notes: [60] },
      ],
    });

    const result = await diagnoseBase(base, tempRoot);
    expect(result.status).toBe("warning");
    expect(result.unparseableChords).toContain("XYZqqq");
    expect(result.parseableChords).toBe(1);
  });

  it("errors when MIDI notes have invalid fields", async () => {
    const base = "bad-midi";
    await writeJson(`artifacts/${base}/chord-source-map.json`, { schemaVersion: 1, entries: [] });
    await writeJson(`artifacts/${base}/a/notes.json`, {
      notes: [
        { midi: 60, start: 0, dur: 1, vel: 80 },
        { midi: "not-a-number", start: 1, dur: 1, vel: 80 },
      ],
      durationBeats: 8,
    });

    const result = await diagnoseBase(base, tempRoot);
    expect(result.status).toBe("error");
    expect(result.midiValid).toBe(false);
    expect(result.beatAlignmentIssues.length).toBeGreaterThan(0);
  });

  it("errors when notes extend past durationBeats", async () => {
    const base = "overshoot";
    await writeJson(`artifacts/${base}/chord-source-map.json`, { schemaVersion: 1, entries: [] });
    await writeJson(`artifacts/${base}/a/notes.json`, {
      notes: [{ midi: 60, start: 0, dur: 12, vel: 80 }],
      durationBeats: 8,
    });

    const result = await diagnoseBase(base, tempRoot);
    expect(result.status).toBe("error");
    expect(result.beatAlignmentIssues.some((i) => i.includes("past durationBeats"))).toBe(true);
  });

  it("returns warning for a base with no artifacts", async () => {
    const result = await diagnoseBase("empty-base", tempRoot);
    expect(result.status).toBe("warning");
    expect(result.sourceMapExists).toBe(false);
    expect(result.timelineEventCount).toBe(0);
    expect(result.variantCount).toBe(0);
  });
});

describe("runDiagnostic", () => {
  it("produces correct summary counts", async () => {
    // Set up 3 bases: one ok, one warning, one error
    await writeJson("artifacts/ok-base/chord-source-map.json", { schemaVersion: 1, entries: [] });
    await writeJson("artifacts/ok-base/chord-timeline.json", {
      chords: [{ beat: 0, name: "C", notes: [60] }],
    });
    await writeJson("artifacts/ok-base/a/notes.json", {
      notes: [{ midi: 60, start: 0, dur: 1, vel: 80 }],
      durationBeats: 4,
    });

    await writeJson("artifacts/warn-base/chord-timeline.json", {
      chords: [{ beat: 0, name: "NotAChord", notes: [60] }],
    });

    await writeJson("artifacts/error-base/a/notes.json", {
      notes: [{ midi: -1, start: -5, dur: 0, vel: 80 }],
      durationBeats: 4,
    });

    const report = await runDiagnostic(tempRoot, ["ok-base", "warn-base", "error-base"]);
    expect(report.summary.totalBases).toBe(3);
    expect(report.summary.ok).toBe(1);
    expect(report.summary.warnings).toBe(1);
    expect(report.summary.errors).toBe(1);
    expect(report.bases.map((b) => b.baseId).sort()).toEqual(["error-base", "ok-base", "warn-base"]);
  });
});
