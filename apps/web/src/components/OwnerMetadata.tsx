"use client";
import { useEffect, useRef, useState } from "react";
import type { SongRow } from "@keyspilli/catalog";
const fields = ["title", "artist", "category"] as const;
export function OwnerMetadata({ song, revision }: { song: Pick<SongRow,"id"|"baseId"|"title"|"artist"|"category">; revision: string | null }) {
  const [draft, setDraft] = useState({ title: song.title, artist: song.artist, category: song.category });
  const [preview, setPreview] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => { active.current?.abort(); setDraft({ title: song.title, artist: song.artist, category: song.category }); setPreview(false); setBusy(false); setNotice(""); return () => { active.current?.abort(); active.current = null; }; }, [song.id,song.title,song.artist,song.category,revision]);
  const changes = fields.filter(field => draft[field] !== song[field]);
  async function save() {
    if (busy || !preview || !changes.length) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setNotice("");
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`/api/songs/${encodeURIComponent(song.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: revision, ...Object.fromEntries(changes.map(field => [field,draft[field]])) }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? "This version changed. Reload and review the current values before saving." : response.status === 401 ? "Owner access expired. Restore access and reload before saving." : String(result.error ?? "Metadata could not be saved."));
      if (active.current === controller) { setPreview(false); setNotice("Saved for every available variant. Reload to view the new publication."); }
    } catch (error) { if (active.current === controller) setNotice(controller.signal.aborted ? "Request timed out. Reload to check the current publication before retrying." : error instanceof Error ? error.message : "Save unavailable."); }
    finally { clearTimeout(timer); if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  return <details className="my-3 rounded-xl border p-3 text-sm" aria-label="Owner metadata edit"><summary className="min-h-11 cursor-pointer">Edit owner metadata</summary>
    <p>Review changes to {song.baseId}. This updates the descriptive fields of all available variants using the existing publication controls.</p>
    <fieldset disabled={busy} className="space-y-2">{fields.map(field => <label key={field} className="block">{field === "title" ? "Lesson title" : field === "artist" ? "Lesson artist" : "Lesson category"}<input className="min-h-11 block w-full border rounded px-2" maxLength={field === "category" ? 80 : 160} required={field !== "artist"} value={draft[field]} onChange={event => { setPreview(false); setDraft(current => ({ ...current, [field]: event.target.value })); }}/></label>)}
      <button className="min-h-11 underline" disabled={!changes.length || !draft.title.trim() || !draft.category.trim()} onClick={() => { setPreview(true); setNotice(""); }}>Preview metadata changes</button>
      <button className="min-h-11 underline ml-3" onClick={() => { setDraft({ title: song.title, artist: song.artist, category: song.category }); setPreview(false); setNotice("Changes discarded."); }}>Discard metadata changes</button>
      {preview && <div className="border rounded p-3" aria-label="Metadata change preview"><ul>{changes.map(field => <li key={field}>{field}: {song[field] || "(empty)"} → {draft[field] || "(empty)"}</li>)}</ul><p className="break-all">Reviewed publication: {revision ?? "Legacy unpinned version"}</p><button className="min-h-11 border rounded px-3" onClick={() => void save()}>Save reviewed metadata</button></div>}
    </fieldset>
    {notice && <p role="status">{notice}</p>}
    {/reload/i.test(notice) && <button className="min-h-11 underline" onClick={() => window.location.reload()}>Reload publication</button>}
  </details>;
}
