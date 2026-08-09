import { NextRequest, NextResponse } from "next/server";
import { chromium, Browser } from "playwright";
import { getArtifactFile } from "@/lib/catalog-api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) browserPromise = chromium.launch({ args: ["--no-sandbox"] });
  return browserPromise;
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
    try {
      const browser = await getBrowser();
      const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
      const origin = process.env.KEYSPILLI_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
      await page.goto(`${origin}/export/${id}?layout=${layout}`, { waitUntil: "networkidle" });
      await page.waitForFunction(
        () => (window as unknown as { __sheetReady?: boolean }).__sheetReady === true,
        undefined,
        { timeout: 30000 },
      );
      const pdf = await page.pdf({ format: "A4", printBackground: true });
      await page.close();
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${id}-${layout}.pdf"`,
        },
      });
    } catch (e) {
      return NextResponse.json({ error: `pdf generation failed: ${(e as Error).message}` }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "unknown type" }, { status: 400 });
}
