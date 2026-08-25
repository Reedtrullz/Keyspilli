import { keySignature } from "./analyze.js";
import { parseMidi } from "./parse.js";
import { parseMusicXmlNotes } from "./parseXml.js";
import { writeMidi } from "./writeMidi.js";
import { writeMusicXml } from "./writeXml.js";
import { Note, Variant } from "./types.js";

export interface VariantArtifacts {
  midi: Uint8Array;
  xml: string;
}

const ROUNDTRIP_TOLERANCE = 0.01;
// MIDI stores tempo as integer microseconds per quarter note, so parsing a
// perfectly valid integer BPM can differ by a few ten-thousandths. This is
// intentionally much tighter than a human-visible stale tempo edit while
// still accepting the format's lossless-in-practice quantization.
export const ARTIFACT_TEMPO_TOLERANCE = 0.01;

function noteShape(notes: Note[]): { midi: number; start: number; dur: number }[] {
  return notes
    .map((n) => ({ midi: n.midi, start: n.start, dur: n.dur }))
    .sort((a, b) => a.midi - b.midi || a.start - b.start || a.dur - b.dur);
}

function compareNotes(expected: ReturnType<typeof noteShape>, actual: Note[], label: string): string[] {
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

/** Render a generated variant exactly as ingest does. */
export function writeVariantArtifacts(variant: Variant, title: string, artist: string): VariantArtifacts {
  const sig = keySignature(variant.key);
  const midi = writeMidi(variant.notes, {
    tempoBpm: variant.tempoBpm,
    timeSig: variant.timeSig,
    keySig: sig.fifths,
    keyMode: sig.mode,
    title: `${title} (${variant.level})`,
    tracks: [
      { name: "Right Hand", notes: variant.notes.filter((n) => n.hand !== "L") },
      { name: "Left Hand", notes: variant.notes.filter((n) => n.hand === "L") },
    ],
  });
  return { midi, xml: writeMusicXml(variant, title, artist) };
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

/** Validate already-rendered bytes/markup (used by catalog verification). */
export function validateArtifactFiles(variant: Variant, artifacts: VariantArtifacts): string[] {
  const issues: string[] = [];
  // The canonical notes are compared against both renderings. Normalize that
  // shared side once instead of sorting the same source array twice for large
  // arrangements.
  const expectedNotes = noteShape(variant.notes);
  try {
    const parsedMidi = parseMidi(artifacts.midi);
    issues.push(...compareTempo(variant.tempoBpm, parsedMidi.tempoBpm, parsedMidi.tempoMetaPresent === true, "midi roundtrip"));
    issues.push(...compareNotes(expectedNotes, parsedMidi.notes, "midi roundtrip"));
  } catch (e) {
    issues.push(`midi roundtrip parse failed: ${(e as Error).message}`);
  }
  try {
    const parsedXml = parseMusicXmlNotes(artifacts.xml);
    issues.push(...compareTempo(variant.tempoBpm, parsedXml.tempoBpm, parsedXml.tempoMetaPresent === true, "xml roundtrip"));
    issues.push(...compareNotes(expectedNotes, parsedXml.notes, "xml roundtrip"));
  } catch (e) {
    issues.push(`xml roundtrip parse failed: ${(e as Error).message}`);
  }
  return issues;
}
