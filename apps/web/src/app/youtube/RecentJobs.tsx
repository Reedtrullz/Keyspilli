"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export interface RecentJob {
  id: string; youtubeUrl: string; status: string; songId: string | null; createdAt: string;
  displayState: string; resultAvailable: boolean; error: string | null;
}

export default function RecentJobs({ refreshKey }: { refreshKey: string }) {
  const [jobs, setJobs] = useState<RecentJob[]>([]);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch("/api/youtube/jobs", { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("Recent imports are unavailable."); const data = await response.json(); if (!Array.isArray(data.jobs)) throw new Error("Invalid import list."); return data.jobs; })
      .then(data => { if (!controller.signal.aborted) setJobs(data); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Recent imports are unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refreshKey, retry]);
  return <section className="surface-card border rounded-2xl p-5 mt-6" aria-label="Recent imports" aria-busy={loading}>
    <div className="flex justify-between items-center"><h2 className="font-semibold">Recent imports</h2><button type="button" className="pressable min-h-11 px-3 underline" onClick={() => setRetry(value => value + 1)}>{error ? "Retry import list" : "Refresh imports"}</button></div>
    <p className="text-xs text-zinc-600">Latest 50 jobs. Processing continues on the server. Cancellation can race publication; always check the saved job.</p>
    {loading && <p role="status">Loading recent imports…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && jobs.length === 0 && <p className="mt-3 text-sm">No recent imports. Submit a link above or <Link href="/uploads" className="underline">add a symbolic file</Link>.</p>}
    <ul className="divide-y">{jobs.map(job => <li key={job.id} className="py-3 text-sm space-y-1">
      <a href={`/youtube?job=${encodeURIComponent(job.id)}`} className="underline font-medium">{job.displayState} · {job.id}</a>
      <p className="break-all text-xs text-zinc-600">{job.youtubeUrl}</p>
      <time dateTime={job.createdAt}>{job.createdAt}</time>
      {job.error && <p>{job.error}</p>}
      {job.resultAvailable && job.songId ? <Link href={`/player/${encodeURIComponent(job.songId)}`} className="block underline">Open import result</Link>
        : job.status === "done" && <p>Its result is unavailable. Reopen the saved job to inspect it; browse the library before importing again.</p>}
    </li>)}</ul>
  </section>;
}
