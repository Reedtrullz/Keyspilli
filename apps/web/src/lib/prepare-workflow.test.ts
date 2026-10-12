import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parseMidi, suggestPhrasePlan, writeMidi } from "@keyspilli/midi";
import { admitPreparation, parseState, prepareWorkflow, resumePreparation, verifyPreparation } from "./prepare-workflow.js";
import { CONFIG, parseJson, REQUIRED_IMPLEMENTATION_FILES, sha256 } from "./prepare-workflow-pins.js";
import { preparationEnvironment, type StageInput, type StageReceipt, type StageRunner } from "./prepare-workflow-process.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");
mkdirSync(join(root, "output"), { recursive: true }); mkdirSync(join(root, "output/song-prep"), { recursive: true });
const scratch = mkdtempSync(join(root, "output/deterministic-workflow-test-"));
let keepDiagnostic = false;
const runParent = mkdtempSync(join(root, "output/song-prep/deterministic-test-"));
mkdirSync(join(scratch, "tmp"));
afterAll(() => { if (!keepDiagnostic) { rmSync(scratch, { recursive: true, force: true }); rmSync(runParent, { recursive: true, force: true }); } });
let count = 0;
const source = writeMidi(Array.from({ length: 16 }, (_, i) => [48, 64, 67].map((midi, j) =>
  ({ midi, start: i * 4, dur: 2, vel: 80, hand: j === 0 ? "L" as const : "R" as const }))).flat(), { tempoBpm: 120 });
const env = preparationEnvironment(join(scratch, "tmp"), process.execPath);
function input(withPlan = false) {
  const dir = join(scratch, `input-${++count}`); mkdirSync(dir);
  const midi = join(dir, "source.actual-midi"), instruction = join(dir, "instructions.txt"), requestPath = join(dir, "request.json");
  writeFileSync(midi, source); writeFileSync(instruction, "Synthetic test context. Music acceptance is not established.\n");
  const request = { schemaVersion: 1, kind: "keyspilli-deterministic-preparation", sourceMidi: { path: midi, sha256: sha256(source) },
    instructions: [{ path: instruction, sha256: sha256(readFileSync(instruction)) }], title: "Authored fixture", artist: "Test composer",
    ...(withPlan ? { phrasePlan: (() => {
      const plan = suggestPhrasePlan(parseMidi(source), { sha256: sha256(source), compositionId: "test-composition", performanceId: "test-performance" });
      plan.phrases[0]!.events[0]!.required = true; plan.phrases[0]!.events[0]!.allowedTransformations = [];
      const path = join(dir, "phrase-plan.json"); writeFileSync(path, JSON.stringify(plan, null, 2) + "\n");
      return { path, sha256: sha256(readFileSync(path)) };
    })() } : {}),
  };
  writeFileSync(requestPath, JSON.stringify(request, null, 2) + "\n");
  return { dir, midi, instruction, requestPath, request };
}
function fixtureCheckout() {
  const fixture = join(scratch, `checkout-${++count}`); mkdirSync(fixture);
  for (const path of REQUIRED_IMPLEMENTATION_FILES) {
    mkdirSync(dirname(join(fixture, path)), { recursive: true });
    writeFileSync(join(fixture, path), path === "package.json" ? '{"name":"keyspilli"}' : path === "package-lock.json" ? "{}"
      : path === "catalog/chord-sources.json" ? '{"schemaVersion":1,"entries":[]}' : "// controlled runner fixture\n");
  }
  for (const args of [["init", "--quiet"], ["add", "."], ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture"]]) {
    const result = spawnSync("git", args, { cwd: fixture, env, encoding: "utf8" }); expect(result.status, result.stderr).toBe(0);
  }
  return fixture;
}
function runFor(checkout = root) { return checkout === root ? join(runParent, `run-${++count}`) : join(checkout, `output/song-prep/run-${++count}`); }
function state(run: string) { return parseState(JSON.parse(readFileSync(join(run, "state.json"), "utf8"))); }
function fileSnapshot(path: string): string {
  const entries: unknown[] = [];
  const visit = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name), next = `${rel}/${name}`, info = lstatSync(full);
      if (info.isDirectory()) { entries.push([next, "directory", info.mode]); visit(full, next); }
      else entries.push([next, info.isSymbolicLink() ? "link" : createHash("sha256").update(readFileSync(full)).digest("hex"), info.mode]);
    }
  };
  visit(path, ""); return JSON.stringify(entries);
}
function readonlyVerify(checkout: string, run: string, phase: string) {
  const before = fileSnapshot(run), value = verifyPreparation(checkout, run);
  expect(value.phase).toBe(phase); expect(fileSnapshot(run)).toBe(before); return value;
}
function readonlyInvalid(checkout: string, run: string, message: RegExp) {
  const before = fileSnapshot(run);
  try { expect(() => verifyPreparation(checkout, run)).toThrow(message); expect(fileSnapshot(run)).toBe(before); }
  catch (error) { keepDiagnostic = true; console.error("readonly diagnostic", { run, rootFiles: readdirSync(run), state: state(run) }); throw error; }
}
const zero = () => ({ bytes: 0, capturedBytes: 0, truncated: false });
function failure(input: StageInput, outcome: "failed" | "interrupted" | "timed-out" = "failed"): StageReceipt {
  mkdirSync(input.work); writeFileSync(join(input.work, "partial.txt"), input.work);
  writeFileSync(join(input.attempt, "stdout.log"), ""); writeFileSync(join(input.attempt, "stderr.log"), "");
  return { schemaVersion: 1, outcome, closed: true, integrityError: null,
    commands: [{ command: "prepare-song", exitCode: outcome === "failed" ? 7 : null, signal: outcome === "failed" ? null : "SIGTERM", termination: outcome === "failed" ? "exit" : outcome === "interrupted" ? "interrupt" : "timeout", groupClosed: true }],
    logs: { stdout: zero(), stderr: zero() } };
}
const call = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", join(root, "apps/web/scripts/prepare-workflow.mts"), ...args], { cwd: root, env, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });

