import { describe, expect, it } from "vitest";
import { renderMusicXml } from "../src/index.js";

function fakeToolkit() {
  const calls: string[] = [];
  const tk = {
    loadData: (xml: string) => {
      calls.push("loadData");
      return true;
    },
    renderToSVG: (page?: number) => {
      calls.push("renderToSVG");
      return "<svg/>";
    },
    getPageCount: () => 1,
    setOptions: (o: Record<string, unknown>) => {
      calls.push("setOptions");
    },
  };
  return { tk, calls };
}

describe("renderMusicXml", () => {
  it("applies options before loading data", async () => {
    const { tk, calls } = fakeToolkit();
    await renderMusicXml("<score/>", { scale: 55, pageWidth: 1400 }, tk);
    expect(calls.indexOf("setOptions")).toBeLessThan(calls.indexOf("loadData"));
    expect(calls[calls.length - 1]).toBe("renderToSVG");
  });

  it("throws when loadData fails instead of rendering garbage", async () => {
    const { tk } = fakeToolkit();
    tk.loadData = () => false;
    await expect(renderMusicXml("<score/>", {}, tk)).rejects.toThrow(/loadData/);
  });
});
