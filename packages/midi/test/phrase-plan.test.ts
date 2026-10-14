import { describe, expect, it } from "vitest";
import { applyPhrasePlan, buildVariants, compilePhrasePlan, parseMidi, parseMusicXmlNotes, writeVariantArtifacts, type ParsedMidi, type PhrasePlanV1 } from "../src/index.js";
import corpus from "./fixtures/phrase-corpus.json";
import * as midiApi from "../src/index.js";

const HASH = "a".repeat(64);
const levels = ["very-beginner", "beginner", "very-easy", "easy", "medium", "advanced"];
const meta = { title: "Authored phrase control", artist: "Keyspilli tests" };
function fixture(index = 0) {
  const item = structuredClone(corpus.cases[index]!);
  const source = item.source as unknown as ParsedMidi;
  const plan = {
    schemaVersion: 1, kind: "keyspilli-phrase-plan", levels,
    source: { sha256: HASH, compositionId: item.compositionId, performanceId: item.performanceId,
      clock: { timebase: "source-quarter-beats", division: source.division, tempoBpm: source.tempoBpm,
        durationBeats: source.durationBeats, timeSig: source.timeSig,
        tempoEvents: source.tempoEvents ?? [], timeSigEvents: source.timeSigEvents ?? [],
        measures: source.notationMeasures ?? [] } },
    phrases: [{ id: "identity", occurrenceId: "performance-1", startBeat: 0, endBeat: 18,
      evidence: { authority: "self-authored", confidence: 1, basis: "original synthetic control" },
      events: source.notes.map((note, index) => ({ id: `event-${index}`, sourceOriginId: note.sourceOrigins![0]!.id,
        sourceOccurrence: 1, role: item.protectedOrigins.includes(note.sourceOrigins![0]!.id) ? item.role : "accompaniment",
        priority: item.protectedOrigins.includes(note.sourceOrigins![0]!.id) ? 100 : 10,
        expected: { midi: note.midi, startBeat: note.start, durationBeats: note.dur, hand: note.hand },
        required: item.protectedOrigins.includes(note.sourceOrigins![0]!.id),
        allowedTransformations: item.protectedOrigins.includes(note.sourceOrigins![0]!.id) ? [] : ["omit", "octave-displacement", "onset-change", "release-change", "hand-reassignment", "velocity-change"] })),
      rests: [{ id: "terminal-rest", startBeat: 16, endBeat: 18, scope: "all" },
        ...(item.compositionId === "breathing-line" ? [{ id: "breath", startBeat: 2 / 3, endBeat: 2 + 1 / 3, scope: "melody" }] : [])] }],
  };
  return { source, plan, item };
}
const run = (source: ParsedMidi, plan: unknown, sourceSha256 = HASH) => buildVariants(source, meta,
  { arrangementProfile: "source", maxDurBeats: null, normalizeRange: false, phrasePlan: plan, sourceSha256 } as Parameters<typeof buildVariants>[2]);

