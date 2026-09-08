import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChordStrip } from "./ChordStrip";

function chords(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    beat: index * 4,
    name: index % 2 === 0 ? "C" : "G7",
    notes: index % 2 === 0 ? [48, 52, 55] : [43, 47, 50, 53],
    sourceKind: index % 3 === 0 ? "authored" as const : "generated" as const,
  }));
}

describe("ChordStrip", () => {
  it("virtualizes the progression while preserving the full accessible position", () => {
    const html = renderToStaticMarkup(createElement(ChordStrip, {
      chords: chords(745),
      currentBeat: 4 * 372 + 0.5,
    }));

    const renderedItems = html.match(/role="listitem"/g) ?? [];
    expect(renderedItems.length).toBeGreaterThan(1);
    expect(renderedItems.length).toBeLessThan(30);
    // Keep the SSR output bounded as the catalog grows: a 745-chord strip
    // should not regress to serializing every miniature keyboard again.
    expect(html.length).toBeLessThan(25_000);
    expect((html.match(/bg-blue-50 ring-1 ring-blue-300/g) ?? [])).toHaveLength(1);
    expect(html).toContain('aria-label="C: Authored chord"');
    expect(html).toContain('aria-label="G7: Generated chord"');
    expect(html).toContain('data-chord-idx="372"');
    expect(html).toContain('aria-posinset="373"');
    expect(html).toContain('aria-setsize="745"');
    expect(html).toContain("Full chord progression");
    expect(html).toContain("Show chord shapes");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("sm:hidden");
    expect(html).toContain('aria-label="Current and next chord"');

  });

  it("keeps inferred and unknown provenance visible in summary and full progression", () => {
    const html = renderToStaticMarkup(createElement(ChordStrip, {
      chords: [
        { beat: 0, name: "C", notes: [60], sourceKind: "inferred" },
        { beat: 4, name: "G7", notes: [67] },
      ],
      currentBeat: 1,
    }));
    expect(html).toContain('aria-label="C: Inferred chord"');
    expect(html).toContain('aria-label="G7: Chord provenance unknown"');
    expect((html.match(/Inferred chord/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((html.match(/Chord provenance unknown/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain(">Inferred</span>");
    expect(html).toContain(">Unknown</span>");
  });

  it("shows no current chord before the first event and through an explicit gap", () => {
    const progression = [
      { beat: 4, name: "C", notes: [60], durationBeats: 2 },
      { beat: 12, name: "G7", notes: [67], durationBeats: 2 },
    ];
    for (const [beat, next] of [[0, "C"], [6, "G7"], [10, "G7"], [14, "End"]] as const) {
      const html = renderToStaticMarkup(createElement(ChordStrip, { chords: progression, currentBeat: beat }));
      const summary = html.split('aria-label="Current and next chord"')[1]!.split("</div>")[0]!;
      expect(summary).toContain('title="No chord">—</span>');
      expect(summary).toContain(`>${next}${next === "End" ? "</span>" : "<small"}`);
      expect(html).not.toContain('aria-current="step"');
    }
    const active = renderToStaticMarkup(createElement(ChordStrip, { chords: progression, currentBeat: 5 }));
    expect(active).toContain('aria-current="step"');
  });

  it("keeps an empty progression empty", () => {
    expect(renderToStaticMarkup(createElement(ChordStrip, { chords: [], currentBeat: 0 }))).toBe("");
  });
});
