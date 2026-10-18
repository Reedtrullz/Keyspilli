import { readFileSync } from "node:fs";
import { resolveAccompaniment } from "../../../packages/player-core/src/accompaniment.ts";
import { melodyOnly, splitPianoRoles } from "../../../packages/midi/src/index.ts";

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

const windowNotes = (notes: readonly any[], start: number, end: number) =>
  notes.filter((note) => note.start >= start && note.start < end);

for (const [baseId, category, start, end] of pilots) {
  const data = JSON.parse(readFileSync(`${DATA_ROOT}/artifacts/${baseId}/a/notes.json`, "utf8"));
  const notes = data.notes ?? [];
  const chords = data.chords ?? [];
  const durationBeats = Math.max(0, ...notes.map((note: any) => note.start + note.dur));
  const split = splitPianoRoles(notes);
  const greedy = melodyOnly(notes, 0.25, 0.125, 0);
  const baseline = resolveAccompaniment(notes, chords, "melody-accompaniment", { durationBeats });
  const candidate = windowNotes(split.melody, start, end).slice(0, 5).map((note: any) => [
    note.midi,
    Number(note.start.toFixed(3)),
    Number(note.dur.toFixed(3)),
    note.hand ?? null,
  ]);
  const greedyCandidate = windowNotes(greedy, start, end).slice(0, 5).map((note: any) => [
    note.midi,
    Number(note.start.toFixed(3)),
    Number(note.dur.toFixed(3)),
    note.hand ?? null,
  ]);
  console.log(JSON.stringify({
    baseId,
    category,
    excerpt: [start, end],
    sourceNotes: windowNotes(notes, start, end).length,
    baselineCandidateNotes: candidate,
    melodyOnlyCandidateNotes: greedyCandidate,
    splitMelodyCount: split.melody.length,
    melodyOnlyCount: greedy.length,
    baselineGeneratedChords: baseline.chords.filter((chord) => chord.sourceKind === "generated").length,
    baselineFallbackSpans: baseline.fallbackSpans.length,
    baselineFallbackReasons: [...new Set(baseline.fallbackSpans.map((span) => span.reason))],
  }));
}
