"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { readLibraryReturn, saveLibraryReturn, transferLibraryReturn } from "../../lib/library-navigation";
import { NavigationFeedback } from "../NavigationFeedback";

export function LibraryReturnLink({ songId, variants }: { songId: string; variants: { id: string }[] }) {
  const [href, setHref] = useState("/songs");
  useEffect(() => {
    const context = readLibraryReturn();
    if (context && variants.some(variant => variant.id === context.playerId)) transferLibraryReturn(context.playerId, songId);
    setHref(readLibraryReturn(songId)?.href ?? "/songs");
  }, [songId, variants]);
  return <Link href={href} className="player-library-link" aria-label="Return to library" title="Return to library" onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const context = readLibraryReturn(songId);
    if (context) saveLibraryReturn({ ...context, restoreScroll: true });
  }}>←<NavigationFeedback destination="Songs" /></Link>;
}
