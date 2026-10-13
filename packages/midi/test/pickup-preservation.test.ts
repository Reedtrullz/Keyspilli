import { describe, expect, it } from "vitest";
import { buildShortStudyVariants, buildVariants, midiBeatToNativeSeconds, parseMidi, parseMusicXmlNotes, selectSourceParts, sourcePedalEnd, writeMidi, writeMusicXml, writeVariantArtifacts, type DifficultyLevel, type Variant } from "../src/index.js";
import { pickupFixture, pickupKinds, twoTempoMidi } from "./pickup-fixtures.js";

const levels: DifficultyLevel[] = ["very-beginner", "beginner", "very-easy", "easy", "medium", "advanced"];
const meta = { title: "Self-authored pickup", artist: "Software control" };
const options = { arrangementProfile: "source" as const, maxDurBeats: null, chords: [] };
const noteShape = (notes: Variant["notes"]) => notes.map(n => [n.midi, n.start, n.dur]).sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!);

describe("ordinary pickup and terminal rest preservation", () => {
  it.each(pickupKinds)("includes the final %s rest bar in the parsed source duration", kind => {
    const fixture = pickupFixture(kind), parsed = parseMusicXmlNotes(fixture.xml);
    expect(parsed.notationMeasures).toEqual(fixture.measures);
    expect(parsed.durationBeats).toBe(fixture.endBeat);
    expect(parsed.repeatPlayback).toBeUndefined();
    expect(parsed.notes[0]!.start).toBe(.5);
  });

  it.each(pickupKinds.flatMap(kind => levels.map(level => ({ kind, level }))))
  ("preserves $kind source measure boundaries through $level and both exports", ({ kind, level }) => {
    const fixture = pickupFixture(kind), parsed = parseMusicXmlNotes(fixture.xml), before = structuredClone(parsed);
    const variant = buildVariants(parsed, meta, options).find(v => v.level === level)!;
    expect(variant.measures).toEqual(fixture.measures);
    const artifacts = writeVariantArtifacts(variant, meta.title, meta.artist);
    for (const exported of [parseMidi(artifacts.midi), parseMusicXmlNotes(artifacts.xml)]) {
      expect(exported.notationMeasures).toEqual(fixture.measures);
      expect(exported.durationBeats).toBe(fixture.endBeat);
      expect(noteShape(exported.notes)).toEqual(noteShape(variant.notes));
      expect(exported.repeatPlayback).toBeUndefined();
    }
    expect(parsed).toEqual(before);
  });

  it.each(pickupKinds)("writes a standalone %s ordinary MIDI map without claiming repeat lineage", kind => {
    const fixture = pickupFixture(kind), parsed = parseMusicXmlNotes(fixture.xml);
    const bytes = writeMidi(parsed.notes, { tempoBpm: 120, timeSig: parsed.timeSig, timeSigEvents: parsed.timeSigEvents, measures: fixture.measures });
    const reparsed = parseMidi(bytes);
    expect(reparsed.notationMeasures).toEqual(fixture.measures);
    expect(reparsed.durationBeats).toBe(fixture.endBeat);
    expect(reparsed.repeatPlayback).toBeUndefined();
    // An ordinary MIDI reader that ignores our optional map must still reach
    // the terminal rest via End Of Track, rather than ending at the last note.
    const withoutMap = bytes.slice(), prefix = new TextEncoder().encode("keyspilli-notation-measures-v1:");
    const at = withoutMap.findIndex((_, index) => prefix.every((value, offset) => withoutMap[index + offset] === value));
    if (at >= 0) withoutMap[at] = 120;
    const ordinaryReader = parseMidi(withoutMap);
    expect(ordinaryReader.notationMeasures).toBeUndefined();
    expect(ordinaryReader.durationBeats).toBe(fixture.endBeat);
  });

  it("keeps a selected source part's explicit rest tail", () => {
    const fixture = pickupFixture("simple"), parsed = parseMusicXmlNotes(fixture.xml);
    const selected = selectSourceParts(parsed, [parsed.sourceParts![0]!.id]);
    expect(selected.durationBeats).toBe(fixture.endBeat);
    expect(selected.notationMeasures).toEqual(fixture.measures);
  });

  it("keeps the same pickup map for an owner-authored one-note study", () => {
    const fixture = pickupFixture("simple"), parsed = parseMusicXmlNotes(fixture.xml);
    const study = { ...parsed, notes: [parsed.notes[0]!] };
    const variants = buildShortStudyVariants(study, meta, { maxDurBeats: null });
    expect(variants.map(v => v.level)).toEqual(["beginner", "easy", "medium", "advanced"]);
    for (const variant of variants) {
      expect(variant.measures).toEqual(fixture.measures);
      expect(parseMusicXmlNotes(writeMusicXml(variant, meta.title, meta.artist)).durationBeats).toBe(fixture.endBeat);
    }
  });

  it.each([false, true])("uses a multipart notation map only when all part boundaries agree (different: %s)", different => {
    const fixture = pickupFixture("simple");
    const body = fixture.xml.match(/<part id="P1">([\s\S]*?)<\/part>/)![1]!;
    const other = different ? body.replace("<duration>2</duration>", "<duration>6</duration>")
      .replace('<measure number="3"><note><rest/><duration>16</duration>', '<measure number="3" implicit="yes"><note><rest/><duration>12</duration>') : body;
    const parsed = parseMusicXmlNotes(`<score-partwise><part id="P1">${body}</part><part id="P2">${other}</part></score-partwise>`);
    expect(parsed.durationBeats).toBe(13);
    // A first-part map must not silently become the map of a different part.
    expect(parsed.notationMeasures).toEqual(different ? undefined : fixture.measures);
  });
});

