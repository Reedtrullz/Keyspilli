"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAnimatedSwitch, usePresence } from "../../components/player/player-motion";

type SearchState = "idle" | "searching" | "candidates-found" | "no-candidates" | "provider-not-configured" | "rate-limited" | "unavailable";

type CandidateCard = {
  candidateId: string;
  resultTitle: string;
  resultSnippet: string | null;
  provider: string;
  candidateUrl: string | null;
  symbolicFormat: string;
  identity: string;
  rights: string;
  timing: string;
};

type HandoffView = {
  handoffId: string;
  candidateId: string;
  provider: string;
  expectedFormat: "midi" | "musicxml" | "mxl";
  userAffirmedTarget: boolean;
};

type UploadResult = { baseId: string; songIds: string[]; easySongId?: string | null };

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function formatLabel(format: string): string {
  if (format === "midi") return "MIDI file";
  if (format === "musicxml") return "MusicXML file";
  if (format === "mxl") return "MXL file";
  return format;
}

function identityLabel(identity: string): string {
  return identity.replace(/^IDENTITY_/, "").replaceAll("_", " ").toLowerCase();
}

function extensionMatches(file: File | null, expected: HandoffView["expectedFormat"] | undefined): boolean {
  if (!file || !expected) return true;
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (expected === "midi") return extension === "mid" || extension === "midi";
  if (expected === "musicxml") return extension === "musicxml" || extension === "xml";
  return extension === "mxl";
}

