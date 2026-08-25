import { afterEach, describe, expect, it } from "vitest";
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
    const request = message as { id: number; type: string; sessionId?: number; page?: number };
    queueMicrotask(() => {
      const sessionId = request.sessionId ?? 7;
      if (request.type === "open") {
        this.onmessage?.({ data: { id: request.id, type: "opened", sessionId } } as MessageEvent);
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
      "prepare",
      "renderPage",
      "close",
    ]);
  });
});