describe("source beat and playback-second controls", () => {
  it("retains an external MIDI End Of Track rest after two native tempo segments", () => {
    const source = parseMidi(twoTempoMidi());
    expect(source.durationBeats).toBe(12);
    expect(source.tempoEvents?.map(e => [e.beat, e.bpm])).toEqual([[0, 120], [4, 60]]);
    expect(source.notes.map(n => [midiBeatToNativeSeconds(source, n.start), midiBeatToNativeSeconds(source, n.start + n.dur)]))
      .toEqual([[0, .5], [2, 3], [6, 7]]);
    const advanced = buildVariants(source, meta, options).find(v => v.level === "advanced")!;
    expect(advanced.measures.at(-1)!.endBeat).toBe(20);
    // Current scalar-clock notation has five arithmetic 4/4 bars, while the
    // source had twelve quarter-note beats. Native seconds remain unchanged.
    expect(advanced.measures).toHaveLength(5);
    const output = parseMidi(writeVariantArtifacts(advanced, meta.title, meta.artist).midi);
    expect(output.durationBeats).toBe(20);
    expect(midiBeatToNativeSeconds(output, output.durationBeats)).toBe(10);
    expect(output.notes.map(n => [midiBeatToNativeSeconds(output, n.start), midiBeatToNativeSeconds(output, n.start + n.dur)]))
      .toEqual([[0, .5], [2, 3], [6, 7]]);
  });

  it("converts supplied measure endpoints once when normalizing a native tempo map", () => {
    const source = { ...parseMidi(twoTempoMidi()), durationBeats: 12, notationMeasures: [0, 4, 8].map((startBeat, index) => ({ index, startBeat, endBeat: startBeat + 4 })) };
    const before = structuredClone(source);
    const expected = [{ index: 0, startBeat: 0, endBeat: 4 }, { index: 1, startBeat: 4, endBeat: 12 }, { index: 2, startBeat: 12, endBeat: 20 }];
    for (const variant of buildVariants(source, meta, options)) {
      expect(variant.measures).toEqual(expected);
      const artifacts = writeVariantArtifacts(variant, meta.title, meta.artist);
      for (const output of [parseMidi(artifacts.midi), parseMusicXmlNotes(artifacts.xml)]) {
        expect(output.notationMeasures).toEqual(expected);
        expect(noteShape(output.notes)).toEqual(noteShape(variant.notes));
        expect(midiBeatToNativeSeconds(output, output.durationBeats)).toBe(10);
      }
    }
    const studySource = { ...source, notes: [source.notes[1]!] };
    for (const variant of buildShortStudyVariants(studySource, meta, { maxDurBeats: null })) expect(variant.measures).toEqual(expected);
    expect(source).toEqual(before);
  });

  it("extends a notation rest without extending the source's missing-up pedal cap", () => {
    const note = { midi: 60, start: 0, dur: 1, vel: 80, sourceMidiChannel: 0 };
    const sourcePedal = { version: 1 as const, endBeat: 6, provenance: "midi-file" as const, changes: [{ beat: 0, channel: 0, value: 127, source: "midi:0" }] };
    const output = parseMidi(writeMidi([note], { tempoBpm: 120, sourcePedal, measures: [{ index: 0, startBeat: 0, endBeat: 4 }, { index: 1, startBeat: 4, endBeat: 8 }] }));
    expect(output.durationBeats).toBe(8);
    expect(output.sourcePedal?.endBeat).toBe(6);
    expect(sourcePedalEnd(output.notes[0]!, output.sourcePedal!)).toBe(6);
    expect(output.notes[0]!.dur).toBe(1);
  });

  it.each(["0", "-1", "Infinity", "bad", "6"])("rejects a forged pedal extent %s without a matching controller timeline", end => {
    expect(() => parseMidi(twoTempoMidi([{ beat: 0, text: `keyspilli-source-pedal-end-v1:${end}` }]))).toThrow(/pedal/i);
  });

  it("keeps an explicitly bounded pedal cap separate from EOT and physical key releases", () => {
    const source = parseMidi(twoTempoMidi([{ beat: 0, text: "keyspilli-source-pedal-end-v1:10" }], [{ beat: 0, value: 127 }]));
    expect(source.durationBeats).toBe(12);
    expect(source.sourcePedal?.endBeat).toBe(10);
    expect(source.notes.map(note => [note.start, note.dur, note.sourceMidiChannel])).toEqual([[0, 1, 0], [4, 1, 0], [8, 1, 0]]);
    expect(source.notes.map(note => sourcePedalEnd(note, source.sourcePedal!))).toEqual([10, 10, 10]);
  });

  it.each([
    { label: "duplicate", metadata: [{ beat: 0, text: "10" }, { beat: 0, text: "10" }], controllerBeat: 0 },
    { label: "misplaced", metadata: [{ beat: 1, text: "10" }], controllerBeat: 0 },
    { label: "before key release", metadata: [{ beat: 0, text: "8" }], controllerBeat: 0 },
    { label: "beyond EOT", metadata: [{ beat: 0, text: "13" }], controllerBeat: 0 },
    { label: "before controller", metadata: [{ beat: 0, text: "10" }], controllerBeat: 11 },
    { label: "excessive payload", metadata: [{ beat: 0, text: "10" + " ".repeat(256) }], controllerBeat: 0 },
  ])("rejects a $label source pedal cap even when actual CC64 is present", ({ metadata, controllerBeat }) => {
    const events = metadata.map(event => ({ ...event, text: `keyspilli-source-pedal-end-v1:${event.text}` }));
    expect(() => parseMidi(twoTempoMidi(events, [{ beat: controllerBeat, value: 127 }]))).toThrow(/pedal|CC64/i);
  });
});

