"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SymbolicUploadChoice, SymbolicUploadIntent } from "@keyspilli/catalog";
import { AudioEngine } from "@keyspilli/player-core";
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

type UploadResult = { baseId: string; sourceHash: string; publicationRevision: string; songIds: string[]; easySongId: string; title: string; artist: string; reused: boolean; symbolicIntent?: SymbolicUploadIntent };
type SourcePartRole = "melody" | "harmony" | "bass" | "other";
const STUDY_LABEL: Record<NonNullable<SymbolicUploadIntent["study"]>["kind"], string> = {
  "one-note": "One-note",
  triad: "Triad",
  "four-note-phrase": "Four-note phrase",
};
const LEVEL_LABEL: Record<"beginner" | "easy" | "medium" | "advanced", string> = {
  beginner: "Beginner", easy: "Easy", medium: "Medium", advanced: "Advanced",
};
type SymbolicPreflight = {
  preflightId: string;
  sourceHash: string;
  expiresAt: string;
  format: "midi" | "musicxml" | "mxl";
  tempoBpm: number;
  timeSig: [number, number];
  parts: Array<{ id: string; name: string; noteCount: number; lowMidi: number | null; highMidi: number | null; startBeat: number | null; endBeat: number | null; percussion: boolean }>;
  unsupportedControls: string[];
  previewNotes: Array<{ partId: string; midi: number; start: number; dur: number; vel: number }>;
};
type PartChoice = { selected: boolean; role?: SourcePartRole };
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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

function lessonCreatedText(result: UploadResult): string {
  const study = result.symbolicIntent?.study;
  if (!study) return `Lesson created with ${result.songIds.length} available levels.`;
  const levels = study.availableLevels.map((level) => LEVEL_LABEL[level]).join(", ");
  return `${STUDY_LABEL[study.kind]} study created. Available levels: ${levels}.`;
}

