import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderMusicXml, renderMusicXmlPages, openMusicXmlOnMainThread } from "../src/index.js";

function fakeToolkit() {
  const calls: string[] = [];
  let loadedXml = "";
  const tk = {
    loadData: (xml: string) => {
      calls.push("loadData");
      loadedXml = xml;
      return true;
    },
    renderToSVG: (page?: number) => {
      calls.push("renderToSVG");
      return `<svg width="640px" height="880px" viewBox="0 0 640 880"><g><path d="M0 0h1"/></g></svg>`;
    },
    getPageCount: () => 1,
    setOptions: (o: Record<string, unknown>) => {
      calls.push("setOptions");
    },
  };
  return { tk, calls, getLoadedXml: () => loadedXml };
}

describe("renderMusicXml", () => {
  it("applies options before loading data", async () => {
    const { tk, calls } = fakeToolkit();
    await renderMusicXml("<score/>", { scale: 55, pageWidth: 1400 }, tk);
    expect(calls.indexOf("setOptions")).toBeLessThan(calls.indexOf("loadData"));
    expect(calls[calls.length - 1]).toBe("renderToSVG");
  });

  it("uses bounded automatic layout and does not pass unsupported border options", async () => {
    const seen: Record<string, unknown>[] = [];
    const { tk } = fakeToolkit();
    tk.setOptions = (options) => seen.push(options);
    await renderMusicXml("<score/>", {}, tk);
    expect(seen[0]).toMatchObject({ breaks: "auto", pageWidth: 1600, pageHeight: 2200, svgViewBox: true });
    expect(seen[0]).not.toHaveProperty("border");
    expect(seen[0]).not.toHaveProperty("adjustPageHeight");
  });

  it("preserves both sound and notation ties for the importer", async () => {
    const { tk, getLoadedXml } = fakeToolkit();
    const xml = '<score><note><tie type="start"/><notations><tied type="start"/></notations></note></score>';
    await renderMusicXml(xml, {}, tk);
    expect(getLoadedXml()).toContain('<tie type="start"/>');
    expect(getLoadedXml()).toBe(xml);
  });

  it("renders every bounded page in order", async () => {
    const { tk, calls } = fakeToolkit();
    tk.getPageCount = () => 3;
    tk.renderToSVG = (page = 1) => {
      calls.push(`page:${page}`);
      return `<svg width="640px" height="880px" viewBox="0 0 640 880"><g data-page="${page}"><path d="M0 0h1"/></g></svg>`;
    };
    const pages = await renderMusicXmlPages("<score/>", { pages: "all" }, tk);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain('data-page="1"');
    expect(pages[2]).toContain('data-page="3"');
    expect(calls.filter((c) => c.startsWith("page:"))).toEqual(["page:1", "page:2", "page:3"]);
  });

  it("rejects an empty or unbounded page instead of reporting readiness", async () => {
    const { tk } = fakeToolkit();
    tk.renderToSVG = () => "<svg/>";
    await expect(renderMusicXml("<score/>", {}, tk)).rejects.toThrow(/empty|unbounded|invalid/i);
  });

  it("adds intrinsic dimensions when Verovio returns a viewBox-only page", async () => {
    const { tk } = fakeToolkit();
    tk.renderToSVG = () => '<svg viewBox="0 0 640 880"><g><path d="M0 0h1"/></g></svg>';
    const page = await renderMusicXml("<score/>", {}, tk);
    expect(page).toContain('viewBox="0 0 640 880"');
    expect(page).toContain('width="640px"');
    expect(page).toContain('height="880px"');
  });

  it("throws when loadData fails instead of rendering garbage", async () => {
    const { tk } = fakeToolkit();
    tk.loadData = () => false;
    await expect(renderMusicXml("<score/>", {}, tk)).rejects.toThrow(/loadData/);
  });
});

it("ships the same browser renderer bytes as the pinned independent consumer", () => {
  for (const [specifier,name] of [["verovio/wasm","verovio-module.mjs"],["verovio/esm","verovio.mjs"]]) {
    expect(readFileSync(new URL(`../../../apps/web/public/verovio/${name}`,import.meta.url))
      .equals(readFileSync(new URL(import.meta.resolve(specifier!))))).toBe(true);
  }
});

it("keeps the main-thread fallback page-at-a-time, locates IDs and destroys its owned renderer",async()=>{
 const {tk,calls}=fakeToolkit();let destroyed=0;const owned={...tk,destroy:()=>destroyed++,getPageWithElement:(id:string)=>id==='keyspilli-score-8'?9:0,getPageCount:()=>100,renderToSVG:(page=1)=>{calls.push(`page:${page}`);return `<svg width="640" height="880"><text>Page ${page}</text></svg>`;}};
 const session=await openMusicXmlOnMainThread('<score/>',{},owned);expect(session.pageCount).toBe(100);expect(calls.filter(c=>c.startsWith('page:'))).toEqual(['page:1']);
 expect(await session.renderPage(1)).toContain('Page 1');expect(await session.elementPage('keyspilli-score-8')).toBe(9);expect(await session.renderPage(50)).toContain('Page 50');
 expect(calls.filter(c=>c.startsWith('page:'))).toEqual(['page:1','page:50']);await session.close();await session.close();expect(destroyed).toBe(1);await expect(session.renderPage(2)).rejects.toThrow(/closed/);
});
