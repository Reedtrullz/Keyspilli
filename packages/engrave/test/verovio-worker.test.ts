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

  afterEach(() => {
    vi.useRealTimers();
    FakeWorker.instances.length = 0;
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: originalWorker,
    });
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
