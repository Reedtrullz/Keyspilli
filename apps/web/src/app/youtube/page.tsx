"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAnimatedSwitch, usePresence } from "../../components/player/player-motion";

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
  const [edit, setEdit] = useState({ title: "", artist: "", key: "", playbackTempo: "", calibrationTempo: "" });
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "queued" | "processing" | "done" | "error">("idle");
  const [songId, setSongId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [actionMsg, setActionMsg] = useState("");
  const [maintainerOpen, setMaintainerOpen] = useState(false);
  const maintainerPanelRef = useRef<HTMLDivElement>(null);
  const statusExitRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const maintainerPresence = usePresence(maintainerOpen);
  const statusSwitch = useAnimatedSwitch(status);
  const actionPresence = usePresence(Boolean(actionMsg));

  useEffect(() => {
    const panel = maintainerPanelRef.current;
    if (!panel) return;
    if (!maintainerPresence.visible) panel.setAttribute("inert", "");
    else panel.removeAttribute("inert");
  }, [maintainerPresence.mounted, maintainerPresence.visible]);

  useEffect(() => {
    const layer = statusExitRef.current;
    if (layer) layer.setAttribute("inert", "");
  }, [statusSwitch.previous]);

  useEffect(() => () => {
    if (pollTimerRef.current !== null) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

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
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
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
    if (pollTimerRef.current !== null) window.clearInterval(pollTimerRef.current);
    let elapsed = 0;
    const t = window.setInterval(async () => {
      elapsed += 3000;
      try {
        const r = await fetch(`/api/youtube/status/${id}`);
        const j = await r.json();
        if (j.status === "processing") {
          setStatus("processing");
          // After 10 minutes, stop auto-polling
          if (elapsed >= 600_000) {
            window.clearInterval(t);
            if (pollTimerRef.current === t) pollTimerRef.current = null;
            setStatus("error");
            setError("This is taking longer than expected. The transcription may still be running in the background.");
          }
        } else if (j.status === "done") {
          setStatus("done");
          setSongId(j.songId);
          window.clearInterval(t);
          if (pollTimerRef.current === t) pollTimerRef.current = null;
        } else if (j.status === "error") {
          setStatus("error");
          setError(j.error ?? "conversion failed");
          window.clearInterval(t);
          if (pollTimerRef.current === t) pollTimerRef.current = null;
        }
      } catch {
        window.clearInterval(t);
        if (pollTimerRef.current === t) pollTimerRef.current = null;
      }
    }, 3000);
    pollTimerRef.current = t;
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
    if (edit.calibrationTempo.trim()) {
      setError("Use ‘Rebuild from source tempo’ for calibration changes; playback saves preserve beat coordinates.");
      return;
    }
    const body: Record<string, string | number> = {};
    if (edit.title.trim()) body.title = edit.title.trim();
    if (edit.artist.trim()) body.artist = edit.artist.trim();
    if (edit.key.trim()) body.key = edit.key.trim();
    if (edit.playbackTempo.trim()) body.playbackTempo = Number(edit.playbackTempo);
    if (!Object.keys(body).length) return;
    try {
      const res = await fetch(`/api/songs/${editSongId.trim()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "update failed");
      setActionMsg(`Updated ${data.songIds.length} variants${data.tempoRole ? ` (${data.tempoRole})` : ""}`);
      setEdit({ title: "", artist: "", key: "", playbackTempo: "", calibrationTempo: "" });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function rebuildCalibration() {
    if (!editSongId.trim() || !edit.calibrationTempo.trim()) return;
    const body = { calibrationTempo: Number(edit.calibrationTempo) };
    try {
      const res = await fetch(`/api/songs/${editSongId.trim()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "calibration rebuild failed");
      setActionMsg(`Rebuilt ${data.songIds.length} variants from source calibration`);
      setEdit((current) => ({ ...current, calibrationTempo: "" }));
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

  function renderConversionStatus(value: typeof status) {
    if (value === "queued") {
      return <p className="text-sm text-zinc-600" role="status">Queued… the worker will pick this up shortly.</p>;
    }
    if (value === "processing") {
      return <p className="text-sm text-indigo-600" role="status">Transcribing audio → MIDI → arrangements. This takes 1–3 minutes.</p>;
    }
    if (value === "done" && songId) {
      return (
        <div className="rounded-xl bg-green-50 p-4 text-sm" role="status">
          Conversion complete!
          <Link href={`/player/${songId}`} className="pressable block mt-2 text-indigo-700 font-medium underline">
            Open your new arrangement →
          </Link>
        </div>
      );
    }
    if (value === "error") {
      return <p className="text-red-600 text-sm" role="alert">{error}</p>;
    }
    return null;
  }

  return (
    <div className="page-shell max-w-2xl mx-auto px-4 py-10">
      <h1 className="page-title text-2xl font-bold mb-2 motion-rise-in">YouTube → Sheet Music</h1>
      <p className="text-zinc-600 text-sm mb-6 motion-rise-in">
        Paste a <strong>solo piano cover</strong> (no vocals or drums, 10 seconds to 5 minutes). A worker downloads the audio,
        transcribes it to MIDI, and creates a full playable arrangement — usually in a minute or two.
      </p>
      <p className="motion-feedback text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-6">
        Experimental: transcription is fully automatic. Clean solo-piano audio works best; fast passages and heavy
        pedal can produce wrong notes. You can always edit the exported MusicXML in MuseScore.
      </p>

      <form
        className="flex flex-col sm:flex-row gap-2 mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          void convert();
        }}
      >
        <label className="sr-only" htmlFor="youtube-url">YouTube URL</label>
        <input
          id="youtube-url"
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          className="form-control flex-1 px-4 py-3 rounded-xl border border-zinc-300 text-sm"
        />
        <button type="submit" disabled={status === "queued" || status === "processing"} className="pressable w-full sm:w-auto px-5 py-3 rounded-xl bg-zinc-900 text-white text-sm font-medium disabled:opacity-40">
          Convert
        </button>
      </form>

      {status !== "idle" && (
        <div className="motion-state-stack youtube-status-slot mb-4" aria-live="polite">
          {statusSwitch.previous && statusSwitch.previous !== "idle" && (
            <div ref={statusExitRef} className="motion-state-layer-exit" aria-hidden="true">
              {renderConversionStatus(statusSwitch.previous)}
            </div>
          )}
          <div className="motion-state-layer-enter">
            {renderConversionStatus(statusSwitch.current)}
          </div>
        </div>
      )}
      {actionPresence.mounted && (
        <p
          className="motion-presence text-emerald-700 text-sm mb-4"
          data-state={actionPresence.visible ? "open" : "closed"}
          aria-hidden={!actionMsg}
          role="status"
        >
          {actionMsg}
        </p>
      )}

      <section className="surface-card rounded-xl border border-zinc-200 p-4 mb-6 motion-rise-in" aria-label="Maintainer tools">
        <button
          type="button"
          className="pressable w-full flex items-center justify-between gap-3 text-left"
          aria-expanded={maintainerOpen}
          aria-controls="youtube-maintainer-tools"
          onClick={() => setMaintainerOpen((open) => !open)}
        >
          <span>
            <span className="block font-semibold text-sm">Maintainer tools</span>
            <span className="block text-xs text-zinc-500 mt-0.5">Re-transcribe or repair existing arrangements</span>
          </span>
          <span className="text-xs text-zinc-500" aria-hidden="true">{maintainerOpen ? "Hide" : "Show"}</span>
        </button>
        {maintainerPresence.mounted && (
          <div
            ref={maintainerPanelRef}
            id="youtube-maintainer-tools"
            className="motion-presence mt-4 pt-4 border-t border-zinc-100"
            data-state={maintainerPresence.visible ? "open" : "closed"}
            aria-hidden={!maintainerPresence.visible}
          >
            <div className="surface-card rounded-xl border border-zinc-200 p-4 mb-4">
              <h2 className="font-semibold text-sm mb-3">Re-transcribe an existing song</h2>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-zinc-500" htmlFor="retranscribe-song-id">Song id</label>
                <input
                  id="retranscribe-song-id"
                  value={retranscribeSongId}
                  onChange={(e) => setRetranscribeSongId(e.target.value)}
                  placeholder="artist-title-vb"
                  className="form-control px-3 py-2 rounded-lg border border-zinc-300 text-sm"
                />
                <label className="text-xs text-zinc-500" htmlFor="retranscribe-url">Original video URL</label>
                <input
                  id="retranscribe-url"
                  type="url"
                  value={retranscribeUrl}
                  onChange={(e) => setRetranscribeUrl(e.target.value)}
                  placeholder="Paste the original video URL"
                  className="form-control px-3 py-2 rounded-lg border border-zinc-300 text-sm"
                />
                <button onClick={retranscribe} className="pressable self-start px-4 py-2 rounded-lg bg-zinc-900 text-white text-sm">
                  Re-transcribe
                </button>
              </div>
            </div>

            <div className="surface-card rounded-xl border border-zinc-200 p-4">
              <h2 className="font-semibold text-sm mb-3">Edit song metadata</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                <label className="sr-only" htmlFor="edit-song-id">Song id</label>
                <input
                  id="edit-song-id"
                  value={editSongId}
                  onChange={(e) => setEditSongId(e.target.value)}
                  placeholder="Song id"
                  className="form-control sm:col-span-2 px-3 py-2 rounded-lg border border-zinc-300 text-sm"
                />
                <label className="sr-only" htmlFor="edit-title">Title</label>
                <input id="edit-title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Title" className="form-control px-3 py-2 rounded-lg border border-zinc-300 text-sm" />
                <label className="sr-only" htmlFor="edit-artist">Artist</label>
                <input id="edit-artist" value={edit.artist} onChange={(e) => setEdit({ ...edit, artist: e.target.value })} placeholder="Artist" className="form-control px-3 py-2 rounded-lg border border-zinc-300 text-sm" />
                <label className="sr-only" htmlFor="edit-key">Key</label>
                <input id="edit-key" value={edit.key} onChange={(e) => setEdit({ ...edit, key: e.target.value })} placeholder="Key (e.g. G)" className="form-control px-3 py-2 rounded-lg border border-zinc-300 text-sm" />
                <label className="sr-only" htmlFor="edit-playback-tempo">Playback tempo</label>
                <input id="edit-playback-tempo" value={edit.playbackTempo} onChange={(e) => setEdit({ ...edit, playbackTempo: e.target.value })} placeholder="Playback tempo BPM" className="form-control px-3 py-2 rounded-lg border border-zinc-300 text-sm" />
              </div>
              <button onClick={editSong} className="pressable px-4 py-2 rounded-lg bg-zinc-900 text-white text-sm">Save metadata / playback</button>
              <div className="mt-4 pt-3 border-t border-zinc-100">
                <p className="text-xs text-amber-700 mb-2">
                  Source calibration changes beat coordinates and rebuilds every variant. Use this only when the detected source
                  tempo is wrong; learner playback changes above preserve the arrangement timeline.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <label className="sr-only" htmlFor="calibration-tempo">Source calibration BPM</label>
                  <input
                    id="calibration-tempo"
                    value={edit.calibrationTempo}
                    onChange={(e) => setEdit({ ...edit, calibrationTempo: e.target.value })}
                    placeholder="Source calibration BPM"
                    className="form-control flex-1 px-3 py-2 rounded-lg border border-amber-300 text-sm"
                  />
                  <button onClick={rebuildCalibration} className="pressable w-full sm:w-auto px-4 py-2 rounded-lg border border-amber-400 bg-amber-50 text-amber-900 text-sm">
                    Rebuild from source tempo
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <h2 className="font-semibold text-sm mb-2">Recent jobs</h2>
      <div className="surface-card motion-stagger rounded-xl border border-zinc-200 divide-y divide-zinc-100 mb-6">
        {jobs.length === 0 && <p className="p-4 text-sm text-zinc-500">No jobs yet.</p>}
        {jobs.map((j) => (
          <div key={j.id} className="job-row flex items-center gap-3 p-3 text-sm">
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
                <button onClick={() => jobAction(j.id, "retry")} className="pressable px-3 py-1.5 rounded-lg border border-zinc-300 text-xs">Retry</button>
                <button onClick={() => jobAction(j.id, "delete")} className="pressable px-3 py-1.5 rounded-lg border border-zinc-300 text-xs">Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {status === "idle" && (
        <div className="helper-callout rounded-xl p-4 text-xs text-zinc-500 motion-feedback">
          Works best with clear, studio-quality solo piano. Full-band tracks and vocals will not transcribe cleanly.
          The transcription worker must be running — start it with <code className="font-mono">npm run worker -w @keyspilli/transcribe</code>.
        </div>
      )}
    </div>
  );
}
