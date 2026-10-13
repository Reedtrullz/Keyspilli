import { loadJson, saveJson } from "@keyspilli/player-core";

export interface RecentSong {
  id: string;
  baseId: string;
  title: string;
  artist: string;
  difficulty: string;
  measure: number;
  at: number;
}

const KEY = "keyspilli.recent";
const MAX_RECENT = 4;

export function addRecent(list: RecentSong[], entry: RecentSong): RecentSong[] {
  return [entry, ...list.filter((r) => r.baseId !== entry.baseId)].slice(0, MAX_RECENT);
}

export function loadRecent(): RecentSong[] {
  return loadJson<RecentSong[]>(KEY, []);
}

export function recordRecent(entry: Omit<RecentSong, "at">): void {
  saveJson(KEY, addRecent(loadRecent(), { ...entry, at: Date.now() }));
}
