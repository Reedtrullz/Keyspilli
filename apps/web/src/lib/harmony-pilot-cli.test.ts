import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { evaluateHarmonyPilotCase, measureHarmonyRealization, replayHarmonyPolicy, type HarmonyPilotCase } from "./harmony-pilot-evaluation";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const script = join(root, "apps/web/scripts/evaluate-harmony-pilot.mts");
const temporary = mkdtempSync(join(tmpdir(), "keyspilli-harmony-boundary-"));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));
const note = () => ({ midi: 48, start: 0, dur: 4, vel: 80, hand: "L" as const });
const source = () => ({ notes: [note(), { ...note(), midi: 55 }], measures: [{ index: 0, startBeat: 0, endBeat: 4 }], key: "C", tempoBpm: 60, timeSig: [4, 4], chords: [] });
const item = (): HarmonyPilotCase => ({ id: "boundary", compositionId: "boundary", split: "development", category: "boundary", key: "C", durationBeats: 4, notes: source().notes,
  reference: [{ startBeat: 0, endBeat: 4, kind: "supported", allowedPitchClasses: [0, 7], bassPc: 0 }] });
let serial = 0;
function run(value: unknown, mode: "source" | "corpus" = "source") {
  const path = join(temporary, `${serial++}.json`), bytes = JSON.stringify(value);
  writeFileSync(path, bytes);
  const result = spawnSync(process.execPath, ["--import", "tsx", script, `--${mode}`, path, "--policy", "conservative-backing-v1"], { cwd: root, encoding: "utf8", timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  expect(result.error).toBeUndefined();
  expect(readFileSync(path, "utf8")).toBe(bytes);
  return result;
}
function reject(value: unknown, reason: RegExp, mode: "source" | "corpus" = "source") {
  const result = run(value, mode);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toMatch(reason);
}
const corpus = (cases: unknown[]) => ({ schemaVersion: 1, corpusId: "boundary-probe", cases });

describe("harmony pilot validates source evidence before musical inference", () => {
  it.each([undefined, "48", -1, 128, 60.5])("rejects invalid MIDI pitch %s", midi => reject({ ...source(), notes: [{ ...note(), midi }] }, /midi|pitch/i));
  it.each([undefined, "loud", -1, 128, 80.5])("rejects invalid velocity %s", vel => reject({ ...source(), notes: [{ ...note(), vel }] }, /vel|velocity/i));
  it.each([
    [{ tempoBpm: undefined }, /tempo|clock/i], [{ tempoBpm: 0 }, /tempo|clock/i], [{ tempoBpm: "60" }, /tempo|clock/i],
    [{ timeSig: undefined }, /meter|timeSig|clock/i], [{ timeSig: [4, 0] }, /meter|timeSig|clock/i], [{ timeSig: [4, 3] }, /meter|timeSig|clock/i],
    [{ key: {} }, /key/i], [{ key: undefined }, /key/i],
  ])("rejects invalid source clock %j", (change, error) => reject({ ...source(), ...change }, error as RegExp));
  it.each([
    [], [{ index: 0, startBeat: 2, endBeat: 4 }, { index: 1, startBeat: 0, endBeat: 2 }],
    [{ index: 0, startBeat: 0, endBeat: 3 }, { index: 1, startBeat: 2, endBeat: 4 }],
    [{ index: 0, startBeat: 0, endBeat: 1 }, { index: 1, startBeat: 2, endBeat: 4 }],
    [{ index: 0, startBeat: 0, endBeat: 2 }],
  ].map(measures => [measures]))("rejects absent, overlapping, unordered or incomplete measure extent %j", measures => reject({ ...source(), measures }, /measure|extent|timing/i));
  it("rejects malformed role metadata that would silently remove or reassign evidence", () => reject({ ...source(), notes: [{ ...note(), lyrics: true }] }, /lyrics/i));
  it("preserves empty-note silence with an explicit clock", () => {
    const result = run({ ...source(), notes: [] });
    expect(result.status).toBe(0);
    const receipt = JSON.parse(result.stdout);
    expect(receipt.referenceMetrics).toBeNull();
    expect(receipt.policies[0].replay.resolution.guidanceNotes).toEqual([]);
  });
  it("keeps the valid C5 actual replay", () => {
    const result = run(source()); expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).implementationRevision).toBe(3);
    expect(JSON.parse(result.stdout).policies[0].replay.resolution.chords[0]).toMatchObject({ name: "C5", notes: [36, 67, 72] });
  });
  it("applies the same musical input boundary to direct replay", () => {
    expect(() => replayHarmonyPolicy({ ...source(), tempoBpm: 0 } as never, "conservative-backing-v1")).toThrow(/tempo|clock/i);
  });
});

describe("harmony pilot corpus admission", () => {
  it("rejects nonstring duplicate composition identities before split selection", () => reject(corpus([
    { ...item(), id: { key: "same" }, compositionId: { key: "same" } },
    { ...item(), id: { key: "same" }, compositionId: { key: "same" }, split: "holdout" },
  ]), /identit|composition|id/i, "corpus"));
  it("validates unselected cases before producing any split receipt", () => reject(corpus([item(), { ...item(), id: "other", compositionId: "other", split: "holdout", notes: [{ ...note(), midi: "bad" }] }]), /midi|pitch/i, "corpus"));
  it("rejects invalid case category and reference partitions", () => {
    reject(corpus([{ ...item(), category: {} }]), /category/i, "corpus");
    reject(corpus([{ ...item(), reference: [] }]), /reference|partition/i, "corpus");
  });
  it("rejects source duration outside the pilot workload envelope", () => reject(corpus([{ ...item(), durationBeats: 8192, notes: [{ ...note(), dur: 8192 }], reference: [{ startBeat: 0, endBeat: 8192, kind: "unknown", allowedPitchClasses: [] }] }]), /bound|duration|extent/i, "corpus"));
  it("rejects excessive events, cases and dense local work before inference", () => {
    reject({ ...source(), notes: Array.from({ length: 4097 }, note) }, /bound|note|event/i);
    reject(corpus(Array.from({ length: 65 }, (_, index) => ({ ...item(), id: `case-${index}`, compositionId: `piece-${index}` }))), /bound|case/i, "corpus");
    reject({ ...source(), notes: Array.from({ length: 257 }, (_, index) => ({ ...note(), dur: 1 + index / 512 })) }, /bound|window|work|density/i);
  });
  it("validates reference evidence before touching note data", () => {
    const invalid = { ...item(), reference: [] };
    Object.defineProperty(invalid, "notes", { get() { throw new Error("notes visited before reference validation"); } });
    expect(() => evaluateHarmonyPilotCase(invalid, "conservative-backing-v1")).toThrow(/partition|reference/i);
  });
  it("reports empty notes with unknown reference as silence and an undefined supported denominator", () => {
    const result = run(corpus([{ ...item(), notes: [], reference: [{ startBeat: 0, endBeat: 4, kind: "unknown", allowedPitchClasses: [] }] }]), "corpus");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).policies[0].summary).toMatchObject({ supportedCoverage: null, wrongHarmonyBeats: 0, abstentionRate: 1 });
  });
  it("rejects malformed realized notes instead of reporting perfect coverage", () => {
    for (const note of [{ midi: 144, start: 0, dur: 4, vel: 80 }, { midi: 48, start: 0, dur: Infinity, vel: 80 }]) {
      expect(() => measureHarmonyRealization(item().reference, [], [note], 4)).toThrow(/midi|pitch|timing|duration/i);
    }
  });
});
