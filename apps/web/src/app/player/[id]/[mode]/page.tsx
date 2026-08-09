import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSongDetail } from "@/lib/catalog-api";
import { Player, type PlayerDetail } from "@/components/player/Player";
import type { ViewMode } from "@keyspilli/player-core";

export const dynamic = "force-dynamic";

const MODES: ViewMode[] = ["falling", "beginner", "sheet", "leadsheet"];

export async function generateMetadata({ params }: { params: Promise<{ id: string; mode: string }> }): Promise<Metadata> {
  const { id } = await params;
  const detail = await getSongDetail(id);
  if (!detail) return { title: "Not found" };
  return { title: `${detail.song.title} by ${detail.song.artist} (${detail.song.difficulty})` };
}

export default async function PlayerModePage({ params }: { params: Promise<{ id: string; mode: string }> }) {
  const { id, mode } = await params;
  const detail = await getSongDetail(id);
  if (!detail || !detail.data || !(MODES as string[]).includes(mode)) notFound();
  return <Player initial={detail as PlayerDetail} mode={mode as ViewMode} />;
}
