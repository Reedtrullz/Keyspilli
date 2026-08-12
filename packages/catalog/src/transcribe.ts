/**
 * Shared Basic Pitch post-processing for YouTube transcriptions: drop notes
 * with no nearby real audio onset (Basic Pitch fabricates notes between real
 * ones) and trim leading silence so songs start at the first note.
 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseMidi, writeMidi } from "@keyspilli/midi";
import { ROOT } from "./paths.js";

const execFileP = promisify(execFile);
const PYTHON = process.env.KEYSPILLI_PYTHON ?? join(ROOT, "services", "transcribe", ".venv", "bin", "python");
const ONSET_MATCH_SEC = Number(process.env.KEYSPILLI_ONSET_MATCH_SEC ?? 0.15);

export async function filterTranscription(rawMidi: Uint8Array, audioPath: string): Promise<Uint8Array> {
  const { stdout } = await execFileP(PYTHON, [join(ROOT, "services", "transcribe", "src", "audio_onsets.py"), audioPath], {
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const audioOnsets = JSON.parse(stdout) as number[];
  const raw = parseMidi(rawMidi);
  const secPerBeat = 60 / raw.tempoBpm;
  const kept = raw.notes.filter((n) => audioOnsets.some((a) => Math.abs(a - n.start * secPerBeat) <= ONSET_MATCH_SEC));
  if (kept.length < raw.notes.length * 0.2) {
    throw new Error(`onset filter dropped too much (${kept.length}/${raw.notes.length})`);
  }
  // Trim leading silence: video intros (title cards, spoken openings) often
  // leave 5-40s with no notes; the player should start at the first note.
  const firstStart = Math.min(...kept.map((n) => n.start));
  if (firstStart * secPerBeat > 2) {
    for (const n of kept) n.start = Math.max(0, n.start - firstStart);
  }
  return writeMidi(kept, {
    tempoBpm: raw.tempoBpm,
    timeSig: raw.timeSig,
    keySig: raw.keySig,
    keyMode: raw.keyMode,
  });
}
