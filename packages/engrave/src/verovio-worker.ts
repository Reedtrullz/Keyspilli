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
  elementPage(elementId: string): Promise<number>;
  close(): Promise<void>;
}

type WorkerResponse =
  | { id: number; type: "warm" }
  | { id: number; type: "opened"; sessionId: number }
  | { id: number; type: "prepared"; sessionId: number; pageCount: number; width: number; height: number }
  | { id: number; type: "page"; sessionId: number; page: number; svg: string }
  | { id: number; type: "elementPage"; sessionId: number; elementId: string; page: number }
  | { id: number; type: "closed"; sessionId: number }
  | { id: number; type: "error"; error: string };

type WorkerRequest =
  | { id: number; type: "warm" }
  | { id: number; type: "open"; xml: string; options: RenderOptions; prepare?: boolean }
  | { id: number; type: "prepare"; sessionId: number }
  | { id: number; type: "renderPage"; sessionId: number; page: number }
  | { id: number; type: "elementPage"; sessionId: number; elementId: string }
  | { id: number; type: "close"; sessionId: number };

// `Omit<WorkerRequest, "id">` collapses the discriminated union to its
// shared fields. Keep the request union distributed so each message retains
// the payload required by its `type` discriminator.
type WorkerRequestInput =
  | { type: "warm" }
  | { type: "open"; xml: string; options: RenderOptions; prepare?: boolean }
  | { type: "prepare"; sessionId: number }
  | { type: "renderPage"; sessionId: number; page: number }
  | { type: "elementPage"; sessionId: number; elementId: string }
  | { type: "close"; sessionId: number };

type PendingRender = {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  cancel: () => void;
};

type VerovioWorkerChannel = {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: Event) => void) | null;
  postMessage: (message: WorkerRequest) => () => void;
  terminate: () => void;
};

class DedicatedWorkerChannel implements VerovioWorkerChannel {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(private readonly worker: Worker) {
    worker.onmessage = event => this.onmessage?.(event);
    worker.onerror = event => this.onerror?.(event);
  }

  postMessage(message: WorkerRequest): () => void {
    this.worker.postMessage(message);
    return () => undefined;
  }

  terminate(): void {
    this.worker.terminate();
  }
}

class ServiceWorkerChannel implements VerovioWorkerChannel {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(private readonly worker: ServiceWorker, private readonly registration: ServiceWorkerRegistration) {}

  postMessage(message: WorkerRequest): () => void {
    const channel = new MessageChannel();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      channel.port1.close();
    };
    channel.port1.onmessage = event => {
      close();
      this.onmessage?.({ data: event.data } as MessageEvent<WorkerResponse>);
    };
    channel.port1.onmessageerror = () => {
      close();
      this.onerror?.(new Event("messageerror"));
    };
    channel.port1.start();
    this.worker.postMessage(message, [channel.port2]);
    return close;
  }

  terminate(): void {
    disableServiceWorker();
    void this.registration.unregister().catch(() => undefined);
  }
}

export const VEROVIO_REQUEST_TIMEOUT_MS = 30_000;
const SERVICE_WORKER_URL = "/verovio/render-service-worker.mjs";
const SERVICE_WORKER_DISABLED_KEY = "keyspilli:verovio-service-worker-disabled";
let verovioWorker: VerovioWorkerChannel | null = null;
let workerChannelPromise: Promise<VerovioWorkerChannel> | null = null;
let serviceWorkerRegistration: Promise<ServiceWorkerRegistration | null> | null = null;
let serviceWorkerDisabled = (() => {
  try { return globalThis.sessionStorage?.getItem(SERVICE_WORKER_DISABLED_KEY) === "1"; }
  catch { return false; }
})();
let workerGeneration = 0;
let nextRequestId = 1;
const pendingRenders = new Map<number, PendingRender>();

