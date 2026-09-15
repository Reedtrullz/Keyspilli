import { NextRequest, NextResponse } from "next/server";
import { chromium, type Browser, type Page } from "playwright";
import { getArtifactFile, getSongDetailShell } from "@/lib/catalog-api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

let browserPromise: Promise<Browser> | null = null;
let activeRenders = 0;

class PdfRenderError extends Error {}

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const browser = await browserPromise;
    if (browser.isConnected()) return browser;
    browserPromise = null;
  }

  const launch = chromium.launch({ headless: true, args: ["--no-sandbox"], timeout: 15_000 });
  browserPromise = launch.catch((error) => {
    // A failed launch must not poison every subsequent request with the same
    // rejected promise. This is particularly important after a browser path
    // or shared-library problem is corrected during a rolling deployment.
    browserPromise = null;
    throw error;
  });
  return browserPromise;
}

async function waitForExportReady(page: Page, layout: "simplify" | "classic"): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const state = window as unknown as { __sheetReady?: boolean; __sheetError?: string };
        return state.__sheetReady === true || typeof state.__sheetError === "string";
      },
      undefined,
      // The large classic smoke score produces 69 pages / 138 SVG elements
      // and can take about 39 seconds on the production VPS when cold. Leave
      // bounded headroom so a valid render does not trigger a rollback.
      { timeout: 60_000 },
    );
  } catch {
    throw new PdfRenderError("score render readiness timed out");
  }

  const state = await page.evaluate((expectedLayout) => {
    const windowState = window as unknown as { __sheetReady?: boolean; __sheetError?: string };
    const svg = document.querySelector(".sheet-svg svg");
    const rect = svg?.getBoundingClientRect();
    return {
      ready: windowState.__sheetReady === true,
      error: windowState.__sheetError,
      // The simplified score is server-rendered; the heading plus body text
      // confirms that the export page did not render an empty/error document.
      hasContent:
        expectedLayout === "classic"
          ? Boolean(svg && rect && rect.width > 0 && rect.height >= 32)
          : Boolean(document.querySelector("h1") && document.body.textContent?.trim()),
    };
  }, layout);

  if (state.error) throw new PdfRenderError("score render failed");
  if (!state.ready || !state.hasContent) throw new PdfRenderError("score render did not produce printable content");
}

/**
 * Chromium's PDF compositor spends much longer laying out thousands of SVG
 * nodes than it does decoding the same SVG as an image. Keep the artwork
 * vector-based, but replace each page subtree with a Blob URL before capture;
 * this is an export-only representation and does not change the interactive
 * sheet DOM.
 */
async function prepareClassicPdfCapture(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const pageNodes = Array.from(document.querySelectorAll<HTMLElement>(".sheet-svg__page"));
    const images: HTMLImageElement[] = [];
    for (const pageNode of pageNodes) {
      const svg = pageNode.querySelector(":scope > svg");
      if (!svg) continue;
      const source = new XMLSerializer().serializeToString(svg);
      const image = document.createElement("img");
      image.alt = "";
      image.dataset.pdfSvg = "true";
      image.style.display = "block";
      image.style.width = "100%";
      image.src = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
      pageNode.replaceChildren(image);
      images.push(image);
    }
    await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
    if (images.length !== pageNodes.length || images.some((image) => image.naturalWidth <= 0)) {
      throw new Error("score SVG image preparation failed");
    }
  });
}

function pdfErrorResponse(code: "PDF_GENERATION_UNAVAILABLE" | "PDF_RENDER_FAILED") {
  return NextResponse.json(
    { error: code === "PDF_RENDER_FAILED" ? "PDF score rendering failed" : "PDF generation is unavailable", code },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const type = req.nextUrl.searchParams.get("type") ?? "midi";
  const layout = req.nextUrl.searchParams.get("layout") ?? "simplify";

  if (type === "midi" || type === "musicxml") {
    const buf = await getArtifactFile(id, type === "midi" ? "variant.mid" : "variant.xml");
    if (!buf) return NextResponse.json({ error: "not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": type === "midi" ? "audio/midi" : "application/vnd.recordare.musicxml+xml",
        "Content-Disposition": `attachment; filename="${id}.${type === "midi" ? "mid" : "musicxml"}"`,
      },
    });
  }

  if (type === "pdf") {
    if (layout !== "simplify" && layout !== "classic") {
      return NextResponse.json({ error: "unknown PDF layout" }, { status: 400 });
    }
    const shell = await getSongDetailShell(id);
    if (!shell) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (layout === "classic") {
      if (shell.song.hasSheetXml !== 1) {
        return NextResponse.json(
          { error: "classic PDF unavailable", code: "CLASSIC_PDF_UNAVAILABLE" },
          { status: 404 },
        );
      }
    }

    // ponytail: two renders per web process; a render queue is only needed at higher load.
    if (activeRenders >= 2) return NextResponse.json({ error: "PDF render busy", code: "PDF_RENDER_BUSY" }, { status: 503, headers: { "Retry-After": "5" } });
    activeRenders++;
    let page: Page | null = null;
    let browser: Browser | null = null;
    let cancelled = false;
    let cancel!: () => void;
    const deadline = new Promise<never>((_, reject) => {
      cancel = () => {
        cancelled = true;
        reject(new PdfRenderError("PDF render deadline or cancellation"));
        if (page) void page.close().catch(() => undefined);
        else if (browser) {
          browserPromise = null;
          void browser.close().catch(() => undefined);
        }
      };
    });
    const timer = setTimeout(cancel, 90_000);
    req.signal.addEventListener("abort", cancel, { once: true });
    if (req.signal.aborted) cancel();
    const checkCancelled = () => { if (cancelled) throw new PdfRenderError("PDF render cancelled"); };
    try {
      const render = async () => {
        checkCancelled();
        browser = await getBrowser();
        checkCancelled();
        const created = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
        if (cancelled) { void created.close().catch(() => undefined); checkCancelled(); }
        page = created;
        const origin = process.env.KEYSPILLI_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
        await page.goto(`${origin}/export/${id}?layout=${layout}`, { waitUntil: "networkidle" });
        checkCancelled();
        await waitForExportReady(page, layout);
        checkCancelled();
        if (layout === "classic") await prepareClassicPdfCapture(page);
        checkCancelled();
        return page.pdf({ format: "A4", printBackground: true });
      };
      const pdf = await Promise.race([render(), deadline]);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${id}-${layout}.pdf"`,
        },
      });
    } catch (e) {
      const renderFailure = e instanceof PdfRenderError;
      console.error(`[pdf-export] ${renderFailure ? "render" : "generation"} failure`, {
        id,
        layout,
        error: e instanceof Error ? e.message : String(e),
      });
      if (browser && !(browser as Browser).isConnected()) browserPromise = null;
      return pdfErrorResponse(renderFailure ? "PDF_RENDER_FAILED" : "PDF_GENERATION_UNAVAILABLE");
    } finally {
      // A page is request-scoped. Always close it, including navigation,
      // readiness, and PDF failures, so repeated downloads do not leak tabs.
      clearTimeout(timer);
      req.signal.removeEventListener("abort", cancel);
      cancelled = true;
      // Closing is best effort; a wedged Chromium must not hold admission forever.
      void (page as Page | null)?.close().catch(() => undefined);
      activeRenders--;
    }
  }
  return NextResponse.json({ error: "unknown type" }, { status: 400 });
}
