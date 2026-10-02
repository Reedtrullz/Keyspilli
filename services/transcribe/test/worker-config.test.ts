import { describe, expect, it } from "vitest";
import { workerNumericConfigFromEnv } from "../src/worker-config.js";

describe("worker numeric startup config", () => {
  it("uses bounded defaults and parses finite overrides", () => {
    expect(workerNumericConfigFromEnv({ KEYSPILLI_TEMPO_OVERRIDE: "120" })).toEqual({
      pollMs: 5_000,
      maxAttempts: 2,
      maxVideoDurationSec: 600,
      shutdownGraceMs: 120_000,
      heartbeatMs: 15_000,
      onsetMatchSec: 0.15,
      tempoOverride: 120,
    });
  });

  it.each([
    ["KEYSPILLI_POLL_MS", "NaN"],
    ["KEYSPILLI_POLL_MS", "Infinity"],
    ["KEYSPILLI_POLL_MS", "  "],
    ["KEYSPILLI_POLL_MS", "0"],
    ["KEYSPILLI_MAX_ATTEMPTS", "1.5"],
    ["KEYSPILLI_MAX_ATTEMPTS", "11"],
    ["KEYSPILLI_MAX_VIDEO_DURATION_SEC", "-1"],
    ["KEYSPILLI_SHUTDOWN_GRACE_MS", "0"],
    ["KEYSPILLI_HEARTBEAT_MS", "Infinity"],
    ["KEYSPILLI_ONSET_MATCH_SEC", "NaN"],
    ["KEYSPILLI_TEMPO_OVERRIDE", "401"],
  ])("rejects invalid %s without echoing its value", (name, value) => {
    try {
      workerNumericConfigFromEnv({ [name]: value });
      throw new Error("expected invalid configuration to throw");
    } catch (error) {
      expect((error as Error).message).toContain(name);
      expect((error as Error).message).not.toContain(`got "${value}"`);
    }
  });
});
