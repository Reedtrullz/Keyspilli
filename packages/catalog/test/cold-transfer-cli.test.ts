import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../scripts/evaluate-cold-transfer.js";

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("cold transfer CLI isolation", () => {
  it("does not open references when an exact frozen stem is unavailable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keyspilli-cold-transfer-"));
    tempDirs.push(dir);
    const missing = "/private/does-not-exist/reference.mid";
    const manifest = {
      schemaVersion: 1,
      kind: "metal-guitar-amt-transfer-preregistration",
      experimentId: "/Users/reidar/isolation-test",
      backends: { sourcePath: "/Users/reidar/private/model" },
      evaluation: { timebase: "absolute-seconds", autoAlignment: false, transposition: 0 },
      songs: ["a", "b", "c"].map((id) => ({
        id,
        stem: { status: "unavailable", logicalId: `${id}-stem` },
        basicPitch: { status: "unavailable", logicalId: `${id}-basic` },
        gaps: { status: "unavailable", logicalId: `${id}-gaps` },
        reference: { status: "available", path: missing, sha256: "0".repeat(64), logicalId: `${id}-reference` },
      })),
    };
    const manifestPath = join(dir, "manifest.json");
    const reportPath = join(dir, "report.json");
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    let output = "";
    let errors = "";
    const code = await main(["--manifest", manifestPath, "--out", reportPath], {
      stdout: (value) => { output += value; return true; },
      stderr: (value) => { errors += value; return true; },
    });
    expect(code).toBe(0);
    expect(errors).toBe("");
    const report = JSON.parse(output) as { globalDecision: string; safety: { referencesRead: boolean }; inputs: Record<string, unknown> };
    expect(report.globalDecision).toBe("GAPS_COLD_TRANSFER_UNAVAILABLE");
    expect(report.safety.referencesRead).toBe(false);
    expect(Object.keys(report.inputs)).toEqual(["a", "b", "c"]);
    expect(output).not.toContain("/Users/reidar");
    expect(report).toHaveProperty("preregistrationSha256");
  });

  it("turns a missing available artifact into a structured unavailable result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keyspilli-cold-transfer-"));
    tempDirs.push(dir);
    const manifest = {
      schemaVersion: 1,
      experimentId: "missing-available",
      songs: ["a", "b", "c"].map((id, index) => ({
        id,
        stem: index === 0 ? { status: "available", path: join(dir, "missing.mid"), sha256: "0".repeat(64) } : { status: "unavailable", logicalId: `${id}-stem` },
        basicPitch: { status: "unavailable", logicalId: `${id}-basic` },
        gaps: { status: "unavailable", logicalId: `${id}-gaps` },
        reference: { status: "unavailable", logicalId: `${id}-reference` },
      })),
    };
    const manifestPath = join(dir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    let output = "";
    let errors = "";
    const code = await main(["--manifest", manifestPath], {
      stdout: (value) => { output += value; return true; },
      stderr: (value) => { errors += value; return true; },
    });
    expect(code).toBe(0);
    expect(errors).toBe("");
    expect(JSON.parse(output)).toMatchObject({ status: "unavailable", globalDecision: "GAPS_COLD_TRANSFER_UNAVAILABLE" });
  });
});
