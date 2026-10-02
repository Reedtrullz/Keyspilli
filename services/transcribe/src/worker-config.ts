export interface WorkerNumericConfig {
  pollMs: number;
  maxAttempts: number;
  maxVideoDurationSec: number;
  shutdownGraceMs: number;
  heartbeatMs: number;
  onsetMatchSec: number;
  tempoOverride?: number;
}

export function finiteNumberSetting(
  name: string,
  raw: string,
  bounds: { min: number; max: number; integer?: boolean },
): number {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  if (!trimmed || !Number.isFinite(value) || value < bounds.min || value > bounds.max || (bounds.integer && !Number.isInteger(value))) {
    const kind = bounds.integer ? "integer" : "number";
    throw new Error(`${name} must be a finite ${kind} between ${bounds.min} and ${bounds.max}`);
  }
  return value;
}

export function workerNumericConfigFromEnv(env: NodeJS.ProcessEnv): WorkerNumericConfig {
  const tempoOverride = env.KEYSPILLI_TEMPO_OVERRIDE?.trim();
  return {
    pollMs: finiteNumberSetting("KEYSPILLI_POLL_MS", env.KEYSPILLI_POLL_MS ?? "5000", { min: 100, max: 300_000, integer: true }),
    maxAttempts: finiteNumberSetting("KEYSPILLI_MAX_ATTEMPTS", env.KEYSPILLI_MAX_ATTEMPTS ?? "2", { min: 1, max: 10, integer: true }),
    maxVideoDurationSec: finiteNumberSetting("KEYSPILLI_MAX_VIDEO_DURATION_SEC", env.KEYSPILLI_MAX_VIDEO_DURATION_SEC ?? "600", { min: 1, max: 86_400 }),
    shutdownGraceMs: finiteNumberSetting("KEYSPILLI_SHUTDOWN_GRACE_MS", env.KEYSPILLI_SHUTDOWN_GRACE_MS ?? "120000", { min: 1_000, max: 900_000, integer: true }),
    heartbeatMs: finiteNumberSetting("KEYSPILLI_HEARTBEAT_MS", env.KEYSPILLI_HEARTBEAT_MS ?? "15000", { min: 1_000, max: 60_000, integer: true }),
    onsetMatchSec: finiteNumberSetting("KEYSPILLI_ONSET_MATCH_SEC", env.KEYSPILLI_ONSET_MATCH_SEC ?? "0.15", { min: 0.001, max: 10 }),
    ...(tempoOverride ? { tempoOverride: finiteNumberSetting("KEYSPILLI_TEMPO_OVERRIDE", tempoOverride, { min: 20, max: 400 }) } : {}),
  };
}
