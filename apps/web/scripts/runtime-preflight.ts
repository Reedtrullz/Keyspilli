import { accessSync, constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { chromium } from "playwright";
import { inspectCatalogReadiness, validateRuntimeConfiguration } from "@keyspilli/catalog/src/readiness.js";

function binaryAvailable(command: string): boolean {
  const paths = isAbsolute(command) ? [command] : (process.env.PATH ?? "").split(delimiter).map(path => join(path, command));
  return paths.some(path => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } });
}
try {
  validateRuntimeConfiguration();
  const catalog = inspectCatalogReadiness();
  const tutorialConfigured = process.env.KEYSPILLI_TUTORIAL_BETA === "1";
  const binaries = {
    chromium: binaryAvailable(chromium.executablePath()),
    ffmpeg: binaryAvailable("ffmpeg"),
    downloader: binaryAvailable("yt-dlp"),
    tutorialPython: binaryAvailable(process.env.KEYSPILLI_TUTORIAL_PYTHON ?? "python3"),
  };
  // Binary presence cannot prove shared libraries, Python model imports, provider auth or device support.
  console.log(JSON.stringify({
    catalog,
    binaries,
    pdf: { state: binaries.chromium ? "unknown" : "unavailable" },
    tutorialImport: { configured: tutorialConfigured, state: !tutorialConfigured || !binaries.ffmpeg || !binaries.downloader || !binaries.tutorialPython ? "unavailable" : "unknown" },
    sourceDiscovery: { configured: process.env.KEYSPILLI_SOURCE_SEARCH_PROVIDER === "brave", state: process.env.KEYSPILLI_SOURCE_SEARCH_PROVIDER === "brave" ? "unknown" : "unavailable" },
  }));
  if (catalog.state !== "ready") process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ state: "unavailable", code: "INVALID_RUNTIME_CONFIGURATION" }));
  process.exitCode = 1;
}
