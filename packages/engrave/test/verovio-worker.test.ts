import { afterEach, describe, expect, it, vi } from "vitest";
import { renderMusicXmlPagesInWorker } from "../src/index.js";

type FakeMessageHandler = ((event: MessageEvent) => void) | null;

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: FakeMessageHandler = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: unknown[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.messages.push(message);
    const request = message as { id: number; type: string; sessionId?: number; page?: number; prepare?: boolean };
    queueMicrotask(() => {
      const sessionId = request.sessionId ?? 7;
      if (request.type === "open") {
        this.onmessage?.({ data: request.prepare
          ? {id:request.id,type:"prepared",sessionId,pageCount:2,width:1600,height:2200}
          : { id: request.id, type: "opened", sessionId } } as MessageEvent);
        return;
      }
      if (request.type === "warm") {
        this.onmessage?.({ data: { id: request.id, type: "warm" } } as MessageEvent);
        return;
      }
      if (request.type === "prepare") {
        this.onmessage?.({ data: { id: request.id, type: "prepared", sessionId, pageCount: 2, width: 1600, height: 2200 } } as MessageEvent);
        return;
      }
      if (request.type === "close") {
        this.onmessage?.({ data: { id: request.id, type: "closed", sessionId } } as MessageEvent);
        return;
      }
      this.onmessage?.({
        data: {
          id: request.id,
          type: "page",
          sessionId,
          page: request.page,
          svg: `<svg width="1" height="1"><path/></svg>`,
        },
      } as MessageEvent);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("renderMusicXmlPagesInWorker", () => {
  const originalWorker = globalThis.Worker;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalMessageChannel = Object.getOwnPropertyDescriptor(globalThis, "MessageChannel");

  afterEach(() => {
    vi.useRealTimers();
    FakeWorker.instances.length = 0;
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (originalMessageChannel) Object.defineProperty(globalThis, "MessageChannel", originalMessageChannel);
    else Reflect.deleteProperty(globalThis, "MessageChannel");
  });

  it("posts the score to a module worker and resolves rendered pages", async () => {
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: FakeWorker,
    });

    const pages = await renderMusicXmlPagesInWorker("<score-partwise/>", {
      scale: 42,
      pages: "first",
    });

    expect(pages).toHaveLength(1);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]?.messages[0]).toMatchObject({
      type: "open",
      xml: "<score-partwise/>",
      options: { scale: 42, pages: "first" },
    });
    expect(FakeWorker.instances[0]?.messages.map((message) => (message as { type: string }).type)).toEqual([
      "open",
      "renderPage",
      "close",
    ]);
  });

  it("warms the existing module worker before opening a score", async () => {
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: FakeWorker,
    });
    vi.resetModules();
    const { openMusicXmlInWorker, warmMusicXmlWorker } = await import("../src/verovio-worker.js");

    await warmMusicXmlWorker();
    const session = await openMusicXmlInWorker("<score/>");
    await session.close();

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]?.messages.map((message) => (message as { type: string }).type)).toEqual([
      "warm",
      "open",
      "close",
    ]);
  });

  it("starts a capture worker without waiting for service worker registration", async () => {
    const getRegistration = vi.fn(() => new Promise<never>(() => {}));
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { serviceWorker: { getRegistration } } });
    Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: FakeWorker });
    vi.resetModules();
    const { warmMusicXmlWorker, openMusicXmlInWorker } = await import("../src/verovio-worker.js");
    const policy = { dedicated: true };

    const [session] = await Promise.all([
      openMusicXmlInWorker("<score/>", {}, policy),
      warmMusicXmlWorker(policy),
    ]);
    expect(await session.renderPage(1)).toContain("<svg");
    await session.close();
    expect(getRegistration).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("disposes a worker after warm failure and opens with a fresh worker", async () => {
    class FailingWarmWorker extends FakeWorker {
      static failWarm = true;
      override postMessage(message: unknown): void {
        if (FailingWarmWorker.failWarm && (message as { type?: string }).type === "warm") {
          this.messages.push(message);
          queueMicrotask(() => this.onmessage?.({ data: { id: (message as { id: number }).id, type: "error", error: "warm failed" } } as MessageEvent));
          return;
        }
        super.postMessage(message);
      }
    }
    Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: FailingWarmWorker });
    vi.resetModules();
    const { openMusicXmlInWorker, warmMusicXmlWorker } = await import("../src/verovio-worker.js");

    await expect(warmMusicXmlWorker()).rejects.toThrow("warm failed");
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]?.terminated).toBe(true);

    FailingWarmWorker.failWarm = false;
    const session = await openMusicXmlInWorker("<score/>");
    expect(FakeWorker.instances).toHaveLength(2);
    await session.close();
  });

  it("uses a ready service worker instead of constructing a dedicated worker", async () => {
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: class { constructor() { throw new Error("dedicated worker must not be constructed"); } },
    });
    const messages: string[] = [];
    const registration = {
      active: {
        scriptURL: "http://localhost/verovio/render-service-worker.mjs",
        postMessage(message: { id: number; type: string }, ports?: MessagePort[]) {
          messages.push(message.type);
          queueMicrotask(() => {
            const response = message.type === "open"
              ? { id: message.id, type: "prepared", sessionId: 5, pageCount: 2, width: 1600, height: 2200 }
              : message.type === "warm"
                ? { id: message.id, type: "warm" }
                : message.type === "close"
                  ? { id: message.id, type: "closed", sessionId: 5 }
                  : null;
            if (response) ports?.[0]?.postMessage(response);
          });
        },
      },
      unregister: vi.fn(async () => true),
    };
    const container = { getRegistration: vi.fn(async () => registration), ready: Promise.resolve(registration) };
    Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: { serviceWorker: container } });
    vi.resetModules();
    const { openMusicXmlInWorker, warmMusicXmlWorker } = await import("../src/verovio-worker.js");

    await warmMusicXmlWorker();
    const session = await openMusicXmlInWorker("<score/>");
    await session.close();

    expect(messages).toEqual(["warm", "open", "close"]);
  });

  it("retires a stalled service worker, closes its port and falls back to a dedicated worker", async () => {
    const close = vi.fn();
    class TestMessageChannel {
      port1 = { start: vi.fn(), close };
      port2 = {};
    }
    Object.defineProperty(globalThis, "MessageChannel", { configurable: true, writable: true, value: TestMessageChannel });
    const unregister = vi.fn(async () => true);
    const registration = {
      active: { scriptURL: "http://localhost/verovio/render-service-worker.mjs", postMessage: vi.fn() },
      unregister,
    };
    const container = { getRegistration: vi.fn(async () => registration), ready: Promise.resolve(registration) };
    Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: { serviceWorker: container } });
    vi.resetModules();
    const { openMusicXmlInWorker, VEROVIO_REQUEST_TIMEOUT_MS } = await import("../src/verovio-worker.js");
    vi.useFakeTimers();
    const failed = openMusicXmlInWorker("<score/>").catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(VEROVIO_REQUEST_TIMEOUT_MS);
    expect(await failed).toContain("timed out");
    expect(unregister).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();

    Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: FakeWorker });
    const session = await openMusicXmlInWorker("<score/>");
    expect(FakeWorker.instances).toHaveLength(1);
    await session.close();
  });

  it("times out every pending request, then isolates a fresh worker from late errors", async () => {
    class ControlledWorker extends FakeWorker {
      static stall = true;
      override postMessage(message: unknown): void {
        if (ControlledWorker.stall) this.messages.push(message);
        else super.postMessage(message);
      }
    }
    Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: ControlledWorker });
    vi.resetModules();
    const { openMusicXmlInWorker, VEROVIO_REQUEST_TIMEOUT_MS } = await import("../src/verovio-worker.js");
    expect(VEROVIO_REQUEST_TIMEOUT_MS).toBe(30_000);
    vi.useFakeTimers();
    const errors: string[] = [];
    void openMusicXmlInWorker("<score-a/>").catch((error: Error) => errors.push(error.message));
    void openMusicXmlInWorker("<score-b/>").catch((error: Error) => errors.push(error.message));
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWorker.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(VEROVIO_REQUEST_TIMEOUT_MS);
    expect(errors).toHaveLength(2);
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
    ControlledWorker.stall = false;
    const fresh = await openMusicXmlInWorker("<score-c/>");
    FakeWorker.instances[0]?.onerror?.({} as ErrorEvent);
    expect(FakeWorker.instances[1]?.terminated).toBe(false);
    await expect(fresh.renderPage(1)).resolves.toContain("<svg");
    await fresh.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("invalidates sessions owned by a timed-out worker", async () => {
    class StalledPageWorker extends FakeWorker {
      static stallPages = false;
      override postMessage(message: unknown): void {
        if (StalledPageWorker.stallPages && (message as { type?: string }).type === "renderPage") this.messages.push(message);
        else super.postMessage(message);
      }
    }
    Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: StalledPageWorker });
    vi.resetModules();
    const { openMusicXmlInWorker, VEROVIO_REQUEST_TIMEOUT_MS } = await import("../src/verovio-worker.js");
    vi.useFakeTimers();
    const old = await openMusicXmlInWorker("<score-a/>");
    StalledPageWorker.stallPages = true;
    const failed = old.renderPage(1).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(VEROVIO_REQUEST_TIMEOUT_MS);
    expect(await failed).toContain("timed out");
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
    await expect(old.renderPage(1)).rejects.toThrow("closed");
    StalledPageWorker.stallPages = false;
    const fresh = await openMusicXmlInWorker("<score-b/>");
    await expect(fresh.renderPage(1)).resolves.toContain("<svg");
    await fresh.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});
