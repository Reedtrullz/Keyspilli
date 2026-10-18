import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import baseConfig from "./playwright.chords-v2.t1.config";

const repoRoot = resolve(__dirname, "../..");

export default defineConfig({
  ...baseConfig,
  testDir: resolve(repoRoot, "docs/superpowers/evidence/2026-09-19-cathedral-organ-gain"),
  testMatch: "organ-gain-probe.spec.ts",
});
