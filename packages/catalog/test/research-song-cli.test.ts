import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = join(repoRoot, "packages/catalog/scripts/research-song.ts");

function runCli(args: string[]): string {
  return execFileSync(process.execPath, ["--import", "tsx", cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}

describe("research-song CLI", () => {
  it("rejects a repository reference before parsing or reporting it", () => {
    expect(() => runCli([
      "--artist", "Sabaton",
      "--title", "Defence Of Moscow",
      "--reference", join(repoRoot, "package.json"),
      "--no-network",
    ])).toThrow(/reference must be outside the repository/);
  });
});
