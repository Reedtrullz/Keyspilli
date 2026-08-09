"use client";

import { SheetMusicView } from "@/components/player/SheetMusicView";

export function ClassicScore({ songId, title }: { songId: string; title: string }) {
  return (
    <div style={{ padding: 40, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, margin: "0 0 16px" }}>{title}</h1>
      <SheetMusicView songId={songId} />
    </div>
  );
}
