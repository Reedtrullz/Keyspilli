"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  openMusicXmlInWorker,
  renderMusicXmlPages,
  type MusicXmlWorkerSession,
} from "@keyspilli/engrave";

export type SheetRenderMode = "virtual" | "all";

type SheetMusicViewProps = {
  songId: string;
  /**
   * `virtual` keeps only a small page window of SVG markup in the DOM (the
   * remaining page shells preserve the scroll range). Printable/export
   * surfaces must opt into `all` so page layout is complete before capture.
   */
  renderMode?: SheetRenderMode;
};

type PageMap = Record<number, string>;

const PAGE_RADIUS = 2;
const INITIAL_PAGES = 2;
const RENDER_OPTIONS = {
  scale: 40,
  pageWidth: 1600,
  pageHeight: 2200,
  breaks: "auto" as const,
  svgFormatRaw: true,
};

function pageRange(start: number, end: number): number[] {
  const pages: number[] = [];
  for (let page = start; page <= end; page += 1) pages.push(page);
  return pages;
}

function parseSvgDimensions(svg: string): { width: number; height: number } | null {
  const width = svg.match(/<svg\b[^>]*\bwidth=["']([0-9.]+)/i)?.[1];
  const height = svg.match(/<svg\b[^>]*\bheight=["']([0-9.]+)/i)?.[1];
  if (width && height && Number(width) > 0 && Number(height) > 0) {
    return { width: Number(width), height: Number(height) };
  }
  const viewBox = svg.match(/<svg\b[^>]*\bviewBox=["']\s*[-+0-9.e]+\s+[-+0-9.e]+\s+([0-9.]+)\s+([0-9.]+)/i);
  if (viewBox && Number(viewBox[1]) > 0 && Number(viewBox[2]) > 0) {
    return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
  }
  return null;
}

function updateSheetState(values: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  Object.assign(window as unknown as Record<string, unknown>, values);
}

export function SheetMusicView({ songId, renderMode = "virtual" }: SheetMusicViewProps) {
  const [pages, setPages] = useState<PageMap>({});
  const [pageCount, setPageCount] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [windowStart, setWindowStart] = useState(1);
  const [windowEnd, setWindowEnd] = useState(INITIAL_PAGES);
  const [dimensions, setDimensions] = useState({ width: 1600, height: 2200 });
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<MusicXmlWorkerSession | null>(null);
  const fallbackPagesRef = useRef<string[] | null>(null);
  const loadedPagesRef = useRef<PageMap>({});
  const inFlightRef = useRef(new Map<number, Promise<void>>());
  const renderPageRef = useRef<(page: number) => Promise<void>>(async () => undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const previousSession = sessionRef.current;
    sessionRef.current = null;
    void previousSession?.close();
    fallbackPagesRef.current = null;
    loadedPagesRef.current = {};
    inFlightRef.current.clear();
    setPages({});
    setPageCount(0);
    setActivePage(1);
    setWindowStart(1);
    setWindowEnd(INITIAL_PAGES);
    setDimensions({ width: RENDER_OPTIONS.pageWidth, height: RENDER_OPTIONS.pageHeight });
    setError("");
    setReady(false);
    updateSheetState({
      __sheetReady: false,
      __sheetError: undefined,
      __sheetPageCount: 0,
      __sheetRenderedPages: 0,
      __sheetRenderMode: renderMode,
      __sheetRenderer: "pending",
      __sheetPrintReady: renderMode === "all",
    });

    const markPage = (page: number, svg: string) => {
      if (cancelled) return;
      loadedPagesRef.current[page] = svg;
      const parsed = parseSvgDimensions(svg);
      if (parsed && page === 1) setDimensions(parsed);
      // Export/print renders every page, but publishing each SVG into React
      // would repeatedly reconcile an increasingly large score DOM. Keep the
      // pages in the ref while they are rendered and publish them once after
      // the all-pages batch completes. Interactive mode still publishes each
      // page so the viewport can mount its bounded window progressively.
      if (renderMode !== "all") {
        setPages({ ...loadedPagesRef.current });
        updateSheetState({
          __sheetRenderedPages: Object.keys(loadedPagesRef.current).length,
        });
      }
    };

    const load = async () => {
      try {
        const response = await fetch(`/api/v1/sheet/${encodeURIComponent(songId)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("sheet unavailable");
        const xml = await response.text();

        let session: MusicXmlWorkerSession | null = null;
        let fallbackPages: string[] | null = null;
        try {
          session = await openMusicXmlInWorker(xml, RENDER_OPTIONS);
        } catch {
          // Module workers are unavailable in some embedded/static previews.
          // Keep the same page-window behavior after falling back to the
          // main-thread renderer; only the compatibility path lays out all SVG
          // strings eagerly.
          fallbackPages = await renderMusicXmlPages(xml, { ...RENDER_OPTIONS, pages: "all" });
        }
        if (cancelled) {
          await session?.close();
          return;
        }

        sessionRef.current = session;
        fallbackPagesRef.current = fallbackPages;
        updateSheetState({ __sheetRenderer: session ? "worker" : "main" });
        const count = session?.pageCount ?? fallbackPages?.length ?? 0;
        if (!count) throw new Error("Verovio returned no pages");
        setPageCount(count);
        updateSheetState({ __sheetPageCount: count });
        const renderPage = async (page: number): Promise<void> => {
          if (cancelled || page < 1 || page > count) return;
          const existing = loadedPagesRef.current[page];
          if (existing) return;
          const inFlight = inFlightRef.current.get(page);
          if (inFlight) return inFlight;
          const promise = (async () => {
            const svg = fallbackPages ? fallbackPages[page - 1] : await session!.renderPage(page);
            if (!svg) throw new Error(`Verovio returned no SVG for page ${page}`);
            if (!cancelled) markPage(page, svg);
          })();
          inFlightRef.current.set(page, promise);
          try {
            await promise;
          } finally {
            inFlightRef.current.delete(page);
          }
        };
        renderPageRef.current = renderPage;

        // The first page is the visible success signal for the interactive
        // view. Export/print uses renderMode=all and does not become ready
        // until every page has been rendered.
        await renderPage(1);
        if (cancelled) return;
        if (renderMode === "all") {
          for (const page of pageRange(2, count)) await renderPage(page);
          if (!cancelled) {
            setPages({ ...loadedPagesRef.current });
            updateSheetState({ __sheetRenderedPages: count });
            setReady(true);
            updateSheetState({ __sheetReady: true, __sheetPrintReady: true });
            await session?.close();
            sessionRef.current = null;
          }
        } else {
          setReady(true);
          updateSheetState({ __sheetReady: true });
          // Warm the next page without growing the DOM. IntersectionObserver
          // will request the remaining bounded window as the user scrolls.
          void Promise.all(pageRange(2, Math.min(count, INITIAL_PAGES)).map(renderPage));
        }
      } catch (e) {
        if (!cancelled && !(e instanceof DOMException && e.name === "AbortError")) {
          const message = String(e instanceof Error ? e.message : e);
          setPages({});
          setError(message);
          setReady(false);
          updateSheetState({ __sheetReady: false, __sheetError: message });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (requestRef.current === controller) requestRef.current = null;
      renderPageRef.current = async () => undefined;
      const session = sessionRef.current;
      sessionRef.current = null;
      void session?.close();
    };
  }, [songId, renderMode]);

  useEffect(() => {
    if (renderMode !== "virtual" || pageCount < 1 || error) return;
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (!Number.isInteger(page) || page < 1 || page > pageCount) continue;
          const start = Math.max(1, page - PAGE_RADIUS);
          const end = Math.min(pageCount, page + PAGE_RADIUS);
          // Keep SVG strings bounded as well as the mounted DOM window. Pages
          // outside the current window are rendered again if the user scrolls
          // back, which is preferable to retaining a full score in memory.
          for (const loaded of Object.keys(loadedPagesRef.current)) {
            const loadedPage = Number(loaded);
            if (loadedPage < start || loadedPage > end) delete loadedPagesRef.current[loadedPage];
          }
          setPages({ ...loadedPagesRef.current });
          updateSheetState({ __sheetRenderedPages: Object.keys(loadedPagesRef.current).length });
          setActivePage(page);
          setWindowStart(start);
          setWindowEnd(end);
          void Promise.all(pageRange(start, end).map((candidate) => renderPageRef.current(candidate)))
            .catch((reason) => {
              const message = String(reason instanceof Error ? reason.message : reason);
              setError(message);
              updateSheetState({ __sheetReady: false, __sheetError: message });
            });
        }
      },
      { root: null, rootMargin: "100% 0px", threshold: 0.01 },
    );
    for (const node of container.querySelectorAll<HTMLElement>(".sheet-svg__page[data-page]")) observer.observe(node);
    return () => observer.disconnect();
  }, [error, pageCount, renderMode, windowEnd, windowStart]);

  const mountedPages = useMemo(() => {
    if (!pageCount) return [];
    // Keep lightweight aspect-ratio placeholders for the full scroll range,
    // while only the bounded window in `pages` contains expensive SVG markup.
    // This preserves native scrolling/keyboard navigation without retaining a
    // full score DOM or SVG string set.
    return pageRange(1, pageCount);
  }, [pageCount]);

  if (error) {
    return (
      <div className="sheet-svg__error p-8 text-sm text-red-700" role="alert">
        Unable to engrave this score: {error}
      </div>
    );
  }
  if (!ready && !mountedPages.length) return <div className="p-8 text-sm text-zinc-400" role="status">Engraving…</div>;
  return (
    <div
      ref={containerRef}
      className="sheet-svg p-4"
      role="region"
      aria-label="Sheet music score"
      aria-busy={!ready}
      data-sheet-render-mode={renderMode}
      data-active-page={activePage}
    >
      {mountedPages.map((page) => {
        const svg = pages[page];
        const props = {
          className: `sheet-svg__page${svg ? "" : " sheet-svg__page--placeholder"}`,
          key: page,
          "data-page": page,
          role: "group",
          "aria-label": `Sheet music page ${page} of ${pageCount}`,
          "aria-posinset": page,
          "aria-setsize": pageCount,
          style: { "--sheet-page-aspect": `${dimensions.width} / ${dimensions.height}` } as CSSProperties,
        };
        if (svg) return <div {...props} dangerouslySetInnerHTML={{ __html: svg }} />;
        return (
          <div {...props}>
            <span className="sheet-svg__page-status">Preparing page {page}…</span>
          </div>
        );
      })}
      {renderMode === "virtual" && pageCount > windowEnd && (
        <p className="sheet-svg__window-status" role="status" aria-live="polite">
          Showing pages {windowStart}–{windowEnd} of {pageCount}; scroll to load more.
        </p>
      )}
    </div>
  );
}
