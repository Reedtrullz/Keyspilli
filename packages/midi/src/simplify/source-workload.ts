import { writeNotationMeasures } from "../notation-measures.js";
import { Note, ParsedMidi, Variant, MidiTimeSignatureEvent } from "../types.js";
import { maxNoteEnd } from "./shared.js";

const MAX_SOURCE_TIME_SIG_EVENTS = 4096;
const MAX_SOURCE_BEATS = 4096;
const MAX_SOURCE_MEASURES = 2048;

export function normalizeTimeSigEvents(events: readonly MidiTimeSignatureEvent[] | undefined): MidiTimeSignatureEvent[] {
  if (!events?.length) return [];
  if (events.length > MAX_SOURCE_TIME_SIG_EVENTS) {
    throw new Error(`source workload exceeds supported limits (${MAX_SOURCE_TIME_SIG_EVENTS} time-signature events)`);
  }
  const sorted = [...events].sort((a, b) => a.beat - b.beat || a.tick - b.tick || a.timeSig[0] - b.timeSig[0] || a.timeSig[1] - b.timeSig[1]);
  const normalized: MidiTimeSignatureEvent[] = [];
  const signatureByTick = new Map<number, [number, number]>();
  const signatureByBeat = new Map<number, [number, number]>();
  for (const event of sorted) {
    const [numerator, denominator] = event.timeSig;
    if (!Number.isInteger(event.tick) || event.tick < 0 || !Number.isFinite(event.beat) || event.beat < 0
      || event.beat > MAX_SOURCE_BEATS || !Number.isInteger(numerator) || numerator <= 0
      || !Number.isInteger(denominator) || denominator <= 0) {
      throw new Error("source workload contains an invalid time-signature event");
    }
    const tickSignature = signatureByTick.get(event.tick);
    const beatSignature = signatureByBeat.get(event.beat);
    if ((tickSignature && (tickSignature[0] !== numerator || tickSignature[1] !== denominator))
      || (beatSignature && (beatSignature[0] !== numerator || beatSignature[1] !== denominator))) {
      throw new Error("source workload contains contradictory time-signature events at one boundary");
    }
    signatureByTick.set(event.tick, [numerator, denominator]);
    signatureByBeat.set(event.beat, [numerator, denominator]);
    const previous = normalized.at(-1);
    if (previous && (previous.tick === event.tick || Math.abs(previous.beat - event.beat) <= 1e-9)) {
      if (previous.timeSig[0] !== numerator || previous.timeSig[1] !== denominator) {
        throw new Error("source workload contains contradictory time-signature events at one boundary");
      }
      continue;
    }
    if (previous && previous.timeSig[0] === numerator && previous.timeSig[1] === denominator) continue;
    normalized.push({ tick: event.tick, beat: event.beat, timeSig: [numerator, denominator] });
  }
  return normalized;
}

function initialTimeSig(timeSig: [number, number], events: readonly MidiTimeSignatureEvent[]): [number, number] {
  const atZero = events.find((event) => event.beat === 0);
  if (atZero) return [...atZero.timeSig] as [number, number];
  return events.length ? [4, 4] : [...timeSig] as [number, number];
}

