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
      () => {
        const state = window;
        return state.__sheetReady === true || typeof state.__sheetError === "string" || state.__publicationConflict === true || Boolean(document.querySelector("[data-publication-conflict]"));
      },
      undefined,
      // The large classic smoke score produces 69 pages / 138 SVG elements.
      { timeout: 60_000 },
    );
  } catch {
    throw new PdfRenderError("score render readiness timed out");
  }

  const state = await page.evaluate((expectedLayout) => {
    const windowState = window;
    const svg = document.querySelector(".sheet-svg svg");
    const rect = svg?.getBoundingClientRect();
    return {
      ready: windowState.__sheetReady === true,
      error: windowState.__sheetError,
      publicationConflict: windowState.__publicationConflict === true || Boolean(document.querySelector("[data-publication-conflict]")),
      hasContent:
        expectedLayout === "classic"
          ? Boolean(svg && rect && rect.width > 0 && rect.height >= 32)
          : Boolean(document.querySelector("h1") && document.body.textContent?.trim()),
    };
  }, layout);

  if (state.publicationConflict) throw new PdfPublicationConflictError("publication changed; reload and retry");
  if (state.error) throw new PdfRenderError("score render failed");
  if (!state.ready || !state.hasContent) throw new PdfRenderError("score render did not produce printable content");
}

/** Use image-backed SVG pages for Chromium's PDF compositor without changing the interactive sheet. */
async function prepareClassicPdfCapture(page) {
  await page.evaluate(async () => {
    const pageNodes = Array.from(document.querySelectorAll(".sheet-svg__page"));
    const images = [];
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
  const response = await page.goto(`${origin}/export/${id}?layout=${layout}${pin}`, { waitUntil: "networkidle" });
  if (response?.status() === 409) throw new PdfPublicationConflictError("publication changed; reload and retry");
  await waitForExportReady(page, layout);
  if (layout === "classic") await prepareClassicPdfCapture(page);
  if (active) await page.evaluate((title) => {
    const heading = document.querySelector("h1");
    if (heading) heading.textContent = title;
  }, active.title);
  return page.pdf({ format: "A4", printBackground: true });
}
