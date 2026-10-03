import { readFileSync } from "node:fs";
import { replayChordsBacking } from "../src/components/player/chords-backing";
import { filterAccompanimentChords, resolveTimedNotes, type SongData } from "@keyspilli/player-core";

const bundlePath = process.argv[2];
if (!bundlePath) throw new Error("Pass the capture fixture bundle path");
const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as {
  fixtures: Array<{ id: string; data: SongData }>;
  captures: Record<string, { clipId: string; songId: string; mode: "original" | "chords" }>;
};
const fixtures = new Map(bundle.fixtures.map(fixture => [fixture.id, fixture.data]));
const captures = Object.fromEntries(Object.entries(bundle.captures).map(([label, capture]) => {
  const fixtureId = capture.songId.replace(/-[ma]$/, "");
  const source = fixtures.get(fixtureId);
  if (!source) throw new Error(`Missing fixture ${fixtureId} for ${label}`);
  const renderedNotes = capture.mode === "original"
    ? resolveTimedNotes(source, 1, 0)
    : resolveTimedNotes({ ...source, notes: replayChordsBacking(source).resolution.notes }, 1, 0);
  const renderedChords = capture.mode === "chords"
    ? filterAccompanimentChords(replayChordsBacking(source).resolution.chords, "both")
    : [];
  const voice = renderedNotes.filter(note => note.hand !== "L").map(note => Number(note.startSec.toFixed(4)));
  const backing = renderedNotes.filter(note => note.hand === "L").map(note => Number(note.startSec.toFixed(4)))
    .concat(renderedChords.map(chord => Number((chord.beat * 0.5).toFixed(4))));
  const expectedAttackSeconds = [...new Set([...voice, ...backing].map(seconds => Number(seconds.toFixed(3))))].sort((a, b) => a - b);
  return [label, { ...capture, expectedAttackSeconds, expectedAttackSecondsByBus: { voice, backing }, renderedEventAudit: {
    resolver: capture.mode === "chords" ? "Player bassChordsBackground + filterAccompanimentChords + resolveTimedNotes" : "Player resolveTimedNotes on Original source notes",
    notes: renderedNotes.map(note => ({ midi: note.midi, startSeconds: Number(note.startSec.toFixed(4)), durationSeconds: Number(note.durSec.toFixed(4)), hand: note.hand ?? null, bus: note.hand === "L" ? "backing" : "voice" })),
    chordEvents: renderedChords.map(chord => ({ startSeconds: Number((chord.beat * 0.5).toFixed(4)), durationBeats: chord.durationBeats, name: chord.name, midiNotes: chord.notes })),
  } }];
}));
process.stdout.write(JSON.stringify({ captures }));
