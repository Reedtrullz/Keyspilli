import Link from "next/link";
import { listSongs } from "@keyspilli/catalog";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const artist = decodeURIComponent(slug);
  const songs = listSongs({ artist, sort: "popular", limit: 200 });
  if (songs.length === 0) notFound();
  const keys = [...new Set(songs.map((s) => s.key))].slice(0, 8);
  const difficulties = [...new Set(songs.map((s) => s.difficulty))];
  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold">{artist}</h1>
      <p className="text-sm text-zinc-500 mb-2">
        {songs.length} arrangements · keys: {keys.join(", ")} · {difficulties.join(", ")}
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {songs.map((s) => (
          <li key={s.id}>
            <Link href={`/player/${s.id}`} className="block rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400">
              <div className="flex gap-2 text-xs text-zinc-500">
                <span className="font-mono">{s.key}</span>
                <span>{s.difficulty}</span>
                <span>{s.tempo} BPM</span>
              </div>
              <div className="font-medium">{s.title}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
