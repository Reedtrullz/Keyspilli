import { NextRequest, NextResponse } from "next/server";
import { chromium, type Browser, type Page } from "playwright";
import { getArtifactFile, getSongDetail } from "@/lib/catalog-api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

let browserPromise: Promise<Browser> | null = null;

class PdfRenderError extends Error {}

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const browser = await browserPromise;
    if (browser.isConnected()) return browser;
    browserPromise = null;
  }

  const launch = chromium.launch({ headless: true, args: ["--no-sandbox"] });
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
      { timeout: 30_000 },
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
    if (layout === "classic") {
      const detail = await getSongDetail(id);
      if (!detail || !detail.data) return NextResponse.json({ error: "not found" }, { status: 404 });
      if (detail.song.hasSheetXml !== 1) {
        return NextResponse.json(
          { error: "classic PDF unavailable", code: "CLASSIC_PDF_UNAVAILABLE" },
          { status: 404 },
        );
      }
    }

    let page: Page | null = null;
    let browser: Browser | null = null;
    try {
      browser = await getBrowser();
      page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
      const origin = process.env.KEYSPILLI_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
      await page.goto(`${origin}/export/${id}?layout=${layout}`, { waitUntil: "networkidle" });
      await waitForExportReady(page, layout);
      const pdf = await page.pdf({ format: "A4", printBackground: true });
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
      if (browser && !browser.isConnected()) browserPromise = null;
      return pdfErrorResponse(renderFailure ? "PDF_RENDER_FAILED" : "PDF_GENERATION_UNAVAILABLE");
    } finally {
      // A page is request-scoped. Always close it, including navigation,
      // readiness, and PDF failures, so repeated downloads do not leak tabs.
      await page?.close().catch(() => undefined);
    }
  }
  return NextResponse.json({ error: "unknown type" }, { status: 400 });
}