describe("durable admission, failure and resume", () => {
  it("verifies admitted/failed states without changing any run bytes and permits only one attempt per explicit invocation", async () => {
    const checkout = fixtureCheckout(), fixture = input(), run = admitPreparation(checkout, fixture.requestPath, runFor(checkout));
    expect(lstatSync(run).mode & 0o777).toBe(0o700); readonlyVerify(checkout, run, "admitted");
    const seen: string[] = [], runner: StageRunner = async args => {
      seen.push(args.work); expect(state(run).phase).toBe("preparing"); expect(state(run).attempts.length).toBe(seen.length);
      return failure(args);
    };
    for (let number = 1; number <= 3; number++) {
      const result = await resumePreparation(checkout, run, { runner });
      expect(result).toMatchObject({ phase: "failed", attempts: number, retryAllowed: number < 3 });
      expect(seen).toHaveLength(number); readonlyVerify(checkout, run, "failed");
    }
    expect(seen.map(path => path.slice(path.indexOf("attempts/")))).toEqual(["attempts/prepare-001/work", "attempts/prepare-002/work", "attempts/prepare-003/work"]);
    const before = fileSnapshot(run); expect((await resumePreparation(checkout, run, { runner })).retryAllowed).toBe(false);
    expect(fileSnapshot(run)).toBe(before); expect(seen).toHaveLength(3);
  }, 15_000);

  it.each(["interrupted", "timed-out"] as const)("resumes a durably closed %s outcome in a fresh attempt", async outcome => {
    const checkout = fixtureCheckout(), fixture = input(), run = runFor(checkout); let calls = 0;
    await prepareWorkflow(checkout, fixture.requestPath, run, { runner: async args => { calls++; return failure(args, outcome); } });
    expect(state(run).phase).toBe("failed");
    await resumePreparation(checkout, run, { runner: async args => { calls++; return failure(args); } });
    expect(calls).toBe(2); expect(state(run).attempts).toHaveLength(2);
  }, 10_000);

  it("concurrent resume launches no second runner and verify does not touch the live lock", async () => {
    const checkout = fixtureCheckout(), fixture = input(), run = admitPreparation(checkout, fixture.requestPath, runFor(checkout));
    let finish!: () => void, calls = 0;
    const pending = resumePreparation(checkout, run, { runner: async args => { calls++; await new Promise<void>(resolve => { finish = resolve; }); return failure(args); } });
    expect(calls).toBe(1); const before = fileSnapshot(run);
    await expect(resumePreparation(checkout, run, { runner: async args => { calls++; return failure(args); } })).rejects.toThrow(/lock/i);
    readonlyInvalid(checkout, run, /lock/i); expect(fileSnapshot(run)).toBe(before); expect(calls).toBe(1);
    finish(); await pending; expect(state(run).phase).toBe("failed");
  }, 10_000);

  it("fails closed on an abandoned lock or persisted running state without trusting timestamps/PIDs", async () => {
    const checkout = fixtureCheckout(), fixture = input(), locked = admitPreparation(checkout, fixture.requestPath, runFor(checkout));
    writeFileSync(join(locked, ".mutation.lock"), '{"pid":99999999,"startedAt":"1970-01-01"}');
    const before = fileSnapshot(locked); await expect(resumePreparation(checkout, locked)).rejects.toThrow(/lock/); expect(fileSnapshot(locked)).toBe(before);
    const run = admitPreparation(checkout, fixture.requestPath, runFor(checkout)), running = state(run);
    running.phase = "preparing"; running.attempts = [{ number: 1, status: "running", receiptSha256: null, payloadSha256: null }];
    writeFileSync(join(run, "state.json"), JSON.stringify(running));
    readonlyInvalid(checkout, run, /running/); await expect(resumePreparation(checkout, run)).rejects.toThrow(/running/);
    expect(existsSync(join(run, ".mutation.lock"))).toBe(true); expect(state(run).phase).toBe("preparing");
  }, 10_000);

  it("does not make an uncertain runner exception retryable", async () => {
    const checkout = fixtureCheckout(), fixture = input(), run = runFor(checkout);
    await expect(prepareWorkflow(checkout, fixture.requestPath, run, { runner: async () => { throw new Error("uncertain runner interruption"); } })).rejects.toThrow(/uncertain/);
    expect(state(run).phase).toBe("preparing"); expect(existsSync(join(run, ".mutation.lock"))).toBe(true);
    await expect(resumePreparation(checkout, run)).rejects.toThrow(/lock/);
  });

  it("enforces the file limit across retained failed attempts, not separately per attempt", async () => {
    const checkout = fixtureCheckout(), fixture = input(), run = runFor(checkout); let calls = 0;
    const runner: StageRunner = async args => {
      calls++; const receipt = failure(args);
      for (let index = 0; index < 2050; index++) writeFileSync(join(args.work, `bounded-${index}.txt`), "");
      return receipt;
    };
    expect((await prepareWorkflow(checkout, fixture.requestPath, run, { runner })).phase).toBe("failed");
    await expect(resumePreparation(checkout, run, { runner })).rejects.toThrow(/payload file|byte limit/);
    expect(calls).toBe(2); expect(state(run).phase).toBe("invalid");
    await expect(resumePreparation(checkout, run, { runner })).rejects.toThrow(/invalid/); expect(calls).toBe(2);
  }, 15_000);
});

