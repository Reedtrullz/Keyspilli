import { notFound } from "next/navigation";
import React from "react";
import { getSongDetail } from "@/lib/catalog-api";
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
  const detail = await getSongDetail(id);
  if (!detail || !detail.data) notFound();
  // A classic export is a MusicXML-backed surface. Do not silently downgrade
  // a direct classic request to the simplified score: callers (including the
  // PDF worker) need a deterministic unavailable response instead.
  if (layout === "classic" && detail.song.hasSheetXml !== 1) notFound();
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#fff" }}>
        {layout === "classic" && detail.song.hasSheetXml === 1 ? (
          <ClassicScore songId={id} title={`${detail.song.title} — ${detail.song.artist}`} />
        ) : (
          <SimplifyScore data={detail.data} title={`${detail.song.title} — ${detail.song.artist}`} />
        )}
      </body>
    </html>
  );
}
