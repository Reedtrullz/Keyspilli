"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface Song {
  id: string;
  title: string;
  artist: string;
  difficulty: string;
  key: string;
  tempo: number;
  plays: number;
  mood: string;
  bassPattern: string;
  style: string;
}

const DIFFICULTIES = ["very-beginner", "beginner", "very-easy", "easy", "medium", "advanced"];
const KEYS = ["C", "D", "E", "F", "G", "A", "B", "Bb", "Eb", "Ab", "Db", "F#", "C#"];
const BASS = ["block", "octave", "oompah", "walking", "pedal", "arpeggio"];

export function SongBrowser() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [key, setKey] = useState("");
  const [bass, setBass] = useState("");
  const [sort, setSort] = useState("popular");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams({ sort, limit: "200" });
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

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search title or artist…"
          className="px-3 py-2 rounded-lg border border-zinc-300 text-sm w-56"
          aria-label="Search songs"
        />
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="px-2 py-2 rounded-lg border border-zinc-300 text-sm" aria-label="Difficulty">
          <option value="">All difficulties</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select value={key} onChange={(e) => setKey(e.target.value)} className="px-2 py-2 rounded-lg border border-zinc-300 text-sm" aria-label="Key">
          <option value="">All keys</option>
          {KEYS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <select value={bass} onChange={(e) => setBass(e.target.value)} className="px-2 py-2 rounded-lg border border-zinc-300 text-sm" aria-label="Bass pattern">
          <option value="">All bass patterns</option>
          {BASS.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="px-2 py-2 rounded-lg border border-zinc-300 text-sm" aria-label="Sort">
          <option value="popular">Most played</option>
          <option value="title">Title A–Z</option>
          <option value="artist">Artist A–Z</option>
          <option value="difficulty">Difficulty ↑</option>
        </select>
        <span className="text-xs text-zinc-500">{loading ? "Loading…" : `${songs.length} results`}</span>
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {!loading && songs.length === 0 && <p className="text-zinc-500 py-8 text-center">No songs match these filters.</p>}
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {songs.map((s) => (
          <li key={s.id}>
            <Link href={`/player/${s.id}`} className="block rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-400 transition-colors">
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
    </div>
  );
}
