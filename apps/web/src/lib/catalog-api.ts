import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getSong, getSongsByBase, artifactsDir, SongRow } from "@keyspilli/catalog";
import type { SongData } from "@keyspilli/player-core";

export interface SongDetail {
  song: SongRow;
  data: SongData | null;
  variants: SongRow[];
}

export async function getSongDetail(id: string): Promise<SongDetail | null> {
  const song = getSong(id);
  if (!song) return null;
  const data = await readFile(join(artifactsDir(song.baseId, song.level), "notes.json"), "utf8")
    .then((s) => JSON.parse(s) as SongData)
    .catch(() => null);
  const variants = getSongsByBase(song.baseId);
  return { song, data, variants };
}

export async function getArtifactFile(id: string, name: "variant.mid" | "variant.xml"): Promise<Buffer | null> {
  const song = getSong(id);
  if (!song) return null;
  return readFile(join(artifactsDir(song.baseId, song.level), name)).catch(() => null);
}
