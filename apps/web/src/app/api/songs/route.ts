import { NextRequest, NextResponse } from "next/server";
import { listSongs, listSongsGroupedWithTotal, countSongs, projectPublicGroupedSongs, type SongFilters } from "@keyspilli/catalog/runtime";
import { readJsonObject } from "../../../lib/bounded-body";

export const dynamic = "force-dynamic";

function includesLegacyVeryEasy(sp: URLSearchParams): boolean {
  return sp.get("legacy") === "1" || sp.get("legacy") === "true" || ["very-easy", "very-beginner"].includes(sp.get("difficulty") ?? "");
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
  const rawIds = sp.get("ids");
  const ids = rawIds === null ? undefined : rawIds === "" ? [] : [...new Set(rawIds.split(","))];
  if (rawIds !== null && (rawIds.length > 32_768 || ids!.length > 500 || ids!.some(id => !/^[a-zA-Z0-9_-]{1,128}$/.test(id)))) {
    return NextResponse.json({ error: "Select at most 500 valid song IDs." }, { status: 400 });
  }
  return songResponse(sp, ids);
}

/** Read-only selection query: same private-edge read contract as GET, no catalog mutation. */
export async function POST(req: NextRequest) {
  const input = await readJsonObject(req, 1_048_576);
  if (input.response) return input.response;
  const selected = input.body.ids;
  // ponytail: 5,000 local favorites per query; a server-owned list is needed above this ceiling.
  if (Object.keys(input.body).some(key => key !== "ids") || !Array.isArray(selected) || selected.length > 5000
      || selected.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) {
    return NextResponse.json({ error: "Select at most 5,000 valid song IDs." }, { status: 400 });
  }
  return songResponse(req.nextUrl.searchParams, [...new Set(selected)]);
}

function songResponse(sp: URLSearchParams, ids: string[] | undefined) {
  const { limit, offset } = safePage(sp);
  const f: SongFilters = {
    publicOnly: !includesLegacyVeryEasy(sp),
    ids,
    artist: sp.get("artist") ?? undefined,
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
      total,
    });
  }
  return NextResponse.json({ songs: listSongs(f), total: countSongs(f) });
}
