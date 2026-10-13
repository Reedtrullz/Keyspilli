import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writeMidi, suggestPhrasePlan, parseMidi } from "@keyspilli/midi";
import { admitRequest, captureImplementation, parseRequest, REQUIRED_IMPLEMENTATION_FILES, WORKFLOW_SCOPES } from "./prepare-workflow-pins.js";
import { preparationEnvironment } from "./prepare-workflow-process.js";

const scratch = mkdtempSync(join(tmpdir(), "deterministic-pins-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const source = writeMidi(Array.from({ length: 16 }, (_, i) => [48, 64, 67].map((midi, j) =>
  ({ midi, start: i * 4, dur: 2, vel: 80, hand: j === 0 ? "L" as const : "R" as const }))).flat(), { tempoBpm: 120 });
const sourcePath = join(scratch, "actual-bytes.blob"), instructionPath = join(scratch, "instructions.txt");
writeFileSync(sourcePath, source); writeFileSync(instructionPath, "Preserve the supplied source; structural preparation is provisional.\n");
const request = () => ({ schemaVersion: 1, kind: "keyspilli-deterministic-preparation", sourceMidi: { path: sourcePath, sha256: sha(source) },
  instructions: [{ path: instructionPath, sha256: sha(readFileSync(instructionPath)) }], title: "Authored test", artist: "Synthetic fixture" });
let sequence = 0;
function checkout() {
  const root = join(scratch, `checkout-${++sequence}`); mkdirSync(root);
  const result = spawnSync("git", ["init", "--quiet", root]); expect(result.status).toBe(0);
  for (const [path, bytes] of [["package.json", '{"name":"keyspilli"}'], ["package-lock.json", "{}"], ["catalog/chord-sources.json", '{"schemaVersion":1,"entries":[]}'],
    ["apps/web/scripts/prepare-song.mts", "// fixture"], ["apps/web/scripts/prepare-workflow.mts", "// fixture"], ["apps/web/scripts/song-bundle.mts", "// fixture"]]) {
    mkdirSync(dirname(join(root, path!)), { recursive: true }); writeFileSync(join(root, path!), bytes!);
  }
  for (const path of REQUIRED_IMPLEMENTATION_FILES.filter(path => /\.(mts|ts)$/.test(path))) {
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), "// fixture");
  }
  return root;
}

describe("deterministic request admission", () => {
  it("requires supplied exact pins and accepts MIDI by actual content", () => {
    const path = join(scratch, `request-${++sequence}.json`); writeFileSync(path, JSON.stringify(request()));
    const result = admitRequest(checkout(), path);
    expect(result.request).toEqual(request()); expect(result.sourceSha256).toBe(sha(source));
    expect(result.files.find(file => file.snapshot === "inputs/source.mid")?.bytes).toEqual(Buffer.from(source));
  });

  it.each(["protocol", "model", "audio", "output", "decisionContractVersion", "provider"])("rejects unowned %s fields", field => {
    expect(() => parseRequest({ ...request(), [field]: "not admitted" })).toThrow(/unknown|unexpected/i);
  });

  it("rejects missing pins, nested extras, traversal, nonabsolute paths, and empty/oversized instructions", () => {
    const valid = request();
    for (const value of [{ ...valid, sourceMidi: { path: sourcePath } },
      { ...valid, sourceMidi: { ...valid.sourceMidi, url: "https://invalid.example" } },
      { ...valid, sourceMidi: { ...valid.sourceMidi, path: join(scratch, "sub") + "/../actual-bytes.blob" } },
      { ...valid, sourceMidi: { ...valid.sourceMidi, path: "relative.mid" } },
      { ...valid, instructions: [] }, { ...valid, instructions: Array(9).fill(valid.instructions[0]) }]) {
      expect(() => parseRequest(value)).toThrow();
    }
  });

  it("compiles selected PhrasePlan native-clock evidence and refuses proposals or mismatches", () => {
    const plan = suggestPhrasePlan(parseMidi(source), { sha256: sha(source), compositionId: "synthetic-composition", performanceId: "synthetic-performance" });
    const path = join(scratch, `plan-${++sequence}.json`), req = join(scratch, `plan-request-${sequence}.json`), root = checkout();
    const check = () => { const bytes = JSON.stringify(plan); writeFileSync(path, bytes); writeFileSync(req, JSON.stringify({ ...request(), phrasePlan: { path, sha256: sha(bytes) } })); return () => admitRequest(root, req); };
    expect(check()).toThrow(/required|protection/i);
    plan.phrases[0]!.events[0]!.required = true; plan.phrases[0]!.events[0]!.allowedTransformations = [];
    expect(check()().canonicalPhrasePlanSha256).toMatch(/^[a-f0-9]{64}$/);
    plan.source.clock.tempoBpm += 1; expect(check()).toThrow(/clock/i);
    plan.source.sha256 = "0".repeat(64); expect(check()).toThrow(/hash/i);
  });

  it("refuses preexisting global mapped bases and symlinked original inputs", () => {
    const root = checkout(), req = join(scratch, `collision-${++sequence}.json`);
    writeFileSync(req, JSON.stringify(request()));
    writeFileSync(join(root, "catalog/chord-sources.json"), JSON.stringify({ schemaVersion: 1, entries: [{ baseId: "upload-" + sha(source), sources: [] }] }));
    expect(() => admitRequest(root, req)).toThrow(/already|mapped|catalog/i);
    writeFileSync(join(root, "catalog/chord-sources.json"), '{"schemaVersion":1,"entries":[]}');
    const link = join(scratch, `link-${sequence}`); symlinkSync(sourcePath, link);
    writeFileSync(req, JSON.stringify({ ...request(), sourceMidi: { path: link, sha256: sha(source) } }));
    expect(() => admitRequest(root, req)).toThrow(/symlink|regular/i);
  });
});

describe("working bytes and environment", () => {
  it("matches the compact path/hash inventory recipe and notices working/catalog metadata changes", () => {
    const root = checkout(), before = captureImplementation(root);
    expect(before.sha256).toBe(sha(JSON.stringify(before.files.map(({ path, sha256 }) => [path, sha256]))));
    expect(WORKFLOW_SCOPES).toContain("catalog"); expect(WORKFLOW_SCOPES).toContain("apps/web/tsconfig.song-tools.json");
    writeFileSync(join(root, "catalog/chord-sources.json"), '{"schemaVersion":1,"entries":[]}\n');
    expect(captureImplementation(root).sha256).not.toBe(before.sha256);
    writeFileSync(join(root, "apps/web/scripts/extra.mts"), "// new effective file");
    expect(captureImplementation(root).files.length).toBe(before.files.length + 1);
  });

  it("rejects implementation symlinks instead of following them", () => {
    const root = checkout(); symlinkSync(sourcePath, join(root, "apps/web/scripts/hidden.mts"));
    expect(() => captureImplementation(root)).toThrow(/symlink|regular/i);
  });

  it("constructs a minimal child environment without inheriting hooks, providers, or production paths", () => {
    const env = preparationEnvironment("/owned/attempt/tmp", process.execPath);
    expect(env).toEqual({ PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", NODE_ENV: "production", TMPDIR: "/owned/attempt/tmp", TSX_DISABLE_CACHE: "1", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" });
    expect(env).not.toHaveProperty("NODE_OPTIONS"); expect(env).not.toHaveProperty("NODE_PATH");
    expect(env).not.toHaveProperty("KEYSPILLI_DATA_DIR"); expect(env).not.toHaveProperty("OPENAI_API_KEY");
  });
});
