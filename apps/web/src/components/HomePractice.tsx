"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { loadPracticeState, PRACTICE_STATE_EVENT, PRACTICE_STATE_KEY, type PracticeState } from "@keyspilli/player-core";
import type { GroupedSong } from "@keyspilli/catalog/runtime";

export function HomePractice({ publicTotal }: { publicTotal: number }) {
  const [state, setState] = useState<PracticeState | null>(null), [songs, setSongs] = useState<GroupedSong[]>([]), [notice, setNotice] = useState("");
  useEffect(() => {
    const refresh = () => setState(loadPracticeState());
    const storage = (e: StorageEvent) => { if (e.key === PRACTICE_STATE_KEY || e.key === null) refresh(); };
    refresh(); window.addEventListener(PRACTICE_STATE_EVENT, refresh); window.addEventListener("storage", storage);
    return () => { window.removeEventListener(PRACTICE_STATE_EVENT, refresh); window.removeEventListener("storage", storage); };
  }, []);
  useEffect(() => {
    if (!state) return;
    const ids = [...new Set([state.resume?.target.variantId, ...state.attempts.slice(0, 5).map(run => run.target.variantId)].filter((id): id is string => !!id))];
    if (!ids.length) { setSongs([]); setNotice(""); return; }
    const abort = new AbortController(); setNotice("Checking your recent arrangements…");
    void fetch("/api/songs?group=1&limit=6", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }), signal: abort.signal })
      .then(async response => { if (!response.ok) throw Error(); const value = await response.json(); if (!Array.isArray(value.songs)) throw Error(); if (!abort.signal.aborted) { setSongs(value.songs); setNotice(""); } })
      .catch(() => { if (!abort.signal.aborted) setNotice("Recent arrangements could not be checked. Browse the library or reload to retry."); });
    return () => abort.abort();
  }, [state]);
  const available = (variant: string, base: string) => songs.find(song => song.representative.baseId === base && song.levels.some(level => level.id === variant));
  const resume = state?.resume, last = resume ? available(resume.target.variantId, resume.target.baseId) : undefined;
  const passage = state?.passages.find(item => item.id === resume?.passageId);
  return <section className="mb-6 border rounded-xl p-4" aria-label="Your practice workspace">
    <h1 className="page-title text-2xl font-semibold">Your practice</h1>
    {notice && <p role="status">{notice}</p>}
    {resume && !notice && (last ? <div className="my-3">
      <Link className="min-h-11 inline-flex items-center underline" href={`/player/${resume.target.variantId}`}>Open last practice: {last.representative.title}{passage ? ` · ${passage.name}` : ""}</Link>
      <p className="text-sm text-zinc-600">Saved position and passage are checked against the current arrangement in the player. Choose Resume deliberately; playback does not start automatically.</p>
    </div> : <p>The previous arrangement is unavailable. Its bookmark is retained; choose an available song below.</p>)}
    {!resume && <p className="my-3">{publicTotal ? "Choose a song and a short passage to practise. Your saved work will appear here." : "Add your own MIDI or MusicXML to start. The library is empty."}</p>}
    {!!state?.attempts.length && <><h2 className="font-semibold">Recent activity</h2><ul>{state.attempts.slice(0, 5).map(run => {
      const song = available(run.target.variantId, run.target.baseId);
      return <li key={run.id} className="my-2">{song ? <Link className="underline" href={`/player/${run.target.variantId}`}>{song.representative.title}</Link> : "Unavailable arrangement"} · {run.outcome} · {run.context.input} · {Math.round(run.context.speed * 100)}%</li>;
    })}</ul></>}
    <div className="flex gap-4"><Link className="min-h-11 inline-flex items-center underline" href="/songs">Browse songs</Link><Link className="min-h-11 inline-flex items-center underline" href="/uploads">Add a song</Link><Link className="min-h-11 inline-flex items-center underline" href="/uploads#starter-studies">Try a starter study</Link></div>
  </section>;
}