describe("stale/tampered runs never become preparation retries", () => {
  it.each(["source", "plan", "instruction", "raw-request", "snapshot", "code", "catalog", "config", "runtime"])("rejects changed %s pins read-only, then permanently invalidates a mutation request", async target => {
    const checkout = fixtureCheckout(), fixture = input(target === "plan"), run = admitPreparation(checkout, fixture.requestPath, runFor(checkout));
    const path = target === "source" ? fixture.midi : target === "instruction" ? fixture.instruction : target === "raw-request" ? fixture.requestPath
      : target === "plan" ? fixture.request.phrasePlan!.path : target === "snapshot" ? join(run, "inputs/source.mid") : target === "code" ? join(checkout, "apps/web/scripts/prepare-song.mts")
      : target === "catalog" ? join(checkout, "catalog/chord-sources.json") : join(run, "admission.json");
    const original = readFileSync(path);
    // Tamper deliberately as the owning test user, including protected snapshots.
    // The production host never changes their read-only permissions.
    if (!(lstatSync(path).mode & 0o200)) chmodSync(path, 0o600);
    if (target === "config" || target === "runtime") {
      const pin = JSON.parse(original.toString());
      if (target === "config") pin.config.maxPreparationAttempts = 9; else pin.runtime.nodeSha256 = "0".repeat(64);
      writeFileSync(path, JSON.stringify(pin)); const changed = state(run); changed.admissionSha256 = sha256(readFileSync(path)); writeFileSync(join(run, "state.json"), JSON.stringify(changed));
    } else writeFileSync(path, Buffer.concat([original, Buffer.from("\n")]));
    readonlyInvalid(checkout, run, /changed|mismatch|configuration|snapshot|byte limit/i);
    let calls = 0; await expect(resumePreparation(checkout, run, { runner: async args => { calls++; return failure(args); } })).rejects.toThrow();
    expect(calls).toBe(0); expect(state(run).phase).toBe("invalid");
    writeFileSync(path, original); await expect(resumePreparation(checkout, run)).rejects.toThrow(/invalid/);
  }, 10_000);

  it("requires original files to remain present, even though exact snapshots are retained", () => {
    const checkout = fixtureCheckout(), fixture = input(), run = admitPreparation(checkout, fixture.requestPath, runFor(checkout));
    unlinkSync(fixture.instruction); readonlyInvalid(checkout, run, /missing|unreadable/);
  });

  it("accepts a metadata-only Git commit while effective bytes are unchanged", () => {
    const checkout = fixtureCheckout(), fixture = input(), run = admitPreparation(checkout, fixture.requestPath, runFor(checkout));
    const before = fileSnapshot(run);
    const committed = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "--quiet", "-m", "metadata only"], { cwd: checkout, env });
    expect(committed.status).toBe(0); expect(verifyPreparation(checkout, run).phase).toBe("admitted"); expect(fileSnapshot(run)).toBe(before);
  });

  it("detects modifications to a closed failed attempt instead of adopting its partial work", async () => {
    const checkout = fixtureCheckout(), fixture = input(), run = runFor(checkout);
    await prepareWorkflow(checkout, fixture.requestPath, run, { runner: async args => failure(args) });
    writeFileSync(join(run, "attempts/prepare-001/work/partial.txt"), "changed"); readonlyInvalid(checkout, run, /payload changed/);
    await expect(resumePreparation(checkout, run)).rejects.toThrow(/payload changed/);
  });
});

