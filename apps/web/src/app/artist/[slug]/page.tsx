import Link from "next/link";
import { listSongsGrouped, countSongsGrouped, PUBLIC_DIFFICULTY_ORDER } from "@keyspilli/catalog/runtime";
import { notFound } from "next/navigation";
import { levelLabel } from "../../../components/level-labels";
import { displaySong } from "../../../components/song-display";

export const dynamic = "force-dynamic";

export default async function ArtistPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ page?: string }> }) {
  const { slug } = await params;
  const artist = decodeURIComponent(slug);
  const requested = Number((await searchParams).page);
  const total = countSongsGrouped({ artist, publicOnly: true });
  if (total === 0) notFound();
  const pages = Math.ceil(total / 60);
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, pages) : 1;
  const songs = listSongsGrouped({ artist, publicOnly: true, sort: "popular", limit: 60, offset: (page - 1) * 60 });
  const levels = songs.flatMap(song => song.levels);
  const keys = [...new Set(levels.map((s) => s.key))].slice(0, 8);
  const difficulties = PUBLIC_DIFFICULTY_ORDER.filter((difficulty) => levels.some((song) => song.difficulty === difficulty)).map(levelLabel);
  return (
    <div className="page-shell max-w-6xl mx-auto px-4 py-8">
      <h1 className="page-title text-2xl font-bold motion-rise-in">{artist}</h1>
      <p className="motion-rise-in text-sm text-zinc-500 mb-2">
        {songs.length} of {total} songs · keys on this page: {keys.join(", ")} · {difficulties.join(", ")}
      </p>
      <ul className="motion-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {songs.map(({ representative: s, levels }) => (
          <li key={s.id} className="interactive-card rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400">
            <Link href={`/player/${s.id}`} className="block">
              <div className="flex gap-2 text-xs text-zinc-500">
                <span className="font-mono">{s.key}</span>
                <span>{s.tempo} BPM</span>
              </div>
              <div className="font-semibold leading-tight" title={s.title}>{displaySong(s.title, s.artist).title}</div>
            </Link>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`Difficulty levels for ${s.title}`}>
              {levels.map(level => <Link key={level.id} className="pressable min-h-11 flex items-center underline text-xs" href={`/player/${level.id}`}>{levelLabel(level.difficulty)}</Link>)}
            </div>
          </li>
        ))}
      </ul>
      <nav aria-label="Artist pages" className="flex gap-4 mt-4">
        {page > 1 && <Link href={`?page=${page - 1}`}>Previous page</Link>}
        <span>Page {page} of {pages}</span>
        {page < pages && <Link href={`?page=${page + 1}`}>Next page</Link>}
      </nav>
    </div>
  );
}
