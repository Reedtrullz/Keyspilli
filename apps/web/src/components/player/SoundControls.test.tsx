import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildMelodyAccompaniment, DEFAULT_SETTINGS } from "@keyspilli/player-core";
import type { ChordSourceOption } from "./chord-sources";
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
      onPreview: () => {},
    }));

    expect(markup).toContain('data-testid="melody-accompaniment-controls"');
    expect(markup).toContain("Automatic melody");
    expect(markup).toContain("Use right-hand part");
    expect(markup).toContain("Reset saved selection");
    expect(markup).toContain("source support notes");
    expect(markup).toContain('data-testid="melody-audition-controls"');
    expect(markup).toContain("Accompaniment includes retained source notes");

    const pulseArrangement = buildMelodyAccompaniment(
      [{ midi: 72, start: 0, dur: 2, vel: 90, hand: "R" }],
      [{ beat: 0, name: "C5", notes: [], durationBeats: 2 }],
      { durationBeats: 2, sourceFingerprint: "fixture-source-v1", selection: "right-hand" },
    );
    const pulseMarkup = renderToStaticMarkup(createElement(SoundControls, {
      settings: { ...DEFAULT_SETTINGS, backgroundMode: "chord", accompanimentStyle: "melody-accompaniment" },
      onChange: () => {},
      melodyArrangement: pulseArrangement,
      rightHandAvailable: true,
      onMelodySelectionChange: () => {},
    }));
    expect(pulseMarkup).toContain("sparse backing notes");
  });

  it("renders partial, unavailable, and missing-chart source status", () => {
    const generated: ChordSourceOption = {
      id: "generated",
      label: "Generated chords",
      chords: [{ beat: 0, name: "C", notes: [48, 52, 55] }],
      provenance: null,
      coverage: "full-song",
      fallback: false,
      fallbackReason: null,
    };
    const partialUg: ChordSourceOption = {
      id: "ug",
      label: "UG opening (partial)",
      chords: [{ beat: 0, name: "C", notes: [48, 52, 55] }],
      provenance: "ug-tabs",
      coverage: "opening-section",
      fallback: false,
      fallbackReason: null,
    };
    const renderSourceStatus = (
      chordSource: "auto" | "ug",
      chordSources: { ug: ChordSourceOption | null; generated: ChordSourceOption; auto: ChordSourceOption },
      chordSourceStatus: string,
    ) => renderToStaticMarkup(createElement(SoundControls, {
      settings: { ...DEFAULT_SETTINGS, backgroundMode: "chord" },
      onChange: () => {},
      chordSource,
      chordSources,
      chordSourceStatus,
      onChordSourceChange: () => {},
    }));

    const partial = renderSourceStatus("auto", {
      ug: partialUg,
      generated,
      auto: { ...generated, id: "auto", label: "UG + generated fallback", fallback: true },
    }, "UG chart covers opening-section; generated chords fill uncovered chart events and the remaining song.");
    expect(partial).toContain("UG chart covers opening-section; generated chords fill uncovered chart events and the remaining song.");

    const unavailable = renderSourceStatus("ug", {
      ug: null,
      generated,
      auto: { ...generated, id: "auto", label: "Generated fallback" },
    }, "UG timeline is unavailable for this arrangement; using generated chords.");
    expect(unavailable).toContain("UG timeline is unavailable for this arrangement; using generated chords.");

    const missingChart: ChordSourceOption = { ...generated, chords: [] };
    const missing = renderSourceStatus("auto", {
      ug: null,
      generated: missingChart,
      auto: { ...missingChart, id: "auto", label: "Generated fallback", fallback: true },
    }, "No chord timeline is available; using piano background.");
    expect(missing).toContain("No chord timeline is available; using piano background.");
  });
});
