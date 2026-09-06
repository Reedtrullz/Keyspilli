import { NextResponse } from "next/server";
import { countSongs } from "@keyspilli/catalog";
import { hasSourceCandidateProvider } from "../../../lib/source-candidate-provider";

export const dynamic = "force-dynamic";

/** Health/version contract used by the Ansible deploy playbook. */
export async function GET() {
  const version = process.env.VERSION ?? process.env.APP_VERSION ?? "dev";
  let dbHealthy = false;
  let songCount: number | null = null;
  try {
    songCount = countSongs();
    dbHealthy = true;
  } catch {
    // The database may be missing on a fresh volume before the pipeline runs.
  }
  return NextResponse.json(
    {
      status: dbHealthy ? "healthy" : "degraded",
      version,
      commit: version,
      image: process.env.IMAGE_REF ?? null,
      capabilities: {
        symbolicUpload: true,
        sourceDiscoveryConfigured: hasSourceCandidateProvider(),
        directAudioAmt: false,
      },
      ...(songCount !== null ? { songs: songCount } : {}),
    },
    { status: dbHealthy ? 200 : 503 },
  );
}
