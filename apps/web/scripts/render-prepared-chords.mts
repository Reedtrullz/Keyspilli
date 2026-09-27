/** Render prepared Player exports, with bounded scratch files and raw clipping checks.
 * KEYSPILLI_SOUNDFONT=/piano.sf2 tsx ... PREPARED_DIR [BASE_ID]
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderMidiToWav } from "../../../packages/catalog/src/midi-renderer.js";
const [rootArg, baseId] = process.argv.slice(2);
assert(rootArg && process.env.KEYSPILLI_SOUNDFONT, "PREPARED_DIR [BASE_ID]; set KEYSPILLI_SOUNDFONT");
const root = resolve(rootArg), hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const fontHash = hash(process.env.KEYSPILLI_SOUNDFONT), rendererHash = hash(new URL("../../../packages/catalog/src/midi-renderer.ts", import.meta.url).pathname);
const rows = JSON.parse(readFileSync(join(root, "ledger.json"), "utf8")).filter((r: any) => !baseId || r.baseId === baseId);
assert(rows.length, "no matching songs");
const results = [], scratch = mkdtempSync(join(root, ".render-"));
try {
  for (const row of rows) {
    const dir = join(root, row.baseId), midi = join(dir, "chords.mid"), receiptPath = join(dir, "audio.json"), mp3 = join(dir, "preview.mp3");
    try {
      assert(row.status !== "blocked", "preparation blocked");
      const midiHash = hash(midi);
      assert.equal(midiHash, row.files["chords.mid"], "stale preparation receipt");
      const prior = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, "utf8")) : null;
      if (prior?.rendererHash === rendererHash && prior?.midiHash === midiHash && prior.fontHash === fontHash && existsSync(mp3) && prior.mp3Hash === hash(mp3)) { results.push(prior); continue; }
      let result;
      const wav = join(scratch, "preview.wav");
      for (const gain of [0.2, 0.05, 0.0125]) {
        result = await renderMidiToWav({ midiPath: midi, outputPath: wav, gain, sampleRate: 22050 });
        if (!result.wav.rawClippingCount) break;
      }
      assert(result && result.wav.rms > 0 && result.wav.clippingCount === 0 && result.wav.rawClippingCount === 0, "silent or clipped audio after bounded gain repair");
      assert(result.wav.durationSeconds >= result.midi.expectedSeconds - 0.25, "truncated audio");
      const temporary = join(scratch, "preview.mp3");
      execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "96k", temporary], { timeout: 600000 });
      assert.equal(hash(midi), midiHash, "MIDI changed while rendering");
      renameSync(temporary, mp3);
      const receipt = { baseId: row.baseId, midiHash, fontHash, rendererHash, mp3Hash: hash(mp3), pcm: result.wav, duration: result.duration, status: "rendered-not-listened", renderer: result.renderer };
      writeFileSync(receiptPath + ".tmp", JSON.stringify(receipt, null, 2)); renameSync(receiptPath + ".tmp", receiptPath); results.push(receipt);
      console.log(`${results.length}/${rows.length} ${row.baseId}: full duration, raw clipping=${result.wav.rawClippingCount}`);
    } catch (error) { results.push({ baseId: row.baseId, error: String(error) }); console.error(row.baseId, String(error)); }
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }
writeFileSync(join(root, baseId ? `${baseId}-audio-result.json` : "audio-ledger.json"), JSON.stringify(results, null, 2));
assert(!results.some((r: any) => r.error), "audio render incomplete");
