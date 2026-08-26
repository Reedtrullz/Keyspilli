import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseMidi, writeMidi } from "@keyspilli/midi";
import { filterTranscription } from "../src/transcribe.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeMidi(): Uint8Array {
  return writeMidi(
    [
      { midi: 60, start: 0, dur: 1, vel: 80, hand: "R" },
      { midi: 64, start: 1, dur: 1, vel: 80, hand: "R" },
    ],
    { tempoBpm: 120, timeSig: [4, 4], keySig: 0, keyMode: 1 },
  );
}

describe("filterTranscription", () => {
  it("skipOnsetFilter bypasses the audio-onset check and keeps all notes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "keyspilli-skip-onset-"));
    dirs.push(dir);
    // Write a silent/empty audio file: the Python detector would normally fail,
    // proving that skipOnsetFilter never invokes it.
    const audioPath = join(dir, "audio.mp3");
    writeFileSync(audioPath, Buffer.alloc(2048, 0));
    const filtered = await filterTranscription(makeMidi(), audioPath, { skipOnsetFilter: true });
    expect(filtered).toBeInstanceOf(Uint8Array);
    expect(parseMidi(filtered).notes.length).toBe(2);
  });
});
