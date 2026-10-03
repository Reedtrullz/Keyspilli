import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getJob, transcribedDir } from "@keyspilli/catalog";
import { publicJobView } from "../../../../../lib/job-view";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  let stage: string | undefined;
  if (job.status === "processing" && /^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
    try {
      const progress = JSON.parse(await readFile(join(transcribedDir(), id, "progress.json"), "utf8"));
      if (["identifying","searching","downloading","extracting","validating","publishing"].includes(progress.stage)) stage = progress.stage;
    } catch { /* Progress is optional; database job state remains authoritative. */ }
  }
  return NextResponse.json({ ...await publicJobView(job), stage }, { headers: { "Cache-Control": "no-store" } });
}
