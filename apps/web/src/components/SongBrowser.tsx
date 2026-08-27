"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadJson } from "@keyspilli/player-core";
import { LEVEL_LABEL, LEVEL_SHORT } from "./level-labels";

interface GroupedSong {
  representative: { id: string; title: string; artist: string; key: string; tempo: number };
  levels: { id: string; difficulty: string }[];
  totalPlays: number;
}

const DIFFICULTIES = ["very-beginner", "beginner", "very-easy", "easy", "medium", "advanced"];
const KEYS = ["C", "D", "E", "F", "G", "A", "B", "Bb", "Eb", "Ab", "Db", "F#", "C#"];
const BASS = ["block", "octave", "oompah", "walking", "pedal", "arpeggio"];
export function SongBrowser() {
  const [songs, setSongs] = useState<GroupedSong[]>([]);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [key, setKey] = useState("");
  const [bass, setBass] = useState("");
  const [sort, setSort] = useState("popular");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => loadJson("keyspilli.favorites", [] as string[]));
  const [learned, setLearned] = useState<string[]>(() => loadJson("keyspilli.learned", [] as string[]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams({ sort, limit: "2000", group: "1" });
    if (q) params.set("q", q);
    if (difficulty) params.set("difficulty", difficulty);
    if (key) params.set("key", key);
    if (bass) params.set("bass", bass);
    setLoading(true);
    fetch(`/api/songs?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setSongs(d.songs ?? []);
        setError("");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [q, difficulty, key, bass, sort]);

  useEffect(() => {
    const t = setTimeout(() => setQ(input), 200);
    return () => clearTimeout(t);
  }, [input]);

  const visible = useMemo(
    () =>
      favoritesOnly
        ? songs.filter((s) => s.levels.some((l) => favorites.includes(l.id)))
        : songs,
    [songs, favoritesOnly, favorites],
  );
  const activeFilterCount = [difficulty, key, bass, sort !== "popular" ? sort : "", favoritesOnly ? "favorites" : ""].filter(Boolean).length;

  return (
    <div aria-busy={loading}>
      <div className="library-toolbar flex flex-wrap gap-2 mb-4 items-center">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search title or artist…"
          className="form-control px-3 py-2 rounded-lg border border-zinc-300 text-sm w-56"
          aria-label="Search songs"
        />
        <button
          type="button"
          className="library-filter-toggle pressable min-h-11 items-center rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          aria-expanded={filtersOpen}
          aria-controls="song-library-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
        <div id="song-library-filters" className="library-filters flex flex-wrap items-center gap-2" data-open={filtersOpen}>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="form-control px-2 py-2 rounded-lg border border-zinc-300 text-sm" aria-label="Difficulty">
            <option value="">All difficulties</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>{LEVEL_LABEL[d] ?? d}</option>
            ))}
          </select>
          <select value={key} onChange={(e) => setKey(e.target.value)} className="form-control px-2 py-2 rounded-lg border border-zinc-300 text-sm" aria-label="Key">
            <option value="">All keys</option>
            {KEYS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <select value={bass} onChange={(e) => setBass(e.target.value)} className="form-control px-2 py-2 rounded-lg border border-zinc-300 text-sm" aria-label="Bass pattern">
            <option value="">All bass patterns</option>
            {BASS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="form-control px-2 py-2 rounded-lg border border-zinc-300 text-sm" aria-label="Sort">
            <option value="popular">Most played</option>
            <option value="title">Title A–Z</option>
            <option value="artist">Artist A–Z</option>
            <option value="difficulty">Difficulty ↑</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={favoritesOnly} onChange={(e) => setFavoritesOnly(e.target.checked)} />
            Favorites only
          </label>
        </div>
        <span className="library-count text-xs text-zinc-600" role="status" aria-live="polite">{loading ? "Loading…" : `${visible.length} songs`}</span>
      </div>
      {error && <p className="motion-feedback text-red-600 text-sm mb-3" role="alert">{error}</p>}
      {!loading && visible.length === 0 && <p className="motion-feedback text-zinc-500 py-8 text-center">No songs match these filters.</p>}
      <ul className="library-results motion-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-loading={loading}>
        {visible.map((s) => {
          const fav = s.levels.some((l) => favorites.includes(l.id));
          const done = s.levels.some((l) => learned.includes(l.id));
          return (
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
                <div className="text-sm text-zinc-500 flex gap-2">
                  <span>{s.representative.artist}</span>
                  {fav && <span className="text-rose-500">♥</span>}
                  {done && <span className="text-green-600">✓ learned</span>}
                </div>
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
          );
        })}
      </ul>
    </div>
  );
}
