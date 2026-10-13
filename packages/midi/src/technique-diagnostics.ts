import type { Hand, Note, ParsedMidi, SourcePedalTimeline } from "./types.js";
import { midiBeatToNativeSeconds } from "./parse.js";
import { sourcePedalEnd, sourcePedalErrors, validSourcePedal } from "./source-pedal.js";

/** Report-only work limits; these do not alter generation/admission policies. */
export const TECHNIQUE_DIAGNOSTIC_LIMITS = Object.freeze({
  maxEvents: 4096, maxSourceOrigins: 16384, maxIdLength: 512, maxBeat: 1_000_000,
  maxTempoEvents: 1024, maxClockWork: 1_000_000, maxControllerWork: 1_000_000,
  maxMaterializedRelations: 100_000, onsetToleranceBeats: 1e-9,
});
export interface TechniqueInput {
  /** Physical attacks require integer velocity 1..127; zero is not an exported attack. */
  events: readonly { eventId: string; note: Note }[];
  clock: {
    data: Pick<ParsedMidi, "division" | "tempoBpm" | "tempoEvents" | "tempoMetaPresent">;
    authority: "declared" | "unknown";
    timebase: "source-quarter-beats" | "arrangement-quarter-beats";
  };
  handAuthority: "source-declared" | "arrangement-assumption" | "unknown";
  pedal: { authority: "declared" | "none" | "unknown"; timeline?: SourcePedalTimeline };
  speedMultiplier?: number;
}
export interface TechniqueInstant { beat: number; nativeSeconds: number | null; playbackSeconds: number | null }
export interface TechniqueInterval { beats: number; nativeSeconds: number | null; playbackSeconds: number | null }
export interface TechniqueEvent {
  eventId: string;
  midi: number;
  velocity: number;
  hand: Hand | null;
  inputHand: Hand | null;
  sourceOrigins: { id: string; occurrence: 1 | 2 | null }[];
  attack: TechniqueInstant;
  physicalRelease: TechniqueInstant;
  physicalDuration: TechniqueInterval;
  /** Controller eligibility only; null means not known, not a held key. */
  cc64EligibleUntil: TechniqueInstant | null;
}
export interface TechniqueHeldAttack {
  hand: Hand | null;
  /** Earliest onset in the global group; individual event onsets remain exact. */
  attack: TechniqueInstant;
  newEventIds: string[];
  carriedEventIds: string[];
  releasedAtAttackEventIds: string[];
  unknownHandCarriedEventIds: string[];
  pedalOnlyEventIds: string[] | null;
  handQualification: "declared-hand-only" | "unknown-hand-predecessors" | "unassigned-hand";
}
export interface TechniqueRegisterTransition {
  hand: Hand;
  priorEventIds: string[];
  nextEventIds: string[];
  priorPitchRange: [number, number];
  nextPitchRange: [number, number];
  priorAnchorMidi: number;
  nextAnchorMidi: number;
  signedSemitoneDisplacement: number;
  priorPhysicalReleases: { eventId: string; release: TechniqueInstant }[];
  priorGroupLatestPhysicalRelease: TechniqueInstant;
  onsetInterval: TechniqueInterval;
  releaseToNextAttack: TechniqueInterval;
  unknownHandInterveningEventIds: string[];
  adjacency: "declared-hand-only" | "unknown-hand-intervening";
}
export interface TechniqueSameKeyRecurrence {
  priorEventId: string;
  nextEventId: string;
  hand: Hand | null;
  midi: number;
  sameHand: "declared" | "unknown";
  adjacency: "declared-hand-only" | "unknown-hand-intervening" | "global-key-only";
  unknownHandInterveningEventIds: string[];
  priorPhysicalRelease: TechniqueInstant;
  onsetInterval: TechniqueInterval;
  releaseToNextAttack: TechniqueInterval;
  physicalRelation: "released-before-attack" | "released-at-attack" | "overlapping-independent-attacks";
}
export interface TechniqueReport {
  status: "reported";
  schemaVersion: 1;
  timebase: TechniqueInput["clock"]["timebase"];
  clock: { status: "known" | "unknown"; authority: TechniqueInput["clock"]["authority"]; reason: string | null };
  handAuthority: TechniqueInput["handAuthority"];
  pedalAuthority: TechniqueInput["pedal"]["authority"];
  speedMultiplier: number;
  events: TechniqueEvent[];
  heldAtAttack: TechniqueHeldAttack[];
  registerTransitions: TechniqueRegisterTransition[];
  sameKeyRecurrences: TechniqueSameKeyRecurrence[];
  counts: { physicalEvents: number; sourceOriginOccurrences: number; materializedRelations: number };
  nonclaims: { fingering: "not-assessed"; handPositionTravel: "not-assessed"; ergonomicSuitability: "not-established"; musicalAcceptance: "not-established"; keyboardAcceptance: "not-established" };
}
export type TechniqueResult = TechniqueReport | {
  status: "refused";
  code: "invalid-input" | "invalid-clock" | "invalid-pedal" | "ambiguous-same-key-onset" | "workload-limit";
  reason: string;
};

