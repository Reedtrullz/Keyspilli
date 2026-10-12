import {sourcePedalErrors} from "./source-pedal.js";
import { keySignature } from "./analyze.js";
import { parseMidi } from "./parse.js";
import { parseMusicXmlNotes } from "./parseXml.js";
import { writeMidi } from "./writeMidi.js";
import { writeMusicXml } from "./writeXml.js";
import { Note, Variant } from "./types.js";

export interface VariantArtifacts {
  midi: Uint8Array;
  xml: string;
  /** Format capabilities, not a musical approval or a claim that checks ran. */
  fidelity: typeof CURRENT_ARTIFACT_FIDELITY;
}

export const LEGACY_ARTIFACT_FIDELITY = {
  schemaVersion: 1, validationScope: "symbolic-events", expressivePreservation: "not-established",
  midi: { noteVelocities: "encoded" }, musicxml: { noteVelocities: "omitted", dynamics: "omitted" },
} as const;

export const CURRENT_ARTIFACT_FIDELITY = {
  schemaVersion: 2, validationScope: "symbolic-events-and-attack-velocities", expressivePreservation: "not-established",
  midi: { noteVelocities: "encoded" }, musicxml: { noteVelocities: "encoded", dynamics: "omitted" },
} as const;

/** Historical reads explicitly adopt v1 when the diagnostic record is absent.
 * Present malformed, null, or future records are retained for refusal. */
export function artifactFidelityForRead(value: unknown): unknown {
  return value === undefined ? LEGACY_ARTIFACT_FIDELITY : value;
}

function exactRecord(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return actual === expected;
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
  const record = actual as Record<string, unknown>;
  const wanted = expected as Record<string, unknown>;
  return Object.keys(record).length === Object.keys(wanted).length
    && Object.entries(wanted).every(([key, value]) => Object.hasOwn(record, key) && exactRecord(record[key], value));
}

const ROUNDTRIP_TOLERANCE = 0.01;
// MIDI stores tempo as integer microseconds per quarter note, so parsing a
// perfectly valid integer BPM can differ by a few ten-thousandths. This is
// intentionally much tighter than a human-visible stale tempo edit while
// still accepting the format's lossless-in-practice quantization.
export const ARTIFACT_TEMPO_TOLERANCE = 0.01;

function noteShape(notes: Note[]): { midi: number; start: number; dur: number; vel: number }[] {
  return notes
    .map((n) => ({ midi: n.midi, start: n.start, dur: n.dur, vel: n.vel }))
    .sort((a, b) => a.midi - b.midi || a.start - b.start || a.dur - b.dur || a.vel - b.vel);
}

function compareNotes(expected: ReturnType<typeof noteShape>, actual: Note[], label: string, velocities: boolean): string[] {
  const a = expected;
  const b = noteShape(actual);
  const issues: string[] = [];
  if (a.length !== b.length) {
    issues.push(`${label}: note count ${b.length} != source ${a.length}`);
    return issues;
  }
  for (let i = 0; i < a.length; i++) {
    const expected = a[i]!;
    const got = b[i]!;
    if (velocities && expected.vel !== got.vel) issues.push(`${label}: note ${i} velocity ${got.vel} != source ${expected.vel}`);
    if (expected.midi !== got.midi || Math.abs(expected.start - got.start) > ROUNDTRIP_TOLERANCE || Math.abs(expected.dur - got.dur) > ROUNDTRIP_TOLERANCE) {
      issues.push(
        `${label}: note ${i} ${got.midi}@${got.start.toFixed(3)}:${got.dur.toFixed(3)} != ${expected.midi}@${expected.start.toFixed(3)}:${expected.dur.toFixed(3)}`,
      );
      if (issues.length >= 8) {
        issues.push(`${label}: more mismatches omitted`);
        break;
      }
    }
  }
  return issues;
}

function compareTempo(expected: number, actual: number, explicit: boolean, label: string): string[] {
  if (!explicit) return [`${label}: tempo metadata missing`];
  if (!Number.isFinite(expected)) return [`${label}: source tempo ${String(expected)} invalid`];
  if (!Number.isFinite(actual) || Math.abs(expected - actual) > ARTIFACT_TEMPO_TOLERANCE) {
    return [`${label}: tempo ${Number.isFinite(actual) ? actual : String(actual)} != source ${expected}`];
  }
  return [];
}

function expectedTimeSigEvents(variant: Variant): { beat: number; timeSig: [number, number] }[] {
  if (variant.timeSigEvents?.length) {
    return variant.timeSigEvents.map((event) => ({ beat: event.beat, timeSig: [...event.timeSig] as [number, number] }));
  }
  return [{ beat: 0, timeSig: [...variant.timeSig] as [number, number] }];
}

function compareTimeSigEvents(
  expected: { beat: number; timeSig: [number, number] }[],
  actual: { beat: number; timeSig: [number, number] }[] | undefined,
  label: string,
): string[] {
  const got = actual ?? [];
  if (expected.length !== got.length) {
    return [`${label}: time signature event count ${got.length} != source ${expected.length}`];
  }
  for (let i = 0; i < expected.length; i++) {
    const source = expected[i]!;
    const rendered = got[i]!;
    if (source.timeSig[0] !== rendered.timeSig[0]
      || source.timeSig[1] !== rendered.timeSig[1]
      || Math.abs(source.beat - rendered.beat) > ROUNDTRIP_TOLERANCE) {
      return [
        `${label}: time signature ${rendered.timeSig[0]}/${rendered.timeSig[1]}@${rendered.beat.toFixed(3)}`
        + ` != source ${source.timeSig[0]}/${source.timeSig[1]}@${source.beat.toFixed(3)}`,
      ];
    }
  }
  return [];
}

