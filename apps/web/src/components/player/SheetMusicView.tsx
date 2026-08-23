"use client";

import { useEffect, useRef, useState } from "react";
import { renderMusicXmlPages } from "@keyspilli/engrave";

export function SheetMusicView({ songId }: { songId: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const state = window as unknown as { __sheetReady?: boolean; __sheetError?: string };
    // Readiness is a success signal, not a "finished loading" signal. Reset
    // both flags when navigating between songs so a previous score cannot
    // accidentally satisfy a PDF/export wait on the next one.
    state.__sheetReady = false;
    delete state.__sheetError;

    fetch(`/api/v1/sheet/${encodeURIComponent(songId)}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("sheet unavailable");
        return r.text();
      })
      .then((xml) => renderMusicXmlPages(xml, { scale: 40, pageWidth: 1600, pageHeight: 2200, pages: "all" }))
      .then((renderedPages) => {
        if (cancelled) return;
        setPages(renderedPages);
        setError("");
        state.__sheetReady = true;
        delete state.__sheetError;
      })
      .catch((e) => {
        if (!cancelled && !(e instanceof DOMException && e.name === "AbortError")) {
          const message = String(e?.message ?? e);
          setPages([]);
          setError(message);
          state.__sheetReady = false;
          state.__sheetError = message;
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (requestRef.current === controller) requestRef.current = null;
    };
  }, [songId]);

  if (error) {
    return (
      <div className="sheet-svg__error p-8 text-sm text-red-700" role="alert">
        Unable to engrave this score: {error}
      </div>
    );
  }
  if (!pages.length) return <div className="p-8 text-sm text-zinc-400" role="status">Engraving…</div>;
  return (
    <div className="sheet-svg p-4" role="region" aria-label="Sheet music score">
      {pages.map((svg, index) => (
        <div className="sheet-svg__page" key={index} aria-label={`Sheet music page ${index + 1} of ${pages.length}`} dangerouslySetInnerHTML={{ __html: svg }} />
      ))}
    </div>
  );
}
