import type { Metadata } from "next";
import React from "react";
import { notFound } from "next/navigation";
import { getSongDetail, getSongDetailShell } from "@/lib/catalog-api";
import { Player, type PlayerDetail, type PlayerShell } from "@/components/player/Player";
import type { ViewMode } from "@keyspilli/player-core";

export const dynamic = "force-dynamic";

const MODES: ViewMode[] = ["falling", "beginner", "sheet", "leadsheet"];

export async function generateMetadata({ params }: { params: Promise<{ id: string; mode: string }> }): Promise<Metadata> {
  const { id } = await params;
  const shell = await getSongDetailShell(id);
  if (!shell) return { title: "Not found" };
  return { title: `${shell.song.title} by ${shell.song.artist} (${shell.song.difficulty})` };
}

export default async function PlayerModePage({ params }: { params: Promise<{ id: string; mode: string }> }) {
  const { id, mode } = await params;
  if (!(MODES as string[]).includes(mode)) notFound();

  // SheetMusicView fetches MusicXML by song id and does not need the large
  // notes/chords payload. Keep the direct sheet RSC payload metadata-only;
  // Player loads the complete detail client-side when practice controls or a
  // different view are requested.
  if (mode === "sheet") {
    const shell = await getSongDetailShell(id);
    if (!shell) notFound();
    return <Player initial={shell as PlayerShell} mode="sheet" />;
  }

  const detail = await getSongDetail(id);
  if (!detail || !detail.data) notFound();
  return <Player initial={detail as PlayerDetail} mode={mode as ViewMode} />;
}