/** Render a generated variant exactly as ingest does. */
export function writeVariantArtifacts(variant: Variant, title: string, artist: string): VariantArtifacts {
  const sig = keySignature(variant.key);
  const midi = writeMidi(variant.notes, {
    sourcePedal:variant.sourcePedal,
    measures: variant.measures,
    tempoBpm: variant.tempoBpm,
    timeSig: variant.timeSig,
    timeSigEvents: variant.timeSigEvents,
    keySig: sig.fifths,
    keyMode: sig.mode,
    title: `${title} (${variant.level})`,
    tracks: [
      { name: "Right Hand", notes: variant.notes.filter((n) => n.hand !== "L") },
      { name: "Left Hand", notes: variant.notes.filter((n) => n.hand === "L") },
    ],
  });
  return {
    midi, xml: writeMusicXml(variant, title, artist),
    fidelity: structuredClone(CURRENT_ARTIFACT_FIDELITY),
  };
}

/**
 * Validate both generated artifacts before they can be published. Every issue
 * is returned to the caller so an import can fail closed with a useful reason.
 */
export function validateArtifactRoundtrip(variant: Variant, title: string, artist: string): string[] {
  let artifacts: VariantArtifacts;
  try {
    artifacts = writeVariantArtifacts(variant, title, artist);
  } catch (e) {
    return [`artifact render failed: ${(e as Error).message}`];
  }
  return validateArtifactFiles(variant, artifacts);
}

/** Validate symbolic pitch/timing/tempo/meter/pedal and v2 attack integers.
 * This does not establish acoustic or expressive equivalence. Fresh exports
 * default to v2; historical callers must explicitly supply their read contract. */
export function validateArtifactFiles(variant: Variant, artifacts: Pick<VariantArtifacts, "midi" | "xml"> & { fidelity?: unknown }): string[] {
  const issues: string[] = [];
  const fidelity = artifacts.fidelity === undefined ? CURRENT_ARTIFACT_FIDELITY : artifacts.fidelity;
  const legacy = exactRecord(fidelity, LEGACY_ARTIFACT_FIDELITY);
  if (!legacy && !exactRecord(fidelity, CURRENT_ARTIFACT_FIDELITY)) issues.push("artifact fidelity record malformed or unsupported");
  if (!legacy && variant.notes.some(n => !Number.isInteger(n.vel) || n.vel < 1 || n.vel > 127)) issues.push("artifact source attack velocity must be an integer between 1 and 127");
  if(variant.sourcePedal){const errors=sourcePedalErrors(variant.notes,variant.sourcePedal);if(errors.length)return errors;}
  // The canonical notes are compared against both renderings. Normalize that
  // shared side once instead of sorting the same source array twice for large
  // arrangements.
  const expectedNotes = noteShape(variant.notes);
  try {
    const parsedMidi = parseMidi(artifacts.midi);
    issues.push(...compareTempo(variant.tempoBpm, parsedMidi.tempoBpm, parsedMidi.tempoMetaPresent === true, "midi roundtrip"));
    issues.push(...compareTimeSigEvents(expectedTimeSigEvents(variant), parsedMidi.timeSigEvents, "midi roundtrip"));
    issues.push(...compareNotes(expectedNotes, parsedMidi.notes, "midi roundtrip", !legacy));
    issues.push(...comparePedal(variant,parsedMidi,"midi roundtrip"));
  } catch (e) {
    issues.push(`midi roundtrip parse failed: ${(e as Error).message}`);
  }
  try {
    const parsedXml = parseMusicXmlNotes(artifacts.xml);
    issues.push(...compareTempo(variant.tempoBpm, parsedXml.tempoBpm, parsedXml.tempoMetaPresent === true, "xml roundtrip"));
    issues.push(...compareTimeSigEvents(expectedTimeSigEvents(variant), parsedXml.timeSigEvents, "xml roundtrip"));
    issues.push(...compareNotes(expectedNotes, parsedXml.notes, "xml roundtrip", !legacy));
    issues.push(...comparePedal(variant,parsedXml,"xml roundtrip"));
  } catch (e) {
    issues.push(`xml roundtrip parse failed: ${(e as Error).message}`);
  }
  return issues;
}

function comparePedal(expected:Variant,actual:Pick<Variant,"notes"|"sourcePedal">,label:string):string[]{
 const a=expected.sourcePedal,b=actual.sourcePedal;if(!a&&!b)return [];if(!a||!b)return [`${label}: source pedal timeline missing or unexpected`];
 if(Math.abs(a.endBeat-b.endBeat)>.01||a.changes.length!==b.changes.length||a.changes.some((e,i)=>{const got=b.changes[i]!;return Math.abs(e.beat-got.beat)>.01||e.channel!==got.channel||e.value!==got.value;}))return [`${label}: source pedal events differ`];
 const shape=(notes:Note[])=>[...notes].sort((a,b)=>a.midi-b.midi||a.sourceMidiChannel!-b.sourceMidiChannel!||a.start-b.start||a.dur-b.dur);
 const left=shape(expected.notes),right=shape(actual.notes);
 return left.length===right.length && left.every((n,i)=>{const got=right[i]!;return n.midi===got.midi&&n.sourceMidiChannel===got.sourceMidiChannel&&Math.abs(n.start-got.start)<=.01&&Math.abs(n.dur-got.dur)<=.01;})?[]:[`${label}: source pedal note channels differ`];
}
