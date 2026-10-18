/** Admission only. These bounds do not alter inference or normalize source evidence. */
import { harmonySegments } from "@keyspilli/midi";
import { arithmeticMeasures, validatePlaybackData, type SongData } from "@keyspilli/player-core";
import type { HarmonyPilotCase, HarmonyReferenceSpan } from "./harmony-pilot-evaluation";

export const HARMONY_PILOT_LIMITS = {
  bytes: 8 * 1024 * 1024, cases: 64, notes: 4096, totalNotes: 16384,
  beats: 1024, measures: 256, contextNotes: 256, referenceSpans: 1024,
  boundaryNoteWork: 16_000_000,
} as const;
type PilotSource = Pick<SongData, "notes" | "measures" | "key" | "timeSig" | "tempoBpm">;
const EPS = 1e-7;
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 128): asserts value is string {
  // eslint-disable-next-line no-control-regex -- control characters are matched on purpose, to strip or reject them in untrusted text
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} must be a bounded nonempty string`);
}
function duration(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > HARMONY_PILOT_LIMITS.beats) throw new Error(`duration outside pilot bounds (0, ${HARMONY_PILOT_LIMITS.beats}] beats`);
}
export function validateHarmonyPilotNotes(value: unknown, endBeat: number, maxNotes: number = HARMONY_PILOT_LIMITS.notes): asserts value is SongData["notes"] {
  if (!Array.isArray(value) || value.length > maxNotes) throw new Error(`notes must be an array bounded to ${maxNotes} events`);
  for (const [index, raw] of value.entries()) {
    const note = object(raw, `notes[${index}]`);
    for (const field of ["midi", "vel"] as const) {
      if (typeof note[field] !== "number" || !Number.isInteger(note[field]) || note[field] < 0 || note[field] > 127) throw new Error(`notes[${index}].${field} must be an integer from 0 to 127`);
    }
    if (typeof note.start !== "number" || !Number.isFinite(note.start) || note.start < 0 || typeof note.dur !== "number" || !Number.isFinite(note.dur)
      || note.dur <= 0 || note.start + note.dur > endBeat + EPS) throw new Error(`notes[${index}] timing must fit the complete measure extent`);
    if (note.hand !== undefined && note.hand !== "L" && note.hand !== "R") throw new Error(`notes[${index}].hand must be L or R`);
    if (note.identitySource !== undefined && !["vocals", "guitar", "other"].includes(note.identitySource as string)) throw new Error(`notes[${index}].identitySource is invalid`);
    if (note.lyrics !== undefined && (typeof note.lyrics !== "string" || note.lyrics.length > 4096)) throw new Error(`notes[${index}].lyrics must be bounded text`);
  }
}
export function validateHarmonyPilotReference(value: unknown, durationBeats: number): asserts value is HarmonyReferenceSpan[] {
  duration(durationBeats);
  if (!Array.isArray(value) || !value.length || value.length > HARMONY_PILOT_LIMITS.referenceSpans) throw new Error("Reference must be a bounded full-duration partition");
  let end = 0;
  for (const raw of value) {
    const span = object(raw, "Reference span") as unknown as HarmonyReferenceSpan;
    if (typeof span.startBeat !== "number" || typeof span.endBeat !== "number" || !Number.isFinite(span.startBeat) || !Number.isFinite(span.endBeat)
      || span.startBeat < 0 || span.endBeat <= span.startBeat || Math.abs(span.startBeat - end) > EPS || span.endBeat > durationBeats + EPS
      || !["supported", "unknown", "rest"].includes(span.kind) || !Array.isArray(span.allowedPitchClasses) || span.allowedPitchClasses.length > 12
      || new Set(span.allowedPitchClasses).size !== span.allowedPitchClasses.length
      || span.allowedPitchClasses.some(pc => !Number.isInteger(pc) || pc < 0 || pc > 11)
      || (span.kind === "supported" ? !span.allowedPitchClasses.length || span.bassPc === undefined || !span.allowedPitchClasses.includes(span.bassPc)
        : span.allowedPitchClasses.length !== 0 || span.bassPc !== undefined)) throw new Error("Reference must partition the full duration with valid supported, unknown or rest spans");
    end = span.endBeat;
  }
  if (Math.abs(end - durationBeats) > EPS) throw new Error("Reference must partition the full duration");
}
export function validateHarmonyPilotSource(value: unknown): asserts value is PilotSource {
  const source = object(value, "Source");
  text(source.key, "key", 32);
  if (typeof source.tempoBpm !== "number" || !Number.isFinite(source.tempoBpm) || source.tempoBpm < 20 || source.tempoBpm > 400) throw new Error("tempoBpm clock must be a number from 20 to 400");
  if (!Array.isArray(source.timeSig) || source.timeSig.length !== 2 || !Number.isInteger(source.timeSig[0]) || source.timeSig[0] < 1 || source.timeSig[0] > 32
    || ![1, 2, 4, 8, 16, 32].includes(source.timeSig[1])) throw new Error("timeSig must declare a supported meter");
  if (!Array.isArray(source.measures) || !source.measures.length || source.measures.length > HARMONY_PILOT_LIMITS.measures) throw new Error(`measures must be a nonempty array bounded to ${HARMONY_PILOT_LIMITS.measures}`);
  let endBeat = 0;
  for (const [index, raw] of source.measures.entries()) {
    const measure = object(raw, `measures[${index}]`);
    if (measure.index !== index || typeof measure.startBeat !== "number" || typeof measure.endBeat !== "number"
      || !Number.isFinite(measure.startBeat) || !Number.isFinite(measure.endBeat) || measure.startBeat < 0 || measure.endBeat <= measure.startBeat
      || Math.abs(measure.startBeat - endBeat) > EPS) throw new Error("measures must be indexed, ordered and contiguous from beat zero");
    endBeat = measure.endBeat;
  }
  duration(endBeat);
  validateHarmonyPilotNotes(source.notes, endBeat);
  const typed = source as unknown as PilotSource;
  const errors = validatePlaybackData(typed);
  if (errors.length) throw new Error(`Invalid source playback data: ${errors.join("; ")}`);
  const windows = harmonySegments(typed.measures, "half-bar");
  if (windows.some(window => typed.notes.filter(note => note.start < window.endBeat && note.start + note.dur > window.startBeat).length > HARMONY_PILOT_LIMITS.contextNotes)) {
    throw new Error(`Pilot work bound: at most ${HARMONY_PILOT_LIMITS.contextNotes} notes may overlap a harmony context window`);
  }
  const boundaries = new Set(windows.flatMap(window => [window.startBeat, window.endBeat]));
  for (const note of typed.notes) { boundaries.add(note.start); boundaries.add(note.start + note.dur); }
  if (boundaries.size * typed.notes.length > HARMONY_PILOT_LIMITS.boundaryNoteWork) throw new Error("Pilot boundary-by-note work exceeds the bounded evaluation envelope");
}
export function validateHarmonyPilotCase(value: unknown): asserts value is HarmonyPilotCase {
  const item = object(value, "Corpus case");
  for (const field of ["id", "compositionId", "category", "key"] as const) text(item[field], field, field === "key" ? 32 : 128);
  if (!["development", "holdout"].includes(item.split as string)) throw new Error("Corpus case requires an explicit development or holdout split");
  duration(item.durationBeats);
  // Validate annotations before inference or inspecting potentially expensive notes.
  validateHarmonyPilotReference(item.reference, item.durationBeats);
  const measures = arithmeticMeasures(item.durationBeats, [4, 4]).map(measure => ({ ...measure, endBeat: Math.min(measure.endBeat, item.durationBeats as number) }));
  validateHarmonyPilotSource({ notes: item.notes, measures, key: item.key, timeSig: [4, 4], tempoBpm: 60 });
}
export function validateHarmonyPilotCorpus(value: unknown): asserts value is { schemaVersion: 1; corpusId: string; cases: HarmonyPilotCase[] } {
  const corpus = object(value, "Pilot corpus");
  text(corpus.corpusId, "corpusId");
  if (corpus.schemaVersion !== 1 || !Array.isArray(corpus.cases) || !corpus.cases.length || corpus.cases.length > HARMONY_PILOT_LIMITS.cases) throw new Error(`Pilot corpus requires 1 to ${HARMONY_PILOT_LIMITS.cases} bounded cases`);
  const ids = new Set<string>(), compositions = new Set<string>();
  let notes = 0;
  for (const item of corpus.cases) {
    validateHarmonyPilotCase(item);
    if (ids.has(item.id) || compositions.has(item.compositionId)) throw new Error("Corpus cases require unique string IDs and composition identities across splits");
    ids.add(item.id); compositions.add(item.compositionId); notes += item.notes.length;
    if (notes > HARMONY_PILOT_LIMITS.totalNotes) throw new Error("Corpus total note count exceeds pilot bounds");
  }
}
