import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseMidi } from "../../../../packages/midi/src/parse.ts";
import { buildVariants } from "../../../../packages/midi/src/simplify.ts";
import { writeMidi } from "../../../../packages/midi/src/writeMidi.ts";
import type { Note } from "../../../../packages/midi/src/types.ts";
import type { SongData } from "../../../../packages/player-core/src/types.ts";
import {
  normalizeImporterTiming,
  rawTrackMetadata,
  tagParsedSourceNotes,
  type RawTrackNote,
} from "./source-candidate-comparison.ts";

const dataRoot = process.env.KEYSPILLI_CANONICAL_DATA_ROOT ?? "/Users/reidar/Projectos/Keyspilli/data";
const outRoot = process.env.KEYSPILLI_SOURCE_CANDIDATE_RENDER_DIR;
if (!outRoot) throw new Error("KEYSPILLI_SOURCE_CANDIDATE_RENDER_DIR is required");

const baseId = "queen-somebody-to-love";
const title = "Somebody To Love";
const artist = "Queen";
const tempoBpm = 108;
const notesPath = join(dataRoot, "artifacts", baseId, "a", "notes.json");
const midiPath = join(dataRoot, "seed-midi", `${baseId}.mid`);
const canonical = JSON.parse(readFileSync(notesPath, "utf8")) as SongData;
const midiBytes = readFileSync(midiPath);
const parsed = parseMidi(midiBytes);
const tracks = rawTrackMetadata(midiBytes, parsed.division);
const cantoMeta = tracks.find((track) => {
  const texts = Array.isArray(track.texts) ? track.texts as Array<{ text?: string }> : [];
  return texts.some((event) => event.text === "-CANTO-");
});
if (!cantoMeta) throw new Error("Queen raw MIDI has no -CANTO- track");
const channelKeys = cantoMeta.channelNotes && typeof cantoMeta.channelNotes === "object"
  ? Object.keys(cantoMeta.channelNotes as Record<string, unknown>).map(Number).filter(Number.isInteger)
  : [];
const channel = channelKeys[0];
if (channel === undefined) throw new Error("Queen -CANTO- track has no note channel");
const withNotes = rawTrackMetadata(midiBytes, parsed.division, [{ trackIndex: Number(cantoMeta.trackIndex), channel }]);
const cantoTrack = withNotes.find((track) => Number(track.trackIndex) === Number(cantoMeta.trackIndex));
const cantoNotes = Array.isArray(cantoTrack?.notes) ? cantoTrack.notes as RawTrackNote[] : [];
if (cantoNotes.length !== 278) throw new Error(`expected 278 CANTO notes, got ${cantoNotes.length}`);

const replay = buildVariants(parsed, { title, artist }, {
  arrangementProfile: "learner",
  audioDerived: false,
  maxDurBeats: null,
}).find((variant) => variant.level === "advanced")?.notes;
if (!replay) throw new Error("current importer replay has no Advanced variant");

const tagged = tagParsedSourceNotes(parsed, cantoNotes);
if (tagged.matched !== cantoNotes.length || tagged.ambiguous !== 0) {
  throw new Error(`CANTO tagging failed: matched=${tagged.matched} ambiguous=${tagged.ambiguous}`);
}
const candidate = buildVariants(tagged.parsed, { title, artist }, {
  arrangementProfile: "learner",
  audioDerived: false,
  maxDurBeats: null,
  protectedIdentitySources: ["vocals"],
}).find((variant) => variant.level === "advanced")?.notes;
if (!candidate) throw new Error("protected candidate has no Advanced variant");

const durationBeats = Math.max(0, ...canonical.notes.map((note) => note.start + note.dur));
const diagnosticWindow = { start: 18, end: 30 };
const trim = (notes: readonly Note[]): Note[] => notes.flatMap((note) => {
  const start = Math.max(diagnosticWindow.start, note.start);
  const end = Math.min(diagnosticWindow.end, note.start + note.dur);
  return end > start ? [{ ...note, start: start - diagnosticWindow.start, dur: end - start }] : [];
});
const renders = {
  original: canonical.notes,
  replay: replay,
  candidate: candidate,
} as const;

mkdirSync(outRoot, { recursive: true });
const midiOptions = {
  tempoBpm,
  timeSig: canonical.timeSig,
  timeSigEvents: canonical.timeSigEvents,
  title,
};
const files: Record<string, string> = {};
for (const [label, notes] of Object.entries(renders)) {
  const fullName = `${label}-full.mid`;
  const diagnosticName = `${label}-diagnostic-18-30-beats.mid`;
  writeFileSync(join(outRoot, fullName), writeMidi([...notes], midiOptions));
  writeFileSync(join(outRoot, diagnosticName), writeMidi(trim(notes), { ...midiOptions, title: `${title} — ${label} diagnostic 18-30 beats` }));
  files[`${label}FullMidi`] = fullName;
  files[`${label}DiagnosticMidi`] = diagnosticName;
}
const sha256File = (name: string): string => createHash("sha256").update(readFileSync(join(outRoot, name))).digest("hex");
const manifest = {
  schemaVersion: 1,
  title,
  artist,
  tempoBpm,
  durationBeats,
  diagnosticWindowBeats: diagnosticWindow,
  source: {
    canonicalNotesSha256: createHash("sha256").update(readFileSync(notesPath)).digest("hex"),
    rawMidiSha256: createHash("sha256").update(midiBytes).digest("hex"),
    rawCantoTrackIndex: Number(cantoMeta.trackIndex),
    rawCantoChannel: channel,
    rawCantoNotes: cantoNotes.length,
  },
  noteCounts: { original: canonical.notes.length, replay: replay.length, candidate: candidate.length },
  files,
  fileSha256: Object.fromEntries(Object.values(files).map((name) => [name, sha256File(name)])),
  notes: {
    replay: "The current parseMidi -> learner buildVariants Advanced result.",
    candidate: "The disposable learner result with only the raw CANTO tuples tagged as vocals; hand, duration, span, and playability guards remain active.",
  },
  nonClaims: [
    "These are same-SoundFont symbolic renders for listening review, not audio-hash acceptance.",
    "The protected candidate is not catalog data, semantic approval, or a deployment artifact.",
  ],
};
writeFileSync(join(outRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
