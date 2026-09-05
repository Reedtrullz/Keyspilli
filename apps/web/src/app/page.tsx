import Link from "next/link";
import { listSongsGrouped, countSongs, getDb, projectPublicGroupedSongs, type GroupedSong } from "@keyspilli/catalog";
import { LEVEL_LABEL, LEVEL_SHORT } from "../components/level-labels";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const popular = projectPublicGroupedSongs(listSongsGrouped({ sort: "popular", limit: 12 }));
  const recent = projectPublicGroupedSongs(listSongsGrouped({ limit: 200 })).sort((a, b) => (a.lastCreatedAt < b.lastCreatedAt ? 1 : -1)).slice(0, 12);
  const plays = (getDb().prepare("SELECT COALESCE(SUM(plays),0) AS s FROM songs").get() as { s: number }).s;
  const total = countSongs();

  return (
    <div className="page-shell max-w-6xl mx-auto px-4 py-8">
      <section className="home-hero mb-8 text-center py-5 sm:py-6 motion-rise-in">
        <h1 className="page-title text-3xl sm:text-4xl font-bold tracking-tight mb-2">Play the songs you love, in hours.</h1>
        <p className="text-zinc-600 mb-6">
          Color-coded notes, falling keys, and sheet music — built for one pianist. No accounts, no paywalls.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link href="/songs" className="pressable px-5 py-2.5 rounded-full bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700">
            Browse songs
          </Link>
          <Link href="/uploads" className="pressable px-5 py-2.5 rounded-full border border-zinc-300 text-sm font-medium hover:bg-zinc-100">
            Add a song
          </Link>
        </div>
        <p className="mt-6 text-sm text-zinc-500">
          {total} arrangements · {plays.toLocaleString()} plays
        </p>
      </section>

      <section className="mb-8 motion-rise-in">
        <h2 className="page-title text-xl font-semibold mb-3">Most played</h2>
        <SongGrid songs={popular} />
      </section>

      <section className="motion-rise-in">
        <h2 className="page-title text-xl font-semibold mb-3">Recently added</h2>
        <SongGrid songs={recent} />
      </section>
    </div>
  );
}

function SongGrid({ songs }: { songs: GroupedSong[] }) {
  return (
    <ul className="motion-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {songs.map((s) => (
        <li key={s.representative.id}>
          <div className="interactive-card rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400 transition-colors h-full">
            <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
              <span className="font-mono">{s.representative.key}</span>
              <span>{s.representative.tempo} BPM</span>
              <span className="ml-auto">{s.totalPlays > 0 ? `${s.totalPlays} plays` : ""}</span>
            </div>
            <Link href={`/player/${s.representative.id}`} className="font-semibold leading-tight hover:underline">
              {s.representative.title}
            </Link>
            <div className="text-sm text-zinc-500">{s.representative.artist}</div>
            <div className="mt-3" role="group" aria-label={`Difficulty levels for ${s.representative.title}`}>
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Levels</span>
              <div className="flex flex-wrap gap-1">
                {s.levels.map((l) => (
                  <Link
                    key={l.id}
                    href={`/player/${l.id}`}
                    title={`${LEVEL_LABEL[l.difficulty] ?? l.difficulty} arrangement`}
                    aria-label={`Open ${LEVEL_LABEL[l.difficulty] ?? l.difficulty} level`}
                    className="pressable px-2 py-0.5 rounded-full border border-zinc-300 text-[11px] text-zinc-600 hover:bg-zinc-900 hover:text-white hover:border-zinc-900"
                  >
                    {LEVEL_SHORT[l.difficulty] ?? l.difficulty}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
