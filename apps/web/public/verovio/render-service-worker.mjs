import { VerovioToolkit } from "/verovio/verovio.mjs";
import "/verovio/render-worker.mjs";
import { loadServiceWorkerVerovio } from "/verovio/service-worker-verovio-loader.mjs";
import { normalizeSheetNavigationUrl, SHEET_NAVIGATION_PREFETCH_TTL_MS, takeFreshNavigationPrefetch } from "/verovio/sheet-navigation-prefetch.mjs";

let toolkitPromise = null;
let prefetchedNavigation = null;
globalThis.__keyspilliVerovioFactory = () => {
  toolkitPromise ??= loadServiceWorkerVerovio(fetch, VerovioToolkit, new URL("/verovio/verovio-module.mjs", self.location.origin).href);
  toolkitPromise.catch(() => { toolkitPromise = null; });
  return toolkitPromise;
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("message", event => {
  if (event.data?.type === "prefetch-sheet-navigation") {
    const url = normalizeSheetNavigationUrl(event.data.url, self.location.origin);
    if (!url) return;
    event.waitUntil((async () => {
      try {
        const response = await fetch(url, { credentials: "include", cache: "no-store" });
        if (!response.ok || response.redirected || new URL(response.url).href !== url || !response.headers.get("content-type")?.startsWith("text/html")) return;
        const headers = new Headers(response.headers);
        for (const name of ["content-encoding", "content-length", "content-range", "transfer-encoding"]) headers.delete(name);
        prefetchedNavigation = {
          url,
          expiresAt: Date.now() + SHEET_NAVIGATION_PREFETCH_TTL_MS,
          response: new Response(await response.arrayBuffer(), { status: response.status, statusText: response.statusText, headers }),
        };
      } catch {
        // A prefetch miss falls through to the normal network navigation.
      }
    })());
    return;
  }
  const port = event.ports[0];
  if (!port) return;
  event.waitUntil(self.__keyspilliVerovioDispatch(event, message => port.postMessage(message)));
});

self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate") return;
  if (prefetchedNavigation && prefetchedNavigation.expiresAt <= Date.now()) prefetchedNavigation = null;
  const response = takeFreshNavigationPrefetch(prefetchedNavigation, event.request.url);
  if (!response) return;
  prefetchedNavigation = null;
  event.respondWith(response);
});
