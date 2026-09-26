/** Compare the Player's realized Chords backing with the owner-accepted corpus. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { artifactsDir, getSong, ROOT } from "@keyspilli/catalog";
import { loadSongArtifact, withChordSources } from "../src/lib/catalog-api";
import { replayChordsBacking } from "../src/components/player/chords-backing";

const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const corpus = JSON.parse(readFileSync(resolve(ROOT, "catalog/chord-golden-corpus.json"), "utf8")) as {
  entries: Array<{ baseId: string; level: string; sourceId: string; advancedNotesSha256: string; timelineSha256: string; acceptedBackingSha256?: string; acceptedEndBeatExclusive?: number }>;
};
const sources = JSON.parse(readFileSync(resolve(ROOT, "catalog/chord-sources.json"), "utf8")) as {
  entries: Array<{ baseId: string; sources: Array<{ id: string; artifactPath?: string }> }>;
};
let drift = 0;
for (const entry of corpus.entries) {
  const source = sources.entries.find((item) => item.baseId === entry.baseId)?.sources.find((item) => item.id === entry.sourceId);
  if (!source?.artifactPath) throw new Error(`${entry.baseId}: source map does not resolve ${entry.sourceId}`);
  if (hash(readFileSync(resolve(ROOT, source.artifactPath))) !== entry.timelineSha256) throw new Error(`${entry.baseId}: timeline hash changed`);
  if (hash(readFileSync(resolve(artifactsDir(entry.baseId, entry.level), "notes.json"))) !== entry.advancedNotesSha256) {
    throw new Error(`${entry.baseId}: Advanced notes hash changed`);
  }
  const song = getSong(`${entry.baseId}-${entry.level}`);
  if (!song) throw new Error(`${entry.baseId}: catalog row missing`);
  const loaded = await loadSongArtifact(song);
  if (!loaded.data) throw new Error(`${entry.baseId}: Advanced artifact missing`);
  const data = await withChordSources(loaded.data, entry.baseId, entry.level);
  const replay = replayChordsBacking(data);
  if (replay.selected.source?.id !== "ug" || replay.selected.fallback) throw new Error(`${entry.baseId}: authored chart was not selected`);
  const end = entry.acceptedEndBeatExclusive;
  if (end !== undefined && (!Number.isFinite(end) || end <= 0 || end > replay.arrangementEnd)) {
    throw new Error(`${entry.baseId}: invalid acceptedEndBeatExclusive`);
  }
  const acceptedNotes = end === undefined ? [] : replay.resolution.notes.filter((note) => note.start < end);
  const acceptedChords = end === undefined ? replay.resolution.chords : replay.resolution.chords.filter((chord) => chord.beat < end);
  const payload = end === undefined
    ? [1, entry.baseId, entry.sourceId, data.sourceFingerprint ?? null,
      acceptedChords.map((chord) => [chord.beat, chord.durationBeats ?? null, chord.name, chord.notes, chord.suggestedHands])]
    : [2, entry.baseId, entry.sourceId, data.sourceFingerprint ?? null, end,
      acceptedNotes.map((note) => [note.start, Math.min(note.dur, end - note.start), note.midi, note.vel, note.hand ?? null, note.sourceLane ?? null]),
      acceptedChords.map((chord) => [chord.beat, chord.durationBeats == null ? null : Math.min(chord.durationBeats, end - chord.beat), chord.name, chord.notes, chord.suggestedHands])];
  const actual = hash(JSON.stringify(payload));
  const status = !entry.acceptedBackingSha256 ? "UNPINNED" : actual === entry.acceptedBackingSha256 ? "MATCH" : "DRIFT";
  if (status !== "MATCH") drift++;
  console.log(JSON.stringify({ baseId: entry.baseId, status, accepted: entry.acceptedBackingSha256 ?? null, actual,
    strikes: acceptedChords.length,
    ...(end === undefined ? {} : { notes: acceptedNotes.length, acceptedEndBeatExclusive: end }) }));
}
if (process.argv.includes("--require-match") && drift) process.exitCode = 1;
