import { NextRequest, NextResponse } from "next/server";
import { listSongs, listSongsGroupedWithTotal, countSongs, projectPublicGroupedSongs, type SongFilters } from "@keyspilli/catalog";

export const dynamic = "force-dynamic";

function includesLegacyVeryEasy(sp: URLSearchParams): boolean {
  return sp.get("legacy") === "1" || sp.get("legacy") === "true" || sp.get("difficulty") === "very-easy";
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const f: SongFilters = {
    difficulty: sp.get("difficulty") ?? undefined,
    key: sp.get("key") ?? undefined,
    style: sp.get("style") ?? undefined,
    mood: sp.get("mood") ?? undefined,
    bassPattern: sp.get("bass") ?? undefined,
    category: sp.get("category") ?? undefined,
    q: sp.get("q") ?? undefined,
    sort: (sp.get("sort") as SongFilters["sort"]) ?? "popular",
    limit: Number(sp.get("limit") ?? 60),
    offset: Number(sp.get("offset") ?? 0),
  };
  if (sp.get("group") === "1") {
    const { songs, total } = listSongsGroupedWithTotal(f);
    const groups = includesLegacyVeryEasy(sp) ? songs : projectPublicGroupedSongs(songs);
    return NextResponse.json({
      songs: groups.map(({ representative, levels, totalPlays }) => ({
        representative: {
          id: representative.id,
          title: representative.title,
          artist: representative.artist,
          key: representative.key,
          tempo: representative.tempo,
        },
        levels: levels.map(({ id, difficulty }) => ({ id, difficulty })),
        totalPlays,
      })),
      total: groups.length === songs.length ? total : groups.length,
    });
  }
  return NextResponse.json({ songs: listSongs(f), total: countSongs() });
}
