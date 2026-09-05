import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "private-alpha-usage.spec.ts",
  workers: 1,
  timeout: 180_000,
  webServer: {
    command: "node scripts/reverse-proxy.mjs",
    url: "http://127.0.0.1:3200",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      KEYSPILLI_PROXY_PORT: "3200",
      KEYSPILLI_PROXY_TARGET_PORT: "3201",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