type RefusalCode = Extract<TechniqueResult, { status: "refused" }>["code"];
class DiagnosticRefusal extends Error {
  constructor(readonly code: RefusalCode, message: string) { super(message); }
}
function check(condition: unknown, code: RefusalCode, message: string): asserts condition {
  if (!condition) throw new DiagnosticRefusal(code, message);
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const ascii = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const identifier = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0
  && value.length <= TECHNIQUE_DIAGNOSTIC_LIMITS.maxIdLength && !/[\x00-\x1f\x7f]/.test(value);
const pitchOrder = (a: TechniqueEvent, b: TechniqueEvent) => a.midi - b.midi || ascii(a.eventId, b.eventId);
/** Only arithmetic round-off is equal here; the onset grouping tolerance is separate. */
function timeOrder(a: number, b: number): number {
  const roundOff = Math.min(1e-9, 4 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)));
  return Math.abs(a - b) <= roundOff ? 0 : a < b ? -1 : 1;
}

function validateClock(input: TechniqueInput): TechniqueReport["clock"] {
  const { clock } = input; const limits = TECHNIQUE_DIAGNOSTIC_LIMITS;
  check(record(clock) && ["declared", "unknown"].includes(clock.authority)
    && ["source-quarter-beats", "arrangement-quarter-beats"].includes(clock.timebase), "invalid-clock", "Invalid clock declaration.");
  const data = clock.data;
  check(record(data) && Number.isInteger(data.division) && data.division > 0 && data.division <= 32767
    && finite(data.tempoBpm) && data.tempoBpm > 0 && finite(60_000_000 / data.tempoBpm)
    && (data.tempoMetaPresent === undefined || typeof data.tempoMetaPresent === "boolean")
    && (data.tempoEvents === undefined || Array.isArray(data.tempoEvents)), "invalid-clock", "Malformed native clock metadata.");
  const tempos = data.tempoEvents ?? [];
  check(tempos.length <= limits.maxTempoEvents, "workload-limit", "Tempo declaration exceeds the diagnostic event budget.");
  let previousTick = -1;
  for (const tempo of tempos) {
    check(record(tempo) && Number.isInteger(tempo.tick) && tempo.tick > previousTick && finite(tempo.beat)
      && tempo.beat >= 0 && tempo.beat <= limits.maxBeat && Math.abs(tempo.tick / data.division - tempo.beat) <= 1e-9
      && finite(tempo.microsecondsPerQuarter) && tempo.microsecondsPerQuarter > 0
      && finite(tempo.bpm) && tempo.bpm > 0 && finite(60_000_000 / tempo.microsecondsPerQuarter)
      && Math.abs(60_000_000 / tempo.microsecondsPerQuarter - tempo.bpm) <= 1e-9 * Math.max(1, tempo.bpm),
    "invalid-clock", "Tempo events must be finite, strictly ordered, positive and internally consistent.");
    previousTick = tempo.tick;
  }
  check(!(data.tempoMetaPresent === false && tempos.length), "invalid-clock", "Explicit tempo events conflict with the absent-metadata declaration.");
  check(clock.timebase !== "arrangement-quarter-beats" || tempos.length === 0 || tempos.length === 1 && tempos[0]!.tick === 0,
    "invalid-clock", "Arrangement beats require a constant clock; do not reintegrate source tempo changes.");
  if (tempos[0]?.tick === 0) check(Math.abs(tempos[0]!.bpm - data.tempoBpm) <= 1e-9 * Math.max(1, data.tempoBpm),
    "invalid-clock", "The initial tempo conflicts with the native tempo declaration.");
  const reason = clock.authority === "unknown" ? "Native clock authority is unknown."
    : data.tempoMetaPresent !== true ? "A numeric tempo alone is not an explicit source clock."
      : tempos.length && tempos[0]!.tick !== 0 ? "The explicit tempo declaration does not cover beat zero." : null;
  return { status: reason ? "unknown" : "known", authority: clock.authority, reason };
}

