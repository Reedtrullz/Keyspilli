"use client";

import React, { useEffect, useRef, useState } from "react";
import { validActiveExportSelection, type ActiveExportSelection } from "./active-arrangement-export";
import { dialogMotionClasses, useDialogMotion } from "./player-motion";
export function DownloadDialog({
  songId,
  publicationRevision,
  hasSheetXml,
  backgroundMode = "piano",
  transpose = 0,
  activeExport,
  onClose,
}: {
  songId: string;
  publicationRevision?: string | null;
  hasSheetXml: boolean;
  backgroundMode?: "piano" | "chord";
  transpose?: number;
  activeExport?: {selection:ActiveExportSelection;sourceFingerprint:string|null;digest:()=>Promise<string>};
  onClose: () => void;
}) {
  const items = [
    { label: "Simplify PDF", desc: "Color-coded notes + letters, ready to print", href: `/api/song/${songId}/export?type=pdf&layout=simplify`, enabled: true },
    { label: "Sheet Music PDF", desc: "Engraved two-staff score", href: `/api/song/${songId}/export?type=pdf&layout=classic`, enabled: hasSheetXml },
    { label: "MIDI", desc: "Current difficulty for a DAW or keyboard", href: `/api/song/${songId}/export?type=midi`, enabled: true },
    { label: "MusicXML", desc: "Edit in MuseScore or any notation app", href: `/api/song/${songId}/export?type=musicxml`, enabled: true },
  ];

  const pin = publicationRevision === undefined ? "" : `&revision=${encodeURIComponent(publicationRevision ?? "unpinned")}`;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [arrangement,setArrangement]=useState("stored"),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const requestRef=useRef<AbortController|null>(null);
  useEffect(()=>()=>{requestRef.current?.abort();requestRef.current=null;},[]);
  async function downloadActive(type:"midi"|"musicxml"|"pdf") {
    if(!activeExport||!publicationRevision||!activeExport.sourceFingerprint||busy||!validActiveExportSelection(activeExport.selection))return;
    const controller=new AbortController();requestRef.current=controller;setBusy(true);setError("");
    const timer=setTimeout(()=>controller.abort(),100000);
    try {
      const expectedHash=await activeExport.digest();if(controller.signal.aborted)return;
      const response=await fetch(`/api/song/${encodeURIComponent(songId)}/active-export`,{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({type,revision:publicationRevision,sourceFingerprint:activeExport.sourceFingerprint,selection:activeExport.selection,expectedHash})});
      if(!response.ok){const value=await response.json();throw new Error(value.error??"Active export unavailable.");}
      const blob=await response.blob();if(controller.signal.aborted)return;
      const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`${songId}-active.${type==="midi"?"mid":type==="pdf"?"pdf":"musicxml"}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){if(requestRef.current===controller)setError(controller.signal.aborted?"Active export timed out. Retry deliberately.":error instanceof Error?error.message:"Active export failed.");}
    finally{clearTimeout(timer);if(requestRef.current===controller)setBusy(false);}
  }
  const { requestClose, visible, closing } = useDialogMotion(onClose);
  const motion = dialogMotionClasses(visible, closing);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previousFocus?.focus(); };
  }, []);

  useEffect(() => {
    if (closing) dialogRef.current?.setAttribute("inert", "");
  }, [closing]);

  return (
    <dialog
      className={`fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl backdrop:bg-black/40 ${motion.panel}`}
      ref={dialogRef}
      aria-hidden={closing}
      aria-label="Download sheet music or MIDI"
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div>
        <div className="flex justify-between items-center mb-1">
          <h2 className="font-semibold">Download</h2>
          <button autoFocus onClick={requestClose} className="px-2 py-1 rounded-lg hover:bg-zinc-100" aria-label="Close">×</button>
        </div>
        <p className="text-xs text-zinc-500 mb-4">Download this arrangement for practice. Source rights still apply.</p>
        <label className="block mb-4 text-sm">Arrangement<select className="block border rounded min-h-11 px-2" disabled={busy} value={arrangement} onChange={event=>{setArrangement(event.target.value);setError("");}}><option value="stored">Stored Original</option><option value="active" disabled={!activeExport||!publicationRevision||!activeExport.sourceFingerprint}>Active arrangement</option></select></label>
        {arrangement === "stored" && backgroundMode === "chord" && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
            Downloads use the stored Original arrangement. Chord mode changes playback and guidance only.
          </p>
        )}
        {arrangement === "stored" && transpose !== 0 && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          Downloads stay in the original key; playback is transposed {transpose > 0 ? `+${transpose}` : transpose} semitones.
        </p>}
        {arrangement === "active" ? <div className="space-y-2"><p className="text-xs text-zinc-600">Selected notes, backing, hand support, speed, transposition and declared dynamics. Chord names appear as MusicXML text and MIDI markers. Timbre, mixer volume and pedal sound tails are separate. Symbolic parity is checked before download.</p>{(["midi","musicxml","pdf"] as const).map(type=><button key={type} disabled={busy} onClick={()=>void downloadActive(type)} className="block w-full text-left rounded-xl border p-3 min-h-11">{busy?"Preparing…":`Active ${type==="midi"?"MIDI":type==="pdf"?"Sheet PDF":"MusicXML"}`}</button>)}</div> : <div className="space-y-2">
          {items.map((it) => (
            <a
              key={it.label}
              href={it.enabled ? it.href + pin : undefined}
              aria-disabled={!it.enabled}
              onClick={(e) => {
                if (!it.enabled) e.preventDefault();
              }}
              className={`block rounded-xl border p-3 ${it.enabled ? "border-zinc-200 hover:border-zinc-400" : "border-zinc-100 opacity-50 cursor-not-allowed"}`}
            >
              <div className="text-sm font-medium">{it.label}</div>
              <div className="text-xs text-zinc-500">{it.desc}</div>
            </a>
          ))}
        </div>
        }
        {error && <p className="text-sm text-red-700 mt-3" role="alert">{error}</p>}
        <button onClick={requestClose} className="w-full mt-4 py-2.5 rounded-xl bg-zinc-900 text-white text-sm font-medium">
          Done
        </button>
      </div>
    </dialog>
  );
}
