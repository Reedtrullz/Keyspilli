"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Job {
  id: string;
  youtubeUrl: string;
  status: "queued" | "processing" | "done" | "error";
  songId: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export default function YoutubePage() {
  const [url, setUrl] = useState("");
  const [retranscribeSongId, setRetranscribeSongId] = useState("");
  const [retranscribeUrl, setRetranscribeUrl] = useState("");
  const [editSongId, setEditSongId] = useState("");
  const [edit, setEdit] = useState({ title: "", artist: "", key: "", tempo: "" });
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "queued" | "processing" | "done" | "error">("idle");
  const [songId, setSongId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [actionMsg, setActionMsg] = useState("");

  async function refreshJobs() {
    const res = await fetch("/api/youtube/jobs").catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setJobs(data.jobs ?? []);
  }

  useEffect(() => {
    void refreshJobs();
  }, []);

  async function convert() {
    setError("");
    // Give immediate feedback for a malformed URL instead of entering the
    // queued state while the API route is still compiling or responding.
    // This mirrors the server-side contract and keeps the form usable when
    // the browser's native `type=url` validation accepts a non-YouTube URL.
    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url.trim())) {
      setStatus("error");
      setError("paste a valid YouTube URL");
      return;
    }
    setStatus("queued");
    try {
      const res = await fetch("/api/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed to queue");
      setJobId(data.jobId);
      poll(data.jobId);
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  }

  function poll(id: string) {
    const t = window.setInterval(async () => {
      try {
        const r = await fetch(`/api/youtube/status/${id}`);
        const j = await r.json();
        if (j.status === "processing") setStatus("processing");
        else if (j.status === "done") {
          setStatus("done");
          setSongId(j.songId);
          window.clearInterval(t);
        } else if (j.status === "error") {
          setStatus("error");
          setError(j.error ?? "conversion failed");
          window.clearInterval(t);
        }
      } catch {
        window.clearInterval(t);
      }
    }, 3000);
  }

  async function postJob(body: Record<string, unknown>) {
    setError("");
    setActionMsg("");
    const res = await fetch("/api/youtube", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "failed to queue");
    setActionMsg(`Queued job ${data.jobId}`);
    await refreshJobs();
  }

  async function retranscribe() {
    if (!retranscribeSongId.trim() || !retranscribeUrl.trim()) return;
    try {
      await postJob({ url: retranscribeUrl.trim(), songId: retranscribeSongId.trim() });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function editSong() {
    if (!editSongId.trim()) return;
    const body: Record<string, string | number> = {};
    if (edit.title.trim()) body.title = edit.title.trim();
    if (edit.artist.trim()) body.artist = edit.artist.trim();
    if (edit.key.trim()) body.key = edit.key.trim();
    if (edit.tempo.trim()) body.tempo = Number(edit.tempo);
    if (!Object.keys(body).length) return;
    try {
      const res = await fetch(`/api/songs/${editSongId.trim()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "update failed");
      setActionMsg(`Updated ${data.songIds.length} variants`);
      setEdit({ title: "", artist: "", key: "", tempo: "" });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function jobAction(id: string, action: "retry" | "delete") {
    const res = await fetch(`/api/youtube/jobs/${id}${action === "retry" ? "/retry" : ""}`, {
      method: action === "retry" ? "POST" : "DELETE",
    });
    if (res.ok) await refreshJobs();
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-2">YouTube → Sheet Music</h1>
      <p className="text-zinc-600 text-sm mb-6">
        Paste a <strong>solo piano cover</strong> (no vocals or drums, under 5 minutes). A worker downloads the audio,
        transcribes it to MIDI, and creates a full playable arrangement — usually in a minute or two.
      </p>
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-6">
        Experimental: transcription is fully automatic. Clean solo-piano audio works best; fast passages and heavy
        pedal can produce wrong notes. You can always edit the exported MusicXML in MuseScore.
      </p>

      <form
        className="flex gap-2 mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          void convert();
        }}
      >
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          className="flex-1 px-4 py-3 rounded-xl border border-zinc-300 text-sm"
        />
        <button type="submit" disabled={status === "queued" || status === "processing"} className="px-5 py-3 rounded-xl bg-zinc-900 text-white text-sm font-medium disabled:opacity-40">
          Convert
        </button>
      </form>

      {status === "queued" && <p className="text-sm text-zinc-600 mb-4">Queued… the worker will pick this up shortly.</p>}
      {status === "processing" && <p className="text-sm text-indigo-600 mb-4">Transcribing audio → MIDI → arrangements. This takes 1–3 minutes.</p>}
      {status === "done" && songId && (
        <div className="rounded-xl bg-green-50 p-4 text-sm mb-4">
          Conversion complete!
          <Link href={`/player/${songId}`} className="block mt-2 text-indigo-700 font-medium underline">
            Open your new arrangement →
          </Link>
        </div>
      )}
      {status === "error" && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {actionMsg && <p className="text-emerald-700 text-sm mb-4">{actionMsg}</p>}

      <div className="rounded-xl border border-zinc-200 p-4 mb-6">
        <h2 className="font-semibold text-sm mb-3">Re-transcribe an existing song</h2>
        <div className="flex flex-col gap-2">
          <input
            value={retranscribeSongId}
            onChange={(e) => setRetranscribeSongId(e.target.value)}
            placeholder="Song id (e.g. artist-title-vb)"
            className="px-3 py-2 rounded-lg border border-zinc-300 text-sm"
          />
          <input
            type="url"
            value={retranscribeUrl}
            onChange={(e) => setRetranscribeUrl(e.target.value)}
            placeholder="Paste the original video URL"
            className="px-3 py-2 rounded-lg border border-zinc-300 text-sm"
          />
          <button onClick={retranscribe} className="self-start px-4 py-2 rounded-lg bg-zinc-900 text-white text-sm">
            Re-transcribe
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 p-4 mb-6">
        <h2 className="font-semibold text-sm mb-3">Edit song metadata</h2>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input
            value={editSongId}
            onChange={(e) => setEditSongId(e.target.value)}
            placeholder="Song id"
            className="col-span-2 px-3 py-2 rounded-lg border border-zinc-300 text-sm"
          />
          <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Title" className="px-3 py-2 rounded-lg border border-zinc-300 text-sm" />
          <input value={edit.artist} onChange={(e) => setEdit({ ...edit, artist: e.target.value })} placeholder="Artist" className="px-3 py-2 rounded-lg border border-zinc-300 text-sm" />
          <input value={edit.key} onChange={(e) => setEdit({ ...edit, key: e.target.value })} placeholder="Key (e.g. G)" className="px-3 py-2 rounded-lg border border-zinc-300 text-sm" />
          <input value={edit.tempo} onChange={(e) => setEdit({ ...edit, tempo: e.target.value })} placeholder="Tempo BPM" className="px-3 py-2 rounded-lg border border-zinc-300 text-sm" />
        </div>
        <button onClick={editSong} className="px-4 py-2 rounded-lg bg-zinc-900 text-white text-sm">
          Save
        </button>
      </div>

      <h2 className="font-semibold text-sm mb-2">Recent jobs</h2>
      <div className="rounded-xl border border-zinc-200 divide-y divide-zinc-100 mb-6">
        {jobs.length === 0 && <p className="p-4 text-sm text-zinc-500">No jobs yet.</p>}
        {jobs.map((j) => (
          <div key={j.id} className="flex items-center gap-3 p-3 text-sm">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${j.status === "done" ? "bg-green-100 text-green-700" : j.status === "error" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
              {j.status}
            </span>
            <div className="flex-1 min-w-0">
              <p className="truncate text-zinc-700">{j.youtubeUrl}</p>
              <p className="text-xs text-zinc-500">
                {new Date(j.createdAt).toLocaleString()}
                {j.songId && <> · <Link href={`/player/${j.songId}`} className="text-indigo-700 underline">{j.songId}</Link></>}
              </p>
              {j.error && <p className="text-xs text-red-600 mt-0.5">{j.error}</p>}
            </div>
            {(j.status === "done" || j.status === "error") && (
              <div className="flex gap-2 shrink-0">
                <button onClick={() => jobAction(j.id, "retry")} className="px-3 py-1.5 rounded-lg border border-zinc-300 text-xs">Retry</button>
                <button onClick={() => jobAction(j.id, "delete")} className="px-3 py-1.5 rounded-lg border border-zinc-300 text-xs">Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {status === "idle" && (
        <div className="rounded-xl bg-zinc-50 p-4 text-xs text-zinc-500">
          Works best with clear, studio-quality solo piano. Full-band tracks and vocals will not transcribe cleanly.
          The transcription worker must be running — start it with <code className="font-mono">npm run worker -w @keyspilli/transcribe</code>.
        </div>
      )}
    </div>
  );
}
