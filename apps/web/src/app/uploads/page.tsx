"use client";

import { useRef, useState } from "react";
import Link from "next/link";

export default function UploadsPage() {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<{ baseId: string; songIds: string[] } | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload() {
    if (!file) return;
    setStatus("uploading");
    setError("");
    try {
      const params = new URLSearchParams();
      if (title.trim()) params.set("title", title.trim());
      if (artist.trim()) params.set("artist", artist.trim());
      const res = await fetch(`/api/uploads?${params}`, {
        method: "POST",
        body: await file.arrayBuffer(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "upload failed");
      setResult(data);
      setStatus("done");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-2">Upload your own song</h1>
      <p className="text-zinc-600 text-sm mb-6">
        Drop a MIDI or MusicXML file and it becomes a playable, color-coded lesson with all six difficulty levels. Max 10 MB.
      </p>

      <div className="rounded-2xl border-2 border-dashed border-zinc-300 p-8 text-center mb-5" onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) setFile(f);
      }}>
        {file ? (
          <div>
            <p className="font-medium">{file.name}</p>
            <p className="text-xs text-zinc-500">{file.size.toLocaleString()} bytes</p>
            <button onClick={() => setFile(null)} className="text-xs text-zinc-500 underline mt-1">Remove</button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-zinc-500 mb-3">Drop your .mid, .midi, .musicxml or .mxl here</p>
            <button onClick={() => inputRef.current?.click()} className="px-4 py-2 rounded-full bg-zinc-900 text-white text-sm">
              Browse files
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".mid,.midi,.musicxml,.mxl,audio/midi"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        <label className="text-sm">
          Title (optional)
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300" placeholder="My Song" />
        </label>
        <label className="text-sm">
          Artist (optional)
          <input value={artist} onChange={(e) => setArtist(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300" placeholder="Me" />
        </label>
      </div>

      {status === "error" && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {status === "done" && result && (
        <div className="rounded-xl bg-green-50 p-4 mb-4 text-sm">
          Done! {result.songIds.length} arrangements created.
          <div className="mt-2">
            <Link href={`/player/${result.songIds[0]}`} className="text-indigo-700 font-medium underline">
              Open in the player →
            </Link>
          </div>
        </div>
      )}

      <button
        onClick={upload}
        disabled={!file || status === "uploading"}
        className="w-full py-3 rounded-xl bg-zinc-900 text-white font-medium disabled:opacity-40"
      >
        {status === "uploading" ? "Processing…" : "Upload & create lesson"}
      </button>
    </div>
  );
}
