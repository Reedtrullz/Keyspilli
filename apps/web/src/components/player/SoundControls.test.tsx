import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildMelodyAccompaniment, DEFAULT_SETTINGS } from "@keyspilli/player-core";
import type { ChordSourceOption } from "./chord-sources";
import { SoundControls } from "./SoundControls";

function render(style?: "melody-accompaniment" | "bass-chords") {
  return renderToStaticMarkup(createElement(SoundControls, {
    settings: { ...DEFAULT_SETTINGS, backgroundMode: "chord", ...(style ? { accompanimentStyle: style } : {}) },
    onChange: () => {},
  }));
}

describe("SoundControls accompaniment styles", () => {
  it("shows Cathedral registration and accurately names the reverb control", () => {
    const markup = renderToStaticMarkup(createElement(SoundControls, {
      settings: { ...DEFAULT_SETTINGS, soundSource: "organ", organStyle: "cathedral", organRegistration: "clear" },
      onChange: () => {},
    }));
    expect(markup).toContain('aria-label="Cathedral registration"');
    expect(markup).toContain("Warm");
    expect(markup).toContain("Clear");
    expect(markup).toContain("Full");
    expect(markup).toContain('aria-label="Organ reverb"');
    expect(markup).not.toContain('aria-label="Organ space"');
  });

  it("explains both explicit styles and preserves their selected state", () => {
    const melody = render("melody-accompaniment");
    expect(melody).toContain("Melody + accompaniment");
    expect(melody).toContain("Original passage is retained");
    expect(melody).toContain('aria-label="Accompaniment style"');
    expect(melody).toContain('aria-checked="true"');

    const bass = render();
    expect(bass).toContain("Bass + chords");
    expect(bass).toContain("Backing only");
    expect(bass).toContain("source melody is omitted");
    expect(bass).toMatch(/Bass \+ chords[\s\S]*aria-checked="true"/);
  });

  it("exposes backing audition controls without melody controls by default", () => {
    const markup = renderToStaticMarkup(createElement(SoundControls, {
      settings: { ...DEFAULT_SETTINGS, backgroundMode: "chord" },
      onChange: () => {},
      onPreview: () => {},
    }));

    expect(markup).toContain('data-testid="backing-audition-controls"');
    expect(markup).toContain("Accompaniment");
    expect(markup).not.toContain('data-testid="melody-accompaniment-controls"');
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
    const phrase = arrangement.phrases[0]!;
    const markup = renderToStaticMarkup(createElement(SoundControls, {
      settings: { ...DEFAULT_SETTINGS, backgroundMode: "chord", accompanimentStyle: "melody-accompaniment" },
      onChange: () => {},
      melodyArrangement: arrangement,
      rightHandAvailable: true,
      sourceBackingMode: "conservative",
      hasSavedMelodySelection: true,
      onMelodySelectionChange: () => {},
      onSourceBackingModeChange: () => {},
      onMelodySelectionReset: () => {},
      onPreview: () => {},
    }));

    expect(markup).toContain('data-testid="melody-accompaniment-controls"');
    expect(markup).toContain('data-testid="advanced-arrangement-controls"');
    expect(markup).toContain("Advanced arrangement controls");
    expect(markup).not.toContain('data-testid="advanced-arrangement-controls" open');
    expect(markup).toContain("Automatic melody");
    expect(markup).toContain("Use right-hand part");
    expect(markup).toContain("Reset all saved choices");
    expect(markup).toContain('data-testid="source-backing-controls"');
    expect(markup).toContain("Conservative source-only preview (whole song)");
    expect(markup).toContain("never adds inferred pitches");
    expect(markup).toContain("Temporal backing reduction is unavailable without reviewed source lane or phrase identity");
    expect(markup).toContain("source support notes");
    expect(markup).toContain('data-testid="melody-audition-controls"');
    expect(markup).toContain("Compare Original");
    expect(markup).toContain("Left hand / accompaniment");
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

  it("renders phrase-local melody choices only for available source hands", () => {
    const arrangement = buildMelodyAccompaniment(
      [
        { midi: 72, start: 0, dur: 1, vel: 90, hand: "R" },
        { midi: 48, start: 0, dur: 1, vel: 60, hand: "L" },
      ],
      [{ beat: 0, name: "C", notes: [], durationBeats: 1 }],
      { durationBeats: 1, sourceFingerprint: "fixture-source-v1" },
    );
    const phrase = arrangement.phrases[0]!;
    const markup = renderToStaticMarkup(createElement(SoundControls, {
      settings: { ...DEFAULT_SETTINGS, backgroundMode: "chord", accompanimentStyle: "melody-accompaniment" },
      onChange: () => {},
      melodyArrangement: arrangement,
      activeMelodyPhrase: phrase,
      phraseSourceCandidates: { rightHand: ["source:right"], leftHand: ["source:left"] },
      phraseOverrideAction: "automatic",
      onMelodySelectionChange: () => {},
      onMelodyPhraseOverrideChange: () => {},
    }));

    expect(markup).toContain('data-testid="melody-phrase-actions"');
    expect(markup).toContain("Use whole-part selection");
    expect(markup).toContain("Source right-hand candidate");
    expect(markup).toContain("Source left-hand candidate");
    expect(markup).toContain("Explicit rest");
    expect(markup).toContain("Source hands may contain chords; these are user-selected choices, not proof of melody.");
  });

  it("disables phrase hand choices when that source hand has no notes", () => {
    const arrangement = buildMelodyAccompaniment(
      [{ midi: 72, start: 0, dur: 1, vel: 90, hand: "R" }],
      [{ beat: 0, name: "C", notes: [], durationBeats: 1 }],
      { durationBeats: 1, sourceFingerprint: "fixture-source-v1" },
    );
    const phrase = arrangement.phrases[0]!;
    const markup = renderToStaticMarkup(createElement(SoundControls, {
      settings: { ...DEFAULT_SETTINGS, backgroundMode: "chord", accompanimentStyle: "melody-accompaniment" },
      onChange: () => {},
      melodyArrangement: arrangement,
      activeMelodyPhrase: phrase,
      phraseSourceCandidates: { rightHand: ["source:right"], leftHand: [] },
      onMelodySelectionChange: () => {},
      onMelodyPhraseOverrideChange: () => {},
    }));

    expect(markup).toMatch(/<button[^>]*aria-disabled="false"[^>]*>Source right-hand candidate/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Source left-hand candidate/);
  });

  it("shows needs-review without confirming a stale rest", () => {
    const arrangement = buildMelodyAccompaniment(
      [{ midi: 72, start: 0, dur: 1, vel: 90, hand: "R" }],
      [{ beat: 0, name: "C", notes: [], durationBeats: 1 }],
      { durationBeats: 1, sourceFingerprint: "fixture-source-v1" },
    );
    const phrase = arrangement.phrases[0]!;
    const markup = renderToStaticMarkup(createElement(SoundControls, {
      settings: { ...DEFAULT_SETTINGS, backgroundMode: "chord", accompanimentStyle: "melody-accompaniment" },
      onChange: () => {},
      melodyArrangement: arrangement,
      activeMelodyPhrase: { ...phrase, review: "needs-review" as const },
      phraseSourceCandidates: { rightHand: ["source:right"], leftHand: [] },
      phraseOverrideAction: null,
      onMelodySelectionChange: () => {},
      onMelodyPhraseOverrideChange: () => {},
    }));

    expect(markup).toContain('data-testid="melody-phrase-review-reason"');
    expect(markup).toContain("stale or invalid phrase data is not applied");
    expect(markup).toMatch(/<button[^>]*aria-checked="false"[^>]*>Explicit rest/);
  });

  it("keeps an overlapping phrase reviewable without checking whole-part selection", () => {
    const arrangement = buildMelodyAccompaniment(
      [{ midi: 72, start: 0, dur: 2, vel: 90, hand: "R" }],
      [{ beat: 0, name: "C", notes: [], durationBeats: 2 }],
      { durationBeats: 2, sourceFingerprint: "fixture-source-v1" },
    );
    const phrase = arrangement.phrases[0]!;
    const markup = renderToStaticMarkup(createElement(SoundControls, {
      settings: { ...DEFAULT_SETTINGS, backgroundMode: "chord", accompanimentStyle: "melody-accompaniment" },
      onChange: () => {},
      melodyArrangement: arrangement,
      activeMelodyPhrase: { ...phrase, review: "needs-review" as const },
      phraseSourceCandidates: { rightHand: ["source:right"], leftHand: [] },
      phraseOverrideAction: null,
      phraseOverrideConflict: true,
      onMelodySelectionChange: () => {},
      onMelodyPhraseOverrideChange: () => {},
    }));

    expect(markup).toContain("saved override overlaps this interval");
    expect(markup).toMatch(/<button[^>]*aria-checked="false"[^>]*>Use whole-part selection/);
    expect(markup).not.toMatch(/<button[^>]*aria-checked="true"[^>]*>Use whole-part selection/);
  });
});
