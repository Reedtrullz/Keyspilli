import Link from "next/link";
import { listSongs, countSongs, getDb } from "@keyspilli/catalog";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const popular = listSongs({ sort: "popular", limit: 12 });
  const recent = listSongs({ limit: 12 }).sort(
    (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
  );
  const plays = (getDb().prepare("SELECT COALESCE(SUM(plays),0) AS s FROM songs").get() as { s: number }).s;
  const total = countSongs();

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <section className="mb-10 text-center py-8">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">Play the songs you love, in hours.</h1>
        <p className="text-zinc-600 mb-6">
          Color-coded notes, falling keys, and sheet music — built for one pianist. No accounts, no paywalls.
        </p>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link href="/songs" className="px-5 py-2.5 rounded-full bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700">
            Browse songs
          </Link>
          <Link href="/uploads" className="px-5 py-2.5 rounded-full border border-zinc-300 text-sm font-medium hover:bg-zinc-100">
            Upload your own MIDI
          </Link>
          <Link href="/youtube" className="px-5 py-2.5 rounded-full border border-zinc-300 text-sm font-medium hover:bg-zinc-100">
            YouTube → sheet music
          </Link>
        </div>
        <p className="mt-6 text-sm text-zinc-500">
          {total} arrangements · {plays.toLocaleString()} plays
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Most played</h2>
        <SongGrid songs={popular} />
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Recently added</h2>
        <SongGrid songs={recent} />
      </section>
    </div>
  );
}

function SongGrid({ songs }: { songs: ReturnType<typeof listSongs> }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {songs.map((s) => (
        <li key={s.id}>
          <Link
            href={`/player/${s.id}`}
            className="block rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400 transition-colors"
          >
            <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
              <span className="font-mono">{s.key}</span>
              <span>{s.difficulty}</span>
              <span>{s.tempo} BPM</span>
              <span className="ml-auto">{s.plays > 0 ? `${s.plays} plays` : ""}</span>
            </div>
            <div className="font-medium leading-tight">{s.title}</div>
            <div className="text-sm text-zinc-500">{s.artist}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
