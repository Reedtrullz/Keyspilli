import { notFound } from "next/navigation";
import React from "react";
import { getSongDetail, getSongDetailShell } from "@/lib/catalog-api";
import { SimplifyScore } from "@/components/export/SimplifyScore";
import { ClassicScore } from "@/components/export/ClassicScore";

export const dynamic = "force-dynamic";

export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ layout?: string }>;
}) {
  const { id } = await params;
  const { layout } = await searchParams;
  if (layout !== undefined && layout !== "simplify" && layout !== "classic") notFound();
  // A classic export is a MusicXML-backed surface. Do not silently downgrade
  // a direct classic request to the simplified score: callers (including the
  // PDF worker) need a deterministic unavailable response instead. The
  // ClassicScore client only needs identity plus the XML artifact id, so keep
  // the large notes/chords payload out of its RSC flight data.
  if (layout === "classic") {
    const shell = await getSongDetailShell(id);
    if (!shell || shell.song.hasSheetXml !== 1) notFound();
    return (
      <html lang="en">
        <body style={{ margin: 0, background: "#fff" }}>
          <ClassicScore songId={id} title={`${shell.song.title} — ${shell.song.artist}`} />
        </body>
      </html>
    );
  }

  const detail = await getSongDetail(id);
  if (!detail || !detail.data) notFound();
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#fff" }}>
        <SimplifyScore data={detail.data} title={`${detail.song.title} — ${detail.song.artist}`} />
      </body>
    </html>
  );
}
