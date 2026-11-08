import {NextRequest,NextResponse} from "next/server";
import {chromium,type Browser,type Page} from "playwright";
import {PublicationRevisionConflictError,type SongDetailShell} from "./catalog-api";
import {PdfPublicationConflictError,PdfRenderError,pdfPageOptions,renderPdfPage} from "./pdf-render-core.mjs";

let browserPromise: Promise<Browser> | null = null;
let activeRenders = 0;

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

function pdfErrorResponse(code: "PDF_GENERATION_UNAVAILABLE" | "PDF_RENDER_FAILED") {
  return NextResponse.json(
    { error: code === "PDF_RENDER_FAILED" ? "PDF score rendering failed" : "PDF generation is unavailable", code },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

const RESPONSE_HEADERS = ["content-type", "content-disposition", "cache-control", "retry-after", "x-publication-revision", "x-active-arrangement-sha256"];

async function renderRemotePdfResponse(req:NextRequest,id:string,layout:"classic"|"simplify",shell:Pick<SongDetailShell,"publicationRevision">,active?:{xml:string;title:string;hash:string}):Promise<Response>{
    const endpoint=process.env.KEYSPILLI_PDF_RENDERER_URL, token=process.env.KEYSPILLI_API_TOKEN;
    if(!endpoint||!token) return pdfErrorResponse("PDF_GENERATION_UNAVAILABLE");
    try {
      const renderUrl=new URL("render",endpoint.endsWith("/")?endpoint:endpoint+"/").toString();
      const response=await fetch(renderUrl,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({id,layout,shell:{publicationRevision:shell.publicationRevision},active}),signal:req.signal});
      const headers=new Headers();
      for(const name of RESPONSE_HEADERS){const value=response.headers.get(name);if(value!==null)headers.set(name,value);}
      return new NextResponse(response.body,{status:response.status,headers});
    } catch { return pdfErrorResponse("PDF_GENERATION_UNAVAILABLE"); }
}

export async function renderPdfResponse(req:NextRequest,id:string,layout:"classic"|"simplify",shell:Pick<SongDetailShell,"publicationRevision">,active?:{xml:string;title:string;hash:string}):Promise<Response>{
    if(process.env.KEYSPILLI_PDF_RENDERER_URL) return renderRemotePdfResponse(req,id,layout,shell,active);
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
        const apiToken = process.env.KEYSPILLI_API_TOKEN;
        // The renderer loads this app's own pages, which the login gate would turn away.
        const created = await browser.newPage(pdfPageOptions(apiToken));
        if (cancelled) { void created.close().catch(() => undefined); checkCancelled(); }
        page = created;
        const origin = process.env.KEYSPILLI_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
        const pdf = await renderPdfPage(page, { origin, id, layout, publicationRevision: shell.publicationRevision, active });
        checkCancelled();
        return pdf;
      };
      const pdf = await Promise.race([render(), deadline]);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${id}${active?"-active":""}-${layout}.pdf"`,
          "X-Publication-Revision": shell.publicationRevision ?? "unpinned",
          ...(active?{"X-Active-Arrangement-SHA256":active.hash}:{}),
        },
      });
    } catch (e) {
      if (e instanceof PdfPublicationConflictError || e instanceof PublicationRevisionConflictError) {
        return NextResponse.json({ error: "publication changed; reload and retry", code: "PUBLICATION_REVISION_CONFLICT" }, { status: 409, headers: { "Cache-Control": "no-store" } });
      }
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
