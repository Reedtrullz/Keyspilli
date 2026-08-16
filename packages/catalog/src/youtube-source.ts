import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseMidi } from "@keyspilli/midi";

/** Which Basic Pitch candidate supplied the MIDI for a YouTube source. */
export type YoutubeSourceKind = "root" | "re";

/** Explicit selection used by rebuild/restore scripts. */
export type YoutubeSourceSelection = "root" | "strict" | "auto";

export interface YoutubeSourceArgs {
  selection: YoutubeSourceSelection;
  positionalArgs: string[];
}

interface CandidateFiles {
  kind: YoutubeSourceKind;
  midiPaths: string[];
  audioPaths: string[];
}

export interface YoutubeSourceCandidate {
  midiPath: string;
  audioPath: string;
  sourceKind: YoutubeSourceKind;
  /** Other complete candidates present in the same job directory. */
  availableKinds: YoutubeSourceKind[];
}

function midiNames(files: string[]): string[] {
  const clean = files.filter((file) => !file.startsWith("._"));
  return [
    ...clean.filter((file) => file === "audio_basic_pitch.mid"),
    ...clean.filter((file) => file !== "audio_basic_pitch.mid" && file.endsWith("_basic_pitch.mid")),
  ];
}

function audioNames(files: string[]): string[] {
  const clean = files.filter((file) => !file.startsWith("._"));
  return [
    ...clean.filter((file) => file === "audio.mp3"),
    ...clean.filter((file) => file !== "audio.mp3" && /^audio\.(?:mp3|m4a|wav|flac|opus|webm|ogg)$/i.test(file)),
  ];
}

async function candidateFiles(dir: string, kind: YoutubeSourceKind): Promise<CandidateFiles> {
  const files = (await readdir(dir).catch(() => [] as string[])).sort((a, b) => a.localeCompare(b));
  return {
    kind,
    midiPaths: midiNames(files).map((file) => join(dir, file)),
    audioPaths: audioNames(files).map((file) => join(dir, file)),
  };
}

/** Keep source validation aligned with ingestSource's catalogue minimum. */
const MIN_USABLE_NOTES = 8;

async function usableMidi(path: string): Promise<boolean> {
  try {
    const parsed = parseMidi(new Uint8Array(await readFile(path)));
    return parsed.notes.length >= MIN_USABLE_NOTES;
  } catch {
    return false;
  }
}

async function usableAudio(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function firstUsable(paths: string[], check: (path: string) => Promise<boolean>): Promise<string | undefined> {
  for (const path of paths) {
    if (await check(path)) return path;
  }
  return undefined;
}

/** Resolve the completed root audio used to create a strict `re/` MIDI. */
export async function resolveYoutubeAudio(jobDir: string): Promise<string | undefined> {
  const root = await candidateFiles(jobDir, "root");
  return firstUsable(root.audioPaths, usableAudio);
}

/** Parse the source option without allowing a bare `--source` to become a base id. */
export function parseYoutubeSourceArgs(
  args: readonly string[],
  defaultSelection: YoutubeSourceSelection,
): YoutubeSourceArgs {
  let selectionValue: string | undefined;
  const positionalArgs: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg.startsWith("--source=")) {
      if (selectionValue !== undefined) throw new Error("duplicate --source option");
      selectionValue = arg.slice("--source=".length);
      continue;
    }
    if (arg === "--source") {
      if (selectionValue !== undefined) throw new Error("duplicate --source option");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--source requires root, strict, or auto");
      selectionValue = value;
      index++;
      continue;
    }
    if (!arg.startsWith("--")) positionalArgs.push(arg);
  }
  const selection = selectionValue ?? defaultSelection;
  if (selection !== "root" && selection !== "strict" && selection !== "auto") {
    throw new Error(`invalid --source=${selection} (expected root, strict, or auto)`);
  }
  return { selection, positionalArgs };
}

/**
 * Resolve one coherent MIDI/audio candidate from a persisted conversion job.
 *
 * The `re/` directory contains a stricter Basic Pitch rerun. Its MIDI may
 * reuse the parent job's audio; that is the same source recording, not a
 * second transcription candidate. The returned `sourceKind` always describes
 * the MIDI candidate, and `availableKinds` makes an unintentional fallback
 * visible to callers.
 */
export async function resolveYoutubeSource(
  jobDir: string,
  selection: YoutubeSourceSelection,
): Promise<YoutubeSourceCandidate | undefined> {
  const root = await candidateFiles(jobDir, "root");
  const re = await candidateFiles(join(jobDir, "re"), "re");
  const rootAudio = await firstUsable(root.audioPaths, usableAudio);
  const reAudio = await firstUsable(re.audioPaths, usableAudio);
  const rootMidi = await firstUsable(root.midiPaths, usableMidi);
  const reMidi = await firstUsable(re.midiPaths, usableMidi);
  const completeRoot = rootMidi && rootAudio
    ? { kind: root.kind, midiPath: rootMidi, audioPath: rootAudio }
    : undefined;
  const sharedAudio = reAudio ?? rootAudio;
  const completeRe = reMidi && sharedAudio
    ? { kind: re.kind, midiPath: reMidi, audioPath: sharedAudio }
    : undefined;
  const availableKinds: YoutubeSourceKind[] = [];
  if (completeRoot) availableKinds.push("root");
  if (completeRe) availableKinds.push("re");

  // `strict` is deliberately fail-closed: an operator asking for the strict
  // candidate must not silently receive an older root transcription. `auto`
  // preserves the historical restore/re-ingest preference for strict output
  // while making the fallback explicit in the call site.
  const selected = selection === "root"
    ? completeRoot
    : selection === "strict"
      ? completeRe
      : completeRe ?? completeRoot;
  if (!selected?.midiPath || !selected.audioPath) return undefined;
  return {
    midiPath: selected.midiPath,
    audioPath: selected.audioPath,
    sourceKind: selected.kind,
    availableKinds,
  };
}
