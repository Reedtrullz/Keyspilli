import { expect, it } from "vitest";
import { leftHandSupport, repairPreparedHarmony, diagnosePreparedChords } from "./chords-preparation";
import type { SongData } from "@keyspilli/player-core";
import type { ChordTimelineArtifact } from "@keyspilli/catalog";
import { writeMidi } from "@keyspilli/midi";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const data = { title: "Test", artist: "Test", tempoBpm: 120, timeSig: [4, 4], key: "C", sourceFingerprint: "test",
  notes: [{ midi: 48, start: 0, dur: 4, vel: 80, hand: "L" }, { midi: 64, start: 0, dur: 4, vel: 80, hand: "R" }],
  chords: [{ name: "C", beat: 0, durationBeats: 4, notes: [48, 64, 67], sourceKind: "inferred", inferenceType: "learner-harmonization" }],
  measures: [{ index: 0, startBeat: 0, endBeat: 4 }] } as SongData;
it("counts uncovered LH duration and overlapping octave doublings only once", () => {
  const snapshot = { schemaVersion: 1, tempoBpm: 120, timeSig: [4, 4], endBeatExclusive: 4, chords: [],
    notes: [{ midi: 48, start: 0, dur: 2, vel: 80 }, { midi: 60, start: 0, dur: 2, vel: 80 }] };
  expect(leftHandSupport(data.notes, snapshot)).toBe(0.5);
  expect(leftHandSupport(data.notes, { ...snapshot, notes: [] })).toBe(0);
});
it("preserves safe existing harmony and refuses to repair an accepted chart", () => {
  const timeline = { schemaVersion: 1, baseId: "test", title: "Test", artist: "Test", tempoBpm: 120, timeSig: [4, 4], durationBeats: 4,
    chords: data.chords, provenance: { sourceId: "prepared", provider: "keyspilli", kind: "midi-derived", sourceRef: "prepared:test" } } as ChordTimelineArtifact;
  const result = repairPreparedHarmony(data, timeline);
  expect(result.retained).toBe(false);
  expect(result.timeline).toEqual(timeline);
  expect(() => repairPreparedHarmony(data, { ...timeline, provenance: { ...timeline.provenance, sourceRef: "accepted" } })).toThrow("prepared timeline");
  expect(diagnosePreparedChords(data).musicalVerdict).toContain("provisional");
});
it("packages both modes, refuses corruption/conflicts, and rolls back without deleting bytes", () => {
  const root = new URL("../../../../", import.meta.url).pathname;
  mkdirSync(join(root, "output"), { recursive: true });
  const scratch = mkdtempSync(join(root, "output", "song-workflow-test-"));
  const run = join(scratch, "run"), input = join(scratch, "source.mid");
  const call = (script: string, args: string[]) => execFileSync(process.execPath, ["--import", "tsx", join(root, "apps/web/scripts", script + ".mts"), ...args], { cwd: root, encoding: "utf8", stdio: "pipe", timeout: 60000 });
  try {
    writeFileSync(input, writeMidi(Array.from({ length: 16 }, (_, i) => i * 4).flatMap(start => [48, 64, 67].map(midi => ({ midi, start, dur: 2, vel: 80 }))), { tempoBpm: 120 }));
    call("prepare-song", [input, run, "Test", "Test"]);
    expect(JSON.parse(readFileSync(join(run, "result.json"), "utf8")).checks).toEqual({ freshImport: true, musicalIdempotence: true });
    const unrelated = join(scratch, "unrelated"); mkdirSync(unrelated); writeFileSync(join(unrelated, "keep"), "preserve");
    expect(() => call("song-bundle", ["install", join(run, "bundle"), unrelated])).toThrow();
    expect(readFileSync(join(unrelated, "keep"), "utf8")).toBe("preserve");
    appendFileSync(join(run, "bundle", "chords.mid"), "corruption");
    expect(() => call("song-bundle", ["install", join(run, "bundle"), join(scratch, "rejected")])).toThrow();
    expect(existsSync(join(scratch, "rejected"))).toBe(false);
    // Rollback must still work with damaged payload files or an incompatible playback engine.
    call("song-bundle", ["rollback", join(run, "bundle"), join(run, "installed")]);
    expect(existsSync(join(run, "installed"))).toBe(false);
    const backup = readdirSync(run).find(n => n.startsWith("installed.rollback-"));
    expect(backup && existsSync(join(run, backup, "db.sqlite"))).toBe(true);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 60000);
