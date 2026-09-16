import { NextRequest, NextResponse } from "next/server";
import { listSongs, listSongsGroupedWithTotal, countSongs, projectPublicGroupedSongs, type SongFilters } from "@keyspilli/catalog";

export const dynamic = "force-dynamic";

function includesLegacyVeryEasy(sp: URLSearchParams): boolean {
  return sp.get("legacy") === "1" || sp.get("legacy") === "true" || sp.get("difficulty") === "very-easy";
}

/** Normalize pagination: positive integer limit capped at 200, non-negative integer offset. */
function safePage(sp: URLSearchParams) {
  const limit = Number(sp.get("limit"));
  const offset = Number(sp.get("offset"));
  return {
    limit: Number.isSafeInteger(limit) && limit > 0 ? Math.min(200, limit) : 200,
    offset: Number.isSafeInteger(offset) && offset >= 0 ? offset : 0,
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const { limit, offset } = safePage(sp);
  const f: SongFilters = {
    importMethod: sp.get("importMethod") ?? undefined,
    difficulty: sp.get("difficulty") ?? undefined,
    key: sp.get("key") ?? undefined,
    style: sp.get("style") ?? undefined,
    mood: sp.get("mood") ?? undefined,
    bassPattern: sp.get("bass") ?? undefined,
    category: sp.get("category") ?? undefined,
    q: sp.get("q") ?? undefined,
    sort: (sp.get("sort") as SongFilters["sort"]) ?? "popular",
    limit,
    offset,
  };
  if (sp.get("group") === "1") {
    const { songs, total } = listSongsGroupedWithTotal(f);
    const groups = includesLegacyVeryEasy(sp) ? songs : projectPublicGroupedSongs(songs);
    return NextResponse.json({
      songs: groups.map(({ representative, levels, totalPlays, lastCreatedAt }) => ({
        representative: {
          id: representative.id,
          baseId: representative.baseId,
          title: representative.title,
          artist: representative.artist,
          key: representative.key,
          tempo: representative.tempo,
        },
        levels: levels.map(({ id, difficulty }) => ({ id, difficulty })),
        totalPlays,
        lastCreatedAt,
      })),
      total: groups.length === songs.length ? total : groups.length,
    });
  }
  return NextResponse.json({ songs: listSongs(f), total: countSongs(f) });
}
