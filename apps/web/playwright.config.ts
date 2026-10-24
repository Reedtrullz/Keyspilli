import { defineConfig } from "@playwright/test";
import { E2E_AUTH_ENV, E2E_AUTH_HEADERS } from "./playwright.auth";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: process.env.CI ? 2 : undefined,
  // These cases use the public seed catalog. Scratch, roadmap and performance
  // cases run through their own configurations and must not mutate this catalog.
  testMatch: ["app.spec.ts", "mobile.spec.ts", "mobile-canvas.spec.ts", "player-instrument.spec.ts", "player-mobile.spec.ts", "player-ui.spec.ts", "private-alpha-usage.spec.ts", "login.spec.ts"],
  webServer: {
    command: "pnpm run start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      KEYSPILLI_API_TOKEN: "test-token-for-e2e",
      ...E2E_AUTH_ENV,
      AUTH_URL: "http://127.0.0.1:3000",
      KEYSPILLI_E2E_LOGIN: "1",
      KEYSPILLI_E2E_LOGIN_TOKEN: "e2e-login-token",
      KEYSPILLI_ORIGIN: "http://127.0.0.1:3000",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    extraHTTPHeaders: E2E_AUTH_HEADERS,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit-mobile", testMatch: "player-mobile.spec.ts", use: { browserName: "webkit", isMobile: true, hasTouch: true } },
  ],
});
