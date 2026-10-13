import type { DifficultyLevel, Note, ParsedMidi, PhraseTransformation, SourceNoteOrigin, Variant } from "../src/index.js";
import { midiBeatToNativeSeconds } from "../src/parse.js";
import { sourcePedalEnd } from "../src/source-pedal.js";

export interface SourceEventDeclaration {
  eventId: string;
  sourceOriginIds: string[];
  sourceOccurrences: Array<{ id: string; originalId: string; occurrence: 1 | 2 }>;
  midi: number;
  sourceAttackBeat: string;
  sourceDurationBeats: string;
  sourcePhysicalReleaseBeat: string;
  velocity: number;
  sourceHand: "R" | "L" | null;
  role: string;
  notationSegments: Array<{ startBeat: string; endBeat: string }>;
}
export interface ContractCase {
  caseId: string;
  familyId: string;
  title: string;
  caseKind: string;
  sourceFile: { path: string; sha256: string; bytes: number };
  sourceClock: { status: "known" | "unknown" | "invalid"; [key: string]: unknown };
  handDeclaration: { complete: boolean; unknownEventIds: string[]; [key: string]: unknown };
  pedalDeclaration: { completeNoPedal: boolean; [key: string]: unknown };
  eventDeclarations: SourceEventDeclaration[];
  authoredRestDeclarations: Array<{ id: string; startBeat: number; endBeat: number; scope: string }>;
  endingEventId: string;
}
export interface TierPolicy {
  tier: DifficultyLevel;
  requiredPhysicalEventIds: string[];
  requiredSourceOriginOccurrences: Array<{ id: string; occurrence: 1 | 2 }>;
  requiredPhysicalEventCount: number;
  requiredSourceOriginOccurrenceCount: number;
  optionalEventPolicies: Array<{ eventId: string; allowedTransformations: PhraseTransformation[] }>;
  requiredRestIds: string[];
  requiredEndingEventId: string;
  expectedDisposition: string;
  prospectiveRefusalReason: string | null;
  phrasePlanLocation: { path: string; jsonPointer: string } | null;
}
export interface PhysicalCorrespondence {
  status: "unambiguous" | "refused";
  format: "midi" | "musicxml";
  division: number;
  sourceIdsEncoded: false;
  canonicalCount: number;
  artifactCount: number;
  issues: string[];
  pairs: Array<{ canonicalIndex: number; artifactIndex: number; attackErrorBeats: number; releaseErrorBeats: number }>;
}

const EPS = 1e-9;
const MAX_PHYSICAL_NOTES = 4096;
const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= EPS;
export function rational(value: string): number {
  if (!/^-?\d+(?:\/[1-9]\d*)?$/.test(value)) throw new Error(`Invalid authored rational ${value}`);
  const [numerator, denominator = "1"] = value.split("/");
  const result = Number(numerator) / Number(denominator);
  if (!Number.isFinite(result)) throw new Error("Authored rational is not finite");
  return result;
}

