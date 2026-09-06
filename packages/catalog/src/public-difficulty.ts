import {
  PUBLIC_DIFFICULTY_ORDER,
  isPublicDifficultyLevel,
  type PublicDifficultyLevel,
} from "@keyspilli/midi";
import type { GroupedSong } from "./group.js";
import type { SongRow } from "./db-types.js";

export { PUBLIC_DIFFICULTY_ORDER, isPublicDifficultyLevel };
export type { PublicDifficultyLevel };

/** Return a physical row only when it has a public difficulty. */
export function projectPublicSongRow(row: SongRow): SongRow | undefined {
  return isPublicDifficultyLevel(row.difficulty) ? row : undefined;
}

/** Hide the physical Very Easy alias without rewriting the remaining rows. */
export function projectPublicSongRows(rows: readonly SongRow[]): SongRow[] {
  return rows
    .filter((row) => projectPublicSongRow(row) !== undefined)
    .sort(
      (a, b) => PUBLIC_DIFFICULTY_ORDER.indexOf(a.difficulty as PublicDifficultyLevel) - PUBLIC_DIFFICULTY_ORDER.indexOf(b.difficulty as PublicDifficultyLevel),
    );
}

/** Easy is the stable public representative when a complete group is present. */
export function selectPublicRepresentative(rows: readonly SongRow[]): SongRow | undefined {
  const publicRows = projectPublicSongRows(rows);
  return publicRows.find((row) => row.difficulty === "easy") ?? publicRows[0];
}

/** Hide Very Easy from a grouped read model and select the Easy cover row. */
export function projectPublicGroupedSong(group: GroupedSong): GroupedSong | undefined {
  const levels = projectPublicSongRows(group.levels);
  const representative = selectPublicRepresentative(levels);
  if (!representative) return undefined;
  return {
    ...group,
    representative,
    levels,
    totalPlays: levels.reduce((total, row) => total + row.plays, 0),
    lastCreatedAt: levels.reduce((latest, row) => (row.createdAt > latest ? row.createdAt : latest), ""),
  };
}

export function projectPublicGroupedSongs(groups: readonly GroupedSong[]): GroupedSong[] {
  return groups.flatMap((group) => {
    const projected = projectPublicGroupedSong(group);
    return projected ? [projected] : [];
  });
}