describe("explicit source-bound phrase contract", () => {
  it("shortens only a permitted optional reduction tail to preserve a source rest", () => {
    const { source, plan } = fixture();
    const compiled = compilePhrasePlan(source, plan as PhrasePlanV1, HASH);
    const advanced = run(source, plan).find(v => v.level === "advanced")!;
    const tail = advanced.notes.filter(n => n.sourceOrigins?.some(o => plan.phrases[0]!.events.some(e =>
      e.sourceOriginId === o.id && !e.required))).at(-1)!;
    expect(tail).toBeDefined();
    const origin = tail.sourceOrigins![0]!.id;
    tail.dur = 16.5 - tail.start;
    const result = applyPhrasePlan([advanced], compiled)[0]!;
    const reduced = result.notes.find(n => n.sourceOrigins?.some(o => o.id === origin))!;
    expect(reduced.midi).toBe(tail.midi);
    expect(reduced.start).toBe(tail.start);
    expect(reduced.start + reduced.dur).toBe(16);
    expect(result.notes.every(n => n.start + n.dur <= 16)).toBe(true);
    const forbidden = structuredClone(plan) as PhrasePlanV1;
    forbidden.phrases[0]!.events.find(e => e.sourceOriginId === origin)!.allowedTransformations = ["octave-displacement", "onset-change", "hand-reassignment", "velocity-change"];
    expect(() => applyPhrasePlan([advanced], compilePhrasePlan(source, forbidden, HASH))).toThrow(/phrase/i);
  });
  for (let index = 0; index < corpus.cases.length; index++) {
    it(`preserves exact selected events through all six tiers: ${corpus.cases[index]!.compositionId}`, () => {
      const { source, plan, item } = fixture(index);
      const before = structuredClone({ source, plan });
      const variants = run(source, plan);
      expect(variants).toHaveLength(6);
      for (const variant of variants) {
        for (const id of item.protectedOrigins) {
          const expected = source.notes.find(n => n.sourceOrigins?.some(o => o.id === id))!;
          const actual = variant.notes.find(n => n.sourceOrigins?.some(o => o.id === id));
          const mappedStart = index === 5 && expected.start > 8 ? 8 + (expected.start - 8) * 2 : expected.start;
          const mappedDur = index === 5 && expected.start >= 8 ? expected.dur * 2 : expected.dur;
          expect(actual, `${variant.level}/${id}`).toMatchObject({ midi: expected.midi, hand: expected.hand });
          expect(actual!.start).toBeCloseTo(mappedStart, 10);
          expect(actual!.dur).toBeCloseTo(mappedDur, 10);
        }
        expect((variant as any).phraseProtection).toMatchObject({ status: "preserved", protectedEvents: 8,
          selectionAccuracy: "not-established", musicalAcceptance: "not-established", sourceSha256: HASH });
      }
      expect({ source, plan }).toEqual(before);
    });
  }

  it("keeps default source preparation untouched unless the plan is selected", () => {
    const { source } = fixture();
    const variants = buildVariants(source, meta, { arrangementProfile: "source", maxDurBeats: null });
    expect(variants.every(v => !("phraseProtection" in v))).toBe(true);
    expect(variants[0]!.sourcePreparation!.changes.some(c => c.reason === "quantization" && c.after.some(n => n.start === 0.375))).toBe(true);
  });

  it.each([
    ["source hash", (x: any) => { x.plan.source.sha256 = "b".repeat(64); }],
    ["clock", (x: any) => { x.plan.source.clock.tempoBpm = 90; }],
    ["source event", (x: any) => { x.source.notes[0].midi += 1; }],
    ["ambiguous origin", (x: any) => { x.source.notes.push(structuredClone(x.source.notes[0])); }],
    ["unknown role", (x: any) => { x.plan.phrases[0].events[0].role = "highest-is-melody"; }],
    ["authority without receipt", (x: any) => { x.plan.phrases[0].evidence.authority = "human-validated"; }],
    ["nonfinite confidence", (x: any) => { x.plan.phrases[0].evidence.confidence = NaN; }],
    ["contradictory source rest", (x: any) => { x.plan.phrases[0].rests[0].startBeat = 0; }],
    ["duplicate event id", (x: any) => { x.plan.phrases[0].events[1].id = x.plan.phrases[0].events[0].id; }],
    ["unsupported policy", (x: any) => { x.plan.phrases[0].events[0].allowedTransformations = ["reharmonize"]; }],
  ])("refuses %s before creating variants", (_label, mutate) => {
    const input = fixture(); mutate(input);
    expect(() => run(input.source, input.plan)).toThrow(/phrase/i);
  });

  it("requires a caller-verified source hash", () => {
    const { source, plan } = fixture();
    expect(() => buildVariants(source, meta, { arrangementProfile: "source", phrasePlan: plan } as any)).toThrow(/phrase/i);
  });

  it.each([null, false, 0, ""])("rejects an explicitly supplied invalid plan: %s", value => {
    const { source } = fixture();
    expect(() => run(source, value)).toThrow(/phrase/i);
  });

  it("does not report zero selected protections as preserved", () => {
    const { source, plan } = fixture();
    for (const event of plan.phrases[0]!.events) { event.required = false; event.allowedTransformations = ["omit", "octave-displacement", "onset-change", "release-change", "hand-reassignment", "velocity-change"]; }
    expect(() => run(source, plan)).toThrow(/phrase.*required/i);
  });

  it("exposes source-bound uncertain proposals from the existing role selector", () => {
    const { source } = fixture();
    const suggest = (midiApi as any).suggestPhrasePlan;
    expect(suggest).toBeTypeOf("function");
    const plan = suggest(source, { sha256: HASH, compositionId: "synthetic", performanceId: "v1" });
    expect(plan.phrases[0].evidence).toMatchObject({ authority: "unknown", confidence: null });
    expect(plan.phrases[0].events).toHaveLength(source.notes.length);
    expect(plan.phrases[0].events.every((e: any) => e.required === false)).toBe(true);
    expect(() => run(source, plan)).toThrow(/phrase.*required/i);
  });

  it("preserves selected event pitch/attack/release/hand through both artifact formats", () => {
    const { source, plan } = fixture(1);
    for (const variant of run(source, plan)) {
      const artifacts = writeVariantArtifacts(variant, meta.title, meta.artist);
      const midi = parseMidi(artifacts.midi);
      const xml = parseMusicXmlNotes(artifacts.xml);
      for (const expected of source.notes.filter(n => n.sourceOrigins![0]!.part === "identity")) {
        for (const parsed of [midi, xml]) {
          const actual = parsed.notes.find(n => n.midi === expected.midi && Math.abs(n.start - expected.start) < 0.01);
          expect(actual).toBeDefined();
          expect(actual!.dur).toBeCloseTo(expected.dur, 2);
          expect(actual!.hand).toBe(expected.hand);
        }
      }
    }
  });

  it.each([60, 90])("keeps protected and ordinary events in the same source beat clock at playback tempo %i", tempo => {
    const { source, plan } = fixture();
    const variants = buildVariants(source, { ...meta, tempo }, { arrangementProfile: "source", maxDurBeats: null,
      normalizeRange: false, phrasePlan: plan, sourceSha256: HASH } as any);
    for (const variant of variants) {
      const expected = source.notes[2]!;
      const actual = variant.notes.find(n => n.sourceOrigins?.some(o => o.id === expected.sourceOrigins![0]!.id))!;
      expect(variant.tempoBpm).toBe(tempo);
      expect(actual.start).toBeCloseTo(expected.start, 10);
      expect(actual.dur).toBeCloseTo(expected.dur, 10);
    }
  });

  it("refuses a faster playback tempo when exact events violate the chosen difficulty limit", () => {
    const { source, plan } = fixture();
    expect(() => buildVariants(source, { ...meta, tempo: 180 }, { arrangementProfile: "source", maxDurBeats: null,
      phrasePlan: plan, sourceSha256: HASH } as any)).toThrow(/median inter-onset/i);
  });

  it("checks a role rest against declarations in every phrase", () => {
    const { source, plan } = fixture();
    plan.phrases.push({ ...structuredClone(plan.phrases[0]!), id: "overlay", startBeat: 0, endBeat: 1,
      events: [], rests: [{ id: "cross-phrase-breath", startBeat: 1 / 3, endBeat: 2 / 3, scope: "melody" }] });
    expect(() => run(source, plan)).toThrow(/rest.*contradicts/i);
  });

  it("checks protected source silence through the actual CC64 sounding release", () => {
    const { source, plan } = fixture();
    source.notes.forEach(n => { n.sourceMidiChannel = 0; });
    source.sourcePedal = { version: 1, endBeat: 18, provenance: "midi-file", changes: [
      { beat: 0, channel: 0, value: 127, source: "midi:0" }, { beat: 1.5, channel: 0, value: 0, source: "midi:0" },
    ] };
    plan.levels = ["advanced"];
    for (const event of plan.phrases[0]!.events) {
      event.required = false;
      event.allowedTransformations = ["omit", "octave-displacement", "onset-change", "release-change", "hand-reassignment", "velocity-change"];
    }
    plan.phrases[0]!.events[1]!.required = true;
    plan.phrases[0]!.events[1]!.allowedTransformations = [];
    plan.phrases[0]!.rests = [{ id: "pedalled-rest", startBeat: 1, endBeat: 2, scope: "all" }];
    expect(() => run(source, plan)).toThrow(/rest.*contradicts/i);
  });

  it("rejects a wildcard occurrence alias of an already assigned physical source event", () => {
    const { source, plan } = fixture();
    const alias = { ...structuredClone(plan.phrases[0]!.events[0]!), id: "wildcard-alias", sourceOccurrence: undefined };
    plan.phrases[0]!.events.push(alias as any);
    expect(() => run(source, plan)).toThrow(/source.*assigned more than once/i);
  });

  it("retains the unlisted source lineage of a compatible exact unison", () => {
    const { source, plan } = fixture();
    source.notes = source.notes.filter(n => n.sourceOrigins![0]!.part === "identity");
    plan.phrases[0]!.events = plan.phrases[0]!.events.filter(e => e.required);
    const unison = structuredClone(source.notes[0]!);
    unison.sourceOrigins = [{ id: "unlisted-unison", occurrence: 1, part: "independent-part" }];
    source.notes.push(unison);
    const advanced = run(source, plan).find(v => v.level === "advanced")!;
    const actual = advanced.notes.find(n => n.sourceOrigins?.some(o => o.id === "unlisted-unison"));
    expect(actual).toMatchObject({ midi: unison.midi, start: unison.start, dur: unison.dur, hand: unison.hand });
    expect(actual!.sourceOrigins).toHaveLength(2);
  });

  it("retains an explicit caller duration ceiling when exact protection conflicts", () => {
    const { source, plan } = fixture();
    expect(() => buildVariants(source, meta, { arrangementProfile: "source", maxDurBeats: 0.2,
      phrasePlan: plan, sourceSha256: HASH } as any)).toThrow(/longer than 0.2 beats/i);
  });

  it("bounds raw semantic plan size and nesting before cloning", () => {
    const { source, plan } = fixture();
    expect(() => run(source, { ...plan, extra: "x".repeat(2 * 1024 * 1024) })).toThrow(/phrase.*2 MiB/i);
    let nested: unknown = "end";
    for (let i = 0; i < 40; i++) nested = { next: nested };
    expect(() => run(source, { ...plan, extra: nested })).toThrow(/phrase.*nesting/i);
  });

  it("derives generated chord coordinates from the restored notes", () => {
    const { source, plan } = fixture();
    source.notes = source.notes.filter(n => n.sourceOrigins![0]!.part === "identity").flatMap(n => [
      { ...n, midi: 48, hand: "L" as const },
      { ...n, midi: 55, hand: "L" as const, sourceOrigins: [{ id: `${n.sourceOrigins![0]!.id}-fifth`, occurrence: 1 as const }] },
    ]);
    plan.phrases[0]!.events = source.notes.map((n, i) => ({ id: `stack-${i}`, sourceOriginId: n.sourceOrigins![0]!.id,
      sourceOccurrence: 1, role: "harmony", priority: 100, expected: { midi: n.midi, startBeat: n.start, durationBeats: n.dur, hand: n.hand },
      required: true, allowedTransformations: [] }));
    for (const variant of run(source, plan)) {
      expect(variant.chords[0]).toMatchObject({ beat: 0.25, name: "C5", notes: [48, 55] });
    }
  });

  it("refuses incompatible unlisted source parents of a quantized collision", () => {
    const { source, plan } = fixture();
    source.notes = source.notes.filter(n => n.sourceOrigins![0]!.part === "identity");
    plan.phrases[0]!.events = plan.phrases[0]!.events.filter(e => e.required);
    const collision = structuredClone(source.notes[0]!);
    collision.start += 0.01;
    collision.sourceOrigins = [{ id: "unlisted-offset-attack", occurrence: 1 }];
    source.notes.push(collision);
    expect(() => run(source, plan)).toThrow(/incompatible unlisted merged source lineage/i);
  });

  it("restores a protected attack when every colliding optional source is explicitly permitted to be omitted", () => {
    const { source, plan } = fixture();
    source.notes = source.notes.filter(n => n.sourceOrigins![0]!.part === "identity");
    plan.phrases[0]!.events = plan.phrases[0]!.events.filter(e => e.required);
    const protectedNote = source.notes[0]!;
    const collision = { ...structuredClone(protectedNote), dur: 8,
      sourceOrigins: [{ id: "listed-optional-pad", occurrence: 1 as const, part: "harmony" }] };
    source.notes.push(collision);
    const optional = { id: "optional-pad", sourceOriginId: "listed-optional-pad", sourceOccurrence: 1 as const,
      role: "harmony", priority: 10, expected: { midi: collision.midi, startBeat: collision.start, durationBeats: collision.dur, hand: collision.hand },
      required: false, allowedTransformations: ["omit"] };
    plan.phrases[0]!.events.push(optional);
    for (const variant of run(source, plan)) {
      expect(variant.notes.find(n => n.sourceOrigins?.some(o => o.id === protectedNote.sourceOrigins![0]!.id))).toMatchObject({
        midi: protectedNote.midi, start: protectedNote.start, dur: protectedNote.dur });
      expect(variant.notes.some(n => n.sourceOrigins?.some(o => o.id === "listed-optional-pad"))).toBe(false);
      expect(variant.phraseProtection!.changes).toContainEqual(expect.objectContaining({ eventId: "optional-pad", operation: "permitted-transformation", after: [] }));
    }
    optional.allowedTransformations = [];
    expect(() => run(source, plan)).toThrow(/incompatible unlisted merged source lineage/i);
  });

  it("shortens a permitted optional physical hold before a restored required attack", () => {
    const { source, plan } = fixture();
    const protectedNote = source.notes[0]!;
    const pad = { ...structuredClone(protectedNote), start: 0, dur: 8,
      sourceOrigins: [{ id: "earlier-optional-pad", occurrence: 1 as const }] };
    source.notes.push(pad);
    plan.phrases[0]!.events.push({ id: "earlier-pad", sourceOriginId: "earlier-optional-pad", sourceOccurrence: 1,
      role: "harmony", priority: 10, expected: { midi: pad.midi, startBeat: 0, durationBeats: 8, hand: pad.hand },
      required: false, allowedTransformations: ["release-change"] });
    const compiled = compilePhrasePlan(source, plan as PhrasePlanV1, HASH);
    const advanced = buildVariants(fixture().source, meta, { arrangementProfile: "source", maxDurBeats: null }).at(-1)!;
    advanced.notes.push(pad);
    const original = structuredClone(advanced);
    const result = applyPhrasePlan([advanced], compiled)[0]!;
    expect(result.notes.find(n => n.sourceOrigins?.some(o => o.id === "earlier-optional-pad"))).toMatchObject({
      midi: pad.midi, start: 0, dur: protectedNote.start });
    expect(result.notes.find(n => n.sourceOrigins?.some(o => o.id === protectedNote.sourceOrigins![0]!.id))).toMatchObject(protectedNote);
    expect(result.phraseProtection!.changes).toContainEqual(expect.objectContaining({ eventId: "earlier-pad",
      after: [expect.objectContaining({ start: 0, dur: protectedNote.start })] }));
    expect(advanced).toEqual(original);
    plan.phrases[0]!.events.at(-1)!.allowedTransformations = [];
    expect(() => applyPhrasePlan([advanced], compilePhrasePlan(source, plan as PhrasePlanV1, HASH))).toThrow(/overlapping MIDI/);
    plan.phrases[0]!.events.pop();
    expect(() => applyPhrasePlan([advanced], compilePhrasePlan(source, plan as PhrasePlanV1, HASH))).toThrow(/overlapping MIDI/);
  });

  it("shortens a permitted optional hold before another explicitly selected source attack", () => {
    const { source, plan } = fixture();
    const backing = source.notes[1]!;
    const repeated = { ...structuredClone(backing), start: 0.5, dur: 0.25,
      sourceOrigins: [{ id: "optional-repeated-key", occurrence: 1 as const }] };
    source.notes.push(repeated);
    plan.phrases[0]!.events.push({ id: "optional-repeated-key", sourceOriginId: "optional-repeated-key", sourceOccurrence: 1,
      role: "harmony", priority: 10, expected: { midi: repeated.midi, startBeat: repeated.start, durationBeats: repeated.dur, hand: repeated.hand },
      required: false, allowedTransformations: [] });
    const advanced = buildVariants(fixture().source, meta, { arrangementProfile: "source", maxDurBeats: null }).at(-1)!;
    advanced.notes = advanced.notes.filter(n => !n.sourceOrigins?.some(o => o.id === backing.sourceOrigins![0]!.id));
    advanced.notes.push(backing, repeated);
    const result = applyPhrasePlan([advanced], compilePhrasePlan(source, plan as PhrasePlanV1, HASH))[0]!;
    expect(result.notes.find(n => n.sourceOrigins?.some(o => o.id === backing.sourceOrigins![0]!.id))).toMatchObject({ start: 0, dur: 0.5 });
    expect(result.notes.find(n => n.sourceOrigins?.some(o => o.id === "optional-repeated-key"))).toMatchObject(repeated);
    plan.phrases[0]!.events.find(e => e.sourceOriginId === backing.sourceOrigins![0]!.id)!.allowedTransformations = [];
    expect(() => applyPhrasePlan([advanced], compilePhrasePlan(source, plan as PhrasePlanV1, HASH))).toThrow(/overlapping MIDI/);
  });

  it("addresses distinct repeat occurrences of the same origin independently", () => {
    const { source, plan } = fixture();
    const first = source.notes[0]!, second = source.notes[2]!;
    second.sourceOrigins = [{ id: first.sourceOrigins![0]!.id, occurrence: 2, part: "identity" }];
    plan.phrases[0]!.events[2]!.sourceOriginId = first.sourceOrigins![0]!.id;
    plan.phrases[0]!.events[2]!.sourceOccurrence = 2;
    const variants = run(source, plan);
    for (const variant of variants) for (const expected of [first, second]) {
      const actual = variant.notes.find(n => n.sourceOrigins?.some(o => o.id === expected.sourceOrigins![0]!.id && o.occurrence === expected.sourceOrigins![0]!.occurrence));
      expect(actual).toMatchObject({ midi: expected.midi, start: expected.start });
    }
  });

  it("maps both edges of a source note crossing a tempo change, including a playback override", () => {
    const { source, plan } = fixture(5);
    const note = source.notes[6]!;
    note.start = 7.5; note.dur = 1;
    plan.phrases[0]!.events[6]!.expected.startBeat = note.start;
    plan.phrases[0]!.events[6]!.expected.durationBeats = note.dur;
    source.notes = source.notes.filter(n => n.sourceOrigins![0]!.part === "identity");
    plan.phrases[0]!.events = plan.phrases[0]!.events.filter(e => e.required);
    const variants = buildVariants(source, { ...meta, tempo: 60 }, { arrangementProfile: "source", maxDurBeats: null,
      phrasePlan: plan, sourceSha256: HASH } as any);
    for (const variant of variants) {
      const actual = variant.notes.find(n => n.sourceOrigins?.some(o => o.id === note.sourceOrigins![0]!.id))!;
      expect(actual.start).toBeCloseTo(7.5, 10);
      expect(actual.dur).toBeCloseTo(1.5, 10);
      expect(variant.measures.at(-1)!.endBeat).toBeCloseTo(28, 10);
    }
  });
});
