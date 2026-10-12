import { MAX_PLAYBACK_BEATS, MAX_PLAYBACK_MEASURES } from "./timeline.js";

export type PracticePulse = "quarter" | "eighth" | "dotted-quarter";
export interface PracticeBeatGroups {
  timeSig: readonly [number, number];
  /** Counts of denominator notes, in order, totaling the numerator. */
  groups: readonly number[];
}
export interface PracticePulseSettings {
  pulse: PracticePulse;
  /** Explicit choices only. A missing meter has no additional group accents. */
  beatGroups?: readonly PracticeBeatGroups[];
}
export interface PracticePulseTiming {
  timeSig: readonly [number, number];
  timeSigEvents?: readonly { beat: number; timeSig: readonly [number, number] }[];
  measureStarts?: readonly number[];
  /** Initial phase supplied only after source timing validation; may precede a pickup. */
  measureStartBeat?: number;
  /** Actual arrangement end, excluding any transport padding. */
  endBeat?: number;
}
export interface PracticePulseEvent { beat: number; accent: "bar" | "group" | "pulse" }
export interface PracticePulsePlan { events: readonly PracticePulseEvent[] }

const MAX_METERS = 32;
const MAX_METER_EVENTS = 512;
const MAX_CLICKS = 65_536;
const EPSILON = 1e-9;
const PULSE_BEATS: Record<PracticePulse, number> = { quarter: 1, eighth: .5, "dotted-quarter": 1.5 };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const meterKey = (meter: readonly [number, number]) => `${meter[0]}/${meter[1]}`;
const validMeter = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2
  && Number.isInteger(value[0]) && value[0] >= 1 && value[0] <= 32 && [1, 2, 4, 8, 16, 32].includes(value[1]);

/** Validate at storage/UI/engine boundaries, before constructing a click plan. */
export function practicePulseSettingsError(value: unknown): string | null {
  if (!object(value) || !keys(value, ["pulse", "beatGroups"]) || !["quarter", "eighth", "dotted-quarter"].includes(value.pulse as string)) {
    return "Choose a quarter, eighth or dotted-quarter practice pulse.";
  }
  if (value.beatGroups === undefined) return null;
  if (!Array.isArray(value.beatGroups) || value.beatGroups.length > MAX_METERS) return "Practice grouping supports at most 32 distinct meters.";
  const seen = new Set<string>();
  for (const pattern of value.beatGroups) {
    if (!object(pattern) || !keys(pattern, ["timeSig", "groups"]) || !validMeter(pattern.timeSig)) return "Practice grouping needs a supported meter fraction.";
    const label = meterKey(pattern.timeSig);
    if (seen.has(label)) return `Practice grouping declares ${label} more than once.`;
    seen.add(label);
    if (!Array.isArray(pattern.groups) || !pattern.groups.length || pattern.groups.length > 32) {
      return `Grouping for ${label} must contain positive whole numbers totaling ${pattern.timeSig[0]} (at most 32 groups).`;
    }
    let total = 0;
    for (const group of pattern.groups) {
      if (!Number.isInteger(group) || group <= 0 || group > 32) return `Grouping for ${label} must contain positive whole numbers totaling ${pattern.timeSig[0]}.`;
      total += group;
    }
    if (total !== pattern.timeSig[0]) return `Grouping for ${label} must contain positive whole numbers totaling ${pattern.timeSig[0]}.`;
  }
  return null;
}

/** Return a detached, bounded copy; invalid saved input never reaches the engine. */
export function readPracticePulseSettings(value: unknown): PracticePulseSettings | undefined {
  if (practicePulseSettingsError(value)) return undefined;
  const settings = value as PracticePulseSettings;
  return {
    pulse: settings.pulse,
    ...(settings.beatGroups?.length ? { beatGroups: settings.beatGroups.map(pattern => ({ timeSig: [...pattern.timeSig] as [number, number], groups: [...pattern.groups] })) } : {}),
  };
}

export function practicePulseBeats(pulse: PracticePulse): number { return PULSE_BEATS[pulse]; }

/** Distinct descriptive meters for explicit setup controls; this does not infer grouping. */
export function practicePulseMeters(timing: PracticePulseTiming): Array<readonly [number, number]> {
  if (timing.timeSigEvents !== undefined && (!Array.isArray(timing.timeSigEvents) || timing.timeSigEvents.length > MAX_METER_EVENTS)) return [];
  const meters = timing.timeSigEvents?.length ? timing.timeSigEvents.map(event => event?.timeSig) : [timing.timeSig];
  for (const meter of meters) if (!validMeter(meter)) return [];
  return [...new Map(meters.map(meter => [meterKey(meter), meter])).values()];
}

/**
 * Build once at a settings/timeline boundary. The scheduler still owns seconds,
 * speed, seek, lookahead, grading and loop clipping. No source notes are edited.
 */