describe("ordinary MIDI measure-map bounds", () => {
  const prefix = "keyspilli-notation-measures-v1:";
  it.each([
    { label: "discontinuous", rows: [[0, 4], [5, 12]] },
    { label: "zero length", rows: [[0, 0]] },
    { label: "excessive end", rows: [[0, 4097]] },
    { label: "excessive count", rows: Array.from({ length: 2049 }, (_, index) => [index, index + 1]) },
    { label: "non-numeric", rows: [[0, "12"]] },
    { label: "negative start", rows: [[-Number.EPSILON, 12]] },
    { label: "before the MIDI end", rows: [[0, 8]] },
  ])("rejects a $label declared ordinary MIDI map", ({ rows }) => {
    expect(() => parseMidi(twoTempoMidi([{ beat: 0, text: prefix + JSON.stringify(rows) }]))).toThrow(/measure.*map/i);
  });
  it("rejects duplicated or misplaced ordinary maps", () => {
    const text = prefix + "[[0,4],[4,8],[8,12]]";
    expect(() => parseMidi(twoTempoMidi([{ beat: 0, text }, { beat: 0, text }]))).toThrow(/ambiguous.*map/i);
    expect(() => parseMidi(twoTempoMidi([{ beat: 1, text }]))).toThrow(/ambiguous.*map/i);
  });
  it("ignores unrelated sequencer metadata", () => {
    expect(parseMidi(twoTempoMidi([{ beat: 0, text: "unrelated-measure-format:[[0,4097]]" }])).notes).toHaveLength(3);
  });
  it.each([
    [{ index: 0, startBeat: 0, endBeat: 0 }],
    [{ index: 0, startBeat: 0, endBeat: 4 }, { index: 1, startBeat: 5, endBeat: 8 }],
    [{ index: 0, startBeat: 0, endBeat: 4097 }],
  ])("rejects invalid ordinary measure spans at the writer boundary (%#)", (...measures) => {
    expect(() => writeMidi([], { tempoBpm: 120, measures })).toThrow(/measure.*map/i);
  });
  it("counts an explicit empty tail against the source workload limit", () => {
    const source = { ...parseMidi(twoTempoMidi()), notationMeasures: [{ index: 0, startBeat: 0, endBeat: 4097 }] };
    expect(() => buildVariants(source, meta, options)).toThrow(/workload|measure.*map/i);
  });
});
