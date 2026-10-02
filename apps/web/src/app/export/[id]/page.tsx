import { notFound } from "next/navigation";
import React from "react";
import { getSongDetail, getSongDetailShell, PublicationRevisionConflictError } from "@/lib/catalog-api";
import { SimplifyScore } from "@/components/export/SimplifyScore";
import { SheetMusicView } from "@/components/player/SheetMusicView";

export const dynamic = "force-dynamic";

export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ layout?: string; revision?: string }>;
}) {
  const { id } = await params;
  const { layout, revision: revisionValue } = await searchParams;
  const revision = revisionValue === undefined ? undefined : revisionValue === "unpinned" ? null : revisionValue;
  if (layout !== undefined && layout !== "simplify" && layout !== "classic") notFound();
  const publicationConflict = () => (
    <html lang="en"><body><main data-publication-conflict style={{ padding: 40, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      This publication changed while the export was loading. Reload the page to continue.
    </main></body></html>
  );
  if (layout === "classic") {
    let shell;
    try {
      shell = await getSongDetailShell(id, revision);
    } catch (error) {
      if (error instanceof PublicationRevisionConflictError) return publicationConflict();
      throw error;
    }
    if (!shell || shell.song.hasSheetXml !== 1) notFound();
    return (
      <html lang="en">
        <body style={{ margin: 0, background: "#fff" }}>
          <div style={{ padding: 40, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
            <h1 style={{ fontSize: 20, margin: "0 0 16px" }}>{`${shell.song.title} — ${shell.song.artist}`}</h1>
            <SheetMusicView songId={id} publicationRevision={revision ?? shell.publicationRevision} renderMode="all" />
          </div>
        </body>
      </html>
    );
  }

  let detail;
  try {
    detail = await getSongDetail(id, revision);
  } catch (error) {
    if (error instanceof PublicationRevisionConflictError) return publicationConflict();
    throw error;
  }
  if (!detail || !detail.data) notFound();
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#fff" }}>
        <SimplifyScore data={detail.data} title={`${detail.song.title} — ${detail.song.artist}`} />
      </body>
    </html>
  );
}
