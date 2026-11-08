import http from 'node:http';
import { createRequire } from 'node:module';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PdfPublicationConflictError, PdfRenderError, pdfPageOptions, renderPdfPage } from '../apps/web/src/lib/pdf-render-core.mjs';

const BODY_LIMIT = 4 * 1024 * 1024;

function json(res, status, body, headers = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': bytes.length, ...headers });
  res.end(bytes);
}

export function pdfRequestAllowed(req, token) {
  if (req.method === 'GET' && req.url === '/health') return true;
  if (req.method !== 'POST' || req.url !== '/render' || !token) return false;
  const supplied = Buffer.from(String(req.headers.authorization ?? ''));
  const expected = Buffer.from(`Bearer ${token}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(req) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > BODY_LIMIT) throw Object.assign(new Error('body too large'), { status: 413 });
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > BODY_LIMIT) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

export async function startPdfRenderer({ origin, apiToken, port = 3001 }) {
  const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
  const { chromium } = require('playwright');
  let browserPromise = null;
  let activeRenders = 0;
  let closing = false;

  async function getBrowser() {
    if (browserPromise) {
      const browser = await browserPromise;
      if (browser.isConnected()) return browser;
      browserPromise = null;
    }
    browserPromise = chromium.launch({ headless: true, args: ['--no-sandbox'], timeout: 15_000 }).catch((error) => {
      browserPromise = null;
      throw error;
    });
    return browserPromise;
  }

  async function render(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('invalid request'), { status: 400 });
    const { id, layout, shell, active } = body;
    if (typeof id !== 'string' || !id || id.length > 512 || !['classic', 'simplify'].includes(layout)) throw Object.assign(new Error('invalid request'), { status: 400 });
    const publicationRevision = shell?.publicationRevision;
    if (publicationRevision !== null && (typeof publicationRevision !== 'string' || publicationRevision.length > 128)) throw Object.assign(new Error('invalid revision'), { status: 400 });
    if (active !== undefined && (!active || typeof active.xml !== 'string' || active.xml.length > BODY_LIMIT || typeof active.title !== 'string' || active.title.length > 2048 || typeof active.hash !== 'string' || !/^[a-f0-9]{64}$/.test(active.hash))) throw Object.assign(new Error('invalid active arrangement'), { status: 400 });
    if (activeRenders >= 1) return { status: 503, json: { error: 'PDF render busy', code: 'PDF_RENDER_BUSY' }, headers: { 'Retry-After': '5' } };
    activeRenders++;
    let browser, page, cancelled = false, cancel;
    const deadline = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        cancelled = true;
        reject(new PdfRenderError('PDF render deadline'));
        if (page) void page.close().catch(() => undefined);
      }, 90_000);
      cancel = () => clearTimeout(timer);
    });
    try {
      browser = await getBrowser();
      if (cancelled) throw new PdfRenderError('PDF render cancelled');
      page = await browser.newPage(pdfPageOptions(apiToken));
      const bytes = await Promise.race([
        renderPdfPage(page, { origin, id, layout, publicationRevision, active }),
        deadline,
      ]);
      return {
        status: 200,
        bytes,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${id}${active ? '-active' : ''}-${layout}.pdf"`,
          'X-Publication-Revision': publicationRevision ?? 'unpinned',
          ...(active ? { 'X-Active-Arrangement-SHA256': active.hash } : {}),
        },
      };
    } catch (error) {
      if (error instanceof PdfPublicationConflictError) return { status: 409, json: { error: 'publication changed; reload and retry', code: 'PUBLICATION_REVISION_CONFLICT' }, headers: { 'Cache-Control': 'no-store' } };
      if (browser && !browser.isConnected()) browserPromise = null;
      console.error('[pdf-renderer] failure', { id, layout, error: error instanceof Error ? error.message.slice(0, 256) : 'unknown' });
      const code = error instanceof PdfRenderError ? 'PDF_RENDER_FAILED' : 'PDF_GENERATION_UNAVAILABLE';
      return { status: 503, json: { error: code === 'PDF_RENDER_FAILED' ? 'PDF score rendering failed' : 'PDF generation is unavailable', code }, headers: { 'Cache-Control': 'no-store' } };
    } finally {
      activeRenders--;
      cancel?.();
      if (page) void page.close().catch(() => undefined);
      if (cancelled && browser && !browser.isConnected()) browserPromise = null;
    }
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      if (!pdfRequestAllowed(req, apiToken)) return json(res, 401, { error: 'unauthorized' });
      if (req.method === 'GET') return json(res, 200, { status: 'ready' }, { 'Cache-Control': 'no-store' });
      try {
        const result = await render(await readJson(req));
        if (result.bytes) {
          const bytes = Buffer.from(result.bytes);
          res.writeHead(result.status, { ...result.headers, 'Content-Length': bytes.length });
          res.end(bytes);
        } else json(res, result.status, result.json, result.headers);
      } catch (error) {
        json(res, error?.status ?? 400, { error: error instanceof Error ? error.message : 'invalid request' });
      }
    })();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    url: `http://127.0.0.1:${port}`,
    async close() {
      if (closing) return;
      closing = true;
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
      if (browserPromise) {
        const browser = await browserPromise.catch(() => null);
        await browser?.close().catch(() => undefined);
      }
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const renderer = await startPdfRenderer({
    origin: process.env.KEYSPILLI_ORIGIN,
    apiToken: process.env.KEYSPILLI_API_TOKEN,
    port: 3001,
  });
  console.log(JSON.stringify({ kind: 'keyspilli-pdf-renderer', state: 'ready', port: 3001 }));
  const stop = () => void renderer.close().finally(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
