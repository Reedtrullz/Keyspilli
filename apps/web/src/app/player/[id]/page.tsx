import type { Metadata } from "next";
import { notFound } from "next/navigation";
import React from "react";
import { getSongDetail } from "@/lib/catalog-api";
import { Player, type PlayerDetail } from "@/components/player/Player";
import { levelLabel } from "../../../components/level-labels";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  // getSongDetail is request-memoized at the catalog boundary, so metadata
  // and the page share one artifact/policy read for this id.
  const detail = await getSongDetail(id);
  if (!detail) return { title: "Not found" };
  return { title: `${detail.song.title} by ${detail.song.artist} (${levelLabel(detail.song.difficulty)})` };
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Keep this call on the same request-scoped loader used by metadata above.
  const detail = await getSongDetail(id);
  if (!detail || !detail.data) notFound();
  return <Player initial={detail as PlayerDetail} mode={null} />;
}
