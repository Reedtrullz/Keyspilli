"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadStringList } from "@keyspilli/player-core";
import { PUBLIC_DIFFICULTY_ORDER, isPublicDifficultyLevel } from "@keyspilli/midi";
import { LEVEL_LABEL, LEVEL_SHORT } from "./level-labels";

interface GroupedSong {
  representative: { id: string; baseId: string; title: string; artist: string; key: string; tempo: number };
  levels: { id: string; difficulty: string }[];
  totalPlays: number;
  lastCreatedAt: string;
}

const KEYS = ["C", "D", "E", "F", "G", "A", "B", "Bb", "Eb", "Ab", "Db", "F#", "C#"];
const BASS = ["block", "octave", "oompah", "walking", "pedal", "arpeggio"];

const PAGE_SIZE = 60;
const DEFAULT_QUERY = { q: "", importMethod: "", key: "", bass: "", artist: "", difficulty: "", style: "", mood: "", category: "", sort: "popular", favorites: false, page: 1 };
type LibraryQuery = typeof DEFAULT_QUERY;

export function readLibraryQuery(params: URLSearchParams): LibraryQuery {
  const pick = (key: string, choices: readonly string[], fallback = "") => choices.includes(params.get(key) ?? "") ? params.get(key)! : fallback;
  const page = Number(params.get("page"));
  return {
    q: (params.get("q") ?? "").slice(0, 256), artist: (params.get("artist") ?? "").slice(0, 256),
    style: (params.get("style") ?? "").slice(0, 256), mood: (params.get("mood") ?? "").slice(0, 256), category: (params.get("category") ?? "").slice(0, 256),
    importMethod: pick("importMethod", ["midi", "sheet-music", "youtube", "other"]),
    key: pick("key", KEYS), bass: pick("bass", BASS), difficulty: pick("difficulty", PUBLIC_DIFFICULTY_ORDER),
    sort: pick("sort", ["popular", "title", "artist", "difficulty", "newest"], "popular"),
    favorites: params.get("favorites") === "1", page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

export function writeLibraryQuery(params: URLSearchParams, query: LibraryQuery): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("legacy"); // This library only displays public levels.
  for (const [key, value] of Object.entries(query)) {
    next.delete(key);
    if (value !== DEFAULT_QUERY[key as keyof LibraryQuery]) next.set(key, key === "favorites" ? "1" : String(value));
  }
  return next;
}

function publicLevelRows(levels: GroupedSong["levels"]): GroupedSong["levels"] {
  const byDifficulty = new Map(
    levels.filter((level) => isPublicDifficultyLevel(level.difficulty)).map((level) => [level.difficulty, level]),
  );
  return PUBLIC_DIFFICULTY_ORDER.flatMap((difficulty) => {
    const level = byDifficulty.get(difficulty);
    return level ? [level] : [];
  });
}

export function experimentLabelsForSongs(songs: GroupedSong[]): Map<string, string> {
  const identity = ({ representative }: GroupedSong) =>
    `${representative.artist.trim().toLowerCase()}\u0000${representative.title.trim().toLowerCase()}`;
  const counts = new Map<string, number>();
  for (const song of songs) counts.set(identity(song), (counts.get(identity(song)) ?? 0) + 1);

  return new Map(songs.flatMap((song) => {
    if ((counts.get(identity(song)) ?? 0) < 2) return [];
    const token = song.representative.baseId.split("-").at(-1) || song.representative.baseId;
    const runId = token.slice(-8);
    const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.exec(song.lastCreatedAt)?.[0]?.replace("T", " ");
    return [[song.representative.id, `Experiment ${runId} · ${timestamp ?? "unknown time"} UTC`]];
  }));
}

export function SongBrowser() {
  const [songs, setSongs] = useState<GroupedSong[]>([]);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState<LibraryQuery>({ ...DEFAULT_QUERY });
  const [ready, setReady] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [learned, setLearned] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function navigate(next: LibraryQuery) {
    const params = writeLibraryQuery(new URLSearchParams(window.location.search), next);
    window.history.pushState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
    setQuery(next);
  }
  function filter(next: Partial<LibraryQuery>) { navigate({ ...query, ...next, page: 1 }); }

  useEffect(() => {
    const restore = () => {
      const next = readLibraryQuery(new URLSearchParams(window.location.search));
      setQuery(next); setInput(next.q);
      const params = writeLibraryQuery(new URLSearchParams(window.location.search), next);
      window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
    };
    const restoreLists = () => {
      setFavorites(loadStringList("keyspilli.favorites"));
      setLearned(loadStringList("keyspilli.learned"));
    };
    restore(); restoreLists(); setReady(true);
    window.addEventListener("popstate", restore);
    window.addEventListener("storage", restoreLists);
    return () => { window.removeEventListener("popstate", restore); window.removeEventListener("storage", restoreLists); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ sort: query.sort, limit: String(PAGE_SIZE), offset: String((query.page - 1) * PAGE_SIZE), group: "1" });
    for (const key of ["q", "importMethod", "key", "bass", "difficulty", "artist", "style", "mood", "category"] as const) if (query[key]) params.set(key, query[key]);
    setLoading(true); setError(""); setSongs([]);
    fetch(`/api/songs?${params}`, { signal: controller.signal, ...(query.favorites ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: favorites }),
    } : {}) })
      .then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Could not load songs"); return data; })
      .then(d => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(d.songs) || !Number.isSafeInteger(d.total) || d.total < 0) throw new Error("Invalid library response");
        const lastPage = Math.max(1, Math.ceil(d.total / PAGE_SIZE));
        if (query.page > lastPage) { navigate({ ...query, page: lastPage }); return; }
        setSongs(d.songs); setTotal(d.total);
      })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load songs"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [ready, query, favorites, retry]);

  useEffect(() => {
    if (!ready || input === query.q) return;
    const timer = setTimeout(() => filter({ q: input.slice(0, 256) }), 200);
    return () => clearTimeout(timer);
  }, [input, ready, query]);

  const visible = songs;
  const experimentLabels = useMemo(() => experimentLabelsForSongs(visible), [visible]);
  const { importMethod, key, bass, difficulty, sort, favorites: favoritesOnly } = query;
  const activeFilterCount = [importMethod, key, bass, difficulty, query.artist, query.style, query.mood, query.category, favoritesOnly ? "favorites" : ""].filter(Boolean).length;
  const narrowed = Boolean(activeFilterCount || query.q);
  function reset() { setInput(""); navigate({ ...DEFAULT_QUERY }); }

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
          <select value={importMethod} onChange={(e) => filter({ importMethod: e.target.value })} className="form-control px-2 py-2 rounded-lg border border-zinc-300 text-sm" aria-label="Import method">
            <option value="">All import methods</option>
            <option value="midi">MIDI</option>
            <option value="sheet-music">Sheet music (MusicXML)</option>
            <option value="youtube">YouTube</option>
            <option value="other">Other / unknown</option>
          </select>
          <select value={key} onChange={(e) => filter({ key: e.target.value })} className="form-control px-2 py-2 rounded-lg border border-zinc-300 text-sm" aria-label="Key">
            <option value="">All keys</option>
            {KEYS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <select value={bass} onChange={(e) => filter({ bass: e.target.value })} className="form-control px-2 py-2 rounded-lg border border-zinc-300 text-sm" aria-label="Bass pattern">
            <option value="">All bass patterns</option>
            {BASS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <select value={difficulty} onChange={e => filter({ difficulty: e.target.value })} aria-label="Difficulty" className="form-control px-2 py-2 rounded-lg border border-zinc-300 text-sm">
            <option value="">All public levels</option>
            {PUBLIC_DIFFICULTY_ORDER.map(level => <option key={level} value={level}>{LEVEL_LABEL[level]}</option>)}
          </select>
          <select value={sort} onChange={(e) => filter({ sort: e.target.value })} className="form-control px-2 py-2 rounded-lg border border-zinc-300 text-sm" aria-label="Sort">
            <option value="popular">Most played</option>
            <option value="title">Title A–Z</option>
            <option value="artist">Artist A–Z</option>
            <option value="difficulty">Difficulty ↑</option>
            <option value="newest">Recently added</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={favoritesOnly} onChange={(e) => filter({ favorites: e.target.checked })} />
            Favorites only
          </label>
        </div>
        {(narrowed || sort !== "popular") && <button type="button" onClick={reset} className="pressable min-h-11 px-3 underline">Reset filters</button>}
        <span className="library-count text-xs text-zinc-600" role="status" aria-live="polite">{loading ? "Loading…" : `${visible.length} of ${total} songs`}</span>
      </div>
      {(query.style || query.mood || query.category) && <p className="text-xs text-zinc-600 mb-3">{[["Style",query.style],["Mood",query.mood],["Category",query.category]].filter(([,value])=>value).map(([label,value])=>`${label}: ${value}`).join(" · ")}</p>}
      {error && <div role="alert" className="text-red-600 text-sm mb-3">{error} <button type="button" onClick={() => setRetry(value => value + 1)} className="pressable min-h-11 px-3 underline">Retry</button></div>}
      {!loading && !error && visible.length === 0 && <div className="motion-feedback text-zinc-500 py-8 text-center">
        <p>{favoritesOnly ? favorites.length ? "No available songs match your favorites and filters." : "You have no favorites yet. Choose a song and mark a level as a favorite in the player." : narrowed ? "No songs match these filters." : "Your library is empty."}</p>
        {narrowed ? <button type="button" onClick={reset} className="pressable min-h-11 px-3 underline">Browse all songs</button> : <Link href="/uploads" className="pressable underline">Add a song</Link>}
      </div>}
      <ul className="library-results motion-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-loading={loading}>
        {visible.map((s) => {
          const fav = favoritesOnly || s.levels.some((l) => favorites.includes(l.id));
          const done = s.levels.some((l) => learned.includes(l.id));
          const publicLevels = publicLevelRows(s.levels);
          const experimentLabel = experimentLabels.get(s.representative.id);
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
                {experimentLabel && (
                  <div className="mt-1 text-xs font-mono text-zinc-500" title={`Full run ID: ${s.representative.baseId}`}>
                    {experimentLabel}
                  </div>
                )}
                <div className="mt-3" role="group" aria-label={`Difficulty levels for ${s.representative.title}`}>
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Levels</span>
                  <div className="flex flex-wrap gap-1">
                  {publicLevels.map((l) => (
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
      {!error && total > PAGE_SIZE && <nav aria-label="Song library pages" className="flex gap-4 items-center mt-4">
        <button type="button" disabled={loading || query.page <= 1} onClick={() => navigate({ ...query, page: query.page - 1 })} className="pressable min-h-11 px-3 underline disabled:opacity-40">Previous page</button>
        <span>Page {query.page} of {Math.ceil(total / PAGE_SIZE)}</span>
        <button type="button" disabled={loading || query.page * PAGE_SIZE >= total} onClick={() => navigate({ ...query, page: query.page + 1 })} className="pressable min-h-11 px-3 underline disabled:opacity-40">Next page</button>
      </nav>}
    </div>
  );
}
