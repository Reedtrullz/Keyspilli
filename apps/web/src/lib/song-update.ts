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

export class SongUpdateError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const KEY_ROOTS = new Set([
  "C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B",
]);

export function isValidKey(key: string): boolean {
  const m = /^([A-Ga-g](?:#|b)?)(m)?$/.exec(key.trim());
  if (!m) return false;
  const root = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  return KEY_ROOTS.has(root);
}

export function resolveBaseId(id: string): string | null {
  const byId = getSong(id);
  if (byId) return byId.baseId;
  return getSongsByBase(id).length ? id : null;
}

function buildMeasures(notes: Variant["notes"], timeSig: [number, number]): Variant["measures"] {
  const [num, den] = timeSig;
  const beatsPerMeasure = num * (4 / den);
  const dur = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 1);
  const count = Math.max(1, Math.ceil(dur / beatsPerMeasure));
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    startBeat: i * beatsPerMeasure,
    endBeat: (i + 1) * beatsPerMeasure,
  }));
}

interface StoredVariant {
  notes: Variant["notes"];
  chords: Variant["chords"];
  measures: Variant["measures"];
  key: string;
  tempoBpm: number;
  timeSig: [number, number];
}

/**
 * Apply metadata to all 6 variants of a song and rewrite their artifacts
 * (notes.json, variant.mid, variant.xml) from the stored notes. A tempo change
 * rescales note times (beats are seconds-derived at the stored tempo), so
 * playback speed stays identical to the original recording.
 */
export async function applySongMetadata(id: string, patch: SongPatch): Promise<SongRow[]> {
  const baseId = resolveBaseId(id);
  if (!baseId) throw new SongUpdateError(404, "song not found");
  const rows = getSongsByBase(baseId);
  if (!rows.length) throw new SongUpdateError(404, "song not found");

  if (patch.tempo !== undefined) {
    if (!Number.isFinite(patch.tempo) || patch.tempo < 20 || patch.tempo > 300) {
      throw new SongUpdateError(400, "tempo must be a number between 20 and 300");
    }
  }
  if (patch.key !== undefined && !isValidKey(patch.key)) {
    throw new SongUpdateError(400, `invalid key: ${patch.key}`);
  }
  const hasPatch = [patch.title, patch.artist, patch.key, patch.tempo, patch.category, patch.style, patch.mood].some(
    (v) => v !== undefined,
  );
  if (!hasPatch) return rows;

  // Load every variant's stored notes up front so a corrupt artifact aborts
  // before anything is written (no partial apply).
  const storedVariants = await Promise.all(
    rows.map(async (row): Promise<{ row: SongRow; dir: string; stored: StoredVariant }> => {
      const dir = artifactsDir(baseId, row.level);
      const stored = (await readFile(join(dir, "notes.json"), "utf8")
        .then((s) => JSON.parse(s) as StoredVariant)
        .catch(() => null)) as StoredVariant | null;
      if (!stored) throw new SongUpdateError(500, `missing or corrupt notes.json for ${row.id}`);
      return { row, dir, stored };
    }),
  );

  const writes = storedVariants.map(({ row, dir, stored }) => {
    const key = patch.key ?? stored.key;
    const tempoBpm = patch.tempo ?? stored.tempoBpm;
    const factor = tempoBpm / stored.tempoBpm;
    const scale =
      factor === 1
        ? (n: Variant["notes"][number]) => n
        : (n: Variant["notes"][number]) => ({ ...n, start: n.start * factor, dur: n.dur * factor });
    const notes = stored.notes.map(scale);
    const chords =
      factor === 1 ? (stored.chords ?? []) : (stored.chords ?? []).map((c) => ({ ...c, beat: c.beat * factor }));
    const measures = factor === 1 ? stored.measures : buildMeasures(notes, stored.timeSig);
    const variant: Variant = {
      level: row.difficulty as Variant["level"],
      difficultyScore: row.difficultyScore,
      notes,
      chords,
      measures,
      bassPattern: row.bassPattern,
      key,
      tempoBpm,
      timeSig: stored.timeSig,
    };
    const title = patch.title ?? row.title;
    const artist = patch.artist ?? row.artist;
    const k = keySignature(key);
    return Promise.all([
      writeFile(join(dir, "notes.json"), JSON.stringify({ ...stored, notes, chords, measures, key, tempoBpm })),
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
  });
  await Promise.all(writes);

  // Artifacts are consistent now; only then update the DB.
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

  return getSongsByBase(baseId);
}
