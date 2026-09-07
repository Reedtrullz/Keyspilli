import React from "react";
import type { SourceArrangement } from "@keyspilli/catalog/src/source-arrangement.js";

export function SourceArrangementNotice({ source }: { source?: SourceArrangement }) {
  if (!source) return null;
  return <div className="mt-2 text-sm text-zinc-600" data-testid="source-arrangement-notice">
    <span className="font-semibold">Source-assisted beta</span>
    {" · "}{source.sourceKind === "tutorial-preview" ? "Tutorial preview — melody inclusion and source rights unverified" : source.containsMelody ? "Melody included" : "Accompaniment only — no vocal melody"}
    <div>Arrangement: {source.arrangementTitle}. Timing follows this arrangement.</div>
    <div className="flex flex-wrap gap-x-3">
      <a className="underline" href={source.actualSourceUrl} target="_blank" rel="noreferrer">Selected arrangement source</a>
      <a className="underline" href={source.requestedUrl} target="_blank" rel="noreferrer">Requested recording</a>
      {source.sourceKind !== "tutorial-preview" && <a className="underline" href={source.licenseEvidenceUrl} target="_blank" rel="noreferrer">{source.license}</a>}
    </div>
  </div>;
}
