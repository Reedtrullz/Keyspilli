"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SongRow } from "@keyspilli/catalog";
import type { Section } from "@keyspilli/midi";
import { validateOwnedSections } from "../lib/owned-sections";

const fields = ["title", "artist", "category"] as const;

function inferType(label: string): Section["type"] {
  const text = label.trim().toLowerCase();
  if (text.startsWith("intro")) return "intro";
  if (text.startsWith("outro") || text.startsWith("coda")) return "outro";
  if (text.startsWith("pre-chorus")) return "pre-chorus";
  if (text.startsWith("chorus") || text.startsWith("refrain")) return "chorus";
  if (text.startsWith("verse")) return "verse";
  if (text.startsWith("bridge")) return "bridge";
  if (text.includes("solo") || text.startsWith("interlude")) return "interlude";
  return "custom";
}

function sectionsToText(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Section[];
    if (!Array.isArray(parsed)) return "";
    return parsed.map((section) => section.label + " " + section.startBeat + " " + section.endBeat).join("\n");
  } catch {
    return "";
  }
}

interface ParseResult {
  sections: Section[] | null;
  error: string | null;
}

/** One section per line: Label startBeat endBeat. Empty input clears the map. */
function parseSectionLines(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { sections: null, error: null };
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const sections: Section[] = [];
  for (const [index, line] of lines.entries()) {
    const parts = line.split(/\s+/);
    if (parts.length < 3) {
      return { sections: null, error: "Line " + (index + 1) + ': expected "Label startBeat endBeat".' };
    }
    const endBeat = Number(parts[parts.length - 1]);
    const startBeat = Number(parts[parts.length - 2]);
    const label = parts.slice(0, -2).join(" ");
    if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat)) {
      return { sections: null, error: "Line " + (index + 1) + ": beats must be numbers." };
    }
    sections.push({ id: "owner-" + (index + 1), label, startBeat, endBeat, type: inferType(label) });
  }
  const error = validateOwnedSections(sections);
  return error ? { sections: null, error } : { sections, error: null };
}

export function OwnerMetadata({ song, revision }: { song: Pick<SongRow,"id"|"baseId"|"title"|"artist"|"category"|"sections">; revision: string | null }) {
  const initialSections = useMemo(() => sectionsToText(song.sections), [song.sections]);
  const [draft, setDraft] = useState({ title: song.title, artist: song.artist, category: song.category, sectionsText: initialSections });
  const [preview, setPreview] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => { active.current?.abort(); setDraft({ title: song.title, artist: song.artist, category: song.category, sectionsText: initialSections }); setPreview(false); setBusy(false); setNotice(""); return () => { active.current?.abort(); active.current = null; }; }, [song.id,song.title,song.artist,song.category,initialSections,revision]);
  const changes = fields.filter(field => draft[field] !== song[field]);
  const sectionsChanged = draft.sectionsText !== initialSections;
  const sectionResult = useMemo(() => parseSectionLines(draft.sectionsText), [draft.sectionsText]);
  const hasChanges = changes.length > 0 || sectionsChanged;
  async function save() {
    if (busy || !preview || !hasChanges || sectionResult.error) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setNotice("");
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const payload: Record<string, unknown> = { expectedRevision: revision, ...Object.fromEntries(changes.map(field => [field,draft[field]])) };
      if (sectionsChanged) payload.sections = sectionResult.sections;
      const response = await fetch("/api/songs/" + encodeURIComponent(song.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? "This version changed. Reload and review the current values before saving." : response.status === 401 ? "Owner access expired. Restore access and reload before saving." : String(result.error ?? "Metadata could not be saved."));
      if (active.current === controller) { setPreview(false); setNotice("Saved for every available variant. Reload to view the new publication."); }
    } catch (error) { if (active.current === controller) setNotice(controller.signal.aborted ? "Request timed out. Reload to check the current publication before retrying." : error instanceof Error ? error.message : "Save unavailable."); }
    finally { clearTimeout(timer); if (active.current === controller) { active.current = null; setBusy(false); } }
  }
  return <details className="my-3 rounded-xl border p-3 text-sm" aria-label="Owner metadata edit"><summary className="min-h-11 cursor-pointer">Edit owner metadata</summary>
    <p>Review changes to {song.baseId}. This updates the descriptive fields of all available variants using the existing publication controls.</p>
    <fieldset disabled={busy} className="space-y-2">{fields.map(field => <label key={field} className="block">{field === "title" ? "Lesson title" : field === "artist" ? "Lesson artist" : "Lesson category"}<input className="min-h-11 block w-full border rounded px-2" maxLength={field === "category" ? 80 : 160} required={field !== "artist"} value={draft[field]} onChange={event => { setPreview(false); setDraft(current => ({ ...current, [field]: event.target.value })); }}/></label>)}
      <label className="block">Section names
        <textarea aria-label="Section names" className="min-h-28 block w-full border rounded px-2 font-mono text-xs" value={draft.sectionsText} placeholder={"Intro 0 24\nVerse 1 24 72\nChorus 72 96"} onChange={event => { setPreview(false); setDraft(current => ({ ...current, sectionsText: event.target.value })); }} />
      </label>
      <p className="text-xs">One section per line: label, start beat, end beat. Leave empty to fall back to source maps and estimates.</p>
      {sectionResult.error && <p role="alert" className="text-red-700">{sectionResult.error}</p>}
      <button className="min-h-11 underline" disabled={!hasChanges || Boolean(sectionResult.error) || !draft.title.trim() || !draft.category.trim()} onClick={() => { setPreview(true); setNotice(""); }}>Preview metadata changes</button>
      <button className="min-h-11 underline ml-3" onClick={() => { setDraft({ title: song.title, artist: song.artist, category: song.category, sectionsText: initialSections }); setPreview(false); setNotice("Changes discarded."); }}>Discard metadata changes</button>
      {preview && <div className="border rounded p-3" aria-label="Metadata change preview"><ul>{changes.map(field => <li key={field}>{field}: {song[field] || "(empty)"} to {draft[field] || "(empty)"}</li>)}
        {sectionsChanged && <li>sections: {sectionResult.sections ? sectionResult.sections.length + " authored spans" : "clear owner sections"}</li>}</ul>
        <p className="break-all">Reviewed publication: {revision ?? "Legacy unpinned version"}</p><button className="min-h-11 border rounded px-3" onClick={() => void save()}>Save reviewed metadata</button></div>}
    </fieldset>
    {notice && <p role="status">{notice}</p>}
    {/reload/i.test(notice) && <button className="min-h-11 underline" onClick={() => window.location.reload()}>Reload publication</button>}
  </details>;
}
