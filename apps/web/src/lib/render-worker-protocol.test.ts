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
    getPageWithElement(id:string) { return id==="keyspilli-score-1"?2:0; },
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
  const sessionId=replies.at(-1)!.sessionId;
  expect(await send({type:"elementPage",sessionId,elementId:"keyspilli-score-1"})).toMatchObject({type:"elementPage",page:2});
  expect((await send({type:"elementPage",sessionId,elementId:"keyspilli-score-99"})).type).toBe("error");
  expect((await send({type:"elementPage",sessionId,elementId:"../../other"})).type).toBe("error");
});

it("serializes cold preparation, replacement and stale closure without corrupting the new layout", async () => {
  const replies: Array<Record<string,unknown>>=[];
  let release!:()=>void;
  const loaded=new Promise<void>(resolve=>{release=resolve;});
  const toolkit={xml:"",setOptions(){},loadData(xml:string){this.xml=xml;return true;},getPageCount(){return 1;},renderToSVG(){return `<svg width="100" height="100"><text>${this.xml}</text></svg>`;}};
  const self={onmessage:null as null|((event:{data:unknown})=>Promise<void>),postMessage(reply:Record<string,unknown>){replies.push(reply);}};
  const context=createContext({self,URL,fakeToolkit:toolkit,loaded});
  runInContext(readFileSync(join(process.cwd(),"public/verovio/render-worker.mjs"),"utf8").replaceAll("import.meta.url",'"file:///render-worker.mjs"'),context);
  runInContext("loadVerovio = async () => {await loaded;return fakeToolkit;}",context);
  const first=self.onmessage!({data:{id:1,type:"open",xml:"old",prepare:true}});
  const second=self.onmessage!({data:{id:2,type:"open",xml:"new",prepare:true}});
  release();await Promise.all([first,second]);
  expect(replies.map(r=>r.type)).toEqual(["prepared","prepared"]);
  await self.onmessage!({data:{id:3,type:"close",sessionId:replies[0]!.sessionId}});
  await self.onmessage!({data:{id:4,type:"renderPage",sessionId:replies[1]!.sessionId,page:1}});
  expect(replies.at(-1)).toMatchObject({type:"page",svg:'<svg width="100" height="100"><text>new</text></svg>'});
});
