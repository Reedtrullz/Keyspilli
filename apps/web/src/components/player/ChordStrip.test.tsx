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
  it("renders the full accessible progression and highlights the active chord", () => {
    const html = renderToStaticMarkup(createElement(ChordStrip, {
      chords: chords(745),
      currentBeat: 4 * 372 + 0.5,
    }));

    expect((html.match(/role="listitem"/g) ?? [])).toHaveLength(745);
    expect((html.match(/bg-blue-50 ring-1 ring-blue-300/g) ?? [])).toHaveLength(1);
    expect(html).toContain('aria-label="C: Authored chord"');
    expect(html).toContain('aria-label="G7: Generated chord"');
    expect(html).toContain('data-chord-idx="372"');
    expect(html).toContain("<svg");
    // Keep the high-cardinality keyboard visualization compact: each keyboard
    // uses grouped paths rather than one SVG rect per key.
    expect(html).not.toContain("<rect");
    expect((html.match(/<path/g) ?? []).length).toBeGreaterThan(0);
    expect(html).toContain('id="keyspilli-mini-keyboard-base"');
    expect((html.match(/<use/g) ?? []).length).toBeGreaterThan(745);
  });

  it("keeps an empty progression empty", () => {
    expect(renderToStaticMarkup(createElement(ChordStrip, { chords: [], currentBeat: 0 }))).toBe("");
  });
});
