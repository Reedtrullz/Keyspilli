"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OwnerStateTools } from "../OwnerStateTools";
import { PracticeSets } from "../PracticeSets";
import { loadPracticeState, savePracticeState, passageAvailable, PRACTICE_STATE_EVENT, PRACTICE_STATE_KEY,
  type PracticeTarget, type SavedPassage } from "@keyspilli/player-core";

export function PracticeWorkspace({ publicationRevision=null, target, variantId, range, endBeat, positionBeat, disabled, bpm, onRecall, onSelect, onSaved, onResume, onUseTempoPlan }: {
  target: PracticeTarget | null; variantId: string; range: { startBeat: number; endBeat: number } | null;
  endBeat: number; positionBeat: number; disabled: boolean;
  publicationRevision?:string|null; bpm: number; onUseTempoPlan: (passage: SavedPassage) => void;
  onRecall?: (passage:SavedPassage)=>void;
  onSelect: (passage: SavedPassage) => void; onResume: (beat: number) => void;
  onSaved: (passage: SavedPassage) => void;
}) {
  const [state, setState] = useState<ReturnType<typeof loadPracticeState>>({ version: 1, passages: [], attempts: [], resume: null });
  const [name, setName] = useState(""), [note, setNote] = useState(""), [notice, setNotice] = useState("");
  const requestedPassage = useSearchParams().get("passage"), appliedPassage = useRef("");
  const selectRef = useRef(onSelect); selectRef.current = onSelect;
  useEffect(() => {
    const refresh = () => setState(loadPracticeState());
    const storage = (event: StorageEvent) => { if (event.key === PRACTICE_STATE_KEY || event.key === null) refresh(); };
    refresh(); window.addEventListener(PRACTICE_STATE_EVENT, refresh); window.addEventListener("storage", storage);
    return () => { window.removeEventListener(PRACTICE_STATE_EVENT, refresh); window.removeEventListener("storage", storage); };
  }, []);
  useEffect(() => {
    if (!requestedPassage || !target || disabled) return;
    const key = `${requestedPassage}:${target.fingerprint}`; if (appliedPassage.current === key) return;
    const passage = state.passages.find(item => item.id === requestedPassage);
    appliedPassage.current = key;
    if (passage && passageAvailable(passage, target, endBeat)) selectRef.current(passage);
    else setNotice("Requested passage is unavailable for this source or target. Its reference is retained.");
  }, [requestedPassage, target, endBeat, disabled, state.passages]);
  const passages = state.passages.filter(item => item.target.variantId === variantId);
  const attempts = state.attempts.filter(item => item.target.variantId === variantId);
  const resume = state.resume;
  const canResume = target && resume && resume.target.variantId === variantId && resume.target.fingerprint === target.fingerprint
    && resume.target.baseId === target.baseId && resume.positionBeat <= endBeat;
  const commit = (next: typeof state) => {
    const saved = savePracticeState(next);
    setNotice(saved ? "Saved on this browser." : "Could not save. Browser storage may be full or unavailable; playback still works.");
    if (saved) setState(next);
    return saved;
  };
  return <details className="border rounded-xl px-4 my-3 text-sm" aria-label="Saved passages and practice history">
    <summary className="min-h-11 flex items-center cursor-pointer">Saved passages & history</summary>
    <div className="space-y-3 pb-4">
      <p className="text-xs text-zinc-600">Private to this browser. Bookmarks match the exact musical source and selected target. They never start playback automatically.</p>
      {canResume && <button disabled={disabled} className="min-h-11 underline" onClick={() => onResume(resume!.positionBeat)}>Resume saved position</button>}
      {!target && <p role="status">Checking saved passages against this arrangement…</p>}
      <form onSubmit={event => {
        event.preventDefault(); if (!target || !range || disabled) return;
        const current = loadPracticeState();
        if (current.passages.length >= 100) { setNotice("Remove a saved passage before adding more (limit 100)."); return; }
        const passage: SavedPassage = { id: crypto.randomUUID(), target, name: name.trim(), note, sectionId: "full", ...range, createdAt: new Date().toISOString() };
        current.passages.push(passage);
        current.resume = { target, passageId: passage.id, positionBeat: Math.max(0, Math.min(endBeat, positionBeat)), updatedAt: new Date().toISOString() };
        if (commit(current)) { onSaved(passage); setName(""); setNote(""); }
      }} className="flex flex-wrap gap-2">
        <label>Passage name <input required maxLength={80} value={name} onChange={event => setName(event.target.value)} className="block border rounded p-2" /></label>
        <label>Practice note <textarea maxLength={500} value={note} onChange={event => setNote(event.target.value)} className="block border rounded p-2" /></label>
        <button disabled={disabled || !target || !range || !name.trim()} className="min-h-11 border rounded px-3">Save selected loop</button>
      </form>
      {!range && <p>Select a loop above to save a passage.</p>}
      {notice && <p role="status">{notice}</p>}
      <ul>{passages.map(passage => {
        const available = !!target && passageAvailable(passage, target, endBeat);
        return <li key={passage.id} className="border-t py-2">
          <strong>{passage.name}</strong><p>{passage.note}</p>
          {!available && <p>Unavailable for this source, hand or arrangement. Its original bookmark is retained.</p>}
          <button disabled={disabled || !available} className="min-h-11 underline mr-4" onClick={() => onSelect(passage)}>Select {passage.name}</button>
          <button disabled={disabled} className="min-h-11 underline" onClick={() => { const current = loadPracticeState(); current.passages = current.passages.filter(item => item.id !== passage.id); if (current.resume?.passageId === passage.id) current.resume = null; commit(current); }}>Delete {passage.name}</button>
          {onRecall && <form onSubmit={event=>{event.preventDefault();if(!disabled&&available&&new FormData(event.currentTarget).get("review"))onRecall(passage);}}><label className="flex gap-2 text-xs"><input type="checkbox" name="review" required disabled={disabled||!available}/>A competent player has reviewed this exact passage at the current tempo; I want a private recall trial.</label><button disabled={disabled||!available} className="min-h-11 underline">Try recall for {passage.name}</button></form>}
          <details className="my-2" aria-label={`Tempo plan for ${passage.name}`}><summary className="min-h-11 cursor-pointer">Tempo plan</summary>
            <p className="text-xs">Opt-in progression from completed keyboard/MIDI play-along runs meeting your onset-score threshold. Wait mode, microphone, cancelled and interrupted runs do not advance it. This is practice progress, not rhythmic or musical certification.</p>
            {passage.tempoPlan && <div>
              <p role="status">Plan: {passage.tempoPlan.status}{passage.tempoPlan.paused ? " · paused" : ""} · {passage.tempoPlan.currentBpm} BPM · {passage.tempoPlan.completedAtTempo}/{passage.repeatTarget} qualifying runs · target {passage.targetTempo} BPM.</p>
              <button disabled={disabled || !available || passage.tempoPlan.paused || passage.tempoPlan.status === "complete"} className="min-h-11 underline mr-4" onClick={() => onUseTempoPlan(passage)}>Use plan tempo {passage.tempoPlan.currentBpm} BPM</button>
              <button disabled={disabled} className="min-h-11 underline mr-4" onClick={() => { const current=loadPracticeState(), saved=current.passages.find(p => p.id===passage.id); if (saved?.tempoPlan) { saved.tempoPlan.paused=!saved.tempoPlan.paused; commit(current); } }}>{passage.tempoPlan.paused ? "Resume plan" : "Pause plan"}</button>
              <button disabled={disabled} className="min-h-11 underline" onClick={() => { const current=loadPracticeState(), saved=current.passages.find(p => p.id===passage.id); if (saved) { delete saved.tempoPlan; commit(current); } }}>Remove tempo plan</button>
            </div>}
            <form className="flex flex-wrap gap-2" onSubmit={event => {
              event.preventDefault(); if (disabled || !available) return;
              const fields=new FormData(event.currentTarget), startBpm=Number(fields.get("startBpm")), targetTempo=Number(fields.get("targetTempo"));
              if (startBpm/bpm < .25 || targetTempo/bpm > 4 || targetTempo < startBpm) { setNotice("Plan tempos must fit 25–400% playback and target must follow start."); return; }
              const current=loadPracticeState(), saved=current.passages.find(p => p.id===passage.id); if (!saved) return;
              saved.targetTempo=targetTempo; saved.repeatTarget=Number(fields.get("repeatTarget"));
              saved.tempoPlan={ policyId:crypto.randomUUID(),startBpm,currentBpm:startBpm,stepBpm:Number(fields.get("stepBpm")),completedAtTempo:0,thresholdPct:Number(fields.get("thresholdPct")),paused:false,status:"active" };
              commit(current);
            }}>
              <label>Starting BPM <input disabled={disabled || !available} className="block border rounded p-2 w-24" name="startBpm" aria-label={`Starting BPM for ${passage.name}`} type="number" step="any" required min={Math.max(20,bpm*.25)} max={Math.min(400,bpm*4)} defaultValue={passage.tempoPlan?.startBpm ?? Math.max(20,Math.round(bpm*.5))} /></label>
              <label>Target BPM <input disabled={disabled || !available} className="block border rounded p-2 w-24" name="targetTempo" aria-label={`Target BPM for ${passage.name}`} type="number" step="any" required min={Math.max(20,bpm*.25)} max={Math.min(400,bpm*4)} defaultValue={passage.targetTempo ?? Math.min(400,bpm)} /></label>
              <label>Step BPM <input disabled={disabled || !available} className="block border rounded p-2 w-24" name="stepBpm" type="number" required min="1" max="50" defaultValue={passage.tempoPlan?.stepBpm ?? 5} /></label>
              <label>Runs per tempo <input disabled={disabled || !available} className="block border rounded p-2 w-24" name="repeatTarget" type="number" required min="1" max="100" defaultValue={passage.repeatTarget ?? 2} /></label>
              <label>Minimum score % <input disabled={disabled || !available} className="block border rounded p-2 w-24" name="thresholdPct" type="number" required min="50" max="100" defaultValue={passage.tempoPlan?.thresholdPct ?? 90} /></label>
              <button disabled={disabled || !available} className="min-h-11 underline">{passage.tempoPlan ? "Restart with this plan" : "Save tempo plan"}</button>
            </form>
          </details>
        </li>;
      })}</ul>
      <h3 className="font-semibold">Recent practice</h3>
      <p className="text-xs text-zinc-600">Latest 200 runs overall; showing the last 20 for this variant. Counts reflect this input and target, not musical certification.</p>
      {!attempts.length && <p>No practice history for this variant yet.</p>}
      <ol>{attempts.slice(0, 20).map(run => <li key={run.id} className="border-t py-2">
        <time dateTime={run.startedAt}>{run.startedAt}</time> · {run.outcome}{run.finishedAt === null && " (unfinished)"}
        <p>{run.context.assessment==="key-hold"?"Key hold/release + onset":"Onset only"} · {run.context.input} · {run.context.wait ? "Wait for notes" : "Play along"} · {Math.round(run.context.speed * 100)}% · transpose {run.context.transpose} · {run.context.hand}</p>
        <p className="text-xs text-zinc-600">Sound: {run.context.effectiveTimbre ?? "Unknown historical timbre"}. Timing calibration: {run.context.timingCalibrationMs == null ? "Unknown / uncalibrated" : `${run.context.timingCalibrationMs} ms owner offset`}. Physical hand is not measured.</p>
        {run.context.assistance && <p>{run.context.assistance.mode==="reduced-pitch"?"Reduced pitch cues":"Guided recall trial"} · {run.context.assistance.reveals} reveals · owner-confirmed passage review; learning or mastery is unverified. Compare assistance separately.</p>}
        {run.context.tempoPlan && <p className="text-xs">Tempo plan attempt · {Math.round(run.context.bpm*run.context.speed)} BPM · {run.context.wait ? "Wait-mode excluded from progress" : "Completed play-along results checked against plan policy"}.</p>}
        {run.result?.diagnostics && <p>{run.result.diagnostics.events.filter(event => event.outcome !== "unmatched").length} saved problem locations · {run.result.diagnostics.omitted} events outside the saved view</p>}
        {run.result && <p>{run.result.accuracyPct}% · {run.result.hit} hit · {run.result.missed} missed · {run.result.wrong} wrong · {run.result.late} late</p>}
        {target && run.target.fingerprint !== target.fingerprint && <p>Different source or target; compare separately.</p>}
      </li>)}</ol>
      {!!attempts.length && <div className="flex gap-4">
        <button disabled={disabled} className="min-h-11 underline" onClick={() => { const current = loadPracticeState(); current.attempts = current.attempts.filter(item => item.target.variantId !== variantId); commit(current); }}>Clear this variant’s history</button>
        <a className="min-h-11 underline flex items-center" download={`${variantId}-practice-history.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ version: 1, attempts }))}`}>Download practice history</a>
      </div>}
      <OwnerStateTools disabled={disabled} publicationRevision={publicationRevision}/>
      <PracticeSets target={target} endBeat={endBeat} disabled={disabled} />
    </div>
  </details>;
}
