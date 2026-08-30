import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { writeMidi, type Note, type ParsedMidi } from "@keyspilli/midi";
import { runPianoDiagnosticsCli } from "../scripts/diagnose-piano-candidates.js";
import {
  canonicalPianoCandidateDiagnosticsJson,
  diagnosePianoCandidates,
  diagnosePianoStage,
  type PianoCandidateDiagnosticsInput,
  type PianoCandidateDiagnosticsReport,
} from "../src/piano-candidate-diagnostics.js";

const parsed = (notes: Note[]): ParsedMidi => ({
  format: 1,
  division: 480,
  tempoBpm: 120,
  keySig: 0,
  keyMode: 0,
  timeSig: [4, 4],
  notes,
  trackNames: ["Piano"],
  durationBeats: Math.max(4, ...notes.map((note) => note.start + note.dur)),
});

describe("piano candidate diagnostics", () => {
  it("reports lower-register density, close intervals, hand overlap, and melody contour", () => {
    const notes: Note[] = [
      { midi: 48, start: 0, dur: 1, vel: 90, hand: "L" },
      { midi: 50, start: 0.04, dur: 0.5, vel: 80, hand: "L" },
      { midi: 60, start: 0, dur: 1, vel: 100, hand: "R" },
      { midi: 64, start: 1, dur: 0.5, vel: 90, hand: "R" },
      { midi: 67, start: 2, dur: 0.5, vel: 90, hand: "R" },
    ];
    const report = diagnosePianoStage("easy", parsed(notes), {
      windows: [{ id: "intro", startBeat: 0, endBeat: 2 }],
    });

    expect(report.stage).toBe("easy");
    expect(report.noteCount).toBe(5);
    expect(report.onsetCount).toBe(3);
    expect(report.lowerRegister.noteCount).toBe(3);
    expect(report.lowerRegister.onsetCount).toBe(1);
    expect(report.lowerRegister.notesPerAttack).toBe(3);
    expect(report.closeIntervals.pitchCount).toBeGreaterThan(0);
    expect(report.hand.overlapCount).toBeGreaterThan(0);
    expect(report.hand.crossingCount).toBe(0);
    expect(report.melody.onsetCount).toBe(3);
    expect(report.melody.p95LeapSemitones).toBeCloseTo(3.95);
    expect(report.windows.intro?.noteCount).toBe(4);
  });

  it("keeps stage labels and canonical JSON deterministic under input reordering", () => {
    const notes: Note[] = [
      { midi: 67, start: 2, dur: 0.5, vel: 90, hand: "R" },
      { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" },
      { midi: 48, start: 0, dur: 1, vel: 80, hand: "L" },
      { midi: 64, start: 1, dur: 0.5, vel: 90, hand: "R" },
    ];
    const base: PianoCandidateDiagnosticsInput = {
      id: "piano-reference",
      stages: {
        raw: parsed(notes),
        aligned: parsed(notes),
        easy: parsed(notes.slice().reverse()),
        medium: parsed(notes),
      },
      windows: [{ id: "main", startBeat: 0, endBeat: 4 }],
    };
    const first = diagnosePianoCandidates(base);
    const second = diagnosePianoCandidates({
      ...base,
      stages: {
        medium: parsed(notes.slice().reverse()),
        easy: parsed(notes),
        raw: parsed(notes.slice().reverse()),
        aligned: parsed(notes),
      },
    });

    expect(Object.keys(first.stages)).toEqual(["raw", "aligned", "easy", "medium"]);
    expect(canonicalPianoCandidateDiagnosticsJson(first)).toBe(canonicalPianoCandidateDiagnosticsJson(second));
    expect(canonicalPianoCandidateDiagnosticsJson(first)).not.toContain("/Users/");
  });

  it("does not invent windows or stage data when none are provided", () => {
    const report = diagnosePianoCandidates({
      id: "synthetic",
      stages: { raw: [{ midi: 60, start: 0, dur: 1, vel: 90 }] },
    });
    expect(report.windows).toEqual([]);
    expect(report.stages.raw?.windows).toEqual({});
    expect(report.stages.easy).toBeUndefined();
  });

  it("fails closed instead of silently dropping malformed, duplicate, or overlapping windows", () => {
    const stage = parsed([{ midi: 60, start: 0, dur: 1, vel: 90 }]);
    const base: PianoCandidateDiagnosticsInput = { id: "synthetic", stages: { raw: stage } };

    expect(() => diagnosePianoCandidates({
      ...base,
      windows: [{ id: "negative", startBeat: -1, endBeat: 2 }],
    })).toThrow(/invalid piano diagnostic window bounds/i);
    expect(() => diagnosePianoCandidates({
      ...base,
      windows: [{ id: "nan", startBeat: Number.NaN, endBeat: 2 }],
    })).toThrow(/invalid piano diagnostic window bounds/i);
    expect(() => diagnosePianoCandidates({
      ...base,
      windows: [
        { id: "same", startBeat: 0, endBeat: 1 },
        { id: "same", startBeat: 1, endBeat: 2 },
      ],
    })).toThrow(/duplicate piano diagnostic window id/i);
    expect(() => diagnosePianoCandidates({
      ...base,
      windows: [
        { id: "first", startBeat: 0, endBeat: 2 },
        { id: "overlap", startBeat: 1, endBeat: 3 },
      ],
    })).toThrow(/overlapping piano diagnostic windows/i);
    expect(() => diagnosePianoCandidates({
      ...base,
      windows: null as unknown as PianoCandidateDiagnosticsInput["windows"],
    })).toThrow(/windows must be an array/i);
  });

  it("reads only explicit MIDI stages and redacts local paths from CLI JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-piano-diagnostics-"));
    try {
      const notes: Note[] = [
        { midi: 48, start: 0, dur: 1, vel: 90, hand: "L" },
        { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" },
        { midi: 64, start: 1, dur: 1, vel: 90, hand: "R" },
      ];
      const rawPath = join(directory, "raw.mid");
      const easyPath = join(directory, "easy.mid");
      await writeFile(rawPath, writeMidi(notes, { tempoBpm: 120 }));
      await writeFile(easyPath, writeMidi(notes.slice().reverse(), { tempoBpm: 120 }));
      let output = "";
      let errors = "";
      const code = await runPianoDiagnosticsCli([
        "--id", "/Users/reidar/Downloads/PianoPaul05.mid",
        "--raw", rawPath,
        "--easy", easyPath,
        "--window", "intro:0:2",
      ], {
        stdout: (value) => { output += value; },
        stderr: (value) => { errors += value; },
      });
      expect(code).toBe(0);
      expect(errors).toBe("");
      expect(output).not.toContain(directory);
      const report = JSON.parse(output) as PianoCandidateDiagnosticsReport;
      expect(report.id).toBe("PianoPaul05");
      expect(Object.keys(report.stages).sort()).toEqual(["easy", "raw"]);
      expect(report.stages.raw?.tempoBpm).toBe(120);
      expect(report.stages.easy?.windows.intro?.noteCount).toBe(3);

      let invalidErrors = "";
      const invalidCode = await runPianoDiagnosticsCli([
        "--raw", rawPath,
        "--window", "first:0:2",
        "--window", "overlap:1:3",
      ], {
        stdout: () => undefined,
        stderr: (value) => { invalidErrors += value; },
      });
      expect(invalidCode).toBe(2);
      expect(invalidErrors).toMatch(/overlapping piano diagnostic windows/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
