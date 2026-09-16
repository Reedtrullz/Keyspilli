import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildMelodyAccompaniment, DEFAULT_SETTINGS } from "@keyspilli/player-core";
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
    expect(melody).toContain("Original passage is retained");
    expect(melody).toContain('aria-label="Accompaniment style"');
    expect(melody).toContain('aria-checked="true"');

    const bass = render("bass-chords");
    expect(bass).toContain("Bass + chords");
    expect(bass).toContain("source melody is omitted where the chord chart is covered");
    expect(bass).toMatch(/Bass \+ chords[\s\S]*aria-checked="true"/);
  });

  it("exposes the inferred melody status and correction action", () => {
    const arrangement = buildMelodyAccompaniment(
      [
        { midi: 60, start: 0, dur: 1, vel: 90, hand: "R" },
        { midi: 48, start: 0, dur: 1, vel: 60, hand: "L" },
      ],
      [{ beat: 0, name: "C", notes: [], durationBeats: 1 }],
      { durationBeats: 1, sourceFingerprint: "fixture-source-v1" },
    );
    const markup = renderToStaticMarkup(createElement(SoundControls, {
      settings: { ...DEFAULT_SETTINGS, backgroundMode: "chord", accompanimentStyle: "melody-accompaniment" },
      onChange: () => {},
      melodyArrangement: arrangement,
      rightHandAvailable: true,
      hasSavedMelodySelection: true,
      onMelodySelectionChange: () => {},
      onMelodySelectionReset: () => {},
    }));

    expect(markup).toContain('data-testid="melody-accompaniment-controls"');
    expect(markup).toContain("Automatic melody");
    expect(markup).toContain("Use right-hand part");
    expect(markup).toContain("Reset saved selection");
    expect(markup).toContain("beats generated");
  });
});
