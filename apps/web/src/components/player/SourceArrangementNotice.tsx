import React from "react";
import type { SourceArrangement } from "@keyspilli/catalog/src/source-arrangement.js";

export function SourceArrangementNotice({ source }: { source?: SourceArrangement }) {
  if (!source) return null;
  return <div className="mt-2 text-sm text-zinc-600" data-testid="source-arrangement-notice">
    <span className="font-semibold">Source-assisted beta</span>
    {" · "}{source.sourceKind === "tutorial-preview" ? "Tutorial preview — melody inclusion and source rights unverified" : source.containsMelody ? "Melody included" : "Accompaniment only — no vocal melody"}
    <span>. Timing follows this arrangement.</span>
    {source.sourceKind === "tutorial-preview" && <div>Beat and measure positions are provisional. The displayed BPM has not been musically verified.</div>}
    <details className="mt-1">
      <summary className="cursor-pointer min-h-11 py-3 underline">Arrangement details</summary>
      <div>Arrangement: {source.arrangementTitle}.</div>
      <div className="flex flex-wrap gap-x-3 pb-2">
      <a className="underline" href={source.actualSourceUrl} target="_blank" rel="noreferrer">Selected arrangement source</a>
      <a className="underline" href={source.requestedUrl} target="_blank" rel="noreferrer">Requested recording</a>
      {source.sourceKind !== "tutorial-preview" && <a className="underline" href={source.licenseEvidenceUrl} target="_blank" rel="noreferrer">{source.license}</a>}
    </div>
    </details>
  </div>;
}
