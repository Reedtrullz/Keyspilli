"use client";

import { SheetMusicView } from "@/components/player/SheetMusicView";

export function ClassicScore({ songId, title }: { songId: string; title: string }) {
  return (
    <div style={{ padding: 40, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, margin: "0 0 16px" }}>{title}</h1>
      {/* Export/print must render every page before the PDF route observes
          __sheetReady; interactive player views use the virtual default. */}
      <SheetMusicView songId={songId} renderMode="all" />
    </div>
  );
}
