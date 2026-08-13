import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { artifactsDir, getDb, getSong, getSongsByBase, SongRow } from "@keyspilli/catalog";
import { keySignature, writeMidi, writeMusicXml, type Variant } from "@keyspilli/midi";

export interface SongPatch {
  title?: string;
  artist?: string;
  key?: string;
  tempo?: number;
  category?: string;
  style?: string;
  mood?: string;
}

export function resolveBaseId(id: string): string | null {
  if (getSong(id)) return getSong(id)!.baseId;
  return getSongsByBase(id).length ? id : null;
}

/**
 * Apply metadata to all 6 variants of a song and rewrite their artifacts
 * (notes.json, variant.mid, variant.xml) from the stored notes.
 */
export async function applySongMetadata(id: string, patch: SongPatch): Promise<SongRow[]> {
  const baseId = resolveBaseId(id);
  if (!baseId) throw new Error("song not found");
  const rows = getSongsByBase(baseId);
  if (!rows.length) throw new Error("song not found");

  // upsertSong only overwrites key/tempo/score on conflict, so patch the rest
  // here; db.ts is owned by another lane.
  const sets: string[] = [];
  const params: Record<string, unknown> = { baseId };
  for (const [col, k] of [
    ["title", "title"],
    ["artist", "artist"],
    ["category", "category"],
    ["style", "style"],
    ["mood", "mood"],
    ["key", "key"],
    ["tempo", "tempo"],
  ] as const) {
    const v = (patch as Record<string, unknown>)[k];
    if (v !== undefined) {
      sets.push(`${col} = @${k}`);
      params[k] = v;
    }
  }
  if (sets.length) getDb().prepare(`UPDATE songs SET ${sets.join(", ")} WHERE base_id = @baseId`).run(params);

  await Promise.all(
    rows.map(async (row) => {
      const dir = artifactsDir(baseId, row.level);
      const stored = (await readFile(join(dir, "notes.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null)) as {
        notes: Variant["notes"];
        chords: Variant["chords"];
        measures: Variant["measures"];
        key: string;
        tempoBpm: number;
        timeSig: [number, number];
      } | null;
      if (!stored) return;
      const key = patch.key ?? stored.key;
      const tempoBpm = patch.tempo ?? stored.tempoBpm;
      const variant: Variant = {
        level: row.difficulty as Variant["level"],
        difficultyScore: row.difficultyScore,
        notes: stored.notes,
        chords: stored.chords ?? [],
        measures: stored.measures,
        bassPattern: row.bassPattern,
        key,
        tempoBpm,
        timeSig: stored.timeSig,
      };
      const title = patch.title ?? row.title;
      const artist = patch.artist ?? row.artist;
      const k = keySignature(key);
      await Promise.all([
        writeFile(join(dir, "notes.json"), JSON.stringify({ ...stored, key, tempoBpm })),
        writeFile(
          join(dir, "variant.mid"),
          writeMidi(variant.notes, {
            tempoBpm,
            timeSig: variant.timeSig,
            keySig: k.fifths,
            keyMode: k.mode,
            title: `${title} (${row.difficulty})`,
            tracks: [
              { name: "Right Hand", notes: variant.notes.filter((n) => n.hand !== "L") },
              { name: "Left Hand", notes: variant.notes.filter((n) => n.hand === "L") },
            ],
          }),
        ),
        writeFile(join(dir, "variant.xml"), writeMusicXml(variant, title, artist)),
      ]);
    }),
  );
  return getSongsByBase(baseId);
}
