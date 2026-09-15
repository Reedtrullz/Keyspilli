import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: process.env.CI ? 2 : undefined,
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      KEYSPILLI_API_TOKEN: "test-token-for-e2e",
      KEYSPILLI_ORIGIN: "http://127.0.0.1:3000",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit-mobile", testMatch: "player-mobile.spec.ts", use: { browserName: "webkit", isMobile: true, hasTouch: true } },
  ],
});
