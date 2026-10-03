"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ImportProgress, { stagePercent } from "./ImportProgress";
import RecentJobs from "./RecentJobs";
export default function TutorialImport() {
  const savedJob = useSearchParams().get("job");
  const submitting = useRef(false);
  const [ready, setReady] = useState(false),
    [cancelling, setCancelling] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [stage, setStage] = useState("");
  const [furthest, setFurthest] = useState(0),
    [createdAt, setCreatedAt] = useState<number | null>(null),
    [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);
  const [url, setUrl] = useState(""),
    [jobId, setJobId] = useState(""),
    [status, setStatus] = useState(""),
    [songId, setSongId] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (
      createdAt === null ||
      status === "done" ||
      status === "error" ||
      !status
    )
      return;
    const tick = () =>
      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - createdAt) / 1000)),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [createdAt, status]);
  useEffect(() => {
    setError(""); setSongId(""); setStage(""); setFurthest(0);
    setCreatedAt(null); setElapsedSeconds(null);
    if (savedJob && /^[a-zA-Z0-9_-]{1,100}$/.test(savedJob)) {
      submitting.current = true;
      setJobId(savedJob);
      setStatus("Checking saved preview");
    } else {
      submitting.current = false;
      setJobId(""); setStatus("");
    }
    setReady(true);
  }, [savedJob]);
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(
          "/api/youtube/status/" + encodeURIComponent(jobId),
          { signal: controller.signal, cache: "no-store" },
        );
        const job = await response.json();
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          submitting.current = false;
          setStatus("error");
          setError("Saved preview was not found. You can submit a new link.");
          return;
        }
        if (!response.ok) throw Error(job.error ?? "Status unavailable");
        setError("");
        setStatus(job.status);
        setStage(typeof job.stage === "string" ? job.stage : "");
        setFurthest((previous) => Math.max(previous, stagePercent(job.stage)));
        const created = Date.parse(job.createdAt);
        if (Number.isFinite(created)) setCreatedAt(created);
        const finished = Date.parse(job.finishedAt);
        if (Number.isFinite(created) && Number.isFinite(finished))
          setElapsedSeconds(
            Math.max(0, Math.floor((finished - created) / 1000)),
          );
        if (job.status === "done" || job.status === "error")
          submitting.current = false;
        if (job.status === "done") {
          setSongId(job.resultAvailable ? job.songId : "");
          if (!job.resultAvailable) setError("This job completed, but its result is unavailable. Check the library or ask the owner to inspect its publication before importing again.");
          return;
        }
        if (job.status === "error") {
          setError(job.error ?? "No supported arrangement found");
          return;
        }
      } catch {
        if (controller.signal.aborted) return;
        setError("Status unavailable; checking again shortly.");
      }
      timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [jobId, refresh]);
  return (
    <div className="page-shell max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold">YouTube piano · Private beta</h1>
      <p className="my-4">
        Paste a recording link. Keyspilli will look for a matching piano
        tutorial and follow that arrangement. Results are experimental and
        pending listening review; source rights and melody inclusion are
        unverified.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready || submitting.current) return;
          submitting.current = true;
          setError("");
          setSongId("");
          setStage("");
          setStatus("Submitting");
          setJobId("");
          setFurthest(0);
          setCreatedAt(Date.now());
          setElapsedSeconds(0);
          try {
            const response = await fetch("/api/youtube/import", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ url }),
            });
            const result = await response.json();
            if (!response.ok) throw Error(result.error ?? "Import failed");
            const location = new URL(window.location.href);
            location.searchParams.set("job", result.jobId);
            window.history.replaceState(window.history.state, "", location);
            setJobId(result.jobId);
          } catch (e) {
            submitting.current = false;
            setError(String(e));
            setStatus("");
          }
        }}
      >
        <label htmlFor="tutorial-url">YouTube link</label>
        <input
          id="tutorial-url"
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="border rounded p-2 w-full my-2"
        />
        <button
          disabled={!ready || submitting.current}
          className="border rounded px-4 py-2"
        >
          Create piano preview
        </button>
      </form>
      {jobId && ["queued", "processing"].includes(status) && (
        <button
          type="button"
          disabled={cancelling}
          className="border rounded px-4 py-2 mt-3"
          onClick={async () => {
            if (cancelling) return;
            setCancelling(true);
            try {
              const response = await fetch(
                "/api/youtube/jobs/" + encodeURIComponent(jobId),
                {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ action: "cancel" }),
                },
              );
              if (!response.ok && response.status !== 409)
                throw Error("Cancellation unavailable; checking job status.");
            } catch {
              setError(
                "Cancellation could not be confirmed. The server may still publish; check the saved job.",
              );
            } finally {
              setCancelling(false);
              setRefresh((value) => value + 1);
            }
          }}
        >
          {cancelling ? "Cancelling…" : "Cancel preview"}
        </button>
      )}
      <ImportProgress
        status={status}
        stage={stage}
        furthest={furthest}
        elapsedSeconds={elapsedSeconds}
        cancelled={error.startsWith("Piano preview cancelled")}
        reconciliationRequired={error.startsWith("Import saved an artifact")}
        resultUnavailable={status === "done" && !songId && Boolean(error)}
      />
      {error && <p role="alert">{error}</p>}
      {songId && (
        <Link
          className="pressable inline-block rounded-full bg-zinc-900 text-white px-5 py-2.5 font-medium"
          href={"/player/" + encodeURIComponent(songId)}
        >
          Open piano lesson
        </Link>
      )}
      <RecentJobs refreshKey={`${jobId}:${status}:${refresh}`} />
    </div>
  );
}
