import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // bounded-mvp expects an empty catalog and runs through the scratch/proxy
  // configurations; it must not run against the seeded default catalog.
  testIgnore: ["bounded-mvp.spec.ts"],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      KEYSPILLI_API_TOKEN: "test-token-for-e2e",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
