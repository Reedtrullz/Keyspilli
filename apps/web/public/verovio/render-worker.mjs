let toolkitPromise = null;
let nextSessionId = 1;
let activeSession = null;

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
    // Raw SVG avoids Verovio's XML serializer whitespace and reduces the
    // structured-clone/innerHTML payload held by the main thread. This is a
    // memory/clone optimization; it does not change the MusicXML response.
    svgFormatRaw: options.svgFormatRaw ?? true,
  });
}

function scoreForVerovio(xml) {
  return xml
    .replace(/<tied\b[^>]*\/>/gi, "")
    .replace(/<notations>\s*<\/notations>/gi, "");
}

async function prepareSession(session) {
  const toolkit = await loadVerovio();
  setRenderOptions(toolkit, session.options);
  if (!toolkit.loadData(scoreForVerovio(session.xml))) throw new Error("Verovio loadData failed");
  session.toolkit = toolkit;
  session.pageCount = Math.max(1, Math.floor(toolkit.getPageCount()));
  session.prepared = true;
}

function assertActiveSession(sessionId, requirePrepared = true) {
  if (!activeSession || activeSession.sessionId !== sessionId) {
    throw new Error("Verovio worker session is not active");
  }
  if (requirePrepared && (!activeSession.prepared || !activeSession.toolkit)) {
    throw new Error("Verovio worker session is not prepared");
  }
  return activeSession;
}

self.onmessage = async (event) => {
  const request = event.data ?? {};
  const { id, type } = request;
  if (!Number.isInteger(id) || typeof type !== "string") return;

  try {
    if (type === "open") {
      if (typeof request.xml !== "string") throw new Error("MusicXML is required");
      const session = {
        sessionId: nextSessionId++,
        xml: request.xml,
        options: request.options ?? {},
        toolkit: null,
        pageCount: 0,
        prepared: false,
      };
      // Only one Verovio toolkit is retained by this worker. Opening a new
      // session supersedes a stale one; the main-thread generation token will
      // ignore any replies from a session that is no longer in use.
      activeSession = session;
      self.postMessage({ id, type: "opened", sessionId: session.sessionId });
      return;
    }

    if (type === "prepare") {
      // Preparation is the operation that sets `prepared`; requiring the
      // prepared flag here rejects every valid first prepare request and
      // silently forces the caller onto the much slower main-thread fallback.
      const session = assertActiveSession(request.sessionId, false);
      if (!session.prepared) await prepareSession(session);
      self.postMessage({
        id,
        type: "prepared",
        sessionId: session.sessionId,
        pageCount: session.pageCount,
        width: session.options.pageWidth ?? 1600,
        height: session.options.pageHeight ?? 2200,
      });
      return;
    }

    if (type === "renderPage") {
      const session = assertActiveSession(request.sessionId);
      const page = request.page;
      if (!Number.isInteger(page) || page < 1 || page > session.pageCount) {
        throw new RangeError(`Verovio page ${page} is outside 1–${session.pageCount}`);
      }
      const svg = assertRenderedPage(session.toolkit.renderToSVG(page), page);
      self.postMessage({ id, type: "page", sessionId: session.sessionId, page, svg });
      return;
    }

    if (type === "close") {
      if (activeSession?.sessionId === request.sessionId) activeSession = null;
      self.postMessage({ id, type: "closed", sessionId: request.sessionId });
      return;
    }

    throw new Error(`Unknown Verovio worker request: ${type}`);
  } catch (error) {
    self.postMessage({
      id,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
