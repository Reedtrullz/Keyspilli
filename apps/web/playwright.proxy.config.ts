import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const scratchDataDir = mkdtempSync(join(tmpdir(), "keyspilli-web-e2e-proxy-"));
process.env.KEYSPILLI_E2E_SCRATCH_DIR = scratchDataDir;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "bounded-mvp.spec.ts",
  workers: 1,
  timeout: 120_000,
  globalTeardown: "./e2e/scratch-global-teardown.ts",
  webServer: [
    {
      command: "npm run dev -- --port 3201",
      url: "http://127.0.0.1:3201",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        KEYSPILLI_DATA_DIR: scratchDataDir,
        KEYSPILLI_E2E_SCRATCH_DIR: scratchDataDir,
        KEYSPILLI_API_TOKEN: "test-token-for-e2e",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
    {
      command: "node scripts/reverse-proxy.mjs",
      url: "http://127.0.0.1:3200",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        KEYSPILLI_PROXY_PORT: "3200",
        KEYSPILLI_PROXY_TARGET_PORT: "3201",
      },
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
