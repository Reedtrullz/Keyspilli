import { NextRequest, NextResponse } from "next/server";
import { listSongs, countSongs, SongFilters } from "@keyspilli/catalog";

export const dynamic = "force-dynamic";

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
  return NextResponse.json({ songs: listSongs(f), total: countSongs() });
}
