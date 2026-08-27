"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAnimatedSwitch, usePresence } from "../../components/player/player-motion";

export default function UploadsPage() {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<{ baseId: string; songIds: string[] } | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const filePickerButtonRef = useRef<HTMLButtonElement>(null);
  const fileExitRef = useRef<HTMLDivElement>(null);
  const errorPresence = usePresence(status === "error");
  const donePresence = usePresence(status === "done" && Boolean(result));
  const fileSwitch = useAnimatedSwitch(file);

  // The outgoing file summary is aria-hidden for the exit frame. Make the
  // subtree inert as well so focus cannot remain on its Remove button while
  // the picker returns underneath it.
  useEffect(() => {
    const layer = fileExitRef.current;
    if (layer) layer.setAttribute("inert", "");
  }, [fileSwitch.previous]);

  const renderFileSummary = (selected: File) => (
    <div className="motion-feedback">
      <p className="font-medium truncate" title={selected.name}>{selected.name}</p>
      <p className="text-xs text-zinc-500">{selected.size.toLocaleString()} bytes</p>
      <button
        onClick={() => {
          setFile(null);
          window.requestAnimationFrame(() => filePickerButtonRef.current?.focus());
        }}
        className="pressable text-xs text-zinc-500 underline mt-1"
      >
        Remove
      </button>
    </div>
  );

  const renderFilePicker = () => (
    <div>
      <p className="text-sm text-zinc-500 mb-3">Drop your .mid, .midi, .musicxml or .mxl here</p>
      <button ref={filePickerButtonRef} onClick={() => inputRef.current?.click()} className="pressable px-4 py-2 rounded-full bg-zinc-900 text-white text-sm">
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
  );

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
    <div className="page-shell max-w-2xl mx-auto px-4 py-10">
      <h1 className="page-title text-2xl font-bold mb-2 motion-rise-in">Upload your own song</h1>
      <p className="text-zinc-600 text-sm mb-6 motion-rise-in">
        Drop a MIDI or MusicXML file and it becomes a playable, color-coded lesson with all six difficulty levels. Max 10 MB.
      </p>

      <div className="dropzone rounded-2xl border-2 border-dashed border-zinc-300 p-8 text-center mb-5 motion-scale-in" onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) setFile(f);
      }}>
        <div className="motion-state-stack dropzone-content-stack">
          {fileSwitch.previous && (
            <div ref={fileExitRef} className="motion-state-layer-exit" aria-hidden="true">
              {renderFileSummary(fileSwitch.previous)}
            </div>
          )}
          <div className="motion-state-layer-enter">
            {fileSwitch.current ? renderFileSummary(fileSwitch.current) : renderFilePicker()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
        <label className="text-sm">
          Title (optional)
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="form-control mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300" placeholder="My Song" />
        </label>
        <label className="text-sm">
          Artist (optional)
          <input value={artist} onChange={(e) => setArtist(e.target.value)} className="form-control mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300" placeholder="Me" />
        </label>
      </div>

      {(errorPresence.mounted || donePresence.mounted) && (
        <div className="upload-status-slot mb-4">
          {errorPresence.mounted && (
            <p
              className="motion-presence text-red-600 text-sm"
              data-state={errorPresence.visible ? "open" : "closed"}
              aria-hidden={status !== "error"}
              role="alert"
            >
              {error}
            </p>
          )}
          {donePresence.mounted && result && (
            <div
              className="motion-presence rounded-xl bg-green-50 p-4 text-sm"
              data-state={donePresence.visible ? "open" : "closed"}
              aria-hidden={status !== "done"}
              role="status"
            >
              Done! {result.songIds.length} arrangements created.
              <div className="mt-2">
                <Link href={`/player/${result.songIds[0]}`} className="pressable text-indigo-700 font-medium underline">
                  Open in the player →
                </Link>
              </div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={upload}
        disabled={!file || status === "uploading"}
        className="pressable w-full py-3 rounded-xl bg-zinc-900 text-white font-medium disabled:opacity-40"
      >
        {status === "uploading" ? "Processing…" : "Upload & create lesson"}
      </button>
    </div>
  );
}
