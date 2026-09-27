import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GradingPanel } from "./GradingPanel";

vi.stubGlobal("React", React);

describe("wait practice guidance", () => {
  it("shows every remaining note at a simultaneous chord attack", () => {
    const html = renderToStaticMarkup(createElement(GradingPanel, {
      waitMode: true,
      waitNotes: [
        { midi: 48, startSec: 1, durSec: 2, vel: 80, hand: "L" },
        { midi: 64, startSec: 1, durSec: 2, vel: 80, hand: "R" },
        { midi: 67, startSec: 1, durSec: 2, vel: 80, hand: "R" },
      ],
      result: null,
      countIn: null,
      input: "keyboard",
      onExit: () => {},
      onRepeat: () => {},
      onDismiss: () => {},
    }));
    expect(html).toContain("C3</strong> (left hand)");
    expect(html).toContain("E4</strong> (right hand)");
    expect(html).toContain("G4</strong> (right hand)");
  });
});
