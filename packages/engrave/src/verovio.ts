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
}

/** Render MusicXML to an SVG document string. */
export async function renderMusicXml(xml: string, opts: RenderOptions = {}, toolkit?: VerovioToolkit): Promise<string> {
  const tk = toolkit ?? (await loadVerovio());
  const options = {
    scale: opts.scale ?? 50,
    pageWidth: opts.pageWidth ?? 1200,
    pageHeight: opts.pageHeight ?? 1600,
    breaks: opts.breaks ?? "none",
    border: 0,
    adjustPageHeight: 1,
    font: "Bravura",
  };
  // Verovio lays out at load time; options must be set first.
  tk.setOptions?.(options);
  if (!tk.loadData(xml)) throw new Error("Verovio loadData failed");
  return tk.renderToSVG(1);
}
