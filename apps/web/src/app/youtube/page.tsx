"use client";

import { useState } from "react";
import Link from "next/link";

export default function YoutubePage() {
  const [url, setUrl] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "queued" | "processing" | "done" | "error">("idle");
  const [songId, setSongId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function convert() {
    setError("");
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
      {status === "idle" && (
        <div className="rounded-xl bg-zinc-50 p-4 text-xs text-zinc-500">
          Works best with clear, studio-quality solo piano. Full-band tracks and vocals will not transcribe cleanly.
          The transcription worker must be running — start it with <code className="font-mono">npm run worker -w @keyspilli/transcribe</code>.
        </div>
      )}
    </div>
  );
}
