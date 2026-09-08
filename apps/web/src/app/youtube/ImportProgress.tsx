import React from "react";

const STAGES = [
  { id: "identifying", percent: 5, title: "Recognizing your song", detail: "Checking the artist and title from your link." },
  { id: "searching", percent: 15, title: "Finding a piano arrangement", detail: "Looking for a matching tutorial with clear, complete notes." },
  { id: "downloading", percent: 30, title: "Getting the tutorial", detail: "Downloading the video. Keep your Mac awake and connected." },
  { id: "extracting", percent: 50, title: "Reading the piano notes", detail: "Working through the video. This is usually the longest step." },
  { id: "validating", percent: 85, title: "Checking the arrangement", detail: "Checking the notes and preparing the difficulty levels." },
  { id: "publishing", percent: 95, title: "Preparing your lesson", detail: "Saving your playable lesson and downloads." },
];

// Stage estimates only: elapsed time never advances the bar or declares success.
export function stagePercent(stage: string): number {
  return STAGES.find((item) => item.id === stage)?.percent ?? 0;
}

export default function ImportProgress({ status, stage, furthest, elapsedSeconds, cancelled }: {
  status: string; stage: string; furthest: number; elapsedSeconds: number | null; cancelled: boolean;
}) {
  if (!status) return null;
  const current = STAGES.find((item) => item.id === stage);
  const done = status === "done", failed = status === "error";
  const active = status === "processing";
  const percent = done ? 100 : active && current ? Math.min(95, Math.max(current.percent, furthest)) : null;
  const retrying = active && current && current.percent < furthest;
  const title = done ? "Your piano lesson is ready" : failed ? (cancelled ? "Preview cancelled" : "We couldn’t create this preview")
    : status === "queued" ? "Waiting for your turn" : current && active ? current.title
    : status === "Submitting" ? "Sending your link" : "Checking your preview";
  const detail = done ? "Choose a difficulty and start playing." : failed ? "You can try another link."
    : status === "queued" ? "Your link is saved. Processing will start when the importer is available."
    : active && current ? current.detail : "Waiting for an update from the importer.";
  const elapsed = elapsedSeconds === null ? null : `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;

  return <section className="surface-card rounded-2xl border border-zinc-200 p-5 my-5" aria-label="Piano preview progress">
    <div role="status" aria-live="polite" aria-atomic="true">
      <h2 className="font-semibold text-lg">{title}</h2>
      <p className="text-sm text-zinc-600 mt-1">{detail}</p>
    </div>
    {!failed && <>
      <div className="flex justify-between gap-3 mt-5 mb-2 text-sm text-zinc-600">
        <span>{done ? "Complete" : percent === null ? "Getting ready" : `Estimated progress · ${percent}%`}</span>
        {elapsed && <span className="tabular-nums">{elapsed} elapsed</span>}
      </div>
      <div role="progressbar" aria-label="Piano preview progress" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? title : `${percent}%${done ? " complete" : " estimated"}: ${title}`}
        className="h-3 rounded-full bg-zinc-100 overflow-hidden">
        <div className={`h-full rounded-full ${done ? "bg-emerald-600" : "bg-indigo-600"} transition-[width] duration-700 motion-reduce:transition-none ${percent === null ? "motion-safe:animate-pulse" : ""}`}
          style={{ width: `${percent ?? 15}%` }} />
      </div>
      {!done && <p className="mt-3 text-xs text-zinc-500">{retrying ? "Checking another tutorial for a better result. " : ""}Progress is approximate. Some steps can take several minutes.</p>}
    </>}
  </section>;
}