/**
 * Local symbolic key facts under caller-declared clock and hand authority.
 * Event IDs identify physical events; source origins are independent witnesses.
 * No hand inference, source matching, release repair, fingering or admission occurs.
 */
export function analyzeTechnique(input: TechniqueInput): TechniqueResult {
  try { return reportTechnique(input); }
  catch (error) {
    if (error instanceof DiagnosticRefusal) return { status: "refused", code: error.code, reason: error.message };
    throw error;
  }
}

function reportTechnique(input: TechniqueInput): TechniqueReport {
  const limits = TECHNIQUE_DIAGNOSTIC_LIMITS;
  check(record(input) && Array.isArray(input.events), "invalid-input", "Expected a finite physical event array.");
  const declaredEvents: TechniqueInput["events"] = input.events;
  check(declaredEvents.length <= limits.maxEvents, "workload-limit", "Physical event count exceeds the diagnostic budget.");
  check(["source-declared", "arrangement-assumption", "unknown"].includes(input.handAuthority), "invalid-input", "Missing hand authority.");
  const speed = input.speedMultiplier === undefined ? 1 : input.speedMultiplier;
  check(finite(speed) && speed > 0, "invalid-input", "Playback speed must be finite and positive.");
  const clock = validateClock(input);
  const eventIds = new Set<string>(), originIds = new Set<string>(); let originCount = 0;
  for (const event of declaredEvents) {
    check(record(event) && identifier(event.eventId) && !eventIds.has(event.eventId) && record(event.note), "invalid-input", "Invalid or duplicate physical event ID/note.");
    eventIds.add(event.eventId); const note = event.note;
    check(finite(note.start) && finite(note.dur), "invalid-input", "Attack and duration must be finite numbers.");
    const end = note.start + note.dur;
    check(Number.isInteger(note.midi) && note.midi >= 0 && note.midi <= 127 && Number.isInteger(note.vel) && note.vel >= 1 && note.vel <= 127
      && finite(note.start) && note.start >= 0 && finite(note.dur) && note.dur > 0 && finite(end) && end > note.start && end <= limits.maxBeat
      && (note.hand === undefined || note.hand === "L" || note.hand === "R")
      && (note.sourceMidiChannel === undefined || Number.isInteger(note.sourceMidiChannel) && note.sourceMidiChannel >= 0 && note.sourceMidiChannel <= 15)
      && (note.sourceOrigins === undefined || Array.isArray(note.sourceOrigins)), "invalid-input", "Malformed physical pitch, velocity, attack, release, hand, channel or lineage.");
    originCount += note.sourceOrigins?.length ?? 0;
    check(originCount <= limits.maxSourceOrigins, "workload-limit", "Source occurrence count exceeds the diagnostic budget.");
    for (const origin of note.sourceOrigins ?? []) {
      check(record(origin) && identifier(origin.id) && (origin.occurrence === undefined || origin.occurrence === 1 || origin.occurrence === 2), "invalid-input", "Malformed source occurrence.");
      const key = `${origin.id}\0${origin.occurrence ?? ""}`;
      check(!originIds.has(key), "invalid-input", "A source origin occurrence is duplicated across physical declarations."); originIds.add(key);
    }
  }
  check(record(input.pedal) && ["declared", "none", "unknown"].includes(input.pedal.authority), "invalid-pedal", "Missing controller authority.");
  const pedal = input.pedal.timeline;
  if (pedal !== undefined) {
    check(validSourcePedal(pedal), "invalid-pedal", "Malformed CC64 timeline.");
    check(input.pedal.authority !== "none", "invalid-pedal", "A controller timeline conflicts with declared no-pedal input.");
    check(declaredEvents.length * pedal.changes.length <= limits.maxControllerWork, "workload-limit", "Controller work exceeds the diagnostic budget.");
    const errors = sourcePedalErrors(declaredEvents.map(e => e.note), pedal);
    check(errors.length === 0, "invalid-pedal", errors.join(" "));
  }
  check(input.pedal.authority !== "declared" || pedal !== undefined, "invalid-pedal", "Declared pedal authority requires its timeline.");
  // Every conversion is cached. At most two event times plus controller-up/end
  // times can be requested; bound this before calling the maintained converter.
  const maxTimePoints = declaredEvents.length * 2 + (pedal ? pedal.changes.length + 1 : 0);
  check(clock.status !== "known" || maxTimePoints * Math.max(1, input.clock.data.tempoEvents?.length ?? 0) <= limits.maxClockWork,
    "workload-limit", "Native tempo mapping work exceeds the diagnostic budget.");
  const times = new Map<number, TechniqueInstant>();
  const instant = (beat: number): TechniqueInstant => {
    const cached = times.get(beat); if (cached) return cached;
    const nativeSeconds = clock.status === "known" ? midiBeatToNativeSeconds(input.clock.data, beat) : null;
    const playbackSeconds = nativeSeconds === null ? null : nativeSeconds / speed;
    check(nativeSeconds === null || finite(nativeSeconds), "invalid-clock", "Native elapsed time overflows the finite clock domain.");
    check(playbackSeconds === null || finite(playbackSeconds), "invalid-input", "Playback scenario overflows finite elapsed time.");
    const value = { beat, nativeSeconds, playbackSeconds }; times.set(beat, value); return value;
  };
  const interval = (from: TechniqueInstant, to: TechniqueInstant): TechniqueInterval => ({
    beats: timeOrder(from.beat, to.beat) === 0 ? 0 : to.beat - from.beat,
    nativeSeconds: from.nativeSeconds === null || to.nativeSeconds === null ? null : to.nativeSeconds - from.nativeSeconds,
    playbackSeconds: from.nativeSeconds === null || to.nativeSeconds === null ? null : (to.nativeSeconds - from.nativeSeconds) / speed,
  });
  const events: TechniqueEvent[] = declaredEvents.map(({ eventId, note }) => {
    const attack = instant(note.start), physicalRelease = instant(note.start + note.dur);
    const eligibleEnd = input.pedal.authority === "unknown" ? null : pedal ? sourcePedalEnd(note, pedal) : note.start + note.dur;
    return { eventId, midi: note.midi, velocity: note.vel, hand: input.handAuthority === "unknown" ? null : note.hand ?? null, inputHand: note.hand ?? null,
      sourceOrigins: (note.sourceOrigins ?? []).map(o => ({ id: o.id, occurrence: o.occurrence ?? null })).sort((a, b) => ascii(a.id, b.id) || (a.occurrence ?? 0) - (b.occurrence ?? 0)),
      attack, physicalRelease, physicalDuration: { ...interval(attack, physicalRelease), beats: note.dur }, cc64EligibleUntil: eligibleEnd === null ? null : instant(eligibleEnd) };
  }).sort((a, b) => a.attack.beat - b.attack.beat || ascii(a.eventId, b.eventId));
  const groups: { attack: TechniqueInstant; events: TechniqueEvent[] }[] = [];
  for (const event of events) {
    let group = groups.at(-1);
    if (!group || event.attack.beat - group.attack.beat > limits.onsetToleranceBeats) { group = { attack: event.attack, events: [] }; groups.push(group); }
    const sameKey = group.events.find(e => e.midi === event.midi);
    check(!sameKey, "ambiguous-same-key-onset", `Independent events ${sameKey?.eventId} and ${event.eventId} attack one MIDI key in the same onset group.`);
    group.events.push(event);
  }
  let materializedRelations = 0;
  const charge = (count: number) => {
    materializedRelations += count;
    check(materializedRelations <= limits.maxMaterializedRelations, "workload-limit", "Materialized event relationships exceed the diagnostic budget; no partial report is returned.");
  };
  const selectedIds = (items: Iterable<TechniqueEvent>, predicate: (event: TechniqueEvent) => boolean): string[] => {
    const selected: TechniqueEvent[] = [];
    for (const event of items) if (predicate(event)) { charge(1); selected.push(event); }
    return selected.sort(pitchOrder).map(e => e.eventId);
  };
  const heldAtAttack: TechniqueHeldAttack[] = [], registerTransitions: TechniqueRegisterTransition[] = [], sameKeyRecurrences: TechniqueSameKeyRecurrence[] = [];
  const active = new Map<string, TechniqueEvent>(), resonant = new Map<string, TechniqueEvent>();
  const unknown = events.filter(e => e.hand === null);
  const previousGroups = new Map<Hand, { attack: TechniqueInstant; events: TechniqueEvent[]; groupIndex: number }>();
  const groupIndices = new Map<string, number>();
  groups.forEach((g, i) => g.events.forEach(e => groupIndices.set(e.eventId, i)));
  events.sort((a, b) => groupIndices.get(a.eventId)! - groupIndices.get(b.eventId)! || pitchOrder(a, b));
  for (const [groupIndex, group] of groups.entries()) {
    const released: TechniqueEvent[] = [];
    for (const [id, event] of active) {
      const order = timeOrder(event.physicalRelease.beat, group.attack.beat);
      if (order <= 0) { if (order === 0) released.push(event); active.delete(id); }
    }
    for (const [id, event] of resonant) if (timeOrder(event.cc64EligibleUntil!.beat, group.attack.beat) <= 0) resonant.delete(id);
    for (const hand of ["L", "R", null] as const) {
      const current = group.events.filter(e => e.hand === hand).sort(pitchOrder); if (!current.length) continue;
      const newEventIds = selectedIds(current, () => true);
      const unknownHandCarriedEventIds = hand === null ? [] : selectedIds(active.values(), e => e.hand === null);
      heldAtAttack.push({ hand, attack: group.attack, newEventIds,
        carriedEventIds: selectedIds(active.values(), e => e.hand === hand), releasedAtAttackEventIds: selectedIds(released, e => e.hand === hand), unknownHandCarriedEventIds,
        pedalOnlyEventIds: input.pedal.authority === "unknown" ? null : selectedIds(resonant.values(), e => e.hand === hand && timeOrder(e.physicalRelease.beat, group.attack.beat) <= 0),
        handQualification: hand === null ? "unassigned-hand" : unknownHandCarriedEventIds.length ? "unknown-hand-predecessors" : "declared-hand-only" });
      if (hand === null) continue;
      const prior = previousGroups.get(hand);
      if (prior) {
        const unknownHandInterveningEventIds = selectedIds(unknown, e => groupIndices.get(e.eventId)! >= prior.groupIndex && groupIndices.get(e.eventId)! <= groupIndex);
        const priorRange: [number, number] = [prior.events[0]!.midi, prior.events.at(-1)!.midi], nextRange: [number, number] = [current[0]!.midi, current.at(-1)!.midi];
        const latestRelease = prior.events.reduce((latest, e) => e.physicalRelease.beat > latest.beat ? e.physicalRelease : latest, prior.events[0]!.physicalRelease);
        charge(prior.events.length);
        registerTransitions.push({ hand, priorEventIds: selectedIds(prior.events, () => true), nextEventIds: selectedIds(current, () => true),
          priorPitchRange: priorRange, nextPitchRange: nextRange, priorAnchorMidi: priorRange[1], nextAnchorMidi: nextRange[1], signedSemitoneDisplacement: nextRange[1] - priorRange[1],
          priorPhysicalReleases: prior.events.map(e => ({ eventId: e.eventId, release: e.physicalRelease })), priorGroupLatestPhysicalRelease: latestRelease,
          onsetInterval: interval(prior.attack, group.attack), releaseToNextAttack: interval(latestRelease, group.attack), unknownHandInterveningEventIds,
          adjacency: unknownHandInterveningEventIds.length ? "unknown-hand-intervening" : "declared-hand-only" });
      }
      previousGroups.set(hand, { attack: group.attack, events: current, groupIndex });
    }
    for (const event of group.events) { active.set(event.eventId, event); if (event.cc64EligibleUntil) resonant.set(event.eventId, event); }
  }
  const previousHandKey = new Map<string, TechniqueEvent>(), previousKey = new Map<number, TechniqueEvent>();
  const recurrence = (prior: TechniqueEvent, next: TechniqueEvent, knownHand: boolean) => {
    const unassigned = knownHand ? selectedIds(unknown, e => e.midi === next.midi && e.attack.beat > prior.attack.beat && e.attack.beat < next.attack.beat) : [];
    const releaseOrder = timeOrder(prior.physicalRelease.beat, next.attack.beat); charge(2);
    sameKeyRecurrences.push({ priorEventId: prior.eventId, nextEventId: next.eventId, hand: knownHand ? next.hand : null, midi: next.midi,
      sameHand: knownHand ? "declared" : "unknown", adjacency: knownHand ? unassigned.length ? "unknown-hand-intervening" : "declared-hand-only" : "global-key-only",
      unknownHandInterveningEventIds: unassigned, priorPhysicalRelease: prior.physicalRelease, onsetInterval: interval(prior.attack, next.attack), releaseToNextAttack: interval(prior.physicalRelease, next.attack),
      physicalRelation: releaseOrder < 0 ? "released-before-attack" : releaseOrder === 0 ? "released-at-attack" : "overlapping-independent-attacks" });
  };
  for (const event of events) {
    if (event.hand !== null) {
      const key = `${event.hand}:${event.midi}`; const prior = previousHandKey.get(key);
      if (prior) recurrence(prior, event, true); previousHandKey.set(key, event);
    }
    const prior = previousKey.get(event.midi);
    if (prior && (prior.hand === null || event.hand === null)) recurrence(prior, event, false);
    previousKey.set(event.midi, event);
  }
  return { status: "reported", schemaVersion: 1, timebase: input.clock.timebase, clock, handAuthority: input.handAuthority, pedalAuthority: input.pedal.authority, speedMultiplier: speed,
    events, heldAtAttack, registerTransitions, sameKeyRecurrences, counts: { physicalEvents: events.length, sourceOriginOccurrences: originCount, materializedRelations },
    nonclaims: { fingering: "not-assessed", handPositionTravel: "not-assessed", ergonomicSuitability: "not-established", musicalAcceptance: "not-established", keyboardAcceptance: "not-established" } };
}