/** Independent of provenance: these are physical note descriptors only. */
export function correspondPhysicalNotes(canonical: readonly Note[], actual: readonly Note[], format: "midi" | "musicxml", channels: boolean): PhysicalCorrespondence {
  const result: PhysicalCorrespondence = { status: "refused", format, division: format === "midi" ? 480 : 960, sourceIdsEncoded: false,
    canonicalCount: canonical.length, artifactCount: actual.length, issues: [], pairs: [] };
  if (canonical.length > MAX_PHYSICAL_NOTES || actual.length > MAX_PHYSICAL_NOTES) {
    result.issues.push(`Physical correspondence workload exceeds ${MAX_PHYSICAL_NOTES} notes per side`);
    return result;
  }
  if (canonical.length !== actual.length) result.issues.push(`Physical note count ${actual.length} != canonical ${canonical.length}`);
  const descriptor = (note: Note, index: number, rendered: boolean): string | null => {
    const label = `${rendered ? "artifact" : "canonical"} note ${index}`;
    if (!note || !Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127
      || !Number.isInteger(note.vel) || note.vel < 1 || note.vel > 127 || !["L", "R"].includes(note.hand ?? "")
      || !Number.isFinite(note.start) || note.start < 0 || !Number.isFinite(note.dur) || note.dur <= 0
      || note.start + note.dur > 4096 || channels && (!Number.isInteger(note.sourceMidiChannel) || note.sourceMidiChannel! < 0 || note.sourceMidiChannel! > 15)) {
      result.issues.push(`${label}: invalid physical descriptor or unknown output hand/channel`);
      return null;
    }
    const attack = Math.round(note.start * result.division), release = Math.round((note.start + note.dur) * result.division);
    if (release <= attack) { result.issues.push(`${label}: writer quantization collapses the physical attack`); return null; }
    // Canonical values are transformed by the fixed writer grid. Parsed values
    // must actually be on that grid, not merely near an available note.
    if (rendered && (!close(note.start, attack / result.division) || !close(note.start + note.dur, release / result.division))) {
      result.issues.push(`${label}: reparsed timestamps do not obey the pinned ${result.division}-tick grid`);
      return null;
    }
    return JSON.stringify([note.midi, attack, release, note.vel, note.hand, channels ? note.sourceMidiChannel : null]);
  };
  const groups = (notes: readonly Note[], rendered: boolean) => {
    const map = new Map<string, number[]>();
    notes.forEach((note, index) => {
      const key = descriptor(note, index, rendered);
      if (key !== null) { const indices = map.get(key) ?? []; indices.push(index); map.set(key, indices); }
    });
    return map;
  };
  const expected = groups(canonical, false), got = groups(actual, true);
  for (const [key, indices] of expected) {
    const candidates = got.get(key) ?? [];
    if (indices.length !== 1 || candidates.length !== 1) {
      result.issues.push(`${indices.length > 1 && candidates.length > 1 ? "Ambiguous" : "Missing or extra"} physical descriptor ${key}: canonical ${indices.length}, artifact ${candidates.length}`);
      continue;
    }
    const canonicalIndex = indices[0]!, artifactIndex = candidates[0]!;
    const left = canonical[canonicalIndex]!, right = actual[artifactIndex]!;
    result.pairs.push({ canonicalIndex, artifactIndex, attackErrorBeats: right.start - left.start,
      releaseErrorBeats: right.start + right.dur - left.start - left.dur });
  }
  for (const key of got.keys()) if (!expected.has(key)) result.issues.push(`Unexpected artifact physical descriptor ${key}`);
  result.pairs.sort((a, b) => a.canonicalIndex - b.canonicalIndex);
  if (!result.issues.length && result.pairs.length === canonical.length) result.status = "unambiguous";
  return result;
}

