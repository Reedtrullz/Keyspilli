import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const scratchDataDir = mkdtempSync(join(tmpdir(), "keyspilli-web-e2e-"));
process.env.KEYSPILLI_E2E_SCRATCH_DIR = scratchDataDir;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "bounded-mvp.spec.ts",
  workers: 1,
  timeout: 120_000,
  globalTeardown: "./e2e/scratch-global-teardown.ts",
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      KEYSPILLI_DATA_DIR: scratchDataDir,
      KEYSPILLI_E2E_SCRATCH_DIR: scratchDataDir,
      KEYSPILLI_API_TOKEN: "test-token-for-e2e",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
