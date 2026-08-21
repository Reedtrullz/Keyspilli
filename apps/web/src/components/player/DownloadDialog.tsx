"use client";

import { useEffect } from "react";
export function DownloadDialog({
  songId,
  hasSheetXml,
  onClose,
}: {
  songId: string;
  hasSheetXml: boolean;
  onClose: () => void;
}) {
  const items = [
    { label: "Simplify PDF", desc: "Color-coded notes + letters, ready to print", href: `/api/song/${songId}/export?type=pdf&layout=simplify`, enabled: true },
    { label: "Sheet Music PDF", desc: "Engraved two-staff score", href: `/api/song/${songId}/export?type=pdf&layout=classic`, enabled: hasSheetXml },
    { label: "MIDI", desc: "Full arrangement for any DAW or keyboard", href: `/api/song/${songId}/export?type=midi`, enabled: true },
    { label: "MusicXML", desc: "Edit in MuseScore or any notation app", href: `/api/song/${songId}/export?type=musicxml`, enabled: true },
  ];

  // Escape to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Download sheet music or MIDI"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-xl">
        <div className="flex justify-between items-center mb-1">
          <h2 className="font-semibold">Download</h2>
          <button autoFocus onClick={onClose} className="px-2 py-1 rounded-lg hover:bg-zinc-100" aria-label="Close">×</button>
        </div>
        <p className="text-xs text-zinc-500 mb-4">Everything is free — yours to keep.</p>
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
        <button onClick={onClose} className="w-full mt-4 py-2.5 rounded-xl bg-zinc-900 text-white text-sm font-medium">
          Done
        </button>
      </div>
    </div>
  );
}
