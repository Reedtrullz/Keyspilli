import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseMidi, parseMusicXmlNotes, suggestPhrasePlan, writeMidi } from "@keyspilli/midi";

it("delivers the pinned bridge in MIDI/XML and a second catalog without importing the competing lead", () => {
  const root = new URL("../../../../", import.meta.url).pathname;
  const scratch = mkdtempSync(join(root, "output", "source-gap-bridge-test-"));
  const input = join(scratch, "source.mid"), run = join(scratch, "run"), planPath = join(scratch, "plan.json");
  const backing = [0, ...Array.from({ length: 15 }, (_, i) => 8 + i * 4)].flatMap(start =>
    [48, 52, 55].map(midi => ({ midi, start, dur: 1, vel: 70, hand: "L" as const })));
  const melody = [{ midi: 67, start: 2, dur: 1, vel: 70, hand: "R" as const },
    { midi: 69, start: 3, dur: 1, vel: 70, hand: "R" as const },
    { midi: 83, start: 2, dur: 2, vel: 90, hand: "R" as const },
    ...Array.from({ length: 30 }, (_, i) => ({ midi: 72, start: 8 + i * 2, dur: .5, vel: 80, hand: "R" as const }))];
  const bytes = writeMidi([...backing, ...melody], { tempoBpm: 120,
    tracks: [{ name: "Left hand", notes: backing }, { name: "Right hand", notes: melody }] });
  const plan = suggestPhrasePlan(parseMidi(bytes), { sha256: createHash("sha256").update(bytes).digest("hex"),
    compositionId: "authored export bridge control", performanceId: "synthetic test" });
  for (const event of plan.phrases[0]!.events) {
    event.role = event.expected.midi <= 55 ? "harmony" : "melody";
    event.required = true; event.allowedTransformations = [];
  }
  plan.chordsBridges = [{ id: "lower-link", startBeat: 2, endBeat: 4, basis: "authored lower connecting voice",
    events: plan.phrases[0]!.events.filter(e => e.expected.midi === 67 || e.expected.midi === 69).map(e => ({ eventId: e.id })) }];
  const call = (extra: string[], destination = run) => spawnSync(process.execPath,
    ["--import", "tsx", join(root, "apps/web/scripts/prepare-song.mts"), input, destination, "Bridge control", "Tests",
      "--phrase-plan", planPath, ...extra], { cwd: root, encoding: "utf8", timeout: 60000 });
  try {
    writeFileSync(input, bytes); writeFileSync(planPath, JSON.stringify(plan));
    const ignored = join(scratch, "must-not-ignore-bridge"), missingOptIn = call([], ignored);
    expect(missingOptIn.status).toBe(1);
    expect(missingOptIn.stderr).toMatch(/bridges require --source-backed-chords/);
    expect(existsSync(ignored)).toBe(false);
    const result = call(["--source-backed-chords"]);
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const midi = parseMidi(readFileSync(join(run, "bundle/chords.mid"))).notes;
    const xml = parseMusicXmlNotes(readFileSync(join(run, "bundle/chords.musicxml"), "utf8")).notes;
    const canonical = (notes: typeof midi) => notes.map(n => [n.midi, n.start, n.dur]).sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!);
    expect(canonical(midi)).toEqual(canonical([...backing, melody[0]!, melody[1]!]));
    expect(canonical(xml)).toEqual(canonical(midi));
    const delivered = JSON.parse(readFileSync(join(run, "bundle/playback.json"), "utf8"));
    expect(delivered.resolution.sourceTransformations.filter((c: { operation: string }) => c.operation === "source-gap-bridge")).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(run, "result.json"), "utf8")).checks).toEqual({ freshImport: true, musicalIdempotence: true });
    expect(readFileSync(input)).toEqual(Buffer.from(bytes));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 60000);
