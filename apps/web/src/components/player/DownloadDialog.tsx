"use client";

import React, { useEffect, useRef } from "react";
import { dialogMotionClasses, useDialogMotion } from "./player-motion";
export function DownloadDialog({
  songId,
  hasSheetXml,
  backgroundMode = "piano",
  transpose = 0,
  onClose,
}: {
  songId: string;
  hasSheetXml: boolean;
  backgroundMode?: "piano" | "chord";
  transpose?: number;
  onClose: () => void;
}) {
  const items = [
    { label: "Simplify PDF", desc: "Color-coded notes + letters, ready to print", href: `/api/song/${songId}/export?type=pdf&layout=simplify`, enabled: true },
    { label: "Sheet Music PDF", desc: "Engraved two-staff score", href: `/api/song/${songId}/export?type=pdf&layout=classic`, enabled: hasSheetXml },
    { label: "MIDI", desc: "Current difficulty for a DAW or keyboard", href: `/api/song/${songId}/export?type=midi`, enabled: true },
    { label: "MusicXML", desc: "Edit in MuseScore or any notation app", href: `/api/song/${songId}/export?type=musicxml`, enabled: true },
  ];

  const dialogRef = useRef<HTMLDialogElement>(null);
  const { requestClose, visible, closing } = useDialogMotion(onClose);
  const motion = dialogMotionClasses(visible, closing);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
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
        {backgroundMode === "chord" && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
            Downloads use the stored Original arrangement. Chord mode changes playback and guidance only.
          </p>
        )}
        {transpose !== 0 && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          Downloads stay in the original key; playback is transposed {transpose > 0 ? `+${transpose}` : transpose} semitones.
        </p>}
        <div className="space-y-2">
          {items.map((it) => (
            <a
              key={it.label}
              href={it.enabled ? it.href : undefined}
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
        <button onClick={requestClose} className="w-full mt-4 py-2.5 rounded-xl bg-zinc-900 text-white text-sm font-medium">
          Done
        </button>
      </div>
    </dialog>
  );
}
