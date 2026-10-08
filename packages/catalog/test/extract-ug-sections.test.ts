import { describe, expect, it } from "vitest";
import { parseChartHtml } from "../scripts/extract-ug-sections";

/** Rebuild the escaped js-store payload shape the live tab page ships. */
function page(content: string, tabId: number | null = 208584): string {
  const payload = JSON.stringify({
    store: {
      page: {
        data: {
          ...(tabId === null ? {} : { tab: { id: tabId } }),
          tab_view: { wiki_tab: { content } },
        },
      },
    },
  }).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return '<div class="js-store" data-content="' + payload + '"></div>';
}

describe("extract-ug-sections", () => {
  it("extracts ordered form headings with their chord sequence", () => {
    const content = [
      "[Intro]",
      "[tab][ch]G[/ch] [ch]Em[/ch][/tab]",
      "",
      "[Verse 1]",
      "[tab]hello[/tab]",
      "[ch]A7[/ch]",
      "",
      "[Chorus]",
      "[ch]G[/ch] [ch]D/F#[/ch]",
    ].join("\r\n");
    const chart = parseChartHtml(page(content));
    expect(chart.source).toBe("ultimate-guitar");
    expect(chart.tabId).toBe(208584);
    expect(chart.sections.map((section) => section.label)).toEqual(["Intro", "Verse 1", "Chorus"]);
    expect(chart.sections[0]!.chords).toEqual(["G", "Em"]);
    expect(chart.sections[1]!.chords).toEqual(["A7"]);
    expect(chart.sections[2]!.chords).toEqual(["G", "D/F#"]);
  });

  it("never treats structural tags as song sections", () => {
    const chart = parseChartHtml(page("[tab]x[/tab]\n[ch]G[/ch]\n[Outro]"));
    expect(chart.sections.map((section) => section.label)).toEqual(["Outro"]);
  });

  it("excludes chord diagrams before the actual form", () => {
    const chart = parseChartHtml(page("[Chords]\n[ch]C[/ch] x32010\n[ch]G[/ch] 320003\n[Intro]\n[ch]Am[/ch]"));
    expect(chart.sections).toEqual([{ label: "Intro", chords: ["Am"] }]);
  });

  it("does not append metadata chords to the preceding passage", () => {
    const chart = parseChartHtml(page("[Verse]\n[ch]C[/ch]\n[Chord diagrams]\n[ch]G[/ch] 320003\n[Chorus]\n[ch]Am[/ch]"));
    expect(chart.sections).toEqual([
      { label: "Verse", chords: ["C"] },
      { label: "Chorus", chords: ["Am"] },
    ]);
  });

  it("rejects a chord reference without named form headings", () => {
    expect(() => parseChartHtml(page("[Chords]\n[ch]C[/ch] x32010"))).toThrow(/No form headings/);
  });

  it("rejects pages without a usable tab payload", () => {
    expect(() => parseChartHtml("<html></html>")).toThrow(/js-store data-content/);
    expect(() => parseChartHtml(page(""))).toThrow(/wiki_tab content/);
  });
});
