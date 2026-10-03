"use client";
import {retainSheetPages,SHEET_WINDOW_BYTES,SHEET_PRINT_BYTES} from "./sheet-pages";

import type { Note, MeasureInfo } from "@keyspilli/midi";
import type { ScoreMeasure } from "./sheet-navigation";
import { useEffect, useMemo, useRef, useState, memo, type CSSProperties } from "react";
import {
  openMusicXmlInWorker,
  openMusicXmlOnMainThread,
  type MusicXmlWorkerSession,
} from "@keyspilli/engrave";

export type SheetRenderMode = "virtual" | "all";
export type SheetReaderPosition = { zoom: number; page: number; offset: number; scrollLeft: number };

export interface SheetScoreInteraction {
  source: { notes: readonly Note[]; measures: readonly MeasureInfo[]; sourceFingerprint?: string };
  enabled: boolean; canNavigate: boolean; beat: number;
  onVerifiedMeasures?(measures: MeasureInfo[]): void;
  onSeek(beat: number): void; onLoop(startBeat: number,endBeat: number): void;
}

type SheetMusicViewProps = {
  suspended?: boolean;
  interaction?: SheetScoreInteraction;
  songId: string;
  publicationRevision?: string | null;
  initialPosition?: SheetReaderPosition;
  /**
   * `virtual` keeps only a small page window of SVG markup in the DOM (the
   * remaining page shells preserve the scroll range). Printable/export
   * surfaces must opt into `all` so page layout is complete before capture.
   */
  renderMode?: SheetRenderMode;
};

type PageMap = Record<number, string>;

// Preserve the actual SVG nodes (and keyboard focus) when neighboring pages update.
const SheetPage = memo(function SheetPage({svg, page, count, zoom, dimensions, virtual}: {svg?:string;page:number;count:number;zoom:number;dimensions:{width:number;height:number};virtual:boolean}) {
  const html = useMemo(()=>svg?{__html:svg}:undefined,[svg]);
  return <div className={`sheet-svg__page${svg?"":" sheet-svg__page--placeholder"}${svg&&virtual?" motion-scale-in":""}`}
    data-page={page} role="group" aria-label={`Sheet music page ${page} of ${count}`} aria-posinset={page} aria-setsize={count}
    style={{...(virtual?{width:`${zoom}%`,alignSelf:"flex-start"}:{}),"--sheet-page-aspect":`${dimensions.width} / ${dimensions.height}`} as CSSProperties}
    {...(html?{dangerouslySetInnerHTML:html}:{children:<span className="sheet-svg__page-status">Preparing page {page}…</span>})} />;
});

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

