import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeMidi } from "@keyspilli/midi";
import { parseYoutubeSourceArgs, resolveYoutubeAudio, resolveYoutubeSource } from "../src/youtube-source.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function jobDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "keyspilli-youtube-source-"));
  dirs.push(dir);
  return dir;
}

function midi(start = 0): Uint8Array {
  return writeMidi(
    Array.from({ length: 8 }, (_, i) => ({ midi: 60 + i, start: start + i * 0.5, dur: 0.5, vel: 80 })),
    { tempoBpm: 120 },
  );
}

describe("resolveYoutubeSource", () => {
  it("parses equals and spaced source options without leaking the value into base ids", () => {
    expect(parseYoutubeSourceArgs(["--source=strict", "song-a"], "root")).toEqual({
      selection: "strict",
      positionalArgs: ["song-a"],
    });
    expect(parseYoutubeSourceArgs(["--source", "auto", "--dry-run", "song-b"], "root")).toEqual({
      selection: "auto",
      positionalArgs: ["song-b"],
    });
    expect(() => parseYoutubeSourceArgs(["--source"], "root")).toThrow(/requires/);
    expect(() => parseYoutubeSourceArgs(["--source", "wat"], "root")).toThrow(/invalid/);
  });

  it("resolves the completed root audio and ignores partial or empty files", async () => {
    const dir = jobDir();
    writeFileSync(join(dir, "audio.mp3"), "");
    writeFileSync(join(dir, "audio.mp3.part"), "partial");
    writeFileSync(join(dir, "audio.txt"), "not audio");
    writeFileSync(join(dir, "audio.wav"), "audio");

    await expect(resolveYoutubeAudio(dir)).resolves.toBe(join(dir, "audio.wav"));

    const sidecarOnly = jobDir();
    writeFileSync(join(sidecarOnly, "audio.json"), "metadata");
    await expect(resolveYoutubeAudio(sidecarOnly)).resolves.toBeUndefined();
  });

  it("selects the requested root or re MIDI while keeping the source audio coherent", async () => {
    const dir = jobDir();
    mkdirSync(join(dir, "re"));
    writeFileSync(join(dir, "audio.mp3"), "audio");
    writeFileSync(join(dir, "audio_basic_pitch.mid"), midi());
    writeFileSync(join(dir, "re", "audio_basic_pitch.mid"), midi(1));

    const root = await resolveYoutubeSource(dir, "root");
    expect(root).toMatchObject({
      sourceKind: "root",
      midiPath: join(dir, "audio_basic_pitch.mid"),
      audioPath: join(dir, "audio.mp3"),
      availableKinds: ["root", "re"],
    });

    const strict = await resolveYoutubeSource(dir, "strict");
    expect(strict).toMatchObject({
      sourceKind: "re",
      midiPath: join(dir, "re", "audio_basic_pitch.mid"),
      audioPath: join(dir, "audio.mp3"),
      availableKinds: ["root", "re"],
    });
  });

  it("falls back to root in auto mode when the strict candidate is absent", async () => {
    const dir = jobDir();
    writeFileSync(join(dir, "audio.mp3"), "audio");
    writeFileSync(join(dir, "audio_basic_pitch.mid"), midi());

    await expect(resolveYoutubeSource(dir, "auto")).resolves.toMatchObject({
      sourceKind: "root",
      midiPath: join(dir, "audio_basic_pitch.mid"),
      audioPath: join(dir, "audio.mp3"),
      availableKinds: ["root"],
    });
  });

  it("uses audio copied inside re when the parent has no audio", async () => {
    const dir = jobDir();
    mkdirSync(join(dir, "re"));
    writeFileSync(join(dir, "re", "strict_basic_pitch.mid"), midi(1));
    writeFileSync(join(dir, "re", "audio.wav"), "audio");

    await expect(resolveYoutubeSource(dir, "strict")).resolves.toMatchObject({
      sourceKind: "re",
      midiPath: join(dir, "re", "strict_basic_pitch.mid"),
      audioPath: join(dir, "re", "audio.wav"),
      availableKinds: ["re"],
    });
  });

  it("ignores AppleDouble files, partial downloads, and incomplete candidates", async () => {
    const dir = jobDir();
    mkdirSync(join(dir, "re"));
    writeFileSync(join(dir, "._audio.mp3"), "junk");
    writeFileSync(join(dir, "audio.mp3.part"), "partial");
    writeFileSync(join(dir, "._audio_basic_pitch.mid"), "junk");
    writeFileSync(join(dir, "re", "audio_basic_pitch.mid"), "strict");

    await expect(resolveYoutubeSource(dir, "root")).resolves.toBeUndefined();
    await expect(resolveYoutubeSource(dir, "strict")).resolves.toBeUndefined();
    await expect(resolveYoutubeSource(dir, "auto")).resolves.toBeUndefined();
  });

  it("rejects a corrupt preferred re MIDI and falls back to a valid root candidate", async () => {
    const dir = jobDir();
    mkdirSync(join(dir, "re"));
    writeFileSync(join(dir, "audio.mp3"), "audio");
    writeFileSync(join(dir, "audio_basic_pitch.mid"), midi());
    writeFileSync(join(dir, "re", "audio_basic_pitch.mid"), "not-a-midi");

    await expect(resolveYoutubeSource(dir, "auto")).resolves.toMatchObject({
      sourceKind: "root",
      midiPath: join(dir, "audio_basic_pitch.mid"),
      audioPath: join(dir, "audio.mp3"),
      availableKinds: ["root"],
    });
  });

  it("tries lower-priority candidates when the preferred file is corrupt or empty", async () => {
    const dir = jobDir();
    writeFileSync(join(dir, "audio.mp3"), "");
    writeFileSync(join(dir, "audio.wav"), "audio");
    writeFileSync(join(dir, "audio_basic_pitch.mid"), "not-a-midi");
    writeFileSync(join(dir, "fallback_basic_pitch.mid"), midi());

    await expect(resolveYoutubeSource(dir, "root")).resolves.toMatchObject({
      sourceKind: "root",
      midiPath: join(dir, "fallback_basic_pitch.mid"),
      audioPath: join(dir, "audio.wav"),
    });
  });

  it("uses a valid re MIDI when the root MIDI is missing", async () => {
    const dir = jobDir();
    mkdirSync(join(dir, "re"));
    writeFileSync(join(dir, "audio.mp3"), "audio");
    writeFileSync(join(dir, "re", "audio_basic_pitch.mid"), midi());

    await expect(resolveYoutubeSource(dir, "auto")).resolves.toMatchObject({
      sourceKind: "re",
      midiPath: join(dir, "re", "audio_basic_pitch.mid"),
      audioPath: join(dir, "audio.mp3"),
      availableKinds: ["re"],
    });
  });

  it("rejects parseable candidates below the catalogue source minimum", async () => {
    const dir = jobDir();
    writeFileSync(join(dir, "audio.mp3"), "audio");
    writeFileSync(join(dir, "audio_basic_pitch.mid"), writeMidi(
      Array.from({ length: 7 }, (_, i) => ({ midi: 60 + i, start: i * 0.5, dur: 0.5, vel: 80 })),
      { tempoBpm: 120 },
    ));

    await expect(resolveYoutubeSource(dir, "root")).resolves.toBeUndefined();
  });

  it("fails closed for an explicitly requested strict candidate", async () => {
    const dir = jobDir();
    writeFileSync(join(dir, "audio.mp3"), "audio");
    writeFileSync(join(dir, "audio_basic_pitch.mid"), midi());

    await expect(resolveYoutubeSource(dir, "strict")).resolves.toBeUndefined();
    await expect(resolveYoutubeSource(dir, "auto")).resolves.toMatchObject({ sourceKind: "root" });
  });
});
