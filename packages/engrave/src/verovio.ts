let toolkitPromise: Promise<VerovioToolkit> | null = null;

export interface VerovioToolkit {
  loadData: (xml: string) => boolean;
  renderToSVG: (page?: number) => string;
  getPageCount: () => number;
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
    const tk = new VerovioToolkit(VerovioModule);
    return tk;
  })();
  return toolkitPromise;
}

export interface RenderOptions {
  scale?: number;
  pageWidth?: number;
  pageHeight?: number;
  colored?: boolean;
  breaks?: "none" | "auto";
}

/** Render MusicXML to an SVG document string. */
export async function renderMusicXml(xml: string, opts: RenderOptions = {}): Promise<string> {
  const tk = await loadVerovio();
  const options = {
    scale: opts.scale ?? 50,
    pageWidth: opts.pageWidth ?? 1200,
    pageHeight: opts.pageHeight ?? 1600,
    breaks: opts.breaks ?? "none",
    border: 0,
    adjustPageHeight: 1,
    font: "Bravura",
  };
  tk.loadData(xml);
  // Verovio exposes options via loadData's second arg in some builds.
  try {
    (tk as unknown as { setOptions?: (o: Record<string, unknown>) => void }).setOptions?.(options);
  } catch {}
  return tk.renderToSVG(1);
}