export function SheetMusicView({ suspended = false, songId, publicationRevision, renderMode = "virtual", initialPosition, interaction }: SheetMusicViewProps) {
  const [zoom, setZoom] = useState(initialPosition?.zoom ?? 100);
  const restoredPositionRef = useRef(false);
  const manualScoreNavigationRef = useRef(false);
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
  const windowRef = useRef({start:1,end:INITIAL_PAGES});
  const loadedPagesRef = useRef<PageMap>({});
  const inFlightRef = useRef(new Map<number, Promise<void>>());
  const renderPageRef = useRef<(page: number) => Promise<void>>(async () => undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scoreMeasures,setScoreMeasures] = useState<ScoreMeasure[]>([]);
  const [scoreNotice,setScoreNotice] = useState("");
  const [selectedScoreMeasure,setSelectedScoreMeasure] = useState(0);
  const [followScore,setFollowScore] = useState(false);
  const scoreMeasuresRef = useRef(scoreMeasures); scoreMeasuresRef.current = scoreMeasures;
  const interactionRef = useRef(interaction); interactionRef.current = interaction;
  const pendingScoreFocusRef = useRef<{id:string;ready:boolean} | null>(null);
  useEffect(() => {
    pendingScoreFocusRef.current = null;
    return () => { pendingScoreFocusRef.current = null; };
  }, [suspended, interaction?.canNavigate]);
  const renderGenerationRef=useRef(0);
  function failRender(reason:unknown,generation:number){
    if(renderGenerationRef.current!==generation)return;renderGenerationRef.current++;
    const message=String(reason instanceof Error?reason.message:reason),session=sessionRef.current;sessionRef.current=null;void session?.close();
    loadedPagesRef.current={};setPages({});setError(message);setReady(false);
    updateSheetState({__sheetReady:false,__sheetError:message,__sheetRenderedPages:0,__sheetRetainedSvgBytes:0,__sheetFallbackSvgBytes:0});
  }


  useEffect(() => {
    if (scoreMeasures.length && interactionRef.current?.enabled && interactionRef.current.canNavigate)
      interactionRef.current.onVerifiedMeasures?.(scoreMeasures);
  }, [scoreMeasures, interaction?.canNavigate, interaction?.enabled]);

  useEffect(() => {
    if (suspended) return;
    let cancelled = false;
    const generation=++renderGenerationRef.current;
    const current=()=>!cancelled&&generation===renderGenerationRef.current;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const previousSession = sessionRef.current;
    sessionRef.current = null;
    void previousSession?.close();
    windowRef.current={start:1,end:INITIAL_PAGES};
    loadedPagesRef.current = {};
    inFlightRef.current=new Map();
    const inFlightRequests=inFlightRef.current;
    setPages({});
    setPageCount(0);
    setActivePage(1);
    setWindowStart(1);
    setWindowEnd(INITIAL_PAGES);
    setDimensions({ width: RENDER_OPTIONS.pageWidth, height: RENDER_OPTIONS.pageHeight });
    setError("");
    setReady(false);
    manualScoreNavigationRef.current = false;
    pendingScoreFocusRef.current = null;
    setScoreMeasures([]); setScoreNotice(""); setSelectedScoreMeasure(0); setFollowScore(false);
    updateSheetState({
      __sheetReady: false,
      __sheetError: undefined,
      __sheetPageCount: 0,
      __sheetRenderedPages: 0,
      __sheetRenderMode: renderMode,
      __sheetRenderer: "pending",
      __sheetPrintReady: renderMode === "all",
      __publicationConflict: false,
    });

    const markPage = (page: number, svg: string) => {
      if (!current()) return;
      const range=renderMode==='all'?{start:1,end:2048}:windowRef.current;
      loadedPagesRef.current=retainSheetPages(loadedPagesRef.current,range.start,range.end,page,svg,renderMode==='all'?SHEET_PRINT_BYTES:SHEET_WINDOW_BYTES);
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
          __sheetRetainedSvgBytes: Object.values(loadedPagesRef.current).reduce((sum, svg) => sum + svg.length * 2, 0),
          __sheetFallbackSvgBytes: 0,
        });
      }
    };

    const load = async () => {
      try {
        const query = publicationRevision === undefined ? ""
          : `?revision=${publicationRevision === null ? "unpinned" : encodeURIComponent(publicationRevision)}`;
        const response = await fetch(`/api/v1/sheet/${encodeURIComponent(songId)}${query}`, { signal: controller.signal });
        if (response.status === 409) {
          updateSheetState({ __publicationConflict: true });
          throw new Error("This score changed while loading. Reload the page to continue.");
        }
        if (!response.ok) throw new Error("sheet unavailable");
        let xml = await response.text();
        if (interaction && renderMode === "virtual") {
          if (!interaction.enabled) setScoreNotice("Score interaction requires the stored Original arrangement in its original key.");
          else {
            try {
              const {prepareScoreNavigation} = await import("./sheet-navigation");
              const mapped = prepareScoreNavigation(xml,interaction.source,publicationRevision,response.headers.get("X-Publication-Revision"));
              if (!current()) return;
              xml = mapped.xml; setScoreMeasures(mapped.measures);
            } catch (error) { if (!cancelled) setScoreNotice(error instanceof Error ? error.message : "Score correspondence is unavailable."); }
          }
        }

        if (!current()) return;
        let session: MusicXmlWorkerSession | null = null;
        let renderer="worker";
        try {
          session = await openMusicXmlInWorker(xml, RENDER_OPTIONS);
        } catch {
          // Both renderer paths hold the layout and render only requested pages.
          session=await openMusicXmlOnMainThread(xml,RENDER_OPTIONS);renderer="main";
        }
        if (!current()) {
          await session?.close();
          return;
        }

        sessionRef.current = session;
        updateSheetState({ __sheetRenderer: renderer });
        const count = session.pageCount;
        if (!count) throw new Error("Verovio returned no pages");
        setPageCount(count);
        updateSheetState({ __sheetPageCount: count });
        const renderPage = async (page: number): Promise<void> => {
          if (!current() || page < 1 || page > count) return;
          const existing = loadedPagesRef.current[page];
          if (existing) return;
          const inFlight = inFlightRequests.get(page);
          if (inFlight) return inFlight;
          const promise = (async () => {
            const svg = await session!.renderPage(page);
            if (!svg) throw new Error(`Verovio returned no SVG for page ${page}`);
            if (current()) markPage(page, svg);
          })();
          inFlightRequests.set(page, promise);
          try {
            await promise;
          } finally {
            inFlightRequests.delete(page);
          }
        };
        renderPageRef.current = renderPage;

        // The first page is the visible success signal for the interactive
        // view. Export/print uses renderMode=all and does not become ready
        // until every page has been rendered.
        await renderPage(1);
        if (!current()) return;
        if (renderMode === "all") {
          for (const page of pageRange(2, count)) await renderPage(page);
          if (current()) {
            setPages({ ...loadedPagesRef.current });
            updateSheetState({ __sheetRenderedPages: count });
            setReady(true);
            updateSheetState({ __sheetReady: true, __sheetPrintReady: true });
            await session?.close();
            if(sessionRef.current===session)sessionRef.current = null;
          }
        } else {
          setReady(true);
          updateSheetState({ __sheetReady: true });
          // Warm the next page without growing the DOM. IntersectionObserver
          // will request the remaining bounded window as the user scrolls.
          void Promise.all(pageRange(2, Math.min(count, INITIAL_PAGES)).map(renderPage)).catch((reason) => {
            if (!current()) return;
            failRender(reason,generation);
          });
        }
      } catch (e) {
        if (current() && !(e instanceof DOMException && e.name === "AbortError")) failRender(e,generation);
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
  }, [suspended, songId, publicationRevision, renderMode, interaction?.source, interaction?.enabled]);

  useEffect(() => {
    if (suspended || renderMode !== "virtual" || pageCount < 1 || error) return;
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") return;
    const generation=renderGenerationRef.current;
    const visiblePages = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        // Use the page occupying most of the viewport, not the last page in
        // an observer batch, for both the visible page label and lazy window.
        for (const entry of entries) {
          if (entry.isIntersecting) visiblePages.add(entry.target);
          else visiblePages.delete(entry.target);
        }
        const visible = [...visiblePages].map((target) => {
          const rect = target.getBoundingClientRect();
          return { target, height: Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0) };
        }).filter((entry) => entry.height > 0).sort((a, b) => b.height - a.height);
        for (const entry of visible.slice(0, 1)) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (!Number.isInteger(page) || page < 1 || page > pageCount) continue;
          const start = Math.max(1, page - PAGE_RADIUS);
          const end = Math.min(pageCount, page + PAGE_RADIUS);
          windowRef.current={start,end};
          // Keep SVG strings bounded as well as the mounted DOM window. Pages
          // outside the current window are rendered again if the user scrolls
          // back, which is preferable to retaining a full score in memory.
          for (const loaded of Object.keys(loadedPagesRef.current)) {
            const loadedPage = Number(loaded);
            if (loadedPage < start || loadedPage > end) delete loadedPagesRef.current[loadedPage];
          }
          setPages({ ...loadedPagesRef.current });
          updateSheetState({
            __sheetRenderedPages: Object.keys(loadedPagesRef.current).length,
            __sheetRetainedSvgBytes: Object.values(loadedPagesRef.current).reduce((sum, svg) => sum + svg.length * 2, 0),
            __sheetFallbackSvgBytes: 0,
          });
          setActivePage(page);
          setWindowStart(start);
          setWindowEnd(end);
          void Promise.all(pageRange(start, end).map((candidate) => renderPageRef.current(candidate)))
            .catch((reason) => {
              failRender(reason,generation);
            });
        }
      },
      { root: null, rootMargin: "0px", threshold: [0.01, 0.25, 0.5, 0.75, 1] },
    );
    for (const node of container.querySelectorAll<HTMLElement>(".sheet-svg__page[data-page]")) observer.observe(node);
    return () => observer.disconnect();
  }, [suspended, error, pageCount, renderMode, windowEnd, windowStart]);

  const mountedPages = useMemo(() => {
    if (!pageCount) return [];
    // Keep lightweight aspect-ratio placeholders for the full scroll range,
    // while only the bounded window in `pages` contains expensive SVG markup.
    // This preserves native scrolling/keyboard navigation without retaining a
    // full score DOM or SVG string set.
    return pageRange(1, pageCount);
  }, [pageCount]);

  useEffect(() => {
    if (!ready || !initialPosition || restoredPositionRef.current || renderMode !== "virtual") return;
    const container = containerRef.current;
    const page = container?.querySelector<HTMLElement>(`[data-page="${Math.max(1, Math.min(pageCount, initialPosition.page))}"]`);
    if (!container || !page) return;
    restoredPositionRef.current = true;
    let cancelled = false;
    const animations = document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity);
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (cancelled || manualScoreNavigationRef.current) return;
      container.scrollLeft = initialPosition.scrollLeft;
      window.scrollTo({ top: window.scrollY + page.getBoundingClientRect().top - initialPosition.offset, behavior: "instant" });
    });
    return () => { cancelled = true; restoredPositionRef.current = false; };
  }, [initialPosition, pageCount, ready, renderMode]);

  async function focusScoreMeasure(index: number) {
    const snapshot = scoreMeasuresRef.current, measure = snapshot[index];
    if (!measure || suspended || !interactionRef.current?.canNavigate) return;
    const request = {id:measure.elementId,ready:false};
    pendingScoreFocusRef.current = request;
    manualScoreNavigationRef.current = true;
    try {
      const page = sessionRef.current ? await sessionRef.current.elementPage(measure.elementId) : 0;
      if (pendingScoreFocusRef.current !== request || scoreMeasuresRef.current !== snapshot || page < 1 || page > pageCount) return;
      windowRef.current={start:Math.max(1,page-PAGE_RADIUS),end:Math.min(pageCount,page+PAGE_RADIUS)};
      loadedPagesRef.current=retainSheetPages(loadedPagesRef.current,windowRef.current.start,windowRef.current.end);
      setSelectedScoreMeasure(index);
      setWindowStart(Math.max(1,page-PAGE_RADIUS)); setWindowEnd(Math.min(pageCount,page+PAGE_RADIUS));
      containerRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`)?.scrollIntoView({block:"center",behavior:"instant"});
      await renderPageRef.current(page);
      if (pendingScoreFocusRef.current === request && scoreMeasuresRef.current === snapshot && interactionRef.current?.canNavigate) {
        request.ready = true;
        setPages({ ...loadedPagesRef.current });
      }
    } catch { if (pendingScoreFocusRef.current === request && scoreMeasuresRef.current === snapshot) {
      pendingScoreFocusRef.current = null;
      setScoreNotice("This passage could not be located. Reload the score before navigating.");
    } }
  }
  function activateScoreMeasure(index: number, loop = false) {
    const measure = scoreMeasuresRef.current[index], controls = interactionRef.current;
    if (!measure || !controls?.enabled || !controls.canNavigate) return;
    manualScoreNavigationRef.current = true;
    setSelectedScoreMeasure(index);
    if (loop) controls.onLoop(measure.startBeat,measure.endBeat); else controls.onSeek(measure.startBeat);
  }
  useEffect(()=>{
    const nodes = containerRef.current?.querySelectorAll<SVGElement>('g.measure[id^="keyspilli-score-"]');
    if (!nodes?.length || !scoreMeasures.length) return;
    const current = followScore && interaction?.enabled ? scoreMeasures.findIndex(m=>interaction.beat>=m.startBeat&&interaction.beat<m.endBeat) : -1;
    const selectedVisible = [...nodes].some(node=>node.id===scoreMeasures[selectedScoreMeasure]?.elementId);
    nodes.forEach((node,position)=>{
      const index = Number(node.id.replace("keyspilli-score-",""));
      if (!scoreMeasures[index]) return;
      node.setAttribute("role","button"); node.setAttribute("aria-label",`Seek score passage ${index+1}. Shift Enter loops this passage.`);
      node.setAttribute("aria-disabled",String(!interaction?.canNavigate));
      node.tabIndex = (selectedVisible ? index===selectedScoreMeasure : position===0) ? 0 : -1;
      if (index===current) node.setAttribute("aria-current","location"); else node.removeAttribute("aria-current");
      node.style.outline = index===current ? "2px solid Highlight" : "";
    });
    const pending = pendingScoreFocusRef.current?.ready && [...nodes].find(node => node.id === pendingScoreFocusRef.current?.id);
    if (pending && !suspended && interaction?.canNavigate) {
      pendingScoreFocusRef.current = null;
      pending.scrollIntoView({block:"center",behavior:"instant"});
      pending.focus({preventScroll:true});
    }
  },[pages,scoreMeasures,selectedScoreMeasure,followScore,interaction?.beat,interaction?.canNavigate,interaction?.enabled,suspended]);

  if (error) {
    return (
      <div className="sheet-svg__error motion-feedback p-8 text-sm text-red-700" role="alert">
        Unable to engrave this score: {error}
      </div>
    );
  }
  if (!ready && !mountedPages.length) {
    return (
      <div className="sheet-svg__loading motion-feedback p-4" role="status" aria-busy="true" aria-label="Engraving sheet music">
        <div className="loading-skeleton mb-3 h-3 w-2/3 rounded-full" />
        <div className="loading-skeleton mb-4 h-3 w-1/2 rounded-full" />
        <div className="loading-skeleton h-[18rem] w-full rounded-xl" />
        <span className="sr-only">Engraving…</span>
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className="sheet-svg p-4"
      role="region"
      aria-label="Sheet music score"
      aria-busy={!ready}
      data-sheet-render-mode={renderMode}
      data-active-page={activePage}
      onClick={event=>{const element=(event.target as Element).closest?.('g.measure[id^="keyspilli-score-"]'); if (!element) return; activateScoreMeasure(Number(element.id.replace("keyspilli-score-","")));}}
      onKeyDown={event=>{
        if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
        const element=(event.target as Element).closest?.('g.measure[id^="keyspilli-score-"]'); if (!element) return;
        const index=Number(element.id.replace("keyspilli-score-",""));
        if (["Enter"," ","ArrowLeft","ArrowRight","Home","End"].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); if (event.repeat) return;
          if (event.key==="Enter"||event.key===" ") activateScoreMeasure(index,event.shiftKey);
          else void focusScoreMeasure(event.key==="Home"?0:event.key==="End"?scoreMeasures.length-1:Math.max(0,Math.min(scoreMeasures.length-1,index+(event.key==="ArrowRight"?1:-1))));
        }
      }}
    >
      {renderMode === "virtual" && <div className="sheet-controls flex flex-wrap items-center gap-3 text-sm w-full">
        <label>Score zoom <select aria-label="Score zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="min-h-11 rounded border border-zinc-300 bg-white px-2">
          {[75, 100, 125, 150, 200].map((value) => <option key={value} value={value}>{value}%</option>)}
        </select></label>
        <button className="min-h-11 rounded border border-zinc-300 bg-white px-3" onClick={() => setZoom(100)}>Fit width</button>
        <span>Page {activePage} of {pageCount}</span>
        {interaction && scoreMeasures.length>0 && <>
          <label className="min-h-11 flex items-center gap-2"><input type="checkbox" checked={followScore} onChange={event=>setFollowScore(event.target.checked)}/>Highlight playback passage</label>
          <button className="min-h-11 rounded border px-3" disabled={!interaction.canNavigate} onClick={()=>void focusScoreMeasure(selectedScoreMeasure)}>Focus score passages</button>
          <button className="min-h-11 rounded border px-3" disabled={!interaction.canNavigate} onClick={()=>activateScoreMeasure(selectedScoreMeasure,true)}>Loop selected score passage</button>
          <p className="w-full">Select a passage on the score to seek. Arrow keys move focus; Enter seeks and Shift+Enter loops. Playback highlighting does not move the page.</p>
        </>}
        {interaction && scoreNotice && <p className="w-full" role="status">{scoreNotice}</p>}
      </div>}
      {mountedPages.map(page=><SheetPage key={page} page={page} count={pageCount} svg={pages[page]} zoom={zoom} dimensions={dimensions} virtual={renderMode==="virtual"}/>)}
      {renderMode === "virtual" && pageCount > windowEnd && (
        <p className="sheet-svg__window-status motion-feedback" role="status" aria-live="polite">
          Showing pages {windowStart}–{windowEnd} of {pageCount}; scroll to load more.
        </p>
      )}
    </div>
  );
}
