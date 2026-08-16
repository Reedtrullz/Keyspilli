/**
 * Parse the tempo fields accepted by metadata/update endpoints.
 *
 * `tempo` remains a compatibility alias for playback tempo.  Callers that
 * need to change the source beat calibration must use `calibrationTempo`
 * explicitly so that an operator cannot accidentally trigger a rebuild by
 * using the learner-facing field.
 */
export type TempoRole = "playback" | "source-calibration";

export interface TempoRequestPatch {
  tempo?: number;
  playbackTempo?: number;
  calibrationTempo?: number;
}
export interface ParsedTempoRequest {
  patch: TempoRequestPatch;
  role: TempoRole | null;
  hasTempo: boolean;
}

export class TempoRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TempoRequestError";
  }
}

function readFinite(body: Record<string, unknown>, field: keyof TempoRequestPatch): number | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TempoRequestError(`${field} must be a finite number`);
  }
  return value;
}

/**
 * Parse and disambiguate role-specific tempo updates.
 *
 * Only one role may be changed per update.  This keeps publication and the
 * response role unambiguous; a source calibration rebuild is an explicit
 * maintainer operation, never an accidental side effect of a playback edit.
 */
export function parseTempoRequest(body: Record<string, unknown>): ParsedTempoRequest {
  const tempo = readFinite(body, "tempo");
  const playbackTempo = readFinite(body, "playbackTempo");
  const calibrationTempo = readFinite(body, "calibrationTempo");
  const hasAlias = tempo !== undefined;
  const hasPlayback = playbackTempo !== undefined;
  const hasCalibration = calibrationTempo !== undefined;

  if (hasAlias && hasPlayback) {
    throw new TempoRequestError("use either tempo or playbackTempo, not both");
  }
  if ((hasAlias || hasPlayback) && hasCalibration) {
    throw new TempoRequestError("choose one tempo role per update: playback or calibration");
  }

  const patch: TempoRequestPatch = {};
  if (hasAlias) patch.tempo = tempo;
  if (hasPlayback) patch.playbackTempo = playbackTempo;
  if (hasCalibration) patch.calibrationTempo = calibrationTempo;

  return {
    patch,
    role: hasCalibration ? "source-calibration" : hasAlias || hasPlayback ? "playback" : null,
    hasTempo: hasAlias || hasPlayback || hasCalibration,
  };
}
