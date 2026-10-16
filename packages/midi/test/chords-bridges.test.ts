import { describe, expect, it } from "vitest";
import { applyPhrasePlan, compilePhrasePlan, phrasePianoBacking, sourcePhraseClock, type Note, type ParsedMidi,
  type PhrasePlanV1, type PhraseProtectionReport, type Variant } from "../src/index.js";

function fixture() {
  const note = (id: string, midi: number, start: number, dur: number): Note =>
    ({ midi, start, dur, vel: 70, hand: "R", sourceOrigins: [{ id }] });
  const notes = [note("backing-a", 48, 0, 1), note("link-a", 67, 1, 1),
    note("link-b", 69, 2, 1), note("upper-lead", 81, 1, 2),
    note("link-c", 74, 5, 1), note("backing-b", 50, 7, 1)];
  const source: ParsedMidi = { format: 1, division: 480, tempoBpm: 120, keySig: 0, keyMode: 0,
    timeSig: [4, 4], notes, trackNames: ["Authored test control"], durationBeats: 8 };
  const plan: PhrasePlanV1 & { chordsBridges: Array<{ id: string; startBeat: number; endBeat: number;
    basis: string; events: Array<{ eventId: string; octaveShift?: number }> }> } = {
    schemaVersion: 1, kind: "keyspilli-phrase-plan", levels: ["advanced"],
    source: { sha256: "a".repeat(64), compositionId: "authored bridge control", performanceId: "test", clock: sourcePhraseClock(source) },
    phrases: [{ id: "whole", occurrenceId: "one", startBeat: 0, endBeat: 8,
      evidence: { authority: "self-authored", confidence: 1, basis: "synthetic source" },
      events: notes.map((n, i) => ({ id: n.sourceOrigins![0]!.id, sourceOriginId: n.sourceOrigins![0]!.id,
        role: i === 0 || i === 5 ? "harmony" : "melody", priority: 50, required: i === 0,
        expected: { midi: n.midi, startBeat: n.start, durationBeats: n.dur, hand: n.hand },
        allowedTransformations: i === 0 ? [] : ["omit", "octave-displacement"] })),
      rests: [{ id: "breath", startBeat: 3, endBeat: 5, scope: "all" }] }],
    chordsBridges: [{ id: "first-link", startBeat: 1, endBeat: 3, basis: "lower linking voice, not the upper lead",
      events: [{ eventId: "link-a" }, { eventId: "link-b" }] },
    { id: "second-link", startBeat: 5, endBeat: 6, basis: "source cadence in a compact register",
      events: [{ eventId: "link-c", octaveShift: -12 }] }],
  };
  const report: PhraseProtectionReport & { plan: typeof plan } = { schemaVersion: 1, status: "preserved", sourceSha256: plan.source.sha256,
    protectedEvents: 1, inferredHands: 0, selectionAccuracy: "not-established", musicalAcceptance: "not-established",
    outputClock: { timebase: "variant-quarter-beats", sourceTempoBpm: 120, playbackTempoBpm: 120 }, changes: [], plan };
  return { notes, source, plan, report };
}

