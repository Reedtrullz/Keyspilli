import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSongDetail } from "@/lib/catalog-api";
import { Player, type PlayerDetail } from "@/components/player/Player";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const detail = await getSongDetail(id);
  if (!detail) return { title: "Not found" };
  return { title: `${detail.song.title} by ${detail.song.artist} (${detail.song.difficulty})` };
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getSongDetail(id);
  if (!detail || !detail.data) notFound();
  return <Player initial={detail as PlayerDetail} mode={null} />;
}