export interface SourceProtection {
  status: "preserved" | "refused";
  issues: string[];
  requiredEvents: Array<{ eventId: string; canonicalIndex: number | null; exact: boolean }>;
  requiredOriginOccurrences: Array<{ id: string; occurrence: 1 | 2; count: number }>;
  optionalEvents: Array<{ eventId: string; canonicalIndices: number[]; permitted: boolean }>;
  rests: Array<{ id: string; phrasePlanId: string; startBeat: number; endBeat: number; scope: string; intrudingCanonicalIndices: number[] }>;
  pedal: { status: "not-declared" | "preserved" | "refused"; channelMismatches: number[] };
  sourceHandAuthority: "authored-known-labels-only";
  generatedHandAuthority: "arrangement-assumption";
}
export function checkSourceProtection(item: ContractCase, policy: TierPolicy, source: ParsedMidi, variant: Variant): SourceProtection {
  const result: SourceProtection = { status: "refused", issues: [], requiredEvents: [],
    requiredOriginOccurrences: [], optionalEvents: [], rests: [], pedal: { status: "not-declared", channelMismatches: [] },
    sourceHandAuthority: "authored-known-labels-only", generatedHandAuthority: "arrangement-assumption" };
  if (item.sourceClock.status !== "known" || source.tempoMetaPresent !== true || !Number.isFinite(source.tempoBpm) || source.tempoBpm <= 0
    || !Number.isFinite(source.division) || source.division <= 0
    || source.tempoEvents?.some(e => !Number.isFinite(e.microsecondsPerQuarter) || e.microsecondsPerQuarter <= 0 || !Number.isFinite(e.tick) || e.tick < 0)) {
    result.issues.push("Exact source-to-output timing requires a known valid declared native clock");
    return result;
  }
  if (variant.notes.length > MAX_PHYSICAL_NOTES || item.eventDeclarations.length > MAX_PHYSICAL_NOTES) {
    result.issues.push("Source protection workload exceeds 4096 physical events"); return result;
  }
  const constantTempo = variant.phraseProtection?.outputClock.sourceTempoBpm ?? source.tempoBpm;
  if (!Number.isFinite(constantTempo) || constantTempo < 20 || constantTempo > 300) {
    result.issues.push("Invalid constant source-coordinate tempo"); return result;
  }
  const beat = (b: number) => midiBeatToNativeSeconds(source, b) * constantTempo / 60;
  if (source.sourcePedal) {
    const expected = source.sourcePedal, actual = variant.sourcePedal;
    const sourceChannels = new Map(source.notes.flatMap(note => (note.sourceOrigins ?? []).map(origin => [originKey(origin), note.sourceMidiChannel] as const)));
    result.pedal.channelMismatches = variant.notes.flatMap((note, index) => (note.sourceOrigins ?? []).some(origin =>
      sourceChannels.has(originKey(origin)) && sourceChannels.get(originKey(origin)) !== note.sourceMidiChannel) ? [index] : []);
    const timelinePreserved = actual && close(actual.endBeat, beat(expected.endBeat)) && actual.changes.length === expected.changes.length
      && actual.changes.every((change, index) => {
        const original = expected.changes[index]!;
        return close(change.beat, beat(original.beat)) && change.channel === original.channel && change.value === original.value && change.source === original.source;
      });
    result.pedal.status = timelinePreserved && !result.pedal.channelMismatches.length ? "preserved" : "refused";
    if (!timelinePreserved) result.issues.push("Complete declared source CC64 timeline is missing or changed");
    if (result.pedal.channelMismatches.length) result.issues.push("Source CC64 note-channel correspondence changed");
  } else if (variant.sourcePedal) {
    result.pedal.status = "refused"; result.issues.push("Undeclared output CC64 cannot satisfy a complete no-pedal source contract");
  }
  const indicesByOrigin = new Map<string, number[]>();
  variant.notes.forEach((note, index) => {
    for (const origin of note.sourceOrigins ?? []) {
      const key = originKey(origin), indices = indicesByOrigin.get(key) ?? [];
      indices.push(index); indicesByOrigin.set(key, indices);
    }
  });
  const declarations = new Map(item.eventDeclarations.map(event => [event.eventId, event]));
  const descendants = (event: SourceEventDeclaration) => [...new Set(event.sourceOccurrences.flatMap(o => indicesByOrigin.get(originKey(o)) ?? []))].sort((a, b) => a - b);
  const exactOrigins = (note: Note, event: SourceEventDeclaration) => event.sourceOccurrences.every(wanted =>
    note.sourceOrigins?.filter(actual => originKey(actual) === originKey(wanted) && actual.originalId === wanted.originalId).length === 1);
  const exact = (note: Note, event: SourceEventDeclaration) => exactOrigins(note, event) && note.midi === event.midi && note.vel === event.velocity
    && (!event.sourceHand || note.hand === event.sourceHand) && close(note.start, beat(rational(event.sourceAttackBeat)))
    && close(note.start + note.dur, beat(rational(event.sourcePhysicalReleaseBeat)));
  for (const eventId of policy.requiredPhysicalEventIds) {
    const event = declarations.get(eventId);
    const candidates = event ? descendants(event) : [];
    const canonicalIndex = candidates.length === 1 ? candidates[0]! : null;
    const preserved = !!event && canonicalIndex !== null && exact(variant.notes[canonicalIndex]!, event);
    result.requiredEvents.push({ eventId, canonicalIndex, exact: preserved });
    if (!preserved) result.issues.push(`Required source event ${eventId} is missing, duplicated, or changed`);
  }
  for (const origin of policy.requiredSourceOriginOccurrences) {
    const count = indicesByOrigin.get(originKey(origin))?.length ?? 0;
    result.requiredOriginOccurrences.push({ ...origin, count });
    if (count !== 1) result.issues.push(`Required source occurrence ${originKey(origin)} occurs ${count} times`);
  }
  for (const optional of policy.optionalEventPolicies) {
    const event = declarations.get(optional.eventId)!;
    const canonicalIndices = descendants(event), actual = canonicalIndices.length === 1 ? variant.notes[canonicalIndices[0]!]! : undefined;
    const allowed = optional.allowedTransformations;
    const permitted = actual ? exactOrigins(actual, event)
      && (actual.midi === event.midi || allowed.includes("octave-displacement") && (actual.midi - event.midi) % 12 === 0)
      && (close(actual.start, beat(rational(event.sourceAttackBeat))) || allowed.includes("onset-change"))
      && (close(actual.start + actual.dur, beat(rational(event.sourcePhysicalReleaseBeat))) || allowed.includes("release-change"))
      && (!event.sourceHand || actual.hand === event.sourceHand || allowed.includes("hand-reassignment"))
      && (actual.vel === event.velocity || allowed.includes("velocity-change"))
      : canonicalIndices.length === 0 && allowed.includes("omit");
    result.optionalEvents.push({ eventId: optional.eventId, canonicalIndices, permitted });
    if (!permitted) result.issues.push(`Optional source event ${optional.eventId} has an unpermitted transformation`);
  }
  for (const id of policy.requiredRestIds) {
    const rest = item.authoredRestDeclarations.find(r => r.id === id);
    if (!rest) { result.issues.push(`Missing authored rest ${id}`); continue; }
    const startBeat = beat(rest.startBeat), endBeat = beat(rest.endBeat);
    const scopedIndices = rest.scope === "all" ? variant.notes.map((_, index) => index)
      : [...new Set(item.eventDeclarations.filter(event => event.role === rest.scope).flatMap(descendants))];
    const intrudingCanonicalIndices = scopedIndices.filter(index => {
      const note = variant.notes[index]!;
      const release = variant.sourcePedal ? sourcePedalEnd(note, variant.sourcePedal) : note.start + note.dur;
      return note.start < endBeat - EPS && release > startBeat + EPS;
    });
    result.rests.push({ ...rest, phrasePlanId: `${item.caseId}:${id}`, startBeat, endBeat, intrudingCanonicalIndices });
    if (intrudingCanonicalIndices.length) result.issues.push(`Required ${rest.scope} rest ${id} is occupied`);
  }
  if (!result.requiredEvents.some(e => e.eventId === policy.requiredEndingEventId && e.exact)) result.issues.push("Exact ending event is not preserved");
  if (result.requiredEvents.length !== policy.requiredPhysicalEventCount || result.requiredOriginOccurrences.length !== policy.requiredSourceOriginOccurrenceCount) {
    result.issues.push("Frozen required inventory count differs from its policy");
  }
  if (!result.issues.length) result.status = "preserved";
  return result;
}

export const originKey = (origin: Pick<SourceNoteOrigin, "id" | "occurrence">) => JSON.stringify([origin.id, origin.occurrence ?? null]);