describe("explicit source-gap Chords bridges", () => {
  it("refuses an optional backing retiming beyond the mapped source domain rather than clamping its gap", () => {
    const { notes, source, plan } = fixture();
    plan.phrases[0]!.events.at(-1)!.allowedTransformations.push("onset-change", "release-change");
    const compiled = compilePhrasePlan(source, plan, plan.source.sha256);
    const variant: Variant = { level: "advanced", difficultyScore: 0, notes: structuredClone(notes), chords: [],
      key: "C", tempoBpm: 120, timeSig: [4, 4], bassPattern: "block", measures: [{ index: 0, startBeat: 0, endBeat: 12 }] };
    variant.notes.at(-1)!.start = 10;
    const applied = applyPhrasePlan([variant], compiled)[0]!;
    expect(applied.notes.find(n => n.midi === 50)!.start).toBe(10);
    expect(() => phrasePianoBacking(applied.notes, applied.phraseProtection)).toThrow(/bridge.*source.*domain/i);
  });

  it("rejects explicit null octave shifts at the source-plan boundary", () => {
    const { source, plan } = fixture();
    Reflect.set(plan.chordsBridges[0]!.events[0]!, "octaveShift", null);
    expect(() => compilePhrasePlan(source, plan, plan.source.sha256)).toThrow(/bridge.*octave/i);
  });
  it("plays only selected source links inside backing gaps, preserving source roles, rests and Original", () => {
    const { notes, source, plan, report } = fixture(), before = structuredClone({ notes, plan, report });
    compilePhrasePlan(source, plan, plan.source.sha256);
    const result = phrasePianoBacking(notes, report);
    expect(result.notes.map(n => [n.midi, n.start, n.dur])).toEqual([
      [48, 0, 1], [67, 1, 1], [69, 2, 1], [62, 5, 1], [50, 7, 1],
    ]);
    expect(result.changes).toContainEqual(expect.objectContaining({ eventId: "link-c", role: "melody",
      operation: "source-gap-bridge", before: [expect.objectContaining({ midi: 74 })], after: [expect.objectContaining({ midi: 62 })] }));
    expect({ notes, plan, report }).toEqual(before);
    Reflect.deleteProperty(report.plan, "chordsBridges");
    expect(phrasePianoBacking(notes, report).notes.map(n => n.midi)).toEqual([48, 50]);
  });

  it.each(["backing overlap", "polyphony", "long gap", "whole-source rest", "missing event", "duplicate selection", "unpermitted octave"])(
    "rejects %s rather than importing an unbounded lead", kind => {
      const { notes, source, plan, report } = fixture();
      if (kind === "backing overlap") plan.chordsBridges[0]!.startBeat = 0;
      if (kind === "polyphony") plan.chordsBridges[0]!.events.push({ eventId: "upper-lead" });
      if (kind === "long gap") { notes.at(-1)!.start = 12; plan.phrases[0]!.events.at(-1)!.expected.startBeat = 12;
        source.durationBeats = 13; plan.source.clock.durationBeats = 13; plan.phrases[0]!.endBeat = 13; }
      if (kind === "whole-source rest") plan.chordsBridges[0]!.endBeat = 4;
      if (kind === "missing event") plan.chordsBridges[0]!.events[0]!.eventId = "absent";
      if (kind === "duplicate selection") plan.chordsBridges[0]!.events.push({ eventId: "link-a" });
      if (kind === "unpermitted octave") plan.phrases[0]!.events.find(e => e.id === "link-c")!.allowedTransformations = ["omit"];
      expect(() => { compilePhrasePlan(source, plan, plan.source.sha256); phrasePianoBacking(notes, report); }).toThrow(/bridge/i);
    });

  it("maps source bridge windows through a tempo change before checking the retained backing gap", () => {
    const { notes, plan, report } = fixture();
    plan.source.clock.tempoEvents = [
      { tick: 0, beat: 0, microsecondsPerQuarter: 500000, bpm: 120 },
      { tick: 960, beat: 2, microsecondsPerQuarter: 1000000, bpm: 60 },
    ];
    for (const n of notes) { if (n.start >= 2) { n.start = 2 + (n.start - 2) * 2; n.dur *= 2; }
      else if (n.start + n.dur > 2) n.dur += n.start + n.dur - 2; }
    expect(phrasePianoBacking(notes, report).notes.map(n => [n.midi, n.start, n.dur])).toEqual([
      [48, 0, 1], [67, 1, 1], [69, 2, 2], [62, 8, 2], [50, 12, 2],
    ]);
  });

  it.each(["missing retained event", "shared lineage", "changed release", "hook", "intro", "slow gap"])(
    "refuses %s without reconstructing or silently changing source material", kind => {
      const { notes, plan, report } = fixture();
      if (kind === "missing retained event") notes.splice(1, 1);
      if (kind === "shared lineage") notes[1]!.sourceOrigins!.push({ id: "upper-lead" });
      if (kind === "changed release") notes[1]!.dur = .5;
      if (kind === "hook") plan.phrases[0]!.events[1]!.role = "hook";
      if (kind === "intro") notes.shift();
      if (kind === "slow gap") {
        notes.at(-1)!.start = 8; plan.phrases[0]!.events.at(-1)!.expected.startBeat = 8;
        plan.source.clock.tempoBpm = 60; plan.source.clock.durationBeats = 9; plan.phrases[0]!.endBeat = 9;
        report.outputClock.sourceTempoBpm = 60;
      }
      const before = structuredClone({ notes, plan });
      expect(() => phrasePianoBacking(notes, report)).toThrow(/bridge/i);
      expect({ notes, plan }).toEqual(before);
    });
});
