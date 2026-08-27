import { NextResponse } from "next/server";
import { getDb } from "@keyspilli/catalog";
import { publicJobError } from "../../../../lib/job-error";

export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = getDb()
    .prepare(
      `SELECT id, youtube_url AS youtubeUrl, status, song_id AS songId, error,
              created_at AS createdAt, finished_at AS finishedAt
       FROM conversion_jobs ORDER BY created_at DESC LIMIT 50`,
    )
    .all();
  return NextResponse.json({
    jobs: (jobs as Array<Record<string, unknown>>).map((job) => ({
      ...job,
      error: publicJobError(job.error),
    })),
  });
}