export default function UploadsPage() {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [candidates, setCandidates] = useState<CandidateCard[]>([]);
  const [selectedHandoff, setSelectedHandoff] = useState<HandoffView | null>(null);
  const [targetConfirmed, setTargetConfirmed] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const [status, setStatus] = useState<"ready" | "uploading" | "done" | "error">("ready");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const filePickerButtonRef = useRef<HTMLButtonElement>(null);
  const fileExitRef = useRef<HTMLDivElement>(null);
  const errorPresence = usePresence(status === "error");
  const donePresence = usePresence(status === "done" && Boolean(result));
  const fileSwitch = useAnimatedSwitch(file);
  const targetId = `target-${(artist || "unknown-artist").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${(title || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100);

  function clearDiscovery(): void {
    setSearchState("idle");
    setCandidates([]);
    setSelectedHandoff(null);
    setTargetConfirmed(false);
    setCandidateError("");
  }

  async function searchCandidates() {
    if (!artist.trim() || !title.trim()) return;
    setSearchState("searching");
    setCandidates([]);
    setCandidateError("");
    try {
      const response = await fetch(`/api/source-candidates?${new URLSearchParams({ targetId, artist: artist.trim(), title: title.trim() })}`);
      const data = await responseBody(response);
      if (!response.ok) {
        setCandidateError(typeof data.error === "string" ? data.error : "Source search is temporarily unavailable.");
        setSearchState(data.code === "SOURCE_SEARCH_RATE_LIMITED" ? "rate-limited" : "unavailable");
        return;
      }
      const nextCandidates = Array.isArray(data.candidates) ? data.candidates as CandidateCard[] : [];
      setCandidates(nextCandidates);
      setSearchState(data.status === "candidates-found"
        ? "candidates-found"
        : data.status === "provider-not-configured"
          ? "provider-not-configured"
          : "no-candidates");
    } catch {
      setCandidateError("Source search is temporarily unavailable.");
      setSearchState("unavailable");
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
      const data = await responseBody(response);
      if (!response.ok) throw new Error(response.status === 404 ? "This source lead is no longer available. Search again." : String(data.error ?? "Candidate selection failed."));
      setSelectedHandoff(data.handoff as HandoffView);
      setTargetConfirmed(false);
    } catch (cause) {
      setCandidateError(cause instanceof Error ? cause.message : "Candidate selection failed.");
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
      const data = await responseBody(response);
      if (!response.ok) throw new Error(response.status === 404 ? "This source lead expired. Search and select it again." : String(data.error ?? "Target confirmation failed."));
      setSelectedHandoff(data.handoff as HandoffView);
    } catch (cause) {
      setTargetConfirmed(false);
      setCandidateError(cause instanceof Error ? cause.message : "Target confirmation failed.");
    }
  }

  useEffect(() => {
    const layer = fileExitRef.current;
    if (layer) layer.setAttribute("inert", "");
  }, [fileSwitch.previous]);

  function selectFile(next: File | null): void {
    setFile(next);
    setStatus("ready");
    setResult(null);
    setError("");
  }

  function reset(): void {
    setTitle("");
    setArtist("");
    selectFile(null);
    clearDiscovery();
    if (inputRef.current) inputRef.current.value = "";
    window.requestAnimationFrame(() => document.getElementById("song-title")?.focus());
  }

  const renderFileSummary = (selected: File) => (
    <div className="motion-feedback">
      <p className="font-medium truncate" title={selected.name}>{selected.name}</p>
      <p className="text-xs text-zinc-500">{selected.size.toLocaleString()} bytes</p>
      <button type="button" onClick={() => {
        selectFile(null);
        window.requestAnimationFrame(() => filePickerButtonRef.current?.focus());
      }} className="pressable text-xs text-zinc-500 underline mt-1">Remove</button>
    </div>
  );

  const renderFilePicker = () => (
    <div>
      <p className="text-sm text-zinc-500 mb-3">Drop your .mid, .midi, .musicxml or .mxl here</p>
      <button type="button" ref={filePickerButtonRef} onClick={() => inputRef.current?.click()} className="pressable px-4 py-2 rounded-full bg-zinc-900 text-white text-sm">Browse files</button>
      <input ref={inputRef} type="file" accept=".mid,.midi,.musicxml,.mxl,audio/midi" className="hidden" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} />
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
        if (!selectedHandoff.userAffirmedTarget || !targetConfirmed) throw new Error("Confirm the selected source lead before uploading.");
        params.set("handoffId", selectedHandoff.handoffId);
        params.set("userAffirmedTarget", "true");
      }
      const response = await fetch(`/api/uploads?${params}`, { method: "POST", body: await file.arrayBuffer() });
      const data = await responseBody(response);
      if (!response.ok) throw new Error(String(data.error ?? "Upload failed."));
      setResult(data as unknown as UploadResult);
      setStatus("done");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
      setStatus("error");
    }
  }

  const retrySearch = searchState === "no-candidates" || searchState === "rate-limited" || searchState === "unavailable";
  const formatWarning = selectedHandoff && !extensionMatches(file, selectedHandoff.expectedFormat);

  return (
    <div className="page-shell max-w-2xl mx-auto px-4 py-10">
      <h1 className="page-title text-2xl font-bold mb-2 motion-rise-in">Add a song</h1>
      <p className="text-zinc-600 text-sm mb-6 motion-rise-in">
        Create a lesson from an authorized MIDI, MusicXML, or MXL file. Keyspilli validates the uploaded bytes and uses the file&apos;s own timing. Max 10 MB.
      </p>

      <section className="rounded-2xl border border-zinc-200 p-5 mb-5" aria-labelledby="song-details-heading">
        <h2 id="song-details-heading" className="font-semibold">1. Song details</h2>
        <p className="text-sm text-zinc-500 mt-1 mb-3">Optional for direct upload; required only when searching for a source lead.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm">Title (optional)
            <input id="song-title" value={title} onChange={(event) => { setTitle(event.target.value); clearDiscovery(); }} className="form-control mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300" placeholder="My Song" />
          </label>
          <label className="text-sm">Artist (optional)
            <input value={artist} onChange={(event) => { setArtist(event.target.value); clearDiscovery(); }} className="form-control mt-1 w-full px-3 py-2 rounded-lg border border-zinc-300" placeholder="Artist" />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 p-5 mb-5" aria-labelledby="source-leads-heading">
        <h2 id="source-leads-heading" className="font-semibold">2. Find source leads (optional)</h2>
        <p className="text-sm text-zinc-500 mt-1 mb-3">Search metadata only, then open a source yourself. Keyspilli never fetches a result page or music file.</p>
        <button type="button" onClick={searchCandidates} disabled={!artist.trim() || !title.trim() || searchState === "searching"} className="pressable px-3 py-2 rounded-lg border border-zinc-300 text-sm disabled:opacity-40">
          {searchState === "searching" ? "Searching…" : retrySearch ? "Try source search again" : "Find source leads"}
        </button>
        <div aria-live="polite">
          {searchState === "provider-not-configured" && <p className="text-sm text-zinc-600 mt-3">Source search is not configured. You can upload an authorized file directly.</p>}
          {searchState === "no-candidates" && <p className="text-sm text-zinc-600 mt-3">Keyspilli couldn&apos;t find a usable symbolic source lead in the bounded search. If you already have an authorized file, upload it directly.</p>}
          {(searchState === "rate-limited" || searchState === "unavailable") && <p className="text-sm text-red-600 mt-3" role="alert">{candidateError}</p>}
        </div>
        {candidates.length > 0 && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-amber-800 bg-amber-50 rounded-lg p-3">Search results are leads only. Keyspilli has not verified that you have permission to use them or that the linked file matches the song.</p>
            {candidates.map((candidate) => (
              <article key={candidate.candidateId} className="rounded-xl bg-zinc-50 p-3 text-sm">
                <p className="font-medium">{candidate.resultTitle}</p>
                <p className="text-xs text-zinc-500 mt-1">{candidate.provider} · {formatLabel(candidate.symbolicFormat)} · Song match: {identityLabel(candidate.identity)}</p>
                <p className="text-xs text-zinc-500">Permission: {candidate.rights === "UNKNOWN_RIGHTS" ? "you must verify" : "review source terms"} · Timing: {candidate.timing === "UNKNOWN_TIMING" ? "unverified" : "review required"}</p>
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
            <p>Selected metadata lead <span className="font-medium">{selectedHandoff.candidateId}</span> from {selectedHandoff.provider}. You still need to provide the file.</p>
            <label className="flex gap-2 items-start mt-2">
              <input type="checkbox" checked={targetConfirmed} onChange={(event) => confirmTarget(event.target.checked)} />
              <span>I confirm this lead matches the title and artist above, and I am authorized to upload and use the symbolic file I provide.</span>
            </label>
            <p className="text-xs text-zinc-600 mt-2">Expected format: {formatLabel(selectedHandoff.expectedFormat)}. Your uploaded bytes remain authoritative for format and timing.</p>
          </div>
        )}
        {candidateError && searchState !== "rate-limited" && searchState !== "unavailable" && <p className="text-sm text-red-600 mt-3" role="alert">{candidateError}</p>}
      </section>

      <section className="mb-5" aria-labelledby="file-heading">
        <h2 id="file-heading" className="font-semibold mb-3">3. Choose a symbolic file</h2>
        <div className="dropzone rounded-2xl border-2 border-dashed border-zinc-300 p-8 text-center motion-scale-in" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          event.preventDefault();
          selectFile(event.dataTransfer.files?.[0] ?? null);
        }}>
          <div className="motion-state-stack dropzone-content-stack">
            {fileSwitch.previous && <div ref={fileExitRef} className="motion-state-layer-exit" aria-hidden="true">{renderFileSummary(fileSwitch.previous)}</div>}
            <div className="motion-state-layer-enter">{fileSwitch.current ? renderFileSummary(fileSwitch.current) : renderFilePicker()}</div>
          </div>
        </div>
        {formatWarning && <p className="text-sm text-amber-800 mt-2" role="status">This lead expected a {formatLabel(selectedHandoff.expectedFormat)}, but the selected filename looks different. The actual file contents decide whether upload succeeds.</p>}
      </section>

      {(errorPresence.mounted || donePresence.mounted) && <div className="upload-status-slot mb-4">
        {errorPresence.mounted && <p className="motion-presence text-red-600 text-sm" data-state={errorPresence.visible ? "open" : "closed"} aria-hidden={status !== "error"} role="alert">{error}</p>}
        {donePresence.mounted && result && <div className="motion-presence rounded-xl bg-green-50 p-4 text-sm" data-state={donePresence.visible ? "open" : "closed"} aria-hidden={status !== "done"} role="status">
          Lesson created with five public levels.
          <div className="mt-2 flex flex-wrap gap-3">
            <Link href={`/player/${result.easySongId ?? result.songIds[0]}`} className="pressable text-indigo-700 font-medium underline">Open in the player →</Link>
            <button type="button" onClick={reset} className="pressable text-zinc-700 underline">Add another song</button>
          </div>
        </div>}
      </div>}

      <button type="button" onClick={upload} disabled={!file || status === "uploading" || status === "done"} className="pressable w-full py-3 rounded-xl bg-zinc-900 text-white font-medium disabled:opacity-40">
        {status === "uploading" ? "Validating and generating…" : "Upload & create lesson"}
      </button>
    </div>
  );
}
