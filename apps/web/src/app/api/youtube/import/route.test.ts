import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const activeJob = vi.hoisted(()=>vi.fn());
const insertJob = vi.hoisted(() => vi.fn());
const queue = vi.hoisted(() => vi.fn(async (_request: Request) => new Response(JSON.stringify({jobId:"preview-job"}),{status:200})));
vi.mock("../route",()=>({POST:queue}));
afterEach(()=>{vi.unstubAllEnvs();queue.mockClear();activeJob.mockReset();});

vi.mock("@keyspilli/catalog", () => ({ insertJob, getDb:()=>({prepare:()=>({get:activeJob})}), canonicalYoutubeUrl: (url:string)=>url.includes("abcdefghijk") ? "https://www.youtube.com/watch?v=abcdefghijk" : null }));

import { POST } from "./route";

function requestFor(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://keys.reidar.tech/api/youtube/import", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("public YouTube import route", () => {
  it.each([
    ["valid URL", { url: "https://www.youtube.com/watch?v=9TjXanLjpTU" }, {}],
    ["invalid URL", { url: "not-a-url" }, {}],
    ["metadata override", { url: "https://youtu.be/9TjXanLjpTU", songId: "song" }, {}],
    ["cross-origin browser", { url: "https://youtu.be/9TjXanLjpTU" }, { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }],
    ["empty body", {}, {}],
  ])("fails closed for %s without creating a conversion job", async (_label, body, headers) => {
    const response = await POST(requestFor(body, headers));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Direct audio conversion is not available. Add a symbolic music file instead.",
      code: "DIRECT_AUDIO_AMT_DISABLED",
      next: "/uploads",
    });
    expect(insertJob).not.toHaveBeenCalled();
  });
});


describe("development tutorial preview",()=>{
 function enable(){
  vi.stubEnv("NODE_ENV","development");vi.stubEnv("KEYSPILLI_TUTORIAL_PREVIEW","1");
  vi.stubEnv("KEYSPILLI_DATA_DIR","/tmp/isolated-preview");vi.stubEnv("KEYSPILLI_API_TOKEN","fixture-token");
 }
 it("queues a same-origin URL through the existing authenticated route",async()=>{
  enable();
  const response=await POST(requestFor({url:"https://youtu.be/abcdefghijk"},{origin:"https://keys.reidar.tech"}));
  expect(response.status).toBe(200);expect(queue).toHaveBeenCalledOnce();
  expect(await queue.mock.calls[0]![0].json()).toEqual({url:"https://youtu.be/abcdefghijk"});
 });
 it("rejects cross-origin requests and existing-song overrides",async()=>{
  enable();
  expect((await POST(requestFor({url:"https://youtu.be/abcdefghijk"},{origin:"https://attacker.example"}))).status).toBe(403);
  expect((await POST(requestFor({url:"https://youtu.be/abcdefghijk",songId:"existing"},{origin:"https://keys.reidar.tech"}))).status).toBe(400);
  expect(queue).not.toHaveBeenCalled();
 });
 it("stays disabled in production even when the preview flag is present",async()=>{
  enable();vi.stubEnv("NODE_ENV","production");
  expect((await POST(requestFor({url:"https://youtu.be/abcdefghijk"},{origin:"https://keys.reidar.tech"}))).status).toBe(410);
  expect(queue).not.toHaveBeenCalled();
 });
});

it("coalesces simultaneous preview submissions",async()=>{
 vi.stubEnv("NODE_ENV","development");vi.stubEnv("KEYSPILLI_TUTORIAL_PREVIEW","1");
 vi.stubEnv("KEYSPILLI_DATA_DIR","/tmp/isolated-preview");vi.stubEnv("KEYSPILLI_API_TOKEN","fixture-token");
 let finish!:(response:Response)=>void;
 queue.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const first=POST(requestFor({url:"https://youtu.be/abcdefghijk"},{origin:"https://keys.reidar.tech"}));
 const second=POST(requestFor({url:"https://youtube.com/watch?v=abcdefghijk"},{origin:"https://keys.reidar.tech"}));
 await vi.waitFor(()=>expect(queue).toHaveBeenCalledOnce());
 await new Promise(resolve=>setTimeout(resolve,30));
 finish(new Response(JSON.stringify({jobId:"shared"})));
 expect(await (await first).json()).toEqual({jobId:"shared"});
 expect(await (await second).json()).toEqual({jobId:"shared"});
 expect(queue).toHaveBeenCalledOnce();
});

it("returns a durable active job without submitting again",async()=>{
 vi.stubEnv("NODE_ENV","development");vi.stubEnv("KEYSPILLI_TUTORIAL_PREVIEW","1");
 vi.stubEnv("KEYSPILLI_DATA_DIR","/tmp/isolated-preview");vi.stubEnv("KEYSPILLI_API_TOKEN","fixture-token");
 activeJob.mockReturnValue({id:"active-job"});
 const response=await POST(requestFor({url:"https://youtu.be/abcdefghijk"},{origin:"https://keys.reidar.tech"}));
 expect(await response.json()).toEqual({jobId:"active-job"});expect(queue).not.toHaveBeenCalled();
});
