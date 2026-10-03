import { NextResponse } from "next/server";
import { getDb } from "@keyspilli/catalog";
import { publicJobView } from "../../../../lib/job-view";

export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = getDb()
    .prepare(
      `SELECT id, youtube_url AS youtubeUrl, status, song_id AS songId, error,
              created_at AS createdAt, finished_at AS finishedAt
       FROM conversion_jobs ORDER BY created_at DESC, id DESC LIMIT 50`,
    )
    .all();
  const views = [];
  // Validate one result at a time so 50 uncached arrangements cannot load together.
  for (const job of jobs as Array<Record<string, unknown>>) views.push(await publicJobView(job));
  return NextResponse.json({
    jobs: views,
  }, { headers: { "Cache-Control": "no-store" } });
}
