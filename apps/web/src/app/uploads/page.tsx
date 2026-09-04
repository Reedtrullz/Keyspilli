"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAnimatedSwitch, usePresence } from "../../components/player/player-motion";

type CandidateCard = {
  candidateId: string;
  resultTitle: string;
  resultSnippet: string | null;
  provider: string;
  candidateUrl: string | null;
  symbolicFormat: string;
  identity: string;
};

type HandoffView = {
  handoffId: string;
  candidateId: string;
  provider: string;
  expectedFormat: "midi" | "musicxml" | "mxl";
  userAffirmedTarget: boolean;
};

export default function UploadsPage() {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [candidateSearch, setCandidateSearch] = useState<"idle" | "searching" | "ready" | "missing" | "error">("idle");
  const [candidates, setCandidates] = useState<CandidateCard[]>([]);
  const [selectedHandoff, setSelectedHandoff] = useState<HandoffView | null>(null);
  const [targetConfirmed, setTargetConfirmed] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [result, setResult] = useState<{ baseId: string; songIds: string[]; easySongId?: string | null } | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const filePickerButtonRef = useRef<HTMLButtonElement>(null);
  const fileExitRef = useRef<HTMLDivElement>(null);
  const errorPresence = usePresence(status === "error");
  const donePresence = usePresence(status === "done" && Boolean(result));
  const fileSwitch = useAnimatedSwitch(file);
  const targetId = `target-${(artist || "unknown-artist").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${(title || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100);

  async function searchCandidates() {
    if (!artist.trim() || !title.trim()) return;
    setCandidateSearch("searching");
    setCandidateError("");
    try {
      const response = await fetch(`/api/source-candidates?${new URLSearchParams({ targetId, artist: artist.trim(), title: title.trim() })}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "source search failed");
      setCandidates(data.candidates ?? []);
      setCandidateSearch(data.status === "provider-missing" ? "missing" : "ready");
    } catch (e) {
      setCandidateError((e as Error).message);
      setCandidateSearch("error");
    }
  }

  async function selectCandidate(candidateId: string) {
    setCandidateError("");
    try {
      const response = await fetch("/api/source-handoffs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId, targetId, targetArtist: artist.trim(), targetTitle: title.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "candidate selection failed");
      setSelectedHandoff(data.handoff);
      setTargetConfirmed(false);
    } catch (e) {
      setCandidateError((e as Error).message);
    }
  }

  async function confirmTarget(confirmed: boolean) {
    setTargetConfirmed(confirmed);
    if (!confirmed || !selectedHandoff) return;
    try {
      const response = await fetch(`/api/source-handoffs/${encodeURIComponent(selectedHandoff.handoffId)}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userAffirmedTarget: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "target confirmation failed");
      setSelectedHandoff(data.handoff);
    } catch (e) {
      setTargetConfirmed(false);
      setCandidateError((e as Error).message);
    }
  }

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
      if (selectedHandoff) {
        if (!selectedHandoff.userAffirmedTarget || !targetConfirmed) throw new Error("confirm the selected source lead before uploading");
        params.set("handoffId", selectedHandoff.handoffId);
        params.set("userAffirmedTarget", "true");
      }
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
        Symbolic upload: drop a MIDI, MusicXML, or MXL file and it becomes a playable, color-coded lesson with all five public difficulty levels. The file's own timing is used. Max 10 MB. YouTube conversion is a separate experimental path.
      </p>

      <section className="rounded-2xl border border-zinc-200 p-5 mb-5" aria-labelledby="source-leads-heading">
        <h2 id="source-leads-heading" className="font-semibold">Have a source lead?</h2>
        <p className="text-sm text-zinc-500 mt-1 mb-3">Search metadata only, then open the source yourself. Keyspilli never downloads a lead automatically.</p>
        <button type="button" onClick={searchCandidates} disabled={!artist.trim() || !title.trim() || candidateSearch === "searching"} className="pressable px-3 py-2 rounded-lg border border-zinc-300 text-sm disabled:opacity-40">
          {candidateSearch === "searching" ? "Searching…" : "Find source leads"}
        </button>
        {candidateSearch === "missing" && <p className="text-sm text-zinc-500 mt-3">No source search provider is configured yet. You can still upload a file directly.</p>}
        {candidateError && <p className="text-sm text-red-600 mt-3" role="alert">{candidateError}</p>}
        {candidates.length > 0 && (
          <div className="mt-4 space-y-3">
            {candidates.map((candidate) => (
              <article key={candidate.candidateId} className="rounded-xl bg-zinc-50 p-3 text-sm">
                <p className="font-medium">{candidate.resultTitle}</p>
                <p className="text-xs text-zinc-500">{candidate.provider} · {candidate.symbolicFormat} · {candidate.identity.replaceAll("IDENTITY_", "").toLowerCase()}</p>
                {candidate.resultSnippet && <p className="text-xs text-zinc-600 mt-1">{candidate.resultSnippet}</p>}
                <div className="flex gap-3 items-center mt-2">
                  {candidate.candidateUrl && <a href={candidate.candidateUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">Open source ↗</a>}
                  <button type="button" onClick={() => selectCandidate(candidate.candidateId)} className="pressable text-indigo-700 underline">Use as a lead</button>
                </div>
              </article>
            ))}
          </div>
        )}
        {selectedHandoff && (
          <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm">
            <p>Selected <span className="font-medium">{selectedHandoff.candidateId}</span> from {selectedHandoff.provider}.</p>
            <label className="flex gap-2 items-start mt-2">
              <input type="checkbox" checked={targetConfirmed} onChange={(e) => confirmTarget(e.target.checked)} />
              <span>I confirm this source lead matches the title and artist above, and I am authorized to upload and use the symbolic file I provide.</span>
            </label>
            <p className="text-xs text-zinc-600 mt-2">Expected format: {selectedHandoff.expectedFormat}. Source timing remains metadata-only; your upload is still treated as private user-supplied symbolic timing.</p>
          </div>
        )}
      </section>

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
              Done! Your song is ready with five public levels.
              <div className="mt-2">
                <Link href={`/player/${result.easySongId ?? result.songIds[0]}`} className="pressable text-indigo-700 font-medium underline">
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
