import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { canonicalPhrasePlan, sourcePhraseClock, suggestPhrasePlan, writeMidi, type PhrasePlanV1 } from "@keyspilli/midi";
import { parseSymbolicUploadSource } from "../../../../packages/catalog/src/ingest.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
mkdirSync(join(root, "output"), { recursive: true });
const scratch = mkdtempSync(join(root, "output", "phrase-cli-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const call = (script: string, args: string[], data = join(scratch, "must-not-create-data")) => spawnSync(process.execPath,
  ["--import", "tsx", join(root, "apps/web/scripts", `${script}.mts`), ...args],
  { cwd: root, encoding: "utf8", timeout: 60_000, env: { ...process.env, KEYSPILLI_DATA_DIR: data } });
const midi = writeMidi(Array.from({ length: 16 }, (_, i) => i * 4).flatMap(start =>
  [48, 64, 67].map((midi, index) => ({ midi, start, dur: 2, vel: 80, hand: index === 0 ? "L" as const : "R" as const }))), { tempoBpm: 120 });
const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${Array.from({ length: 4 }, (_, index) => `<measure number="${index + 1}">${index === 0 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="120"/></direction>' : ''}${["C", "D", "E", "F"].map(step => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`).join("")}</measure>`).join("")}</part></score-partwise>`;
const mxl = zipSync({
  "META-INF/container.xml": new TextEncoder().encode('<container><rootfiles><rootfile full-path="scores/source.xml"/></rootfiles></container>'),
  "scores/source.xml": new TextEncoder().encode(xml),
});
const input = join(scratch, "source.mid");
writeFileSync(input, midi);
const proposal = () => suggestPhrasePlan(parseSymbolicUploadSource(midi).parsed, {
  sha256: hash(midi), compositionId: "synthetic-cli-composition", performanceId: "synthetic-cli-performance",
});
const selected = () => {
  const plan = proposal();
  plan.phrases[0]!.events[0]!.required = true;
  plan.phrases[0]!.events[0]!.allowedTransformations = [];
  return plan;
};

describe("phrase-plan inspect CLI", () => {
  it.each([
    ["source.mid", midi], ["source.musicxml", new TextEncoder().encode(xml)], ["source.mxl", mxl],
  ] as const)("pins exact %s bytes, origins and native clock without claiming selected protections", (filename, bytes) => {
    const sourcePath = join(scratch, filename), outputPath = join(scratch, filename + ".plan.json");
    writeFileSync(sourcePath, bytes);
    const result = call("phrase-plan", ["inspect", sourcePath, outputPath, "--composition-id", "composition-one", "--performance-id", "performance-one"]);
    expect(result.status, result.stderr).toBe(0);
    const plan = JSON.parse(readFileSync(outputPath, "utf8")) as PhrasePlanV1;
    const source = parseSymbolicUploadSource(bytes).parsed;
    expect(plan.source).toEqual({ sha256: hash(bytes), compositionId: "composition-one", performanceId: "performance-one", clock: sourcePhraseClock(source) });
    expect(plan.phrases.flatMap(phrase => phrase.events).map(event => event.sourceOriginId))
      .toEqual(source.notes.map(note => note.sourceOrigins![0]!.id));
    expect(plan.phrases.every(phrase => phrase.evidence.authority === "unknown" && phrase.evidence.confidence === null)).toBe(true);
    expect(plan.phrases.flatMap(phrase => phrase.events).every(event => !event.required)).toBe(true);
    expect(existsSync(join(scratch, "must-not-create-data"))).toBe(false);
    expect(new Uint8Array(readFileSync(sourcePath))).toEqual(bytes);
  });

  it("refuses to overwrite existing review evidence", () => {
    const output = join(scratch, "existing-review.json");
    writeFileSync(output, "keep this exact evidence");
    const result = call("phrase-plan", ["inspect", input, output, "--composition-id", "one", "--performance-id", "two"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/exist|overwrite|preserv/i);
    expect(readFileSync(output, "utf8")).toBe("keep this exact evidence");
  });

  it("requires explicit composition/performance identity and rejects malformed input before writing", () => {
    const output = join(scratch, "invalid-output.json"), badInput = join(scratch, "invalid.mid");
    writeFileSync(badInput, "not a symbolic score");
    const missingIdentity = call("phrase-plan", ["inspect", input, output]);
    expect(missingIdentity.status).not.toBe(0);
    expect(missingIdentity.stderr).toMatch(/composition.*performance|composition-id/);
    const invalid = call("phrase-plan", ["inspect", badInput, output, "--composition-id", "one", "--performance-id", "two"]);
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toMatch(/source|parse|MIDI/i);
    expect(existsSync(output)).toBe(false);
  });
});

describe("strict phrase-plan CLI argument handling", () => {
  it.each(["phrase-plan", "prepare-song"])("provides %s help without input or output side effects", script => {
    const result = call(script, ["--help"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/usage:/i);
    expect(result.stdout).toMatch(script === "prepare-song" ? /--phrase-plan/ : /--composition-id/);
    expect(call(script, ["--unrecognized-flag"]).stderr).toMatch(/unknown|unrecognized/i);
  });

  it("rejects unknown and duplicated prepare flags before creating a run", () => {
    const path = join(scratch, "duplicate-plan.json"), run = join(scratch, "bad-flags-run");
    writeFileSync(path, JSON.stringify(selected()));
    for (const flags of [["--unknown"], ["--phrase-plan", path, "--phrase-plan", path], ["unexpected-fifth-positional"]]) {
      const result = call("prepare-song", [input, run, "Test", "Test", ...flags]);
      expect(result.status, result.stdout).not.toBe(0);
      expect(existsSync(run)).toBe(false);
    }
  });

  it("keeps a run inside the checkout even when an existing parent is a symlink", () => {
    const outside = mkdtempSync(join(tmpdir(), "phrase-cli-outside-"));
    const link = join(scratch, "outside-link");
    try {
      symlinkSync(outside, link, "dir");
      const result = call("prepare-song", [input, join(link, "run"), "Test", "Test"]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/inside checkout/);
      expect(existsSync(join(outside, "run"))).toBe(false);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });
});

describe("prepare-song phrase-plan consumer", () => {
  it.each(["hash", "clock", "unrequired"])("rejects %s plan evidence before any catalog/run output", mutation => {
    const plan = mutation === "unrequired" ? proposal() : selected();
    if (mutation === "hash") plan.source.sha256 = "0".repeat(64);
    if (mutation === "clock") plan.source.clock.tempoBpm += 1;
    const path = join(scratch, `${mutation}-plan.json`), run = join(scratch, `${mutation}-run`);
    writeFileSync(path, JSON.stringify(plan));
    const result = call("prepare-song", [input, run, "Test", "Test", "--phrase-plan", path]);
    expect(result.status, result.stdout).not.toBe(0);
    expect(result.stderr).toMatch(mutation === "unrequired" ? /required|protection/ : new RegExp(mutation, "i"));
    expect(existsSync(run)).toBe(false);
  });

  it("rejects malformed and oversized raw plan files without creating a run", () => {
    for (const [name, contents, reason] of [
      ["malformed", "{bad", /JSON|parse|phrase plan/i],
      ["oversized", " ".repeat(2 * 1024 * 1024) + "{}", /2 MiB|size|large/i],
    ] as const) {
      const path = join(scratch, `${name}-plan.json`), run = join(scratch, `${name}-run`);
      writeFileSync(path, contents);
      const result = call("prepare-song", [input, run, "Test", "Test", "--phrase-plan", path]);
      expect(result.status, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(reason);
      expect(existsSync(run)).toBe(false);
    }
  });

  it("retains exact selected plan bytes and pins them through real preparation, bundling and fresh install", () => {
    const plan = selected(), raw = JSON.stringify(plan, null, 2) + "\n";
    const path = join(scratch, "selected-plan.json"), run = join(scratch, "selected-run");
    writeFileSync(path, raw);
    const result = call("prepare-song", [input, run, "Test", "Test", "--phrase-plan", path]);
    expect(result.status, result.stderr).toBe(0);
    const receipt = JSON.parse(readFileSync(join(run, "result.json"), "utf8"));
    expect(receipt.phrasePlan).toMatchObject({ sourceSha256: hash(midi), sha256: hash(canonicalPhrasePlan(plan)), fileSha256: hash(raw) });
    expect(readFileSync(receipt.phrasePlan.path, "utf8")).toBe(raw);
    expect(receipt.checks).toEqual({ freshImport: true, musicalIdempotence: true });
    const installedRoot = join(run, "installed", "artifacts", receipt.baseId);
    const manifest = JSON.parse(readFileSync(join(installedRoot, "manifest.json"), "utf8"));
    expect(manifest.phrasePlan).toMatchObject({ sourceSha256: hash(midi), sha256: receipt.phrasePlan.sha256 });
    for (const level of ["vb", "b", "ve", "e", "m", "a"]) {
      const data = JSON.parse(readFileSync(join(installedRoot, level, "notes.json"), "utf8"));
      expect(data.phraseProtection).toMatchObject({ plan, status: level === "a" ? "preserved" : "not-targeted", selectionAccuracy: "not-established", musicalAcceptance: "not-established" });
    }
    const again = call("prepare-song", [input, run, "Test", "Test", "--phrase-plan", path]);
    expect(again.status).not.toBe(0);
    expect(readFileSync(receipt.phrasePlan.path, "utf8")).toBe(raw);
  }, 60_000);
});