describe("bounded paths and strict owned JSON", () => {
  it("refuses existing, outside, traversing and symlinked run paths", () => {
    const fixture = input(), existing = runFor(); mkdirSync(existing, { mode: 0o700 });
    const target = join(scratch, "outside"); mkdirSync(target); const link = join(runParent, "link"); symlinkSync(target, link);
    for (const run of [existing, join(root, "apps/web/scripts/run"), `${runParent}/sub/../escape`, join(link, "escape")]) expect(() => admitPreparation(root, fixture.requestPath, run)).toThrow(/exists|song-prep|traversal|symlink/);
    expect(existsSync(join(target, "escape"))).toBe(false);
  });

  it.each(["request", "source", "instruction", "plan"])("enforces the %s byte bound before run reservation", target => {
    const fixture = input(target === "plan"), run = runFor();
    const path = target === "request" ? fixture.requestPath : target === "source" ? fixture.midi : target === "instruction" ? fixture.instruction : fixture.request.phrasePlan!.path;
    const limit = target === "request" ? CONFIG.requestBytes : target === "source" ? CONFIG.sourceBytes : target === "instruction" ? CONFIG.instructionBytes : CONFIG.phrasePlanBytes;
    writeFileSync(path, Buffer.alloc(limit + 1, " "));
    if (target !== "request") {
      const pin = target === "source" ? fixture.request.sourceMidi : target === "instruction" ? fixture.request.instructions[0]! : fixture.request.phrasePlan!;
      pin.sha256 = sha256(readFileSync(path)); writeFileSync(fixture.requestPath, JSON.stringify(fixture.request));
    }
    expect(() => admitPreparation(root, fixture.requestPath, run)).toThrow(/byte limit/); expect(existsSync(run)).toBe(false);
  });

  it("refuses duplicate keys, deeply nested JSON, and unknown state fields without rewriting them", () => {
    expect(() => parseJson(Buffer.from('{"a":1,"a":2}'), "request")).toThrow(/duplicate/);
    expect(() => parseJson(Buffer.from('['.repeat(65) + '0' + ']'.repeat(65)), "request")).toThrow(/nesting/);
    const checkout = fixtureCheckout(), fixture = input(), run = admitPreparation(checkout, fixture.requestPath, runFor(checkout));
    writeFileSync(join(run, "state.json"), JSON.stringify({ ...state(run), force: true })); readonlyInvalid(checkout, run, /unknown/);
  });

  it("strict CLI parsing rejects unknown/repeated flags and raw request traversal before reservation", () => {
    const fixture = input(), run = runFor();
    for (const args of [["prepare", fixture.requestPath, run, "--force"], ["prepare", fixture.requestPath, run, "--until", "prepared", "--until", "prepared"],
      ["prepare", `${fixture.dir}/../${fixture.dir.split("/").at(-1)}/request.json`, run], ["prepare", fixture.requestPath, run, "--until", "published"], ["verify", run, "--until", "prepared"]]) {
      expect(call(args).status).not.toBe(0); expect(existsSync(run)).toBe(false);
    }
  }, 10_000);
});

