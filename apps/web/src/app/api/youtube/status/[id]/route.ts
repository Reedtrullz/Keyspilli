import { NextResponse } from "next/server";
import { getJob } from "@keyspilli/catalog";
import { publicJobError } from "../../../../../lib/job-error";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ...job, error: publicJobError(job.error) });
}