function rejectPendingRenders(error: Error): void {
  for (const pending of pendingRenders.values()) {
    pending.cancel();
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  pendingRenders.clear();
}

function disposeWorker(error: Error, worker: VerovioWorkerChannel): void {
  if (verovioWorker !== worker) return;
  verovioWorker = null;
  workerChannelPromise = null;
  worker.terminate();
  rejectPendingRenders(error);
}

function attachVerovioWorker(worker: VerovioWorkerChannel): VerovioWorkerChannel {
  workerGeneration += 1;
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    if (verovioWorker !== worker) return;
    const response = event.data;
    const pending = pendingRenders.get(response.id);
    if (!pending) return;
    pending.cancel();
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

function serviceWorkerContainer(): ServiceWorkerContainer | null {
  return (globalThis.navigator as Navigator | undefined)?.serviceWorker ?? null;
}

function disableServiceWorker(): void {
  serviceWorkerDisabled = true;
  serviceWorkerRegistration = null;
  try { globalThis.sessionStorage?.setItem(SERVICE_WORKER_DISABLED_KEY, "1"); }
  catch { /* Storage can be unavailable under privacy policy. */ }
}

function readyServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (serviceWorkerDisabled) return Promise.resolve(null);
  if (serviceWorkerRegistration) return serviceWorkerRegistration;
  const pending = (async (): Promise<ServiceWorkerRegistration | null> => {
    const container = serviceWorkerContainer();
    if (!container) return null;
    try {
      const scriptURL = new URL(SERVICE_WORKER_URL, globalThis.location?.origin ?? "http://localhost").href;
      const matches = (registration: ServiceWorkerRegistration | null | undefined) => registration?.active?.scriptURL === scriptURL ? registration : null;
      const existing = await container.getRegistration();
      const matched = matches(existing);
      if (matched) return matched;
      await container.register(SERVICE_WORKER_URL, { type: "module", scope: "/" });
      return await new Promise<ServiceWorkerRegistration | null>(resolve => {
        const timer = setTimeout(() => resolve(null), 1_500);
        container.ready.then(
          registration => { clearTimeout(timer); resolve(matches(registration)); },
          () => { clearTimeout(timer); resolve(null); },
        );
      });
    } catch {
      return null;
    }
  })();
  serviceWorkerRegistration = pending;
  return pending;
}

async function createVerovioWorker(): Promise<VerovioWorkerChannel> {
  const registration = await readyServiceWorker();
  if (registration?.active) return new ServiceWorkerChannel(registration.active, registration);

  const WorkerConstructor = globalThis.Worker;
  if (!WorkerConstructor) throw new Error("Verovio workers are unavailable in this environment");
  return new DedicatedWorkerChannel(new WorkerConstructor("/verovio/render-worker.mjs", {
    type: "module",
    name: "keyspilli-verovio",
  }));
}

async function getVerovioWorker(): Promise<VerovioWorkerChannel> {
  if (verovioWorker) return verovioWorker;
  workerChannelPromise ??= createVerovioWorker();
  try {
    return attachVerovioWorker(await workerChannelPromise);
  } catch (error) {
    workerChannelPromise = null;
    throw error;
  }
}

function request(request: WorkerRequestInput): Promise<WorkerResponse> {
  const id = nextRequestId++;
  return new Promise<WorkerResponse>((resolve, reject) => {
    void getVerovioWorker().then(worker => {
      const timer = setTimeout(() => disposeWorker(new Error("Verovio worker request timed out"), worker), VEROVIO_REQUEST_TIMEOUT_MS);
      let cancel: () => void = () => undefined;
      pendingRenders.set(id, { resolve, reject, timer, cancel: () => cancel() });
      try {
        cancel = worker.postMessage({ id, ...request } satisfies WorkerRequest);
      } catch (error) {
        cancel();
        pendingRenders.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, error => reject(error instanceof Error ? error : new Error(String(error))));
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
  async prepare(prepared?: WorkerResponse): Promise<this> {
    if (this.closed || this.generation !== workerGeneration || !verovioWorker) throw new Error("Verovio worker session is closed");
    const response = prepared ?? await request({ type: "prepare", sessionId: this.sessionId });
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

  async elementPage(elementId: string): Promise<number> {
    if (this.closed || this.generation !== workerGeneration || !verovioWorker) throw new Error("Verovio worker session is closed");
    if (!/^keyspilli-score-\d{1,4}$/.test(elementId)) throw new Error("invalid score measure identity");
    const response = await request({ type: "elementPage", sessionId: this.sessionId, elementId });
    if (response.type !== "elementPage" || response.sessionId !== this.sessionId || response.elementId !== elementId
      || !Number.isInteger(response.page) || response.page < 1 || response.page > this.pageCount) throw new Error("score measure has no rendered page");
    return response.page;
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

/** Start module initialization before a score payload is available. */
export async function warmMusicXmlWorker(): Promise<void> {
  const worker = await getVerovioWorker();
  try {
    const response = await request({ type: "warm" });
    if (response.type !== "warm") throw new Error("Verovio worker returned an invalid warm response");
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (verovioWorker === worker) disposeWorker(failure, worker);
    throw failure;
  }
}

/** Open/layout atomically so another view cannot replace the session between messages. */
export async function openMusicXmlInWorker(xml: string, opts: RenderOptions = {}): Promise<MusicXmlWorkerSession> {
  const prepared = await request({ type: "open", xml, options: opts, prepare: true });
  if (prepared.type !== "prepared") throw new Error("Verovio worker returned an invalid open response");
  const session = new WorkerScoreSession(prepared.sessionId, workerGeneration);
  try {return await session.prepare(prepared);}
  catch(error){await session.close();throw error;}
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
