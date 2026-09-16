import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@keyspilli/player-core";
import { SoundControls } from "./SoundControls";

function render(style: "melody-accompaniment" | "bass-chords" = "melody-accompaniment") {
  return renderToStaticMarkup(createElement(SoundControls, {
    settings: { ...DEFAULT_SETTINGS, backgroundMode: "chord", accompanimentStyle: style },
    onChange: () => {},
  }));
}

describe("SoundControls accompaniment styles", () => {
  it("explains both explicit styles and preserves their selected state", () => {
    const melody = render();
    expect(melody).toContain("Melody + accompaniment");
    expect(melody).toContain("Original passage retained");
    expect(melody).toContain('aria-label="Accompaniment style"');
    expect(melody).toContain('aria-checked="true"');

    const bass = render("bass-chords");
    expect(bass).toContain("Bass + chords");
    expect(bass).toContain("source melody is omitted where the chord chart is covered");
    expect(bass).toMatch(/Bass \+ chords[\s\S]*aria-checked="true"/);
  });
});
