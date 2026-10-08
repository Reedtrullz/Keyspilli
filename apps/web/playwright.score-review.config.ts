import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", testMatch: "score-review-report.spec.ts", workers: 1, timeout: 30000, use: { browserName: "chromium", trace: "retain-on-failure" } });
