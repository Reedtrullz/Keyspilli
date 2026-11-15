import { VerovioToolkit } from "/verovio/verovio.mjs";
import "/verovio/render-worker.mjs";
import { loadServiceWorkerVerovio } from "/verovio/service-worker-verovio-loader.mjs";

let toolkitPromise = null;
globalThis.__keyspilliVerovioFactory = () => {
  toolkitPromise ??= loadServiceWorkerVerovio(fetch, VerovioToolkit, new URL("/verovio/verovio-module.mjs", self.location.origin).href);
  toolkitPromise.catch(() => { toolkitPromise = null; });
  return toolkitPromise;
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("message", event => {
  const port = event.ports[0];
  if (!port) return;
  event.waitUntil(self.__keyspilliVerovioDispatch(event, message => port.postMessage(message)));
});
