import createVerovioModule from "/verovio/verovio-module.mjs";
import { VerovioToolkit } from "/verovio/verovio.mjs";
import "/verovio/render-worker.mjs";

globalThis.__keyspilliVerovioFactory = async () => new VerovioToolkit(await createVerovioModule());

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("message", event => {
  const port = event.ports[0];
  if (!port) return;
  event.waitUntil(self.__keyspilliVerovioDispatch(event, message => port.postMessage(message)));
});