describe("actual CLI structural preparation", () => {
  it.each([false, true])("prepares all six tiers and both installations (PhrasePlan=%s), then seals without rerunning", withPlan => {
    const fixture = input(withPlan), run = runFor();
    const prepared = call(["prepare", fixture.requestPath, run, "--until", "prepared"]);
    expect(prepared.status, prepared.stderr).toBe(0); const first = JSON.parse(prepared.stdout);
    expect(first).toMatchObject({ phase: "prepared", status: "prepared", provisional: true, attempts: 1, providerCalls: 0, productionAdmission: false });
    expect(first.assessments).toMatchObject({ sourceIdentity: "unknown", listening: "unknown", keyboardAssessment: "unknown", musicalAcceptance: "not-established", offlineScoreReview: { status: "unavailable" } });
    const work = join(run, "attempts/prepare-001/work"), baseId = `upload-${sha256(source)}`;
    for (const level of CONFIG.levels) for (const name of ["notes.json", "variant.mid", "variant.xml"]) expect(existsSync(join(work, "installed/artifacts", baseId, level, name))).toBe(true);
    const logs = readFileSync(join(run, "attempts/prepare-001/stdout.log"), "utf8"); expect(logs).toMatch(/Identical bundle already installed/);
    const receipt = JSON.parse(readFileSync(join(run, "attempts/prepare-001/stage-receipt.json"), "utf8"));
    expect(receipt.commands.map((entry: { command: string }) => entry.command)).toEqual(["prepare-song", "song-bundle-verify"]);
    expect(receipt.commands.every((entry: { exitCode: number; groupClosed: boolean }) => entry.exitCode === 0 && entry.groupClosed)).toBe(true);
    const manifest = JSON.parse(readFileSync(join(work, "bundle/artifacts/manifest.json"), "utf8"));
    expect(manifest.sourceArtifactHash).toBe(sha256(source));
    if (withPlan) expect(manifest.phrasePlan.sourceSha256).toBe(sha256(source)); else expect(manifest.phrasePlan).toBeUndefined();
    readonlyVerify(root, run, "prepared");
    // Failed read-only checks leave every current byte intact, including SQLite.
    for (const path of [join(work, "installed/db.sqlite"), join(work, `installed/artifacts/${baseId}/a/notes.json`)]) {
      const original = readFileSync(path); writeFileSync(path, Buffer.concat([original, Buffer.from("x")]));
      readonlyInvalid(root, run, /payload changed|inventory changed/); writeFileSync(path, original);
    }
    const extra = join(work, "unexpected.txt"); writeFileSync(extra, "extra"); readonlyInvalid(root, run, /payload changed|inventory changed/); unlinkSync(extra);
    const linked = join(work, "linked.txt"); symlinkSync(fixture.instruction, linked); readonlyInvalid(root, run, /symlink/); unlinkSync(linked);
    const before = fileSnapshot(join(run, "attempts")), checkpoint = readFileSync(join(run, "prepared.json"));
    expect(existsSync(join(run, ".mutation.lock"))).toBe(false);
    const resumed = call(["resume", run]);
    if (resumed.status !== 0) { keepDiagnostic = true; console.error("resume diagnostic", { pid: resumed.pid, run, stdout: resumed.stdout, stderr: resumed.stderr,
      rootFiles: readdirSync(run), lock: existsSync(join(run, ".mutation.lock")) ? readFileSync(join(run, ".mutation.lock"), "utf8") : null, state: state(run) }); }
    expect(resumed.status, resumed.stderr).toBe(0); const completed = JSON.parse(resumed.stdout);
    expect(completed).toMatchObject({ phase: "sealed", status: "complete", provisional: true, attempts: 1, payloadSha256: first.payloadSha256 });
    expect(fileSnapshot(join(run, "attempts"))).toBe(before); expect(readFileSync(join(run, "prepared.json"))).toEqual(checkpoint);
    readonlyVerify(root, run, "sealed");
    const allBefore = fileSnapshot(run); const verified = call(["verify", run]); expect(verified.status, verified.stderr).toBe(0); expect(fileSnapshot(run)).toBe(allBefore);
    const repeated = call(["resume", run]); expect(repeated.status, repeated.stderr).toBe(0); expect(fileSnapshot(run)).toBe(allBefore);
  }, 120_000);
});
