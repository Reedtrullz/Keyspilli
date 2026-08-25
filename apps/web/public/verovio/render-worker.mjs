let toolkitPromise = null;

const SVG_WIDTH_RE = /<svg\b[^>]*\bwidth=["']([0-9]+(?:\.[0-9]+)?)(?:px)?["']/i;
const SVG_HEIGHT_RE = /<svg\b[^>]*\bheight=["']([0-9]+(?:\.[0-9]+)?)(?:px)?["']/i;
const SVG_VIEWBOX_RE = /<svg\b[^>]*\bviewBox=["']\s*[-+0-9.e]+\s+[-+0-9.e]+\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)["']/i;

async function loadVerovio() {
  if (toolkitPromise) return toolkitPromise;
  toolkitPromise = (async () => {
    const moduleUrl = new URL("./verovio-module.mjs", import.meta.url).href;
    const toolkitUrl = new URL("./verovio.mjs", import.meta.url).href;
    const createVerovioModule = await import(moduleUrl);
    const { VerovioToolkit } = await import(toolkitUrl);
    const verovioModule = await createVerovioModule.default();
    return new VerovioToolkit(verovioModule);
  })();
  try {
    return await toolkitPromise;
  } catch (error) {
    toolkitPromise = null;
    throw error;
  }
}

function assertRenderedPage(svg, page) {
  if (!/^\s*<svg\b/i.test(svg)) throw new Error(`Verovio returned invalid SVG for page ${page}`);
  const widthMatch = svg.match(SVG_WIDTH_RE);
  const heightMatch = svg.match(SVG_HEIGHT_RE);
  const viewBox = svg.match(SVG_VIEWBOX_RE);
  const width = widthMatch?.[1] ?? viewBox?.[1];
  const height = heightMatch?.[1] ?? viewBox?.[2];
  if (!width || !height || Number(width) <= 0 || Number(height) <= 0) {
    throw new Error(`Verovio returned an unbounded SVG for page ${page}`);
  }
  if (!/<(?:g|path|text|use)\b/i.test(svg)) {
    throw new Error(`Verovio returned an empty SVG for page ${page}`);
  }
  if (!widthMatch || !heightMatch) {
    return svg.replace(/<svg\b([^>]*)>/i, (_root, attrs) => {
      const withWidth = widthMatch ? attrs : `${attrs} width="${width}px"`;
      const withHeight = heightMatch ? withWidth : `${withWidth} height="${height}px"`;
      return `<svg${withHeight}>`;
    });
  }
  return svg;
}

function setRenderOptions(toolkit, options) {
  toolkit.setOptions?.({
    scale: options.scale ?? 40,
    pageWidth: options.pageWidth ?? 1600,
    pageHeight: options.pageHeight ?? 2200,
    breaks: options.breaks ?? "auto",
    font: "Bravura",
    svgViewBox: true,
  });
}

function scoreForVerovio(xml) {
  return xml
    .replace(/<tied\b[^>]*\/>/gi, "")
    .replace(/<notations>\s*<\/notations>/gi, "");
}

async function render(xml, options) {
  const toolkit = await loadVerovio();
  setRenderOptions(toolkit, options);
  if (!toolkit.loadData(scoreForVerovio(xml))) throw new Error("Verovio loadData failed");
  const pageCount = Math.max(1, Math.floor(toolkit.getPageCount()));
  const count = options.pages === "first" ? 1 : pageCount;
  const pages = [];
  for (let page = 1; page <= count; page += 1) {
    pages.push(assertRenderedPage(toolkit.renderToSVG(page), page));
  }
  return pages;
}

self.onmessage = async (event) => {
  const { id, xml, options } = event.data ?? {};
  if (!Number.isInteger(id) || typeof xml !== "string") return;
  try {
    const pages = await render(xml, options ?? {});
    self.postMessage({ id, type: "result", pages });
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