/** Bound synchronous work for every importer, including sparse malicious timelines. */
export function assertSourceWorkload(src: ParsedMidi, grid = 0.25): void {
  const fail = () => { throw new Error("source workload exceeds supported limits (20000 notes, 4096 beats, 2048 measures, 200M grid-note pairs)"); };
  if (!Number.isFinite(grid) || grid < 1 / 16 || grid > 4
    || !Number.isFinite(src.durationBeats) || src.durationBeats < 0
    || src.notes.length > 20_000
    || (src.tempoEvents?.length ?? 0) > 20_000
    || src.notes.length * (src.tempoEvents?.length ?? 0) > 40_000_000) fail();
  let end = src.durationBeats;
  if (src.notationMeasures !== undefined) {
    if (!Array.isArray(src.notationMeasures)) fail();
    writeNotationMeasures(src.notationMeasures);
    end = Math.max(end, src.notationMeasures.at(-1)?.endBeat ?? 0);
  }
  for (const note of src.notes) {
    if (!Number.isFinite(note.start) || !Number.isFinite(note.dur) || note.start < 0 || note.dur < 0) fail();
    end = Math.max(end, note.start + note.dur);
  }
  const timeSigEvents = normalizeTimeSigEvents(src.timeSigEvents);
  const effectiveInitialTimeSig = initialTimeSig(src.timeSig, timeSigEvents);
  const measureBeats = effectiveInitialTimeSig[0] * 4 / effectiveInitialTimeSig[1];
  // ponytail: conservative work estimate for the synchronous arranger; move to a
  // cancellable worker before raising this ceiling for very large scores.
  if (!Number.isInteger(effectiveInitialTimeSig[0]) || effectiveInitialTimeSig[0] <= 0
    || !Number.isInteger(effectiveInitialTimeSig[1]) || effectiveInitialTimeSig[1] <= 0
    || !Number.isFinite(measureBeats) || measureBeats <= 0 || end > MAX_SOURCE_BEATS
    || Math.ceil(end / measureBeats) > MAX_SOURCE_MEASURES
    || Math.ceil(end / grid) * src.notes.length > 200_000_000) fail();
  const boundedEvents = timeSigEvents.filter((event) => event.beat <= end + 1e-9);
  const timeline = boundedEvents.length
    ? [...(boundedEvents[0]!.beat > 0 ? [{ beat: 0, timeSig: [4, 4] as [number, number] }] : []), ...boundedEvents]
    : [{ beat: 0, timeSig: effectiveInitialTimeSig }];
  let measureWork = 0;
  for (let index = 0; index < timeline.length; index += 1) {
    const event = timeline[index]!;
    const nextBeat = Math.min(timeline[index + 1]?.beat ?? end, end);
    const width = event.timeSig[0] * (4 / event.timeSig[1]);
    if (!Number.isFinite(width) || width <= 0) fail();
    if (nextBeat > event.beat) measureWork += Math.ceil((nextBeat - event.beat) / width);
    if (measureWork > MAX_SOURCE_MEASURES) fail();
  }
}

/** Preserve an explicit, complete map without inferring source phase from it.
 * Incomplete multipart maps retain the existing arithmetic fallback. */
export function sourceMeasures(source: ParsedMidi, notes: Note[], events: readonly MidiTimeSignatureEvent[]): Variant["measures"] {
  const measures = source.notationMeasures;
  if (measures?.length && measures.at(-1)!.endBeat >= Math.max(source.durationBeats, maxNoteEnd(notes)) - 1e-6) {
    return measures.map(measure => ({ ...measure }));
  }
  return buildMeasures(notes, source.timeSig, source.durationBeats, events);
}

function buildMeasures(
  notes: Note[],
  timeSig: [number, number],
  arrangementEnd = 0,
  timeSigEvents: readonly MidiTimeSignatureEvent[] = [],
): Variant["measures"] {
  const [num, den] = timeSig;
  const dur = Math.max(arrangementEnd, maxNoteEnd(notes), 1);
  const validEvents = timeSigEvents.filter((event) => event.beat <= dur + 1e-9);
  const dedupedEvents = validEvents.filter((event, index, events) => index === 0 || event.beat > events[index - 1]!.beat);
  const timeline = dedupedEvents.length
    ? [
        ...(dedupedEvents[0]!.beat > 0 ? [{ beat: 0, timeSig: [4, 4] as [number, number], tick: 0 }] : []),
        ...dedupedEvents,
      ]
    : [{ beat: 0, timeSig: initialTimeSig(timeSig, timeSigEvents), tick: 0 }];
  const measures: Variant["measures"] = [];
  for (let index = 0; index < timeline.length; index += 1) {
    const event = timeline[index]!;
    const next = timeline[index + 1];
    const rawBeatsPerMeasure = event.timeSig[0] * (4 / event.timeSig[1]);
    const beatsPerMeasure = Number.isFinite(rawBeatsPerMeasure) && rawBeatsPerMeasure > 0 ? rawBeatsPerMeasure : 4;
    const segmentEnd = next?.beat ?? dur;
    let startBeat = event.beat;
    while (startBeat < segmentEnd - 1e-9 || (!next && measures.length === 0)) {
      const endBeat = next ? Math.min(startBeat + beatsPerMeasure, segmentEnd) : startBeat + beatsPerMeasure;
      if (measures.length >= MAX_SOURCE_MEASURES) throw new Error("source workload exceeds supported limits (2048 measures)");
      measures.push({ index: measures.length, startBeat, endBeat });
      startBeat = endBeat;
    }
  }
  return measures.length ? measures : [{ index: 0, startBeat: 0, endBeat: 4 }];
}
