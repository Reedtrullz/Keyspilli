let toolkitPromise: Promise<VerovioToolkit> | null = null;

export interface VerovioToolkit {
  loadData: (xml: string) => boolean;
  renderToSVG: (page?: number) => string;
  getPageCount: () => number;
  setOptions?: (o: Record<string, unknown>) => void;
}

/** Lazily load the Verovio WASM toolkit (client-side only). */
export async function loadVerovio(): Promise<VerovioToolkit> {
  if (toolkitPromise) return toolkitPromise;
  toolkitPromise = (async () => {
    // Load Verovio from the public/ assets (browser ESM build) so webpack
    // never touches its Node-targeted CJS build or its 7.6 MB wasm bundle.
    const createVerovioModule = (await import(/* webpackIgnore: true */ ("/verovio/verovio-module.mjs" as string))) as unknown as {
      default: () => Promise<unknown>;
    };
    const { VerovioToolkit } = (await import(/* webpackIgnore: true */ ("/verovio/verovio.mjs" as string))) as unknown as {
      VerovioToolkit: new (m: unknown) => VerovioToolkit;
    };
    const VerovioModule = await createVerovioModule.default();
    return new VerovioToolkit(VerovioModule);
  })();
  // A failed load must not brick the sheet view for the whole session.
  toolkitPromise.catch(() => {
    toolkitPromise = null;
  });
  return toolkitPromise;
}

export interface RenderOptions {
  scale?: number;
  pageWidth?: number;
  pageHeight?: number;
  colored?: boolean;
  breaks?: "none" | "auto";
  /** Render every laid-out page instead of only the first page. */
  pages?: "first" | "all";
}

const SVG_WIDTH_RE = /<svg\b[^>]*\bwidth=["']([0-9]+(?:\.[0-9]+)?)(?:px)?["']/i;
const SVG_HEIGHT_RE = /<svg\b[^>]*\bheight=["']([0-9]+(?:\.[0-9]+)?)(?:px)?["']/i;
const SVG_VIEWBOX_RE = /<svg\b[^>]*\bviewBox=["']\s*[-+0-9.e]+\s+[-+0-9.e]+\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)["']/i;

function assertRenderedPage(svg: string, page: number): string {
  if (!/^\s*<svg\b/i.test(svg)) {
    throw new Error(`Verovio returned invalid SVG for page ${page}`);
  }
  const widthMatch = svg.match(SVG_WIDTH_RE);
  const heightMatch = svg.match(SVG_HEIGHT_RE);
  const viewBox = svg.match(SVG_VIEWBOX_RE);
  const width = widthMatch?.[1] ?? viewBox?.[1];
  const height = heightMatch?.[1] ?? viewBox?.[2];
  if (!width || !height || Number(width) <= 0 || Number(height) <= 0) {
    throw new Error(`Verovio returned an unbounded SVG for page ${page}`);
  }
  // A successful load can still produce an empty SVG when the layout fails.
  // Require at least one drawn/text element so callers do not mark a blank
  // score as ready.
  if (!/<(?:g|path|text|use)\b/i.test(svg)) {
    throw new Error(`Verovio returned an empty SVG for page ${page}`);
  }
  // svgViewBox intentionally omits width/height in recent Verovio builds.
  // Add pixel dimensions derived from the viewBox so browsers retain the
  // score's aspect ratio even when a parent applies responsive CSS scaling.
  if (!widthMatch || !heightMatch) {
    return svg.replace(/<svg\b([^>]*)>/i, (_root, attrs: string) => {
      const withWidth = widthMatch ? attrs : `${attrs} width="${width}px"`;
      const withHeight = heightMatch ? withWidth : `${withWidth} height="${height}px"`;
      return `<svg${withHeight}>`;
    });
  }
  return svg;
}

function setRenderOptions(tk: VerovioToolkit, opts: RenderOptions): void {
  // These are deliberately limited to options supported by the browser build.
  // In particular, `border` is not a Verovio 4 option and emits a warning.
  // Automatic breaks plus fixed page dimensions prevent one giant horizontal
  // SVG, while svgViewBox keeps the intrinsic aspect ratio when CSS scales it.
  tk.setOptions?.({
    scale: opts.scale ?? 40,
    pageWidth: opts.pageWidth ?? 1600,
    pageHeight: opts.pageHeight ?? 2200,
    breaks: opts.breaks ?? "auto",
    font: "Bravura",
    svgViewBox: true,
  });
}

function scoreForVerovio(xml: string): string {
  // The browser Verovio build imports playback-level <tie> correctly, but
  // currently leaves notation-level <tied> markers open in dense grand-staff
  // streams. The source/export MusicXML retains both standards-compliant
  // markers; strip only the duplicate visual marker for this renderer so a
  // valid score does not surface a false "ties left open" warning.
  return xml
    .replace(/<tied\b[^>]*\/>/gi, "")
    .replace(/<notations>\s*<\/notations>/gi, "");
}

/** Render MusicXML to all page SVG documents in score order. */
export async function renderMusicXmlPages(xml: string, opts: RenderOptions = {}, toolkit?: VerovioToolkit): Promise<string[]> {
  const tk = toolkit ?? (await loadVerovio());
  // Verovio lays out at load time; options must be set first.
  setRenderOptions(tk, opts);
  if (!tk.loadData(scoreForVerovio(xml))) throw new Error("Verovio loadData failed");
  const pageCount = Math.max(1, Math.floor(tk.getPageCount()));
  const count = opts.pages === "first" ? 1 : pageCount;
  const pages: string[] = [];
  for (let page = 1; page <= count; page++) {
    pages.push(assertRenderedPage(tk.renderToSVG(page), page));
  }
  return pages;
}

/** Render MusicXML to the first SVG page (backwards-compatible convenience). */
export async function renderMusicXml(xml: string, opts: RenderOptions = {}, toolkit?: VerovioToolkit): Promise<string> {
  const pages = await renderMusicXmlPages(xml, { ...opts, pages: "first" }, toolkit);
  return pages[0]!;
}
