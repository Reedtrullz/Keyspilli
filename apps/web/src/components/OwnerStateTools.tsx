"use client";
import Link from "next/link";
import { NavigationFeedback } from "./NavigationFeedback";
import { DiagnosticTools } from "./DiagnosticTools";
import { useRef, useState } from "react";
import { exportOwnerState, parseOwnerState, restoreOwnerState, OWNER_STATE_MAX_BYTES, type OwnerState } from "@keyspilli/player-core";

export function OwnerStateTools({ disabled = false, publicationRevision=null }: { disabled?: boolean;publicationRevision?:string|null }) {
  const [history, setHistory] = useState(false), [preview, setPreview] = useState<OwnerState | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge"), [notice, setNotice] = useState("");
  const readGeneration = useRef(0);
  return <details className="border rounded-xl p-3 text-sm" aria-label="Back up browser practice">
    <summary className="min-h-11 cursor-pointer">Back up or restore browser practice</summary>
    <p>Preferences, favorites, passages, practice sets and source-bound choices only. No songs or credentials. Hardware calibration is reset on restore; musical choices wait for a matching source.</p>
    <label className="block my-2"><input type="checkbox" checked={history} onChange={e => setHistory(e.target.checked)} /> Include private practice history</label>
    <button disabled={disabled} className="min-h-11 underline" onClick={() => {
      try {
        const document = exportOwnerState(history), url = URL.createObjectURL(new Blob([JSON.stringify(document)], { type: "application/json" }));
        const a = window.document.createElement("a"); a.href = url; a.download = "keyspilli-owner-state-v1.json"; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("Owner state downloaded. Keep this private.");
      } catch (error) { setNotice(error instanceof Error ? error.message : "Could not export browser practice."); }
    }}>Download owner state</button>
    <label className="block my-2">Preview restore <input disabled={disabled} type="file" accept="application/json,.json" onChange={async e => {
      const file = e.target.files?.[0], generation = ++readGeneration.current; e.target.value = ""; setPreview(null); if (!file) return;
      try { if (file.size > OWNER_STATE_MAX_BYTES) throw Error("Owner state exceeds 2 MiB."); const value = parseOwnerState(await file.text()); if (generation !== readGeneration.current) return; setPreview(value); setNotice("Preview only; nothing changed."); }
      catch (error) { if (generation === readGeneration.current) setNotice(error instanceof Error ? error.message : "Could not read owner state."); }
    }} /></label>
    {preview && <div className="border-t pt-2">
      <p>{preview.favorites.length} favorites · {Object.keys(preview.songPrefs).length} song preferences · {preview.practice.passages.length} passages · {preview.practiceSets?.sets.length ?? 0} practice sets · {preview.practice.attempts.length} history entries · {Object.keys(preview.musicalChoices).length} source-bound choices.</p>
      <label>Restore mode <select aria-label="Owner restore mode" value={mode} onChange={e => setMode(e.target.value as "merge" | "replace")}><option value="merge">Merge, imported values win conflicts</option><option value="replace">Replace supported preferences and passages</option></select></label>
      <p>Merge retains unrelated entries. History remains unchanged when excluded; included history keeps the latest 200 runs. A merge exceeding bookmark limits is refused. Replace removes supported preferences and bookmarks absent from this file.</p>
      <button disabled={disabled} className="min-h-11 underline" onClick={() => {
        const saved = restoreOwnerState(preview, mode);
        setNotice(saved ? "Restored. Reload before starting practice to apply preferences and checked choices." : "Restore failed. Storage may be full or combined entries exceed limits. Reload and check existing state before trying again.");
        if (saved) setPreview(null);
      }}>Apply {mode} restore</button>
      <button className="min-h-11 underline ml-4" onClick={() => setPreview(null)}>Discard preview</button>
    </div>}
    {notice && <p role="status">{notice}</p>}
    <p><Link href="/maintenance" className="inline-flex min-h-11 items-center underline">Inspect catalog publication recovery<NavigationFeedback destination="publication recovery" /></Link></p>
    <DiagnosticTools disabled={disabled} publicationRevision={publicationRevision}/>
  </details>;
}
