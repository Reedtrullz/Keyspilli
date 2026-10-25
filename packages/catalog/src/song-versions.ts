import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./paths.js";
import type { GroupedSong } from "./group.js";

export interface SongVersionGroup {
  primaryBaseId: string;
  versions: Array<{ baseId: string; label: string }>;
}

export function parseSongVersionGroups(value: unknown): SongVersionGroup[] {
  assert(value && typeof value === "object" && !Array.isArray(value), "song versions must be an object");
  const document = value as Record<string, unknown>;
  assert(document.schemaVersion === 1 && Array.isArray(document.groups) && document.groups.length <= 256, "invalid song versions schema");
  const membership = new Set<string>();
  return document.groups.map((value: unknown) => {
    assert(value && typeof value === "object" && !Array.isArray(value), "invalid version group");
    const group = value as Record<string, unknown>;
    assert(typeof group.primaryBaseId === "string" && /^[a-z0-9][a-z0-9-]{0,119}$/.test(group.primaryBaseId), "invalid primary base");
    assert(Array.isArray(group.versions) && group.versions.length >= 2 && group.versions.length <= 16, "a group needs 2 to 16 versions");
    const labels = new Set<string>();
    const versions = group.versions.map((value: unknown) => {
      assert(value && typeof value === "object" && !Array.isArray(value), "invalid song version");
      const { baseId, label } = value as Record<string, unknown>;
      assert(typeof baseId === "string" && /^[a-z0-9][a-z0-9-]{0,119}$/.test(baseId), "invalid version base");
      assert(typeof label === "string" && label === label.trim() && label.length > 0 && label.length <= 80
        && !Array.from(label).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127), "invalid version label");
      assert(!membership.has(baseId) && !labels.has(label.toLowerCase()), "ambiguous version membership or label");
      membership.add(baseId); labels.add(label.toLowerCase());
      return { baseId, label };
    });
    assert(versions[0]?.baseId === group.primaryBaseId, "the primary must be the first version");
    return { primaryBaseId: group.primaryBaseId, versions };
  });
}

/** Read on each request so an operator metadata update needs no process restart. */
export function readSongVersionGroups(): SongVersionGroup[] {
  let text: string;
  try { text = readFileSync(join(dataDir(), "artifacts", ".song-versions.json"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  assert(Buffer.byteLength(text) <= 1_048_576, "song versions exceed 1 MiB");
  return parseSongVersionGroups(JSON.parse(text));
}

/** Fold only visible bases; the primary may be reached by an alternative's search/favorite. */
export function groupSongVersions(matches: GroupedSong[], available: GroupedSong[], groups: SongVersionGroup[]): GroupedSong[] {
  const byBase = new Map(available.map(group => [group.representative.baseId, group]));
  const families = new Map<string, GroupedSong>();
  for (const group of groups) {
    const primary = byBase.get(group.primaryBaseId);
    if (!primary) continue;
    const members = group.versions.flatMap(version => {
      const song = byBase.get(version.baseId);
      return song && song.representative.artist === primary.representative.artist ? [{ ...song, label: version.label }] : [];
    });
    if (members.length < 2) continue;
    const family: GroupedSong = {
      ...primary,
      alternativeVersions: members.filter(member => member.representative.baseId !== group.primaryBaseId)
        .map(({ representative, levels, label }) => ({ representative, levels, label })),
      totalPlays: members.reduce((sum, member) => sum + member.totalPlays, 0),
      lastCreatedAt: members.reduce((latest, member) => member.lastCreatedAt > latest ? member.lastCreatedAt : latest, ""),
    };
    for (const member of members) families.set(member.representative.baseId, family);
  }
  const seen = new Set<string>();
  return matches.flatMap(match => {
    const family = families.get(match.representative.baseId) ?? match;
    if (seen.has(family.representative.baseId)) return [];
    seen.add(family.representative.baseId);
    return [family];
  });
}
