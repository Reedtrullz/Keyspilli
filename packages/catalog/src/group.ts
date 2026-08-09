import type { SongRow } from "./db.js";

export interface GroupedSong {
  representative: SongRow;
  levels: SongRow[];
  totalPlays: number;
  lastCreatedAt: string;
}

/**
 * Group arrangement variants by base song. One entry per song, with all
 * difficulty levels attached and play counts summed.
 */
export function groupSongs(rows: SongRow[]): GroupedSong[] {
  const byBase = new Map<string, SongRow[]>();
  for (const r of rows) {
    const arr = byBase.get(r.baseId) ?? [];
    arr.push(r);
    byBase.set(r.baseId, arr);
  }
  const out: GroupedSong[] = [];
  for (const [baseId, variants] of byBase) {
    const levels = [...variants].sort((a, b) => a.difficultyScore - b.difficultyScore);
    const mostPlayed = levels.reduce((best, v) => (v.plays > best.plays ? v : best), levels[0]!);
    const easy = levels.find((v) => v.level === "e");
    const representative = mostPlayed.plays > 0 ? mostPlayed : (easy ?? levels[0]!);
    out.push({
      representative,
      levels,
      totalPlays: levels.reduce((s, v) => s + v.plays, 0),
      lastCreatedAt: levels.reduce((m, v) => (v.createdAt > m ? v.createdAt : m), ""),
    });
  }
  return out;
}
