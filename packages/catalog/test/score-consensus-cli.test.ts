import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "..", "..");

describe("score consensus CLI wrapper", () => {
  it("is exposed as a local catalog command and forwards usage errors", async () => {
    const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    expect(packageJson.scripts?.["benchmark:score-consensus"]).toBe("tsx scripts/run-score-consensus.ts");

    await expect(execFileAsync(
      join(repoRoot, "node_modules", ".bin", "tsx"),
      [join(packageRoot, "scripts", "run-score-consensus.ts"), "--help"],
      { cwd: packageRoot },
    )).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Usage: run-score-consensus.ts"),
    });
  });
});
