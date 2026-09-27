/** Offline ingest-to-Player evidence; --reference-track strips POP909-CL's final chord track.
 * No song bytes enter the report. The isolated catalog is removed after the run.
 * tsx apps/web/scripts/evaluate-upload-chords.mts [--reference-track] <file.mid|file.xml|file.mxl>...
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { ingestSource } from "@keyspilli/catalog";
import { inferHarmonyTimeline, parseMidi, writeMidi } from "@keyspilli/midi";
import { chordsFromBlocks, chordsFromLabels, scoreChords } from "../../../packages/midi/src/chord-scoring.js";
import { getSongDetail } from "../src/lib/catalog-api.js";
import { evaluateChordsBacking } from "../src/lib/chords-evaluation.js";
import { replayChordsBacking } from "../src/components/player/chords-backing.js";

const args = process.argv.slice(2), referenceTrack = args.includes("--reference-track");
const files = args.filter(arg => arg !== "--reference-track");
if (!files.length || files.some(file => file.startsWith("--"))) throw new Error("usage: evaluate-upload-chords.mts [--reference-track] <source files...>");
const root = mkdtempSync(join(tmpdir(), "keyspilli-upload-eval-"));
const previousRoot = process.env.KEYSPILLI_DATA_DIR;
process.env.KEYSPILLI_DATA_DIR = root;
const rows = [];
try {
  for (const file of files) {
    const name = basename(file), started = performance.now();
    try {
      const bytes = readFileSync(file);
      if (bytes.byteLength > 16 * 1024 * 1024) throw new Error("source exceeds 16 MiB");
      const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
      let buf: Uint8Array = bytes, reference;
      if (referenceTrack) {
        const parsed = parseMidi(bytes);
        const track = Math.max(...parsed.notes.map(n => n.sourceOrigins?.[0]?.track ?? -1));
        reference = chordsFromBlocks(parsed.notes.filter(n => n.sourceOrigins?.[0]?.track === track));
        if (!reference.length) throw new Error("no reference chords on final track");
        // Both score and reference use source beats at a constant reference
        // clock. Real variable-tempo integration is tested by upload-chords.test.
        buf = writeMidi(parsed.notes.filter(n => n.sourceOrigins?.[0]?.track !== track), { tempoBpm: parsed.tempoBpm, timeSig: parsed.timeSig });
      }
      const imported = await ingestSource({ buf, baseId: `eval-${sourceSha256}`, title: name, artist: "Offline evaluation", contentType: "upload", acquiredVia: "upload" });
      if (imported.error) throw new Error(imported.error);
      const detail = await getSongDetail(`${imported.baseId}-e`);
      const data = detail?.chordData ?? detail?.data;
      if (!data || detail?.chordUnavailableReason) throw new Error(detail?.chordUnavailableReason ?? "Player data unavailable");
      const replay = replayChordsBacking(data), end = replay.arrangementEnd;
      const labels = replay.selected.source?.chords ?? [];
      rows.push({ name, sourceSha256, tempoBpm: data.tempoBpm, endBeat: end,
        uncertainFraction: labels.filter(c => c.reviewReason).reduce((sum, c) => sum + (c.durationBeats ?? 0), 0) / end,
        metrics: evaluateChordsBacking(data),
        ...(reference ? {
          legacyHarmony: scoreChords(reference, chordsFromLabels(inferHarmonyTimeline(data.notes, data.measures, { key: data.key }), end), end),
          sourceGroundedHarmony: scoreChords(reference, chordsFromLabels(labels, end), end),
        } : {}), elapsedMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      rows.push({ name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), referenceTrack, rows }, null, 2));
  if (rows.some(row => "error" in row)) process.exitCode = 1;
} finally {
  if (previousRoot === undefined) delete process.env.KEYSPILLI_DATA_DIR; else process.env.KEYSPILLI_DATA_DIR = previousRoot;
  rmSync(root, { recursive: true, force: true });
}
