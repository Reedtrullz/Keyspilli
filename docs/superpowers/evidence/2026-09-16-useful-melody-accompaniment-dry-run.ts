import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildMelodyAccompaniment } from "../../../packages/player-core/src/accompaniment.ts";
import { tryParseChordSymbol } from "../../../packages/midi/src/chords.ts";
import type { ChordLabel, Note } from "../../../packages/midi/src/types.ts";

const DATA_ROOT = "/Users/reidar/Projectos/Keyspilli/data";

const pilots = [
  ["the-beatles-blackbird", "standard-midi", 4, 36],
  ["the-beatles-blackbird", "standard-midi", 68, 100],
  ["ed-sheeran-perfect", "standard-midi", 0, 32],
  ["ed-sheeran-perfect", "standard-midi", 32, 64],
  ["massive-attack-teardrop", "standard-midi", 0, 32],
  ["dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo", "standard-midi", 0, 32],
  ["aria-ellys-music-the-warning-hell-you-call-a-dream-piano-cover-by-aria-ellys-mslzwo1d", "youtube-transcribed", 0, 32],
  ["beginner-piano-tutorial-easy-piano-jumbo-songbook-pay-me-my-money-down-mslzx940", "youtube-transcribed", 0, 32],
  ["piano-cover-by-pianella-piano-hozier-too-sweet-mslzwyl8", "youtube-transcribed", 0, 32],
  ["dorelia-bast-sabaton-en-livstid-i-krig-a-lifetime-of-war-piano-cover-mslzy9fm", "youtube-transcribed", 0, 32],
] as const;

const overlap = (start: number, end: number, rangeStart: number, rangeEnd: number) =>
  Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart));

const sourceHash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

for (const [baseId, category, startBeat, endBeat] of pilots) {
  const notesPath = `${DATA_ROOT}/artifacts/${baseId}/a/notes.json`;
  const manifestPath = `${DATA_ROOT}/artifacts/${baseId}/manifest.json`;
  const rawNotes = readFileSync(notesPath, "utf8");
  const data = JSON.parse(rawNotes) as { notes?: Note[]; chords?: ChordLabel[] };
  const notes = data.notes ?? [];
  const chords = data.chords ?? [];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { sourceArtifactHash?: string };
  const durationBeats = Math.max(0, ...notes.map((note) => note.start + note.dur));
  const sourceFingerprint = manifest.sourceArtifactHash
    ? `variant:${baseId}:a:${manifest.sourceArtifactHash}`
    : `legacy:${baseId}:${sourceHash(notesPath)}`;
  const result = buildMelodyAccompaniment(notes, chords, { durationBeats, sourceFingerprint });
  const generatedBeats = result.chords.reduce(
    (sum, chord) => sum + overlap(chord.beat, chord.beat + (chord.durationBeats ?? 0), startBeat, endBeat),
    0,
  );
  const fallbackBeats = result.fallbackSpans.reduce(
    (sum, span) => sum + overlap(span.startBeat, span.endBeat, startBeat, endBeat),
    0,
  );
  const generatedVoicings = result.chords
    .filter((chord) => overlap(chord.beat, chord.beat + (chord.durationBeats ?? 0), startBeat, endBeat) > 0)
    .map((chord) => {
      const activeMelody = result.melody.filter((note) =>
        overlap(note.start, note.start + note.dur, chord.beat, chord.beat + (chord.durationBeats ?? 0)) > 0,
      );
      const lowestMelody = activeMelody.length ? Math.min(...activeMelody.map((note) => note.midi)) : null;
      const span = Math.max(...chord.notes) - Math.min(...chord.notes);
      const collidesWithMelody = lowestMelody !== null && chord.notes.some((midi) => midi >= lowestMelody - 2);
      const parsed = tryParseChordSymbol(chord.name);
      const expectedBassPc = parsed?.bassPc ?? parsed?.rootPc;
      const actualLowestPitchClass = Math.min(...chord.notes) % 12;
      const bassMeaningPreserved = expectedBassPc !== undefined && actualLowestPitchClass === expectedBassPc;
      if (span > 12 || collidesWithMelody || !bassMeaningPreserved) {
        throw new Error(`${baseId} emitted unsafe support at beat ${chord.beat}: span=${span}, collision=${collidesWithMelody}, bass=${actualLowestPitchClass}/${expectedBassPc}`);
      }
      return {
        beat: chord.beat,
        name: chord.name,
        pitches: chord.notes,
        simultaneousSpan: span,
        activeMelodyLowest: lowestMelody,
        collidesWithMelody,
        actualLowestPitchClass,
        expectedBassPc,
        bassMeaningPreserved,
      };
    });
  const melodyNotes = result.melody.filter((note) => note.start >= startBeat && note.start < endBeat).length;
  const unresolvedSpans = result.provenance.unresolvedSpans.filter((span) =>
    overlap(span.startBeat, span.endBeat, startBeat, endBeat) > 0,
  );
  const fallbackReasons = [...new Set(result.fallbackSpans
    .filter((span) => overlap(span.startBeat, span.endBeat, startBeat, endBeat) > 0)
    .map((span) => span.reason))];
  console.log(JSON.stringify({
    baseId,
    category,
    variant: "a",
    excerpt: [startBeat, endBeat],
    sourceFingerprint,
    manifestSourceArtifactHash: manifest.sourceArtifactHash ?? null,
    notesJsonSha256: sourceHash(notesPath),
    sourceNotes: notes.filter((note) => note.start >= startBeat && note.start < endBeat).length,
    selectedMelodyNotes: melodyNotes,
    generatedSupportBeats: Number(generatedBeats.toFixed(3)),
    retainedFallbackBeats: Number(fallbackBeats.toFixed(3)),
    generatedChordEvents: result.chords.filter((chord) =>
      overlap(chord.beat, chord.beat + (chord.durationBeats ?? 0), startBeat, endBeat) > 0,
    ).length,
    generatedVoicings,
    allGeneratedSupportWithinOctave: generatedVoicings.every((voicing) => voicing.simultaneousSpan <= 12),
    allGeneratedSupportAvoidsMelody: generatedVoicings.every((voicing) => !voicing.collidesWithMelody),
    allGeneratedBassMeaningPreserved: generatedVoicings.every((voicing) => voicing.bassMeaningPreserved),
    unresolvedSpans,
    fallbackReasons,
    bothMelodyAndSupport: melodyNotes > 0 && generatedBeats > 0,
    changedPaths: [],
  }));
}