export default function UploadsForm({ tutorialEnabled }: { tutorialEnabled: boolean }) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<File | null>(null);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [candidates, setCandidates] = useState<CandidateCard[]>([]);
  const [selectedHandoff, setSelectedHandoff] = useState<HandoffView | null>(null);
  const [targetConfirmed, setTargetConfirmed] = useState(false);
  const [candidateError, setCandidateError] = useState("");
  const [status, setStatus] = useState<"ready" | "uploading" | "existing" | "done" | "error" | "reconciliation">("ready");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState("");
  const [preflight, setPreflight] = useState<SymbolicPreflight | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [partChoices, setPartChoices] = useState<Record<string, PartChoice>>({});
  const [arrangementIntent, setArrangementIntent] = useState<"original" | "backing-only-chords">("original");
  const [rightsAttested, setRightsAttested] = useState(false);
  const [ownerAuthoredStudy, setOwnerAuthoredStudy] = useState(false);
  const [auditioning, setAuditioning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const filePickerButtonRef = useRef<HTMLButtonElement>(null);
  const fileExitRef = useRef<HTMLDivElement>(null);
  const discoveryGeneration = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const preflightAbortRef = useRef<AbortController | null>(null);
  const preflightGenerationRef = useRef(0);
  const usedPreflightRef = useRef<string | null>(null);
  const auditionRef = useRef<{ engine: AudioEngine; timer: ReturnType<typeof setTimeout> } | null>(null);
  const uploadingRef = useRef(false);
  const errorPresence = usePresence(status === "error" || status === "reconciliation");
  const donePresence = usePresence((status === "done" || status === "existing") && Boolean(result));
  const fileSwitch = useAnimatedSwitch(file);
  const targetId = `target-${(artist || "unknown-artist").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${(title || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100);

  function clearDiscovery(): void {
    discoveryGeneration.current++;
    searchAbortRef.current?.abort();
    setSearchState("idle");
    setCandidates([]);
    setSelectedHandoff(null);
    setTargetConfirmed(false);
    setCandidateError("");
  }

  async function searchCandidates() {
    if (!artist.trim() || !title.trim()) return;
    searchAbortRef.current?.abort();
    const generation = ++discoveryGeneration.current;
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchState("searching");
    setCandidates([]);
    setCandidateError("");
    try {
      const response = await fetch(`/api/source-candidates?${new URLSearchParams({ targetId, artist: artist.trim(), title: title.trim() })}`, { signal: controller.signal });
      const data = await responseBody(response);
      if (generation !== discoveryGeneration.current) return;
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
    } catch (cause) {
      if (controller.signal.aborted || generation !== discoveryGeneration.current) return;
      setCandidateError("Source search is temporarily unavailable.");
      setSearchState("unavailable");
    }
  }
  async function selectCandidate(candidateId: string) {
    const generation = ++discoveryGeneration.current;
    setCandidateError("");
    try {
      const response = await fetch("/api/source-handoffs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId, targetId, targetArtist: artist.trim(), targetTitle: title.trim() }),
      });
      const data = await responseBody(response);
      if (generation !== discoveryGeneration.current) return;
      if (!response.ok) throw new Error(response.status === 404 ? "This source lead is no longer available. Search again." : String(data.error ?? "Candidate selection failed."));
      setSelectedHandoff(data.handoff as HandoffView);
      setTargetConfirmed(false);
    } catch (cause) {
      if (generation !== discoveryGeneration.current) return;
      setCandidateError(cause instanceof Error ? cause.message : "Candidate selection failed.");
    }
  }

  async function confirmTarget(confirmed: boolean) {
    const generation = ++discoveryGeneration.current;
    setTargetConfirmed(confirmed);
    if (!confirmed || !selectedHandoff) return;
    try {
      const response = await fetch(`/api/source-handoffs/${encodeURIComponent(selectedHandoff.handoffId)}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userAffirmedTarget: true }),
      });
      const data = await responseBody(response);
      if (generation !== discoveryGeneration.current) return;
      if (!response.ok) throw new Error(response.status === 404 ? "This source lead expired. Search and select it again." : String(data.error ?? "Target confirmation failed."));
      setSelectedHandoff(data.handoff as HandoffView);
    } catch (cause) {
      if (generation !== discoveryGeneration.current) return;
      setTargetConfirmed(false);
      setCandidateError(cause instanceof Error ? cause.message : "Target confirmation failed.");
    }
  }

  function stopAudition(): void {
    const active = auditionRef.current;
    if (!active) return;
    clearTimeout(active.timer);
    active.engine.cancelAll();
    active.engine.dispose();
    auditionRef.current = null;
    setAuditioning(false);
  }

  async function requestSymbolicPreflight(target: File, generation: number): Promise<SymbolicPreflight> {
    preflightAbortRef.current?.abort();
    const controller = new AbortController();
    preflightAbortRef.current = controller;
    setPreflightBusy(true);
    try {
      const response = await fetch("/api/uploads/preflight", {
        method: "POST",
        body: await target.arrayBuffer(),
        signal: controller.signal,
      });
      const data = await responseBody(response);
      if (!response.ok) throw new Error(String(data.error ?? "The symbolic file could not be reviewed."));
      const reviewed = data as unknown as SymbolicPreflight;
      if (preflightGenerationRef.current === generation && preflightAbortRef.current === controller
        && !controller.signal.aborted && fileRef.current === target) setPreflight(reviewed);
      return reviewed;
    } finally {
      if (preflightGenerationRef.current === generation && preflightAbortRef.current === controller) {
        setPreflightBusy(false);
        preflightAbortRef.current = null;
      }
    }
  }

  async function reviewSymbolicFile(): Promise<void> {
    if (!file || file.size > MAX_UPLOAD_BYTES || preflightBusy) return;
    const target = file;
    const generation = ++preflightGenerationRef.current;
    setError("");
    setPreflight(null);
    setPartChoices({});
    setRightsAttested(false);
    setOwnerAuthoredStudy(false);
    setArrangementIntent("original");
    usedPreflightRef.current = null;
    stopAudition();
    try {
      await requestSymbolicPreflight(target, generation);
    } catch (cause) {
      if (generation !== preflightGenerationRef.current || fileRef.current !== target) return;
      if (cause instanceof Error && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "The symbolic file could not be reviewed.");
      setStatus("error");
    }
  }

  function cancelSymbolicReview(): void {
    preflightGenerationRef.current++;
    preflightAbortRef.current?.abort();
    preflightAbortRef.current = null;
    setPreflightBusy(false);
    setPreflight(null);
    setPartChoices({});
    setRightsAttested(false);
    setOwnerAuthoredStudy(false);
    setArrangementIntent("original");
    usedPreflightRef.current = null;
    stopAudition();
    setStatus("ready");
    setError("");
  }

  async function currentSymbolicPreflight(target: File): Promise<SymbolicPreflight> {
    if (preflight && Date.parse(preflight.expiresAt) > Date.now() + 1_000
      && usedPreflightRef.current !== preflight.preflightId) return preflight;
    const generation = ++preflightGenerationRef.current;
    return requestSymbolicPreflight(target, generation);
  }

  function auditionSelectedParts(): void {
    if (!preflight) return;
    stopAudition();
    const selectedIds = new Set(Object.entries(partChoices).filter(([, choice]) => choice.selected).map(([id]) => id));
    const notes = preflight.previewNotes.filter((note) => selectedIds.has(note.partId));
    if (!notes.length) {
      setError("Select a pitched source part to audition its preview.");
      setStatus("error");
      return;
    }
    try {
      const engine = new AudioEngine();
      const ctx = engine.ensure();
      const firstBeat = Math.min(...notes.map((note) => note.start));
      const secondsPerBeat = 60 / Math.max(30, Math.min(300, preflight.tempoBpm));
      const preview = notes.map((note) => ({
        midi: note.midi,
        startSec: (note.start - firstBeat) * secondsPerBeat,
        durSec: Math.min(1.5, Math.max(0.08, note.dur * secondsPerBeat)),
        vel: Math.max(1, Math.min(127, note.vel)),
        hand: "R" as const,
      })).filter((note) => note.startSec < 4.25).slice(0, 64);
      for (const note of preview) engine.noteOn(note, 0.05 + note.startSec);
      const endsAt = Math.max(...preview.map((note) => note.startSec + note.durSec));
      const timer = setTimeout(() => {
        engine.cancelAll();
        engine.dispose();
        if (auditionRef.current?.engine === engine) auditionRef.current = null;
        setAuditioning(false);
      }, Math.min(5_500, Math.ceil((endsAt + 0.25) * 1_000)));
      auditionRef.current = { engine, timer };
      setAuditioning(true);
      void ctx;
    } catch {
      setError("Audio preview is unavailable in this browser.");
      setStatus("error");
    }
  }

  useEffect(() => {
    const layer = fileExitRef.current;
    if (layer) layer.setAttribute("inert", "");
  }, [fileSwitch.previous]);

  useEffect(() => {
    return () => {
      discoveryGeneration.current++;
      searchAbortRef.current?.abort();
      uploadAbortRef.current?.abort();
      preflightAbortRef.current?.abort();
      preflightGenerationRef.current++;
      const active = auditionRef.current;
      if (active) { clearTimeout(active.timer); active.engine.cancelAll(); active.engine.dispose(); auditionRef.current = null; }
    };
  }, []);

  function selectFile(next: File | null): void {
    if (uploadingRef.current) return;
    preflightGenerationRef.current++;
    preflightAbortRef.current?.abort();
    preflightAbortRef.current = null;
    setPreflightBusy(false);
    usedPreflightRef.current = null;
    fileRef.current = next;
    setPreflight(null);
    setPartChoices({});
    setRightsAttested(false);
    setOwnerAuthoredStudy(false);
    setArrangementIntent("original");
    stopAudition();
    setFile(next);
    setStatus("ready");
    setResult(null);
    setError("");
  }

  function chooseStarter(kind: "one-note" | "triad" | "four-note-phrase"): void {
    const pitches = kind === "one-note" ? ["C"] : kind === "triad" ? ["C", "E", "G"] : ["C", "D", "E", "G"];
    const xml = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Starter notes</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${pitches.map((step, index) => `<note>${kind === "triad" && index > 0 ? "<chord/>" : ""}<pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>`).join("")}</measure></part></score-partwise>`;
    clearDiscovery();
    selectFile(new File([xml], `keyspilli-${kind}.musicxml`, { type: "application/vnd.recordare.musicxml+xml" }));
    setTitle(`Starter: ${STUDY_LABEL[kind]}`);
    setArtist("Keyspilli authored exercise");
    if (inputRef.current) inputRef.current.value = "";
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

  async function upload(mode?: "replace") {
    if (!file || uploadingRef.current) return;
    const selectedPartChoices = Object.entries(partChoices)
      .filter(([, choice]) => choice.selected)
      .map(([id, choice]) => ({ id, role: choice.role }));
    if (!preflight || selectedPartChoices.length === 0 || selectedPartChoices.some((part) => !part.role) || !rightsAttested) {
      setError("Review the file, select each source part and role, and confirm your source authorization before publishing.");
      setStatus("error");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("File too large (max 10 MB). Choose a smaller MIDI, MusicXML or MXL file.");
      setStatus("error");
      return;
    }
    uploadingRef.current = true;
    discoveryGeneration.current++;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    const chosenHandoff = selectedHandoff;
    const confirmed = targetConfirmed;
    const chosenTitle = title.trim();
    const chosenArtist = artist.trim();
    const chosenArrangementIntent = arrangementIntent;
    const chosenStudyIntent = ownerAuthoredStudy;
    setStatus("uploading");
    setError("");
    try {
      const params = new URLSearchParams();
      if (chosenTitle) params.set("title", chosenTitle);
      if (chosenArtist) params.set("artist", chosenArtist);
      if (mode === "replace" && result) {
        params.set("mode", "replace");
        params.set("expectedRevision", result.publicationRevision);
      }
      if (chosenHandoff) {
        if (!chosenHandoff.userAffirmedTarget || !confirmed) throw new Error("Confirm the selected source lead before uploading.");
        params.set("handoffId", chosenHandoff.handoffId);
        params.set("userAffirmedTarget", "true");
      }
      const reviewed = await currentSymbolicPreflight(file);
      const choice: SymbolicUploadChoice = {
        selectedParts: selectedPartChoices.map(({ id, role }) => ({ id, role: role! })),
        arrangementIntent: chosenArrangementIntent,
        rightsAttested: true,
        ownerAuthoredStudy: chosenStudyIntent,
      };
      usedPreflightRef.current = reviewed.preflightId;
      const response = await fetch(`/api/uploads?${params}`, {
        method: "POST",
        headers: {
          "x-keyspilli-upload-preflight": reviewed.preflightId,
          "x-keyspilli-upload-choice": JSON.stringify(choice),
        },
        body: await file.arrayBuffer(),
        signal: controller.signal,
      });
      const data = await responseBody(response);
      if (controller.signal.aborted) return;
      if (response.status === 409 && ["UPLOAD_REVISION_STALE", "UPLOAD_INTENT_REVIEW_REQUIRED"].includes(String(data.code)) && data.receipt && typeof data.receipt === "object") {
        setResult({ ...(data.receipt as UploadResult), reused: true });
        setError(data.code === "UPLOAD_INTENT_REVIEW_REQUIRED"
          ? "This file already has a lesson using different part or arrangement choices. Review it before replacing it."
          : "The accepted lesson changed. Review the current version before replacing it.");
        setStatus("existing");
        return;
      }
      if (!response.ok) {
        if (data.reconciliationRequired || data.code === "ARTIFACT_RECONCILIATION_REQUIRED") {
          setError("Upload needs catalog reconciliation. Check its saved state before trying again.");
          setStatus("reconciliation");
          return;
        }
        if (data.code === "UPLOAD_BUSY") throw new Error("Another upload is in progress. Try again shortly.");
        throw new Error(String(data.error ?? "Upload failed."));
      }
      setResult(data as unknown as UploadResult);
      setStatus(data.reused === true ? "existing" : "done");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error && cause.name === "AbortError"
        ? "The request stopped, but server publication may still finish. Check the catalog before retrying."
        : cause instanceof Error ? cause.message : "Upload failed.");
      setStatus("error");
    } finally {
      uploadingRef.current = false;
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
    }
  }

  const retrySearch = searchState === "no-candidates" || searchState === "rate-limited" || searchState === "unavailable";
  const formatWarning = selectedHandoff && !extensionMatches(file, selectedHandoff.expectedFormat);
  const selectedPartIds = Object.entries(partChoices).filter(([, choice]) => choice.selected).map(([id]) => id);
  const backingRolesAllowed = arrangementIntent !== "backing-only-chords"
    || selectedPartIds.every((id) => partChoices[id]?.role === "harmony" || partChoices[id]?.role === "bass");
  const completePartSelection = selectedPartIds.length > 0
    && selectedPartIds.every((id) => Boolean(partChoices[id]?.role));
  const canPublishSymbolic = Boolean(preflight && completePartSelection && rightsAttested
    && backingRolesAllowed
    && (!ownerAuthoredStudy || arrangementIntent === "original"));

  return (
    <div className="page-shell max-w-2xl mx-auto px-4 py-10">
      <h1 className="page-title text-2xl font-bold mb-2 motion-rise-in">Add a song</h1>
      {tutorialEnabled && (
        <section className="surface-card rounded-2xl border border-zinc-200 p-5 my-5" aria-labelledby="youtube-heading">
          <h2 id="youtube-heading" className="font-semibold">Have a YouTube link?</h2>
          <p className="mt-2 text-sm text-zinc-600">Create a piano lesson from a matching tutorial. Private beta.</p>
          <Link href="/youtube" className="pressable inline-block mt-4 px-4 py-2 rounded-full bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700">
            Import from YouTube
          </Link>
        </section>
      )}
      <p className="text-zinc-600 text-sm mb-6 motion-rise-in">
        Create a lesson from an authorized MIDI, MusicXML, or MXL file. Keyspilli validates the uploaded bytes and uses the file&apos;s own timing. Max 10 MB.
      </p>

      <fieldset disabled={status === "uploading"}>
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

      <details id="starter-studies" className="rounded-2xl border border-zinc-200 p-5 mb-5">
        <summary className="min-h-11 cursor-pointer font-semibold">Try a short authored starter study</summary>
        <p className="text-sm my-2">Choose a small C-major exercise, then review its notes and source role before publishing. Choosing a starter does not add anything to your library.</p>
        <div className="flex flex-wrap gap-3">{(["one-note", "triad", "four-note-phrase"] as const).map(kind => <button key={kind} type="button" className="min-h-11 rounded border px-3" disabled={status === "uploading" || preflightBusy} onClick={() => chooseStarter(kind)}>Choose {STUDY_LABEL[kind].toLowerCase()} starter</button>)}</div>
      </details>

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
          if (uploadingRef.current) return;
          selectFile(event.dataTransfer.files?.[0] ?? null);
        }}>
          <div className="motion-state-stack dropzone-content-stack">
            {fileSwitch.previous && <div ref={fileExitRef} className="motion-state-layer-exit" aria-hidden="true">{renderFileSummary(fileSwitch.previous)}</div>}
            <div className="motion-state-layer-enter">{fileSwitch.current ? renderFileSummary(fileSwitch.current) : renderFilePicker()}</div>
          </div>
        </div>
        {formatWarning && <p className="text-sm text-amber-800 mt-2" role="status">This lead expected a {formatLabel(selectedHandoff.expectedFormat)}, but the selected filename looks different. The actual file contents decide whether upload succeeds.</p>}
      </section>

      <section className="rounded-2xl border border-zinc-200 p-5 mb-5" aria-labelledby="symbolic-review-heading">
        <h2 id="symbolic-review-heading" className="font-semibold">4. Review parts and publication intent</h2>
        <p className="text-sm text-zinc-500 mt-1 mb-3">Preflight reads the selected bytes and expires after ten minutes. Nothing enters the catalog until you confirm publication.</p>
        {!preflight ? (
          <button type="button" onClick={reviewSymbolicFile} disabled={!file || preflightBusy || status === "uploading"} className="pressable px-4 py-2 rounded-lg border border-zinc-300 text-sm disabled:opacity-40">
            {preflightBusy ? "Reviewing file…" : "Review file parts"}
          </button>
        ) : <>
          <div className="rounded-xl bg-zinc-50 p-3 text-sm">
            <p>{formatLabel(preflight.format)} · {Math.round(preflight.tempoBpm)} BPM · {preflight.timeSig[0]}/{preflight.timeSig[1]} · source {preflight.sourceHash.slice(0, 12)}</p>
            <p className="text-xs text-zinc-500 mt-1">Review expires {new Date(preflight.expiresAt).toLocaleTimeString()}.</p>
            {preflight.unsupportedControls.length > 0 && <p className="text-xs text-amber-800 mt-2">Unsupported MIDI controls will not be reproduced: {preflight.unsupportedControls.join(", ")}.</p>}
          </div>
          <ul className="mt-3 space-y-2" aria-label="Source parts">
            {preflight.parts.map((part) => {
              const choice = partChoices[part.id];
              return <li key={part.id} className="rounded-xl border border-zinc-200 p-3">
                <div className="flex flex-wrap gap-3 items-start">
                  <label className="flex gap-2 items-start flex-1 min-w-48 text-sm">
                    <input type="checkbox" checked={choice?.selected ?? false} disabled={part.percussion} onChange={(event) => setPartChoices((current) => ({
                      ...current,
                      [part.id]: { ...current[part.id], selected: event.target.checked },
                    }))} />
                    <span><span className="font-medium">{part.name}</span><br />{part.noteCount} note events · MIDI {part.lowMidi ?? "—"}–{part.highMidi ?? "—"} · beat {part.startBeat ?? "—"}–{part.endBeat ?? "—"}{part.percussion ? " · percussion, unsupported for pitched lessons" : ""}</span>
                  </label>
                  <label className="text-xs text-zinc-600">Source role
                    <select aria-label={`Role for ${part.name}`} className="form-control block mt-1 px-2 py-1 rounded border border-zinc-300" disabled={!choice?.selected} value={choice?.role ?? ""} onChange={(event) => setPartChoices((current) => ({
                      ...current,
                      [part.id]: { ...current[part.id], selected: true, role: event.target.value as SourcePartRole },
                    }))}>
                      <option value="" disabled>Choose a role</option>
                      <option value="melody" disabled={arrangementIntent === "backing-only-chords"}>Melody</option>
                      <option value="harmony">Harmony</option>
                      <option value="bass">Bass</option>
                      <option value="other" disabled={arrangementIntent === "backing-only-chords"}>Other</option>
                    </select>
                  </label>
                </div>
              </li>;
            })}
          </ul>
          <fieldset className="mt-4 space-y-2" aria-label="Arrangement intent">
            <legend className="text-sm font-medium">How should the selected parts be used?</legend>
            <label className="flex gap-2 items-start text-sm"><input type="radio" name="arrangement-intent" checked={arrangementIntent === "original"} onChange={() => setArrangementIntent("original")} /> <span>Original: preserve the selected source parts as the lesson basis.</span></label>
            <label className="flex gap-2 items-start text-sm"><input type="radio" name="arrangement-intent" checked={arrangementIntent === "backing-only-chords"} onChange={() => { setArrangementIntent("backing-only-chords"); setOwnerAuthoredStudy(false); }} /> <span>Backing-only Chords: use only owner-identified harmony or bass parts. They are placed in a left-hand accompaniment lane; physical hand suitability is not verified and no melody part is included.</span></label>
          </fieldset>
          {arrangementIntent === "backing-only-chords" && !backingRolesAllowed && <p className="text-sm text-amber-800 mt-2" role="status">Reassign every selected part to Harmony or Bass before publishing a backing-only lesson.</p>}
          <div className="mt-4 space-y-2">
            <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={rightsAttested} onChange={(event) => setRightsAttested(event.target.checked)} /> <span>I created these symbolic bytes or am authorized by the rights holder to upload and use them.</span></label>
            <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={ownerAuthoredStudy} disabled={arrangementIntent !== "original"} onChange={(event) => setOwnerAuthoredStudy(event.target.checked)} /> <span>This is an authorized exact short study (one note, a triad, or a four-note phrase); do not add notes to it.</span></label>
          </div>
          <div className="flex flex-wrap gap-3 mt-4 items-center">
            <button type="button" onClick={auditioning ? stopAudition : auditionSelectedParts} disabled={selectedPartIds.length === 0 || preflightBusy} className="pressable px-3 py-2 rounded-lg border border-zinc-300 text-sm disabled:opacity-40">{auditioning ? "Stop audition" : "Audition selected parts"}</button>
            <button type="button" onClick={reviewSymbolicFile} disabled={!file || preflightBusy} className="pressable px-3 py-2 rounded-lg border border-zinc-300 text-sm disabled:opacity-40">{preflightBusy ? "Reviewing…" : "Review again"}</button>
            <button type="button" onClick={cancelSymbolicReview} disabled={status === "uploading"} className="pressable text-sm text-zinc-600 underline disabled:opacity-40">Cancel review</button>
          </div>
          {ownerAuthoredStudy && arrangementIntent === "original" && <p className="text-xs text-zinc-500 mt-2">The source must contain exactly one note, three simultaneous distinct pitches, or four notes across multiple onsets. Only levels that pass the normal playability limits will be published.</p>}
        </>}
      </section>
      </fieldset>

      {(errorPresence.mounted || donePresence.mounted) && <div className="upload-status-slot mb-4">
        {errorPresence.mounted && <p className="motion-presence text-red-600 text-sm" data-state={errorPresence.visible ? "open" : "closed"} aria-hidden={status !== "error" && status !== "reconciliation"} role="alert">{error}</p>}
        {donePresence.mounted && result && <div className="motion-presence rounded-xl bg-green-50 p-4 text-sm" data-state={donePresence.visible ? "open" : "closed"} aria-hidden={status !== "done" && status !== "existing"} role="status">
          {status === "existing" ? <>
            <p><span className="font-medium">{result.title}</span> by {result.artist} already has an accepted lesson. Your current details have not changed it.</p>
            {error && <p className="mt-2 text-amber-800" role="alert">{error}</p>}
            <div className="mt-2 flex flex-wrap gap-3">
              <Link href={`/player/${result.easySongId}`} className="pressable text-indigo-700 font-medium underline">Open accepted lesson →</Link>
              <button type="button" onClick={() => setStatus("done")} className="pressable text-zinc-700 underline">Reuse this lesson</button>
              <button type="button" onClick={() => upload("replace")} className="pressable text-red-700 underline">Replace using the details above</button>
            </div>
          </> : <>
            {result.reused ? "Using the accepted lesson." : lessonCreatedText(result)}
            <div className="mt-2 flex flex-wrap gap-3">
              <Link href={`/player/${result.easySongId}`} className="pressable text-indigo-700 font-medium underline">Open in the player →</Link>
              <button type="button" onClick={reset} className="pressable text-zinc-700 underline">Add another song</button>
            </div>
          </>}
        </div>}
      </div>}

      <button type="button" onClick={() => upload()} disabled={!file || !canPublishSymbolic || status === "uploading" || status === "done" || status === "existing" || status === "reconciliation"} className="pressable w-full py-3 rounded-xl bg-zinc-900 text-white font-medium disabled:opacity-40">
        {status === "uploading" ? "Validating and generating…" : "Confirm and publish lesson"}
      </button>
    </div>
  );
}