export function preparePracticePulsePlan(timing: PracticePulseTiming, settings: PracticePulseSettings, durationBeats: number): PracticePulsePlan {
  const settingError = practicePulseSettingsError(settings);
  if (settingError) throw new RangeError(settingError);
  if (!finite(durationBeats) || durationBeats <= 0 || durationBeats > MAX_PLAYBACK_BEATS) throw new RangeError("Practice timing duration must be positive and at most 4096 quarter-note beats.");
  const end = timing.endBeat ?? durationBeats;
  if (!finite(end) || end <= 0 || end > durationBeats + EPSILON || end > MAX_PLAYBACK_BEATS) throw new RangeError("Practice timing end must fit the arrangement duration.");
  if (!validMeter(timing.timeSig)) throw new RangeError("Practice pulse needs a supported meter fraction.");
  const suppliedEvents = timing.timeSigEvents;
  if (suppliedEvents !== undefined && (!Array.isArray(suppliedEvents) || !suppliedEvents.length || suppliedEvents.length > MAX_METER_EVENTS)) throw new RangeError("Practice timing supports 1–512 ordered meter events.");
  const events = suppliedEvents ?? [{ beat: 0, timeSig: timing.timeSig }];
  let previousEvent = -1;
  for (const event of events) {
    if (!event || !finite(event.beat) || event.beat < 0 || event.beat > end || event.beat <= previousEvent || !validMeter(event.timeSig)) throw new RangeError("Practice timing needs finite, ordered meter events inside the arrangement.");
    previousEvent = event.beat;
  }
  if (events[0]!.beat !== 0) throw new RangeError("Practice timing needs the opening meter at beat zero.");
  const meters = practicePulseMeters(timing);
  if (meters.length > MAX_METERS) throw new RangeError("Practice grouping supports at most 32 distinct meters.");
  for (const pattern of settings.beatGroups ?? []) {
    if (!meters.some(meter => meterKey(meter) === meterKey(pattern.timeSig))) throw new RangeError(`Grouping for ${meterKey(pattern.timeSig)} does not match this arrangement. Choose a current meter in practice setup.`);
  }
  const firstWidth = events[0]!.timeSig[0] * 4 / events[0]!.timeSig[1];
  const firstPhase = timing.measureStartBeat ?? 0;
  if (!finite(firstPhase) || firstPhase > 0 || firstPhase <= -firstWidth) throw new RangeError("Practice pickup timing needs a validated initial bar phase.");

  let starts: number[];
  if (timing.measureStarts !== undefined) {
    if (!Array.isArray(timing.measureStarts) || !timing.measureStarts.length || timing.measureStarts.length > MAX_PLAYBACK_MEASURES) throw new RangeError("Practice pulse needs a displayed bar map within 2048 bars.");
    starts = [...timing.measureStarts];
    let previous = -1;
    for (const start of starts) {
      if (!finite(start) || start < 0 || start > end + EPSILON || start <= previous) throw new RangeError("Practice pulse needs finite, ordered displayed bar starts within the arrangement.");
      previous = start;
    }
    if (starts[0] !== 0) throw new RangeError("Practice pulse needs a displayed opening bar at beat zero.");
  } else {
    starts = [0];
    for (let index = 0; index < events.length; index++) {
      const event = events[index]!, width = event.timeSig[0] * 4 / event.timeSig[1];
      const regionEnd = Math.min(events[index + 1]?.beat ?? end, end);
      const phase = index === 0 ? firstPhase : event.beat;
      for (let start = phase; start < regionEnd - EPSILON; start += width) {
        if (start <= 0) continue;
        if (starts.length >= MAX_PLAYBACK_MEASURES) throw new RangeError("Practice pulse needs a displayed bar map within 2048 bars.");
        starts.push(start);
      }
    }
  }
  for (const event of events) {
    if (!starts.some(start => Math.abs(start - event.beat) <= EPSILON)) throw new RangeError("Meter changes do not align with the displayed bars. Use default clicks or choose an arrangement with verified bar timing.");
  }

  const planned = new Map<string, PracticePulseEvent>();
  const strength = { pulse: 0, group: 1, bar: 2 };
  let meterIndex = 0;
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index]!, upper = Math.min(starts[index + 1] ?? end, end);
    if (start >= end) break;
    while (events[meterIndex + 1] && events[meterIndex + 1]!.beat <= start + EPSILON) meterIndex++;
    const meter = events[meterIndex]!.timeSig, width = meter[0] * 4 / meter[1];
    const phase = index === 0 ? firstPhase : start;
    if (upper > phase + width + EPSILON || starts[index + 1] !== undefined && Math.abs(upper - phase - width) > EPSILON) {
      throw new RangeError("The displayed bars do not align with the declared meter or pickup. Use default clicks or choose an arrangement with verified bar timing.");
    }
    const add = (beat: number, accent: PracticePulseEvent["accent"]) => {
      if (beat < start - EPSILON || beat < 0 || beat >= upper - EPSILON) return;
      const key = beat.toFixed(9), previous = planned.get(key);
      if (!previous && planned.size >= MAX_CLICKS) throw new RangeError("Practice pulse exceeds the bounded click budget.");
      if (!previous || strength[accent] > strength[previous.accent]) planned.set(key, { beat, accent });
    };
    add(phase, "bar");
    const unit = PULSE_BEATS[settings.pulse];
    for (let pulse = Math.ceil((start - phase) / unit - EPSILON); phase + pulse * unit < upper - EPSILON; pulse++) add(phase + pulse * unit, "pulse");
    const pattern = settings.beatGroups?.find(candidate => meterKey(candidate.timeSig) === meterKey(meter));
    if (pattern) {
      let offset = 0;
      for (const group of pattern.groups.slice(0, -1)) {
        offset += group * 4 / meter[1];
        add(phase + offset, "group");
      }
    }
  }
  return { events: [...planned.values()].sort((left, right) => left.beat - right.beat) };
}

/** User-facing validation shares the exact engine plan boundary. */
export function practicePulseProblem(timing: PracticePulseTiming, settings: PracticePulseSettings, durationBeats: number): string | null {
  try { preparePracticePulsePlan(timing, settings, durationBeats); return null; }
  catch (error) { return error instanceof Error ? error.message : "Practice pulse timing is unavailable. Use default clicks."; }
}

export function firstPracticePulseAtOrAfter(events: readonly PracticePulseEvent[], beat: number): number {
  let low = 0, high = events.length;
  while (low < high) {
    const middle = low + ((high - low) >> 1);
    if (events[middle]!.beat < beat - EPSILON) low = middle + 1;
    else high = middle;
  }
  return low;
}
