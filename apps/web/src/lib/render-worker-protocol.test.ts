import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { expect, it } from "vitest";

it("renders A from A after an oversized or failed B mutates the shared toolkit", async () => {
  const replies: Array<Record<string, unknown>> = [];
  const toolkit = {
    xml: "",
    setOptions() {},
    loadData(xml: string) { this.xml = xml; return xml !== "bad-b"; },
    getPageCount() { return 3; },
    renderToSVG() { return `<svg width="100" height="100"><text>${this.xml.slice(0, 8)}</text></svg>`; },
  };
  const self = { onmessage: null as null | ((event: { data: unknown }) => Promise<void>), postMessage(reply: Record<string, unknown>) { replies.push(reply); } };
  const context = createContext({ self, fakeToolkit: toolkit, URL });
  // The runtime URL is irrelevant here; inject a deterministic toolkit at the module boundary.
  const source = readFileSync(join(process.cwd(), "public/verovio/render-worker.mjs"), "utf8").replaceAll("import.meta.url", '"file:///render-worker.mjs"');
  runInContext(source, context);
  runInContext("loadVerovio = async () => fakeToolkit", context);
  let id = 0;
  const send = async (data: Record<string, unknown>) => {
    await self.onmessage!({ data: { id: ++id, ...data } });
    return replies.at(-1)!;
  };
  const page = async (xml: string, pageNumber = 1) => {
    const opened = await send({ type: "open", xml, options: {} });
    const sessionId = opened.sessionId;
    expect((await send({ type: "prepare", sessionId })).type).toBe("prepared");
    return (await send({ type: "renderPage", sessionId, page: pageNumber })).svg as string;
  };

  expect(await page("score-a")).toContain("score-a");
  expect(await page("score-a")).toContain("score-a"); // cached A
  expect(await page("score-b:" + "x".repeat(4 * 1024 * 1024))).toContain("score-b:");
  expect(await page("score-a", 2)).toContain("score-a"); // uncached A after B
  expect((await send({ type: "prepare", sessionId: (await send({ type: "open", xml: "bad-b", options: {} })).sessionId })).type).toBe("error");
  expect(await page("score-a", 3)).toContain("score-a"); // uncached A after failed B
});
