import { NextResponse } from "next/server";
import { inspectCatalogReadiness, tutorialImportsEnabled } from "@keyspilli/catalog/runtime";
import { hasSourceCandidateProvider } from "../../../lib/source-candidate-provider";

export const dynamic = "force-dynamic";

/** Health/version contract used by the Ansible deploy playbook. */
export async function GET() {
  const version = process.env.VERSION ?? process.env.APP_VERSION ?? "dev";
  const catalog = inspectCatalogReadiness();
  const dbHealthy = catalog.state === "ready";
  const sourceDiscoveryConfigured = hasSourceCandidateProvider();
  const tutorialEnabled = tutorialImportsEnabled();
  return NextResponse.json(
    {
      status: dbHealthy ? "healthy" : "degraded",
      version,
      commit: version,
      image: process.env.IMAGE_REF ?? null,
      capabilities: {
        symbolicUpload: dbHealthy && catalog.writable === true,
        tutorialImportsEnabled: tutorialEnabled,
        sourceDiscoveryConfigured,
        directAudioAmt: false,
      },
      readiness: {
        catalog,
        symbolicUpload: { state: dbHealthy && catalog.writable ? "ready" : "unavailable" },
        sourceDiscovery: { state: sourceDiscoveryConfigured ? "unknown" : "unavailable", configured: sourceDiscoveryConfigured },
        tutorialImport: { state: tutorialEnabled ? "unknown" : "unavailable", configured: tutorialEnabled },
      },
      ...(catalog.songs !== undefined ? { songs: catalog.songs } : {}),
    },
    { status: dbHealthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
