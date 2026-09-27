import type { RenderOptions } from "./verovio.js";

/**
 * A prepared score held by the Verovio worker. Keeping the toolkit alive for a
 * session lets the sheet view request only pages near the viewport instead of
 * cloning every SVG back to the main thread up front.
 */
export interface MusicXmlWorkerSession {
  readonly sessionId: number;
  readonly pageCount: number;
  readonly width: number;
  readonly height: number;
  prepare(): Promise<MusicXmlWorkerSession>;
  renderPage(page: number): Promise<string>;
  close(): Promise<void>;
}

type WorkerResponse =
  | { id: number; type: "opened"; sessionId: number }
  | { id: number; type: "prepared"; sessionId: number; pageCount: number; width: number; height: number }
  | { id: number; type: "page"; sessionId: number; page: number; svg: string }
  | { id: number; type: "closed"; sessionId: number }
  | { id: number; type: "error"; error: string };

type WorkerRequest =
  | { id: number; type: "open"; xml: string; options: RenderOptions }
  | { id: number; type: "prepare"; sessionId: number }
  | { id: number; type: "renderPage"; sessionId: number; page: number }
  | { id: number; type: "close"; sessionId: number };

// `Omit<WorkerRequest, "id">` collapses the discriminated union to its
// shared fields. Keep the request union distributed so each message retains
// the payload required by its `type` discriminator.
type WorkerRequestInput =
  | { type: "open"; xml: string; options: RenderOptions }
  | { type: "prepare"; sessionId: number }
  | { type: "renderPage"; sessionId: number; page: number }
  | { type: "close"; sessionId: number };

type PendingRender = {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export const VEROVIO_REQUEST_TIMEOUT_MS = 30_000;
let verovioWorker: Worker | null = null;
let workerGeneration = 0;
let nextRequestId = 1;
const pendingRenders = new Map<number, PendingRender>();

function rejectPendingRenders(error: Error): void {
  for (const pending of pendingRenders.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  pendingRenders.clear();
}

function disposeWorker(error: Error, worker: Worker): void {
  if (verovioWorker !== worker) return;
  verovioWorker = null;
  worker.terminate();
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
  workerGeneration += 1;
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    if (verovioWorker !== worker) return;
    const response = event.data;
    const pending = pendingRenders.get(response.id);
    if (!pending) return;
    pendingRenders.delete(response.id);
    clearTimeout(pending.timer);
    if (response.type === "error") {
      pending.reject(new Error(response.error));
      return;
    }
    pending.resolve(response);
  };
  worker.onerror = () => {
    disposeWorker(new Error("Verovio worker failed"), worker);
  };
  verovioWorker = worker;
  return worker;
}

function request(request: WorkerRequestInput): Promise<WorkerResponse> {
  const id = nextRequestId++;
  return new Promise<WorkerResponse>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = getVerovioWorker();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const timer = setTimeout(() => disposeWorker(new Error("Verovio worker request timed out"), worker), VEROVIO_REQUEST_TIMEOUT_MS);
    pendingRenders.set(id, { resolve, reject, timer });
    try {
      worker.postMessage({ id, ...request } satisfies WorkerRequest);
    } catch (error) {
      pendingRenders.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

class WorkerScoreSession implements MusicXmlWorkerSession {
  readonly sessionId: number;
  private _pageCount = 0;
  private _width = 1600;
  private _height = 2200;
  private closed = false;

  constructor(sessionId: number, private readonly generation: number) {
    this.sessionId = sessionId;
  }

  get pageCount(): number {
    return this._pageCount;
  }

  get width(): number {
    return this._width;
  }

  get height(): number {
    return this._height;
  }

  /** Prepare/layout the score once. Rendering individual pages is cheap after this. */
  async prepare(): Promise<this> {
    if (this.closed || this.generation !== workerGeneration || !verovioWorker) throw new Error("Verovio worker session is closed");
    const response = await request({ type: "prepare", sessionId: this.sessionId });
    if (response.type !== "prepared" || response.sessionId !== this.sessionId) {
      throw new Error("Verovio worker returned an invalid prepare response");
    }
    this._pageCount = Math.max(1, Math.floor(response.pageCount));
    this._width = response.width > 0 ? response.width : this._width;
    this._height = response.height > 0 ? response.height : this._height;
    return this;
  }

  async renderPage(page: number): Promise<string> {
    if (this.closed || this.generation !== workerGeneration || !verovioWorker) throw new Error("Verovio worker session is closed");
    if (!Number.isInteger(page) || page < 1 || (this._pageCount > 0 && page > this._pageCount)) {
      throw new RangeError(`Verovio page ${page} is outside 1–${this._pageCount || "?"}`);
    }
    const response = await request({ type: "renderPage", sessionId: this.sessionId, page });
    if (response.type !== "page" || response.sessionId !== this.sessionId || response.page !== page) {
      throw new Error("Verovio worker returned an invalid page response");
    }
    return response.svg;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.generation !== workerGeneration || !verovioWorker) return;
    try {
    const response = await request({ type: "close", sessionId: this.sessionId });
      if (response.type !== "closed" || response.sessionId !== this.sessionId) {
        throw new Error("Verovio worker returned an invalid close response");
      }
    } catch {
      // Closing is best effort. A worker failure has already rejected page
      // requests, and terminating it is handled by disposeWorker().
    }
  }
}

/**
 * Open and prepare a MusicXML score in a dedicated Verovio worker session.
 *
 * `prepare` is deliberately a separate worker message even though this
 * convenience function awaits it before resolving. Consumers that need an
 * explicit loading state can build on the same protocol while the normal
 * sheet view gets a single, ready-to-render session object.
 */
export async function openMusicXmlInWorker(xml: string, opts: RenderOptions = {}): Promise<MusicXmlWorkerSession> {
  const opened = await request({ type: "open", xml, options: opts });
  if (opened.type !== "opened") throw new Error("Verovio worker returned an invalid open response");
  const session = new WorkerScoreSession(opened.sessionId, workerGeneration);
  await session.prepare();
  return session;
}

/** Render every laid-out page through the session protocol. */
export async function renderMusicXmlPagesInWorker(xml: string, opts: RenderOptions = {}): Promise<string[]> {
  const session = await openMusicXmlInWorker(xml, opts);
  try {
    const pages: string[] = [];
    const count = opts.pages === "first" ? 1 : session.pageCount;
    for (let page = 1; page <= count; page += 1) {
      pages.push(await session.renderPage(page));
    }
    return pages;
  } finally {
    await session.close();
  }
}
