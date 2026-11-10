export class PdfRenderError extends Error {}
export class PdfPublicationConflictError extends Error {}

export const PDF_VIEWPORT = Object.freeze({ width: 1240, height: 1754 });

export function pdfPageOptions(apiToken) {
  return {
    viewport: PDF_VIEWPORT,
    ...(apiToken ? { extraHTTPHeaders: { "x-keyspilli-api-token": `Bearer ${apiToken}` } } : {}),
  };
}

async function waitForExportReady(page, layout) {
  try {
    await page.waitForFunction(
      (expectedLayout) => {
        const state = window;
        if (typeof state.__sheetError === "string" || state.__publicationConflict === true || document.querySelector("[data-publication-conflict]")) return true;
        if (state.__sheetReady !== true) return false;
        if (expectedLayout !== "classic") return true;
        // The score-ready flag can be published before React commits the images.
        return state.__sheetPageCount > 0
          && document.querySelectorAll(".sheet-svg__page > img[data-pdf-svg]").length === state.__sheetPageCount;
      },
      layout,
      // The large classic smoke score produces 69 pages / 138 SVG elements.
      { timeout: 60_000 },
    );
  } catch {
    throw new PdfRenderError("score render readiness timed out");
  }

  const state = await page.evaluate((expectedLayout) => {
    const windowState = window;
    const sheetImage = document.querySelector(".sheet-svg img[data-pdf-svg]");
    return {
      ready: windowState.__sheetReady === true,
      error: windowState.__sheetError,
      publicationConflict: windowState.__publicationConflict === true || Boolean(document.querySelector("[data-publication-conflict]")),
      hasContent:
        expectedLayout === "classic"
          ? Boolean(sheetImage)
          : Boolean(document.querySelector("h1") && document.body.textContent?.trim()),
    };
  }, layout);

  if (state.publicationConflict) throw new PdfPublicationConflictError("publication changed; reload and retry");
  if (state.error) throw new PdfRenderError("score render failed");
  if (!state.ready || !state.hasContent) throw new PdfRenderError("score render did not produce printable content");
}

async function prepareClassicPdfCapture(page) {
  await page.evaluate(async () => {
    const images = Array.from(document.querySelectorAll(".sheet-svg__page > img[data-pdf-svg]"));
    await Promise.all(images.map(image => image.decode()));
    const first = images[0]?.getBoundingClientRect();
    if (!first || first.width <= 0 || first.height < 32 || images.some(image => image.naturalWidth <= 0)) {
      throw new Error("score SVG image preparation failed");
    }
  });
}

export async function renderPdfPage(page, { origin, id, layout, publicationRevision, active }) {
  if (active) {
    await page.route(`**/api/v1/sheet/${encodeURIComponent(id)}*`, (route) => route.fulfill({
      status: 200,
      contentType: "application/vnd.recordare.musicxml+xml",
      headers: { "X-Publication-Revision": publicationRevision ?? "unpinned" },
      body: active.xml,
    }));
  }
  const pin = `&revision=${publicationRevision === null ? "unpinned" : encodeURIComponent(publicationRevision)}`;
  const capture = layout === "classic" ? "&capture=pdf" : "";
  const response = await page.goto(`${origin}/export/${id}?layout=${layout}${pin}${capture}`, { waitUntil: "domcontentloaded" });
  if (response?.status() === 409) throw new PdfPublicationConflictError("publication changed; reload and retry");
  await waitForExportReady(page, layout);
  if (layout === "classic") await prepareClassicPdfCapture(page);
  if (active) await page.evaluate((title) => {
    const heading = document.querySelector("h1");
    if (heading) heading.textContent = title;
  }, active.title);
  return page.pdf({ format: "A4", printBackground: true });
}
