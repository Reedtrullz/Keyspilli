import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const cli = join(dirname(createRequire(import.meta.url).resolve("playwright/package.json")), "cli.js");
const scratch = mkdtempSync(join(tmpdir(), "keyspilli-e2e-routing-"));
try {
  function files(config) {
    const result = spawnSync(process.execPath, [cli, "test", "--config", config, "--list", "--reporter=json"], {
      cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, KEYSPILLI_E2E_SCRATCH_DIR: scratch, KEYSPILLI_PERF_BASELINE: "0" },
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.errors, []);
    const found = new Set();
    function collect(suite) {
      for (const spec of suite.specs ?? []) found.add(spec.file);
      for (const child of suite.suites ?? []) collect(child);
    }
    report.suites.forEach(collect);
    return found;
  }
  const seeded = files("playwright.config.ts"), roadmap = files("playwright.roadmap.config.ts");
  assert(seeded.has("app.spec.ts") && seeded.has("player-mobile.spec.ts"), "Seeded app/mobile coverage must remain enabled");
  assert(roadmap.has("library-roadmap.spec.ts") && roadmap.has("owner-review.spec.ts"), "Isolated roadmap coverage must remain enabled");
  for (const file of roadmap) assert(!seeded.has(file), `${file} requires the isolated roadmap catalog`);
  assert(!seeded.has("performance-baseline.spec.ts"), "Performance measurements require explicit opt-in");
  console.log(`E2E routing passed: ${seeded.size} seeded files, ${roadmap.size} isolated roadmap files`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
