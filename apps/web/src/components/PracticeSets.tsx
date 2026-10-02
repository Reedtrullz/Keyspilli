"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { loadPracticeSets, savePracticeSets, loadPracticeState, passageAvailable, PRACTICE_SETS_EVENT, PRACTICE_STATE_EVENT,
  type PracticeSetsState, type PracticeTarget, type SavedPassage } from "@keyspilli/player-core";
import type { GroupedSong } from "@keyspilli/catalog/runtime";

export function PracticeSets({ target = null, endBeat = 0, disabled = false }: { target?: PracticeTarget | null; endBeat?: number; disabled?: boolean }) {
  const [state, setState] = useState<PracticeSetsState>({ version: 1, sets: [], activeSetId: null });
  const [passages, setPassages] = useState<SavedPassage[]>([]), [songs, setSongs] = useState<GroupedSong[]>([]);
  const [name, setName] = useState(""), [passageId, setPassageId] = useState(""), [notice, setNotice] = useState(""), [availability, setAvailability] = useState("");
  const selected = state.sets.find(set => set.id === state.activeSetId), eligible = target ? passages.filter(p => passageAvailable(p, target, endBeat)) : [];
  const selectedIds = JSON.stringify([...new Set(selected?.items.map(item => item.variantId) ?? [])].sort());
  useEffect(() => {
    const refresh = () => { setState(loadPracticeSets()); setPassages(loadPracticeState().passages); };
    refresh(); window.addEventListener(PRACTICE_SETS_EVENT, refresh); window.addEventListener(PRACTICE_STATE_EVENT, refresh); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(PRACTICE_SETS_EVENT, refresh); window.removeEventListener(PRACTICE_STATE_EVENT, refresh); window.removeEventListener("storage", refresh); };
  }, []);
  useEffect(() => {
    const ids: string[] = JSON.parse(selectedIds);
    if (!ids.length) { setSongs([]); setAvailability(""); return; }
    const controller = new AbortController(); setAvailability("Checking set entries…"); setSongs([]);
    void fetch("/api/songs?group=1&limit=60", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }), signal: controller.signal })
      .then(async r => { if (!r.ok) throw Error(); const value = await r.json(); if (!Array.isArray(value.songs)) throw Error(); if (!controller.signal.aborted) { setSongs(value.songs); setAvailability(""); } })
      .catch(() => { if (!controller.signal.aborted) setAvailability("Availability could not be checked. Reload or choose another set to retry."); });
    return () => controller.abort();
  }, [selectedIds]);
  const commit = (next: PracticeSetsState) => { const ok = savePracticeSets(next); setNotice(ok ? "Practice set saved on this browser." : "Could not save: limit 20 sets, 50 entries per set, 256 KiB total; storage may be full."); if (ok) setState(next); };
  const changeItems = (items: NonNullable<typeof selected>["items"]) => { if (!selected || disabled) return; const current = loadPracticeSets(); commit({ ...current, sets: current.sets.map(set => set.id === selected.id ? { ...set, items } : set) }); };
  const entry = (item: NonNullable<typeof selected>["items"][number]) => {
    const song = songs.find(song => song.representative.baseId === item.baseId && song.levels.some(level => level.id === item.variantId));
    const passage = item.passageId ? passages.find(p => p.id === item.passageId && p.target.baseId === item.baseId && p.target.variantId === item.variantId) : undefined;
    return { song, passage, available: !!song && (!item.passageId || !!passage), href: `/player/${item.variantId}${item.passageId ? `?passage=${encodeURIComponent(item.passageId)}` : ""}` };
  };
  const next = selected?.items.find(item => !item.completed && entry(item).available);
  return <details className="border rounded-xl p-3 my-3 text-sm" aria-label="Owner practice sets">
    <summary className="min-h-11 cursor-pointer">Practice sets</summary>
    <p>Ordered choices for this browser. Completion is your manual note; it does not certify learning. Source-bound passages are checked again on open.</p>
    <form className="flex gap-2 my-2" onSubmit={e => { e.preventDefault(); if (disabled || !name.trim()) return; const current = loadPracticeSets(), id = crypto.randomUUID(); commit({ ...current, activeSetId: id, sets: [...current.sets, { id, name: name.trim(), items: [] }] }); setName(""); }}>
      <label>New practice set <input disabled={disabled} required maxLength={80} value={name} onChange={e => setName(e.target.value)} className="block border rounded p-2" /></label>
      <button disabled={disabled || !name.trim()} className="min-h-11 underline">Create set</button>
    </form>
    {!!state.sets.length && <label>Selected set <select disabled={disabled} aria-label="Selected practice set" value={state.activeSetId ?? ""} onChange={e => commit({ ...loadPracticeSets(), activeSetId: e.target.value || null })}><option value="">Choose a set</option>{state.sets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label>}
    {selected && <div>
      <h3 className="font-semibold">{selected.name}</h3>
      {target ? <div className="my-2">
        <label>Chosen target <select disabled={disabled} aria-label="Practice set passage" value={passageId} onChange={e => setPassageId(e.target.value)}><option value="">Whole chosen variant</option>{eligible.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button disabled={disabled} className="min-h-11 underline ml-3" onClick={() => {
          if (passageId && !eligible.some(p => p.id === passageId)) { setNotice("This passage no longer matches the chosen arrangement."); return; }
          changeItems([...selected.items, { id: crypto.randomUUID(), baseId: target.baseId, variantId: target.variantId, completed: false, ...(passageId ? { passageId } : {}) }]);
        }}>Add chosen arrangement</button>
      </div> : <p>Open a song and use its saved-passages workspace to add the chosen variant or passage.</p>}
      {availability && <p role="status">{availability}</p>}
      <ol>{selected.items.map((item,index) => { const info = entry(item), label = info.song?.representative.title ?? item.variantId;
        return <li key={item.id} data-set-item={item.id} className="border-t py-2">
          {info.available && !disabled ? <Link className="min-h-11 inline-flex items-center underline" href={info.href}>{label}{info.passage ? ` · ${info.passage.name}` : ""}</Link> : <span>{label} · {disabled ? "Finish practice to navigate" : availability ? "Checking availability" : "Unavailable; original reference retained"}</span>}
          <label className="block"><input disabled={disabled} type="checkbox" checked={item.completed} onChange={e => changeItems(selected.items.map(old => old.id === item.id ? { ...old, completed: e.target.checked } : old))} /> Manually completed {label}</label>
          <button disabled={disabled || index === 0} className="min-h-11 underline mr-3" aria-label={`Move ${label} up`} onClick={() => { const items = [...selected.items]; [items[index-1],items[index]] = [items[index]!,items[index-1]!]; changeItems(items); }}>Move up</button>
          <button disabled={disabled || index === selected.items.length-1} className="min-h-11 underline mr-3" aria-label={`Move ${label} down`} onClick={() => { const items = [...selected.items]; [items[index],items[index+1]] = [items[index+1]!,items[index]!]; changeItems(items); }}>Move down</button>
          <button disabled={disabled} className="min-h-11 underline" onClick={() => changeItems(selected.items.filter(old => old.id !== item.id))}>Remove entry</button>
        </li>;
      })}</ol>
      {next && !disabled && <Link className="min-h-11 inline-flex items-center underline" href={entry(next).href}>Next unfinished item</Link>}
      <button disabled={disabled} className="min-h-11 underline block" onClick={() => { const current = loadPracticeSets(); commit({ ...current, activeSetId: null, sets: current.sets.filter(set => set.id !== selected.id) }); }}>Delete set {selected.name}</button>
    </div>}
    {notice && <p role="status">{notice}</p>}
  </details>;
}
