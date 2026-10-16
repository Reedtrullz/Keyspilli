import { expect, it } from "vitest";
import { leftHandSupport, repairPreparedHarmony, diagnosePreparedChords } from "./chords-preparation";
import type { SongData } from "@keyspilli/player-core";
import type { ChordTimelineArtifact } from "@keyspilli/catalog";
import { parseMidi, sourcePhraseClock, suggestPhrasePlan, writeMidi } from "@keyspilli/midi";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const data = { title: "Test", artist: "Test", tempoBpm: 120, timeSig: [4, 4], key: "C", sourceFingerprint: "test",
  notes: [{ midi: 48, start: 0, dur: 4, vel: 80, hand: "L" }, { midi: 64, start: 0, dur: 4, vel: 80, hand: "R" }],
  chords: [{ name: "C", beat: 0, durationBeats: 4, notes: [48, 64, 67], sourceKind: "inferred", inferenceType: "learner-harmonization" }],
  measures: [{ index: 0, startBeat: 0, endBeat: 4 }] } as SongData;
it("uses explicitly selected source roles to leave a melody-only opening and backing rests silent", () => {
  const root = new URL("../../../../", import.meta.url).pathname;
  const scratch = mkdtempSync(join(root, "output", "source-role-backing-test-"));
  const run = join(scratch, "run"), input = join(scratch, "source.mid"), planPath = join(scratch, "plan.json");
  const melody = Array.from({ length: 32 }, (_, i) => ({ midi: 60 + i % 3 * 2, start: i * 2, dur: 0.5, vel: 80, hand: "R" as const }));
  const backing = Array.from({ length: 12 }, (_, i) => [72, 76, 79].map(midi => ({ midi, start: 8 + i * 4, dur: 3, vel: 70, hand: "L" as const }))).flat();
  const bytes = writeMidi([...melody, ...backing], { tempoBpm: 120, tracks: [{ name: "Right hand", notes: melody }, { name: "Left hand", notes: backing }] });
  const hash = createHash("sha256").update(bytes).digest("hex");
  const source = parseMidi(bytes);
  const plan = suggestPhrasePlan(source, { sha256: hash, compositionId: "authored-crossing-control", performanceId: "test-v1" });
  plan.levels = ["advanced"];
  plan.source.clock = sourcePhraseClock(source);
  for (const event of plan.phrases[0]!.events) {
    const note = source.notes.find(n => n.sourceOrigins?.some(o => o.id === event.sourceOriginId))!;
    event.role = note.hand === "R" ? "melody" : "harmony";
    event.required = event.sourceOriginId === source.notes[0]!.sourceOrigins![0]!.id;
    if (event.required) event.allowedTransformations = [];
  }
  const call = (args: string[]) => execFileSync(process.execPath, ["--import", "tsx", join(root, "apps/web/scripts/prepare-song.mts"), ...args], { cwd: root, encoding: "utf8", timeout: 60000 });
  try {
    writeFileSync(input, bytes); writeFileSync(planPath, JSON.stringify(plan));
    call([input, run, "Crossing control", "Authored tests", "--phrase-plan", planPath, "--source-backed-chords"]);
    const actual = parseMidi(readFileSync(join(run, "bundle", "chords.mid"))).notes;
    expect(actual.length).toBeGreaterThan(0);
    expect(actual.some(n => n.start < 8)).toBe(false);
    expect(actual.some(n => n.start < 12 && n.start + n.dur > 11.01)).toBe(false);
    expect(actual.some(n => n.midi % 12 === 2)).toBe(false);
    const timeline = JSON.parse(readFileSync(join(run, "bundle", "timeline.json"), "utf8"));
    expect(timeline.chords.every((c: { inferred: boolean; sourceKind: string }) => c.inferred && c.sourceKind === "generated")).toBe(true);
    expect(timeline.provenance.sourceId).toBe("prepared-source-backed");
    expect(readFileSync(input)).toEqual(Buffer.from(bytes));
    expect(() => call([input, join(scratch, "missing-plan"), "Test", "Tests", "--source-backed-chords"])).toThrow();
    expect(existsSync(join(scratch, "missing-plan"))).toBe(false);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 60000);
it.each([false, true])("realizes only selected backing attacks and releases with crossing hands=%s", crossing => {
  const root = new URL("../../../../", import.meta.url).pathname;
  const scratch = mkdtempSync(join(root, "output", "selected-rest-realization-"));
  const input = join(scratch, "source.mid"), planPath = join(scratch, "plan.json"), run = join(scratch, "run");
  const starts = Array.from({ length: 8 }, (_, i) => i * 2);
  const melody = starts.flatMap(start => [start + .5, start + 1.5].map(beat => ({ midi: 62, start: beat, dur: .25, vel: 80, hand: crossing ? "L" as const : "R" as const })));
  const backing = starts.flatMap(start => [72, 76, 79].map(midi => ({ midi, start, dur: 1.75, vel: 70, hand: crossing ? "R" as const : "L" as const })));
  const bytes = writeMidi([...melody, ...backing], { tempoBpm: 120, measures: Array.from({ length: 4 }, (_, index) => ({ index, startBeat: index * 4, endBeat: index * 4 + 4 })),
    tracks: [{ name: crossing ? "Left hand" : "Right hand", notes: melody }, { name: crossing ? "Right hand" : "Left hand", notes: backing }] });
  const hash = createHash("sha256").update(bytes).digest("hex"), source = parseMidi(bytes);
  const plan = suggestPhrasePlan(source, { sha256: hash, compositionId: "authored-role-rest-realization", performanceId: "test-v1" });
  for (const event of plan.phrases[0]!.events) {
    event.role = event.expected.midi === 62 ? "melody" : "harmony";
    event.required = true; event.allowedTransformations = [];
  }
  plan.phrases[0]!.rests = starts.map((start, i) => ({ id: `breath-${i}`, startBeat: start + 1.75, endBeat: start + 2, scope: "all" }));
  try {
    writeFileSync(input, bytes); writeFileSync(planPath, JSON.stringify(plan));
    execFileSync(process.execPath, ["--import", "tsx", join(root, "apps/web/scripts/prepare-song.mts"), input, run, "Authored role/rest control", "Tests", "--phrase-plan", planPath, "--source-backed-chords"],
      { cwd: root, encoding: "utf8", timeout: 60000 });
    const actual = parseMidi(readFileSync(join(run, "bundle", "chords.mid"))).notes;
    expect([...new Set(actual.map(n => n.start))]).toEqual(starts);
    for (const note of actual) expect(note.dur).toBeCloseTo(1.75, 8);
    expect(actual.some(n => n.midi % 12 === 2)).toBe(false);
    expect(readFileSync(input)).toEqual(Buffer.from(bytes));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 60000);
it("retains explicitly selected monophonic backing without inventing chord tones", () => {
  const root = new URL("../../../../", import.meta.url).pathname;
  const scratch = mkdtempSync(join(root, "output", "monophonic-source-backing-"));
  const melody = Array.from({ length: 16 }, (_, i) => ({ midi: 74, start: i, dur: .25, vel: 80, hand: "R" as const }));
  const backing = Array.from({ length: 14 }, (_, i) => ({ midi: [48, 55, 52][i % 3]!, start: i + 2, dur: .5, vel: 70, hand: "L" as const }));
  const bytes = writeMidi([...melody, ...backing], { tempoBpm: 120,
    tracks: [{ name: "Right hand", notes: melody }, { name: "Left hand", notes: backing }] });
  const source = parseMidi(bytes), hash = createHash("sha256").update(bytes).digest("hex");
  const plan = suggestPhrasePlan(source, { sha256: hash, compositionId: "authored-monophonic-backing", performanceId: "test-v1" });
  for (const event of plan.phrases[0]!.events) {
    event.role = event.expected.midi === 74 ? "melody" : "accompaniment";
    event.required = true; event.allowedTransformations = [];
  }
  try {
    const input = join(scratch, "source.mid"), planPath = join(scratch, "plan.json"), run = join(scratch, "run");
    writeFileSync(input, bytes); writeFileSync(planPath, JSON.stringify(plan));
    execFileSync(process.execPath, ["--import", "tsx", join(root, "apps/web/scripts/prepare-song.mts"), input, run,
      "Authored monophonic backing", "Tests", "--phrase-plan", planPath, "--source-backed-chords"], { cwd: root, timeout: 60000 });
    const actual = parseMidi(readFileSync(join(run, "bundle", "chords.mid"))).notes;
    expect(actual.map(n => [n.midi, n.start, n.dur])).toEqual(backing.map(n => [n.midi, n.start, n.dur]));
    expect(actual.some(n => n.midi === 74 || n.start < 2)).toBe(false);
    expect(readFileSync(input)).toEqual(Buffer.from(bytes));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 60000);

it("refuses a doubled lead as raw backing while the same input still prepares chordal Chords", () => {
  const root = new URL("../../../../", import.meta.url).pathname;
  const scratch = mkdtempSync(join(root, "output", "doubled-lead-chords-"));
  const input = join(scratch, "source.mid"), planPath = join(scratch, "plan.json");
  const melody = Array.from({ length: 32 }, (_, index) => ({ midi: 60 + index % 3 * 2,
    start: index * 2, dur: 0.5, vel: 80, hand: "R" as const }));
  const doubled = melody.map(note => ({ ...note }));
  const chords = Array.from({ length: 12 }, (_, index) => index * 4 + 8)
    .flatMap(start => [72, 76, 79].map(midi => ({ midi, start, dur: 3, vel: 70, hand: "L" as const })));
  const bytes = writeMidi([...melody, ...doubled, ...chords], { tempoBpm: 120,
    tracks: [{ name: "Right hand", notes: melody }, { name: "Left hand", notes: chords },
      { name: "Right hand backing double", notes: doubled }] });
  const source = parseMidi(bytes), hash = createHash("sha256").update(bytes).digest("hex");
  const plan = suggestPhrasePlan(source, { sha256: hash, compositionId: "authored-doubled-lead", performanceId: "test-v1" });
  const leadTrack = source.notes.find(note => note.hand === "R")!.sourceOrigins![0]!.track;
  for (const event of plan.phrases[0]!.events) {
    const note = source.notes.find(note => note.sourceOrigins?.some(origin => origin.id === event.sourceOriginId))!;
    event.role = note.sourceOrigins!.some(origin => origin.id === event.sourceOriginId && origin.track === leadTrack) ? "melody" : "accompaniment";
    event.required = true; event.allowedTransformations = [];
  }
  const call = (run: string, sourceBacked = false) => execFileSync(process.execPath, ["--import", "tsx",
    join(root, "apps/web/scripts/prepare-song.mts"), input, run, "Doubled lead", "Authored tests", "--phrase-plan", planPath,
    ...(sourceBacked ? ["--source-backed-chords"] : [])], { cwd: root, encoding: "utf8", timeout: 60000 });
  try {
    writeFileSync(input, bytes); writeFileSync(planPath, JSON.stringify(plan));
    expect(() => call(join(scratch, "raw-backing"), true)).toThrow(/shared melody\/hook/i);
    const run = join(scratch, "chordal");
    call(run);
    const playback = JSON.parse(readFileSync(join(run, "bundle", "playback.json"), "utf8"));
    expect(playback.snapshot.notes).toEqual([]);
    expect(playback.snapshot.chords.length).toBeGreaterThan(0);
    expect(parseMidi(readFileSync(join(run, "bundle", "chords.mid"))).notes.length).toBeGreaterThan(0);
    expect(readFileSync(input)).toEqual(Buffer.from(bytes));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 60000);

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
