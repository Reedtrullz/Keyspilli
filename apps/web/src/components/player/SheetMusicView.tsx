"use client";

import { useEffect, useRef, useState } from "react";
import { renderMusicXml } from "@keyspilli/engrave";

export function SheetMusicView({ songId }: { songId: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const setReady = () => {
    (window as unknown as { __sheetReady?: boolean }).__sheetReady = true;
  };
  const didSet = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/sheet/${songId}`)
      .then((r) => {
        if (!r.ok) throw new Error("sheet unavailable");
        return r.text();
      })
      .then((xml) => renderMusicXml(xml, { scale: 55, pageWidth: 1400 }))
      .then((s) => {
        if (cancelled) return;
        setSvg(s);
        setError("");
        if (!didSet.current) {
          setReady();
          didSet.current = true;
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e.message ?? e));
          setReady();
          didSet.current = true;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [songId]);

  if (error) return <div className="p-8 text-sm text-zinc-500">{error}</div>;
  if (!svg) return <div className="p-8 text-sm text-zinc-400">Engraving…</div>;
  return <div className="sheet-svg p-4" dangerouslySetInnerHTML={{ __html: svg }} />;
}
