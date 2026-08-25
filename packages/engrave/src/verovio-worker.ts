import type { RenderOptions } from "./verovio.js";

type WorkerResponse =
  | { id: number; type: "result"; pages: string[] }
  | { id: number; type: "error"; error: string };

type PendingRender = {
  resolve: (pages: string[]) => void;
  reject: (error: Error) => void;
};

let verovioWorker: Worker | null = null;
let nextRequestId = 1;
const pendingRenders = new Map<number, PendingRender>();

function rejectPendingRenders(error: Error): void {
  for (const pending of pendingRenders.values()) pending.reject(error);
  pendingRenders.clear();
}

function disposeWorker(error: Error): void {
  const worker = verovioWorker;
  verovioWorker = null;
  worker?.terminate();
  rejectPendingRenders(error);
}

function getVerovioWorker(): Worker {
  if (verovioWorker) return verovioWorker;

  const WorkerConstructor = globalThis.Worker;
  if (!WorkerConstructor) {
    throw new Error("Verovio workers are unavailable in this environment");
  }

  const worker = new WorkerConstructor("/verovio/render-worker.mjs", {
    type: "module",
    name: "keyspilli-verovio",
  });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const pending = pendingRenders.get(response.id);
    if (!pending) return;
    pendingRenders.delete(response.id);
    if (response.type === "error") {
      pending.reject(new Error(response.error));
      return;
    }
    pending.resolve(response.pages);
  };
  worker.onerror = () => {
    disposeWorker(new Error("Verovio worker failed"));
  };
  verovioWorker = worker;
  return worker;
}

/**
 * Render MusicXML off the browser's main thread.
 *
 * Verovio's WASM layout is synchronous and can monopolize the UI thread for
 * several seconds on dense scores. The worker keeps that CPU cost but moves it
 * off the main thread. The caller can fall back to `renderMusicXmlPages` when
 * workers are unavailable (for example, during server-side rendering).
 */
export function renderMusicXmlPagesInWorker(xml: string, opts: RenderOptions = {}): Promise<string[]> {
  const id = nextRequestId++;
  return new Promise<string[]>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = getVerovioWorker();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    pendingRenders.set(id, { resolve, reject });
    try {
      worker.postMessage({ id, xml, options: opts });
    } catch (error) {
      pendingRenders.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
