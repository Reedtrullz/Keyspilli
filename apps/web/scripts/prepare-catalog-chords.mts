/** Private, resumable catalog preparation. Does not mutate source artifacts or a live service.
 * KEYSPILLI_DATA_DIR=/snapshot tsx apps/web/scripts/prepare-catalog-chords.mts INVENTORY_JSON OUTPUT_DIR
 * INVENTORY_JSON is the concatenated live /api/songs?group=1 response's songs arrays.
 * Outputs are agent arrangements, not musical acceptance. Every export round-trips and replays.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { inferHarmonyTimeline, parseMidi, parseMusicXmlNotes, writeMidi, writeMusicXml, type ChordLabel, type Note } from "@keyspilli/midi";
import { parseChordTimeline, type ChordSourceMap, type ChordTimelineArtifact } from "@keyspilli/catalog";
import { PlaybackEngine } from "../../../packages/player-core/src/engine.js";
import { DEFAULT_SETTINGS } from "../../../packages/player-core/src/prefs.js";
import { resolveTimedNotes } from "../../../packages/player-core/src/timeline.js";
import { getSongDetail, projectChordSources } from "../src/lib/catalog-api.js";
import { replayChordsBacking } from "../src/components/player/chords-backing.js";
import { evaluateChordsBacking, snapshotChordsBacking } from "../src/lib/chords-evaluation.js";

const [inventoryPath, outputPath] = process.argv.slice(2);
assert(inventoryPath && outputPath && process.env.KEYSPILLI_DATA_DIR, "usage: KEYSPILLI_DATA_DIR=/snapshot tsx prepare-catalog-chords.mts INVENTORY_JSON OUTPUT_DIR");
const out = resolve(outputPath), root = process.cwd();
assert(relative(root, out) && !relative(root, out).startsWith(".."), "output must be inside the checkout (chart artifact paths are repository-relative)");
mkdirSync(out, { recursive: true });
const hash = (x: string | Uint8Array) => createHash("sha256").update(x).digest("hex");
const atomic = (path: string, bytes: string | Uint8Array) => { writeFileSync(path + ".tmp", bytes); renameSync(path + ".tmp", path); };
const json = (path: string, value: unknown) => atomic(path, JSON.stringify(value, null, 2) + "\n");
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")) as Array<{ representative: { baseId: string; title: string; artist: string } }>;
assert(Array.isArray(inventory) && inventory.length > 0, "inventory must contain songs");
for (const row of inventory) assert(/^[a-z0-9][a-z0-9-]{0,119}$/.test(row.representative?.baseId ?? ""), "invalid base ID");
assert(new Set(inventory.map(r => r.representative.baseId)).size === inventory.length, "duplicate inventory base IDs");
if (process.argv.includes("--verify")) {
  assert(resolve(process.env.KEYSPILLI_CHORD_SOURCE_MAP ?? "") === join(out, "chord-sources.json"), "verification must load the delivered map");
  const verified = [];
  for (const { representative: song } of inventory) {
    const dir = join(out, song.baseId), receipt = JSON.parse(readFileSync(join(dir, "receipt.json"), "utf8"));
    for (const [name, digest] of Object.entries(receipt.files)) assert.equal(hash(readFileSync(join(dir, name))), digest, `${song.baseId}: changed ${name}`);
    const detail = await getSongDetail(`${song.baseId}-a`);
    assert(detail?.data && !detail.chordUnavailableReason, `${song.baseId}: unavailable`);
    const data = detail.chordData ?? detail.data;
    const expected = JSON.parse(readFileSync(join(dir, "playback.json"), "utf8")).snapshot;
    assert.deepEqual(JSON.parse(JSON.stringify(snapshotChordsBacking(data, replayChordsBacking(data)))), expected, `${song.baseId}: installed map changed playback`);
    verified.push(song.baseId);
  }
  json(join(out, "verified-import.json"), { checkedAt: new Date().toISOString(), songs: verified.length, baseIds: verified, method: "fresh process, delivered source map, actual getSongDetail and Player replay" });
  console.log(`Verified installed backing for ${verified.length} songs`);
  process.exit(0);
}
const sourceMap: ChordSourceMap = JSON.parse(readFileSync("catalog/chord-sources.json", "utf8"));
const preserved = new Set(sourceMap.entries.filter(e => e.sources.some(s => s.artifactPath)).map(e => e.baseId));
const generator = hash(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" })
  + execFileSync("git", ["diff", "--", "packages", "apps/web/src"], { encoding: "utf8" }) + readFileSync(new URL(import.meta.url), "utf8"));
const overridesPath = join(out, "harmonizations.json");
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, "utf8")) : {};
const map: ChordSourceMap = { schemaVersion: 1, entries: [...sourceMap.entries] };
const rows: Array<Record<string, any>> = [];
const canonical = (notes: readonly Note[], tick: number) => notes.map(n => [n.midi, Math.round(n.start * tick), Math.round(n.dur * tick)])
  .sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]! || a[2]! - b[2]!);
for (const { representative: song } of inventory) {
  const dir = join(out, song.baseId), receiptPath = join(dir, "receipt.json");
  mkdirSync(dir, { recursive: true });
  try {
    const detail = await getSongDetail(`${song.baseId}-a`);
    assert(detail?.data && !detail.chordUnavailableReason, detail?.chordUnavailableReason ?? "missing Advanced data");
    const original = detail.data, input = detail.chordData ?? original;
    const inputHash = hash(JSON.stringify(input) + JSON.stringify(overrides[song.baseId] ?? null));
    let receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, "utf8")) : null;
    if (receipt?.generator === generator && receipt?.inputHash === inputHash
      && Object.entries(receipt.files).every(([name, digest]) => existsSync(join(dir, name)) && hash(readFileSync(join(dir, name))) === digest)) {
      rows.push(receipt);
      if (receipt.mapping) map.entries = [...map.entries.filter(e => e.baseId !== song.baseId), receipt.mapping];
      continue;
    }
    let playerData = input;
    let timeline: ChordTimelineArtifact | null = null;
    let mapping;
    if (!preserved.has(song.baseId)) {
      // The owner requested composed learner backings. Contextual harmony is
      // an arrangement choice, explicitly inferred; it is not recovered ground truth.
      const labels: ChordLabel[] = overrides[song.baseId]?.chords ?? inferHarmonyTimeline(original.notes, original.measures, { key: original.key });
      assert(input.sourceFingerprint, "preparation requires a source fingerprint");
      timeline = parseChordTimeline({ schemaVersion: 1, baseId: song.baseId, title: song.title, artist: song.artist,
        key: input.key, tempoBpm: input.tempoBpm, timeSig: input.timeSig,
        durationBeats: Math.max(...input.measures.map(m => m.endBeat), ...input.notes.map(n => n.start + n.dur)), coverage: "full-song",
        chords: labels.map(c => ({ ...c, sourceKind: "inferred", inferred: true, inferenceType: "learner-harmonization" })),
        provenance: { sourceId: "prepared", provider: "keyspilli", kind: "midi-derived", sourceRef: `prepared:${input.sourceFingerprint}`, confidence: "inferred arrangement" } });
      json(join(dir, "timeline.json"), timeline);
      mapping = { baseId: song.baseId, canonicalTitle: song.title, canonicalArtist: song.artist,
        sources: [{ id: "prepared", provider: "keyspilli", kind: "midi-derived" as const,
          sourceRef: timeline.provenance.sourceRef, artifactPath: relative(root, join(dir, "timeline.json")), priority: 0 }] };
      map.entries = [...map.entries.filter(e => e.baseId !== song.baseId), mapping];
      playerData = projectChordSources(input, timeline);
    }
    const replay = replayChordsBacking(playerData), snapshot = snapshotChordsBacking(playerData, replay);
    if (preserved.has(song.baseId)) assert(sourceMap.entries.find(e => e.baseId === song.baseId)?.sources
      .some(s => s.artifactPath && s.sourceRef === replay.selected.source?.provenanceInfo?.sourceRef),
    "mapped backing was not selected; reconcile chart/source versions before preserving it");
    const notes = resolveTimedNotes({ ...playerData, notes: snapshot.notes }, 1, 0);
    const captured: Note[] = [];
    let engine: PlaybackEngine, noteEvents = 0, chordEvents = 0;
    const beatsPerSecond = playerData.tempoBpm / 60;
    const audio = { ensure() {}, noteOn(n: any, when = 0) { noteEvents++; captured.push({ midi: n.midi, start: (engine.time + when) * beatsPerSecond, dur: n.durSec * beatsPerSecond, vel: n.vel, hand: n.hand }); },
      playChord(pitches: number[], when: number, duration: number) { chordEvents++; const start = (engine.time + when) * beatsPerSecond;
        const chord = snapshot.chords.find(c => Math.abs(c.beat - start) < 1e-6);
        for (const midi of pitches) captured.push({ midi, start, dur: duration * beatsPerSecond, vel: 80, hand: chord?.suggestedHands[chord.notes.indexOf(midi)] }); },
      noteOff() {}, metronomeClick() {}, cancelAll() {}, setGains() {}, dispose() {}, sustainPedal: true };
    engine = new PlaybackEngine(audio, notes, replay.arrangementEnd / beatsPerSecond, playerData, { ...DEFAULT_SETTINGS, backgroundMode: "chord" }, snapshot.chords);
    engine.start();
    for (let step = 0; engine.playing && step < 1_000_000; step++) engine.tick(0.05);
    assert(!engine.playing && noteEvents === notes.length && chordEvents === engine.chords.length, "transport dropped events");
    assert(captured.length > 0, "silent backing");
    const midi = writeMidi(captured, { tempoBpm: playerData.tempoBpm, timeSig: playerData.timeSig, timeSigEvents: playerData.timeSigEvents,
      tracks: [{ name: "Left hand", notes: captured.filter(n => n.hand === "L") }, { name: "Right hand", notes: captured.filter(n => n.hand !== "L") }] });
    assert.deepEqual(canonical(parseMidi(midi).notes, 480), canonical(captured, 480), "MIDI round trip changed notes");
    const xml = writeMusicXml({ ...playerData, notes: captured, chords: replay.chords, level: "a", difficultyScore: 0, bassPattern: "block" }, `${song.title} — Chords`, song.artist);
    const parsedXml = parseMusicXmlNotes(xml);
    assert.deepEqual(canonical(parsedXml.notes, 960), canonical(captured, 960), "MusicXML round trip changed notes");
    atomic(join(dir, "chords.mid"), midi); atomic(join(dir, "chords.musicxml"), xml);
    json(join(dir, "playback.json"), { baseId: song.baseId, title: song.title, status: preserved.has(song.baseId) ? "preserved" : "prepared candidate", inputPins: {}, advanced: original, playerData, snapshot, resolution: replay.resolution });
    const metrics = evaluateChordsBacking(playerData);
    const files = Object.fromEntries(["chords.mid", "chords.musicxml", "playback.json", ...(timeline ? ["timeline.json"] : [])].map(name => [name, hash(readFileSync(join(dir, name)))]));
    receipt = { ...song, generator, inputHash, sourceFingerprint: input.sourceFingerprint, status: preserved.has(song.baseId) ? "preserved" : "prepared-candidate",
      assessment: "structural checks only; not a musical acceptance", files, mapping, metrics,
      references: overrides[song.baseId]?.references ?? [], rationale: overrides[song.baseId]?.rationale ?? "Contextual learner harmonization from the existing Advanced arrangement.",
      checks: { transportEvents: noteEvents + chordEvents, exportedNotes: captured.length, midiRoundTrip: true, musicXmlRoundTrip: true, chordMidiVelocity: 80 } };
    json(receiptPath, receipt); rows.push(receipt);
    console.log(`${rows.length}/${inventory.length} ${song.baseId}: ${receipt.status}; proxies ${metrics.backing.gate.passed ? "pass" : "flagged"}`);
  } catch (error) {
    const row = { ...song, status: "blocked", error: error instanceof Error ? error.message : String(error) };
    rows.push(row); console.error(`${rows.length}/${inventory.length} ${song.baseId}: ${row.error}`);
  }
  json(join(out, "ledger.json"), rows);
}
assert(rows.length === inventory.length, "scope mismatch");
json(join(out, "ledger.json"), rows); json(join(out, "chord-sources.json"), map);
const summary = { visible: inventory.length, statuses: Object.fromEntries([...new Set(rows.map(r => r.status))].map(s => [s, rows.filter(r => r.status === s).length])),
  structuralProxyPass: rows.filter(r => r.metrics?.backing.gate.passed).length, musicalAcceptance: "not established", generator };
json(join(out, "summary.json"), summary); console.log(JSON.stringify(summary));
if (rows.some(r => r.status === "blocked")) process.exitCode = 1;
