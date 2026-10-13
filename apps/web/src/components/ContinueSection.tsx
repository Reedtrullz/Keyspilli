"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { levelLabel } from "./level-labels";
import { loadRecent, type RecentSong } from "./recent-songs";
import { displaySong } from "./song-display";

function ago(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function ContinueSection() {
  const [recent, setRecent] = useState<RecentSong[]>([]);
  useEffect(() => setRecent(loadRecent()), []);
  if (recent.length === 0) return null;

  return (
    <section className="mb-8 motion-rise-in" aria-labelledby="continue-heading">
      <h2 id="continue-heading" className="page-title text-xl font-semibold mb-3">Continue where you left off</h2>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {recent.map((r) => {
          const shown = displaySong(r.title, r.artist);
          return (
            <li key={r.baseId}>
              <Link href={`/player/${r.id}`} className="interactive-card block h-full rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400">
                <div className="flex gap-2 text-xs text-zinc-500 mb-1">
                  <span>{levelLabel(r.difficulty)}</span>
                  <span className="ml-auto">{ago(r.at)}</span>
                </div>
                <div className="font-semibold leading-tight">{shown.title}</div>
                {shown.artist && <div className="text-sm text-zinc-500">{shown.artist}</div>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
