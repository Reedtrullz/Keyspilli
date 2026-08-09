import Link from "next/link";
import { getDb } from "@keyspilli/catalog";

export const dynamic = "force-dynamic";

export default function ArtistsPage() {
  const rows = getDb()
    .prepare(
      "SELECT artist, COUNT(*) AS c, SUM(plays) AS plays FROM songs GROUP BY artist ORDER BY artist COLLATE NOCASE",
    )
    .all() as { artist: string; c: number; plays: number }[];
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-4">Artists</h1>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {rows.map((r) => (
          <li key={r.artist}>
            <Link href={`/artist/${encodeURIComponent(r.artist)}`} className="block rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400">
              <div className="font-medium">{r.artist}</div>
              <div className="text-sm text-zinc-500">{r.c} arrangements</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
