import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyzeTechnique, TECHNIQUE_DIAGNOSTIC_LIMITS, type TechniqueInput, type TechniqueReport } from "../src/technique-diagnostics.js";
import type { Hand, ParsedMidi } from "../src/types.js";

const directory = new URL("./fixtures/technique-contract-v1/", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, directory), "utf8"));
interface Declaration { caseId: string; eventDeclarations: { eventId: string; sourceOriginIds: string[] }[] }
const corpus = read("technique-contract-corpus-v1.json") as { cases: Declaration[] };
type Quantity = { number: number } | null;
type Instant = { sourceBeat: Quantity; nativeSeconds: Quantity };
type Interval = { sourceBeats: Quantity; nativeSeconds: Quantity };
interface Reference {
  events?: { eventId: string; midi: number; sourceHand: Hand | null; attack: Instant; physicalRelease: Instant; physicalDuration: Interval }[];
  heldAtAttack?: { hand: Hand; newAttackEventIds: string[]; expectedCarriedPhysicalEventIds: string[]; expectedReleasedExactlyAtAttackEventIds: string[]; unknownHandRelevantEventIds: string[] }[];
  registerTransitions?: { priorGroupEventIds: string[]; nextGroupEventIds: string[]; priorPitchRange: number[]; nextPitchRange: number[]; signedSemitoneDisplacement: number; onsetInterval: Interval; priorGroupLatestPhysicalRelease: Instant; releaseToNextAttack: Interval }[];
  sameKeyRecurrences?: { priorEventId: string; nextEventId: string; hand: Hand; midi: number; onsetInterval: Interval; priorPhysicalRelease: Instant; releaseToNextAttack: Interval }[];
}
const references = read("technique-contract-reference-v1.json") as { cases: Record<string, Reference> };
const ids = (values: readonly string[]) => [...values].sort();
function inputFor(caseId: string): TechniqueInput {
  const source = read(`sources/${caseId}.source.json`) as ParsedMidi;
  const declarations = corpus.cases.find(c => c.caseId === caseId)!.eventDeclarations;
  return {
    events: source.notes.map(note => {
      const origins = JSON.stringify(ids(note.sourceOrigins!.map(o => o.id)));
      const matches = declarations.filter(d => JSON.stringify(ids(d.sourceOriginIds)) === origins);
      if (matches.length !== 1) throw new Error("Fixture physical identity is not unique");
      return { eventId: matches[0]!.eventId, note };
    }),
    clock: { data: source, authority: caseId === "clock-unknown" ? "unknown" : "declared", timebase: "source-quarter-beats" },
    handAuthority: "source-declared",
    pedal: source.sourcePedal ? { authority: "declared", timeline: source.sourcePedal } : { authority: "none" },
  };
}
function reported(input: TechniqueInput): TechniqueReport {
  const result = analyzeTechnique(input);
  expect(result.status, result.status === "refused" ? result.reason : undefined).toBe("reported");
  if (result.status !== "reported") throw new Error(result.reason);
  return result;
}
function numeric(actual: number | null, expected: Quantity) {
  if (expected === null) expect(actual).toBeNull();
  else expect(actual).toBeCloseTo(expected.number, 9);
}
function observationInterval(actual: { beats: number; nativeSeconds: number | null }, expected: Interval) {
  numeric(actual.beats, expected.sourceBeats); numeric(actual.nativeSeconds, expected.nativeSeconds);
}
const event = (eventId: string, midi: number, start: number, dur: number, hand?: Hand) => ({ eventId, note: { midi, start, dur, hand, vel: 80 } });
function direct(events: TechniqueInput["events"]): TechniqueInput {
  return { events, clock: { data: { division: 960, tempoBpm: 120, tempoMetaPresent: true }, authority: "declared", timebase: "source-quarter-beats" }, handAuthority: "source-declared", pedal: { authority: "none" } };
}

describe("independently frozen technique observations", () => {
  it.each(Object.keys(references.cases).filter(id => id !== "clock-malformed"))("matches authored event, carry, release and recurrence witnesses: %s", caseId => {
    const report = reported(inputFor(caseId));
    const reference = references.cases[caseId]!;
    for (const expected of reference.events ?? []) {
      const actual = report.events.find(e => e.eventId === expected.eventId);
      expect(actual).toMatchObject({ midi: expected.midi, hand: expected.sourceHand });
      numeric(actual!.attack.beat, expected.attack.sourceBeat); numeric(actual!.attack.nativeSeconds, expected.attack.nativeSeconds);
      numeric(actual!.physicalRelease.beat, expected.physicalRelease.sourceBeat); numeric(actual!.physicalRelease.nativeSeconds, expected.physicalRelease.nativeSeconds);
      observationInterval(actual!.physicalDuration, expected.physicalDuration);
    }
    for (const expected of reference.heldAtAttack ?? []) {
      const actual = report.heldAtAttack.find(a => a.hand === expected.hand && JSON.stringify(ids(a.newEventIds)) === JSON.stringify(ids(expected.newAttackEventIds)));
      expect(actual).toBeDefined();
      expect(ids(actual!.carriedEventIds)).toEqual(ids(expected.expectedCarriedPhysicalEventIds));
      expect(ids(actual!.releasedAtAttackEventIds)).toEqual(ids(expected.expectedReleasedExactlyAtAttackEventIds));
      expect(ids(actual!.unknownHandCarriedEventIds)).toEqual(ids(expected.unknownHandRelevantEventIds));
    }
    for (const expected of reference.registerTransitions ?? []) {
      const actual = report.registerTransitions.find(t => JSON.stringify(ids(t.priorEventIds)) === JSON.stringify(ids(expected.priorGroupEventIds)) && JSON.stringify(ids(t.nextEventIds)) === JSON.stringify(ids(expected.nextGroupEventIds)));
      expect(actual).toBeDefined();
      expect(actual!.priorPitchRange).toEqual(expected.priorPitchRange); expect(actual!.nextPitchRange).toEqual(expected.nextPitchRange);
      expect(actual!.signedSemitoneDisplacement).toBe(expected.signedSemitoneDisplacement);
      observationInterval(actual!.onsetInterval, expected.onsetInterval); observationInterval(actual!.releaseToNextAttack, expected.releaseToNextAttack);
      numeric(actual!.priorGroupLatestPhysicalRelease.beat, expected.priorGroupLatestPhysicalRelease.sourceBeat);
      numeric(actual!.priorGroupLatestPhysicalRelease.nativeSeconds, expected.priorGroupLatestPhysicalRelease.nativeSeconds);
    }
    for (const expected of reference.sameKeyRecurrences ?? []) {
      const actual = report.sameKeyRecurrences.find(t => t.priorEventId === expected.priorEventId && t.nextEventId === expected.nextEventId);
      expect(actual).toMatchObject({ hand: expected.hand, midi: expected.midi, sameHand: "declared" });
      observationInterval(actual!.onsetInterval, expected.onsetInterval); observationInterval(actual!.releaseToNextAttack, expected.releaseToNextAttack);
      numeric(actual!.priorPhysicalRelease.beat, expected.priorPhysicalRelease.sourceBeat);
    }
  });

  it("keeps the aperture onset gap equal while the physical release gap changes sign", () => {
    const open = reported(inputFor("aperture-open")).registerTransitions[0]!;
    const held = reported(inputFor("aperture-held")).registerTransitions[0]!;
    expect(open).toMatchObject({ signedSemitoneDisplacement: 19, onsetInterval: { beats: 4, nativeSeconds: 2 }, releaseToNextAttack: { beats: 3.5, nativeSeconds: 1.75 } });
    expect(held).toMatchObject({ signedSemitoneDisplacement: 19, onsetInterval: { beats: 4, nativeSeconds: 2 }, releaseToNextAttack: { beats: -0.5, nativeSeconds: -0.25 } });
  });

  it("retains one physical compatible unison and one tied attack, with every source occurrence", () => {
    const report = reported(inputFor("prism-barline"));
    const unison = report.events.find(e => e.eventId.endsWith(":unison60:attack"));
    expect(unison?.sourceOrigins).toHaveLength(2);
    expect(report.events.filter(e => e.attack.beat === 0)).toHaveLength(4);
    expect(report.events.filter(e => e.attack.beat === 0).reduce((n, e) => n + e.sourceOrigins.length, 0)).toBe(5);
    expect(report.events.filter(e => e.attack.beat === 4)).toHaveLength(0);
    expect(report.sameKeyRecurrences.some(e => e.nextEventId.includes("tie") && e.onsetInterval.beats === 1)).toBe(false);
  });

  it("rescales native elapsed time once without changing physical event identities or beats", () => {
    const input = inputFor("changing-hourglass");
    const normal = reported(input); const slow = reported({ ...input, speedMultiplier: 0.5 });
    const selected = (report: TechniqueReport) => report.registerTransitions.find(t => t.priorEventIds.length === 1 && t.priorEventIds[0] === "ks11-v1:changing-hourglass:tempo-hold60:attack"
      && t.nextEventIds.length === 1 && t.nextEventIds[0] === "ks11-v1:changing-hourglass:after-change79:attack");
    expect(selected(normal)).toMatchObject({ onsetInterval: { beats: 4, nativeSeconds: 3, playbackSeconds: 3 }, releaseToNextAttack: { beats: -1, nativeSeconds: -1, playbackSeconds: -1 } });
    expect(selected(slow)).toMatchObject({ onsetInterval: { beats: 4, nativeSeconds: 3, playbackSeconds: 6 }, releaseToNextAttack: { beats: -1, nativeSeconds: -1, playbackSeconds: -2 } });
    expect(slow.events.map(e => [e.eventId, e.midi, e.attack.beat, e.physicalRelease.beat])).toEqual(normal.events.map(e => [e.eventId, e.midi, e.attack.beat, e.physicalRelease.beat]));
  });

  it("uses a declared constant arrangement clock without reintegrating the source tempo map", () => {
    const input = direct([event("held", 60, 2, 8, "R"), event("high", 79, 8, 1, "R")]);
    input.clock.timebase = "arrangement-quarter-beats"; input.handAuthority = "arrangement-assumption";
    expect(reported(input)).toMatchObject({ handAuthority: "arrangement-assumption", registerTransitions: [{ onsetInterval: { nativeSeconds: 3 }, releaseToNextAttack: { nativeSeconds: -1 } }] });
    input.clock.data.tempoEvents = [{ tick: 0, beat: 0, microsecondsPerQuarter: 500000, bpm: 120 }, { tick: 3840, beat: 4, microsecondsPerQuarter: 1000000, bpm: 60 }];
    expect(analyzeTechnique(input)).toMatchObject({ status: "refused", code: "invalid-clock" });
  });

  it("keeps pedal eligibility separate from released physical keys and respects channel/up boundaries", () => {
    const report = reported(inputFor("pedal-envelope"));
    const atTwo = report.heldAtAttack.find(a => a.hand === "R" && a.attack.beat === 2)!;
    expect(atTwo).toMatchObject({ carriedEventIds: [], pedalOnlyEventIds: ["ks11-v1:pedal-envelope:released60:attack"] });
    expect(report.events.find(e => e.eventId.includes(":unpedalled-left48:"))?.cc64EligibleUntil?.beat).toBe(2.75);
    expect(report.heldAtAttack.find(a => a.hand === "R" && a.attack.beat === 4)?.pedalOnlyEventIds).toEqual([]);
  });

  it("keeps unknown-hand carry and global same-key recurrence unqualified", () => {
    const report = reported(inputFor("unnamed-hands"));
    expect(report.heldAtAttack.find(a => a.hand === "R" && a.attack.beat === 2)).toMatchObject({ carriedEventIds: [], unknownHandCarriedEventIds: ["ks11-v1:unnamed-hands:unassigned66-a:attack"], handQualification: "unknown-hand-predecessors" });
    expect(report.sameKeyRecurrences.find(r => r.midi === 66)).toMatchObject({ hand: null, sameHand: "unknown", onsetInterval: { beats: 4, nativeSeconds: 2 }, releaseToNextAttack: { beats: 1, nativeSeconds: 0.5 } });
    const input = direct([event("a", 60, 0, 0.5, "R"), event("u", 60, 1, 0.5), event("b", 60, 2, 0.5, "R")]);
    expect(reported(input).sameKeyRecurrences.find(r => r.priorEventId === "a" && r.nextEventId === "b")).toMatchObject({ sameHand: "declared", adjacency: "unknown-hand-intervening", unknownHandInterveningEventIds: ["u"] });
  });

  it("is invariant under event and compatible-origin shuffles without mutating input", () => {
    const input = inputFor("prism-barline"); const before = JSON.stringify(input);
    const expected = reported(input);
    const shuffled = { ...input, events: [...input.events].reverse().map(e => ({ ...e, note: { ...e.note, sourceOrigins: [...e.note.sourceOrigins!].reverse() } })) };
    expect(reported(shuffled)).toEqual(expected); expect(JSON.stringify(input)).toBe(before);
  });

  it("groups from the first unused onset without transitive chaining and retains actual onsets", () => {
    const input = direct([event("z", 67, 0, 1, "R"), event("a", 60, 1e-9, 1, "R"), event("m", 72, 2e-9, 1, "R")]);
    const report = reported(input);
    expect(report.heldAtAttack.map(g => g.newEventIds)).toEqual([["a", "z"], ["m"]]);
    expect(report.events.find(e => e.eventId === "a")?.attack.beat).toBe(1e-9);
    expect(report.heldAtAttack[1]?.carriedEventIds).toEqual(["a", "z"]);
  });

  it("renders each onset group in pitch/ID order while retaining individual event times", () => {
    const report = reported(direct([event("z", 67, 0, 1, "R"), event("a", 60, 1e-9, 1, "R"), event("m", 72, 2e-9, 1, "R")]));
    expect(report.events.map(e => e.eventId)).toEqual(["a", "z", "m"]);
    expect(report.events.map(e => e.attack.beat)).toEqual([1e-9, 0, 2e-9]);
  });

  it("separates older carried keys from the complete immediately prior release anchor", () => {
    const report = reported(direct([event("older", 60, 0, 10, "R"), event("short", 64, 1, 0.5, "R"), event("next", 79, 2, 0.5, "R")]));
    expect(report.heldAtAttack[2]?.carriedEventIds).toEqual(["older"]);
    expect(report.registerTransitions[1]).toMatchObject({ priorEventIds: ["short"], priorGroupLatestPhysicalRelease: { beat: 1.5 }, releaseToNextAttack: { beats: 0.5 } });
  });
});

describe("diagnostic refusals and finite work", () => {
  it("requires a physical attack velocity from 1 through 127", () => {
    const input = direct([event("a", 60, 0, 1, "R")]);
    input.events[0]!.note.vel = 0;
    expect(analyzeTechnique(input)).toMatchObject({ status: "refused", code: "invalid-input" });
    for (const velocity of [1, 127]) {
      input.events[0]!.note.vel = velocity;
      expect(reported(input).events[0]?.velocity).toBe(velocity);
    }
  });

  it("does not assign seconds to an undeclared numeric120 placeholder", () => {
    const input = direct([event("a", 60, 0, 1, "R"), event("b", 72, 2, 1, "R")]);
    input.clock.data.tempoMetaPresent = false;
    expect(reported(input)).toMatchObject({ clock: { status: "unknown" }, registerTransitions: [{ onsetInterval: { beats: 2, nativeSeconds: null }, releaseToNextAttack: { beats: 1, nativeSeconds: null } }] });
    input.handAuthority = "unknown";
    expect(reported(input).events.map(e => e.hand)).toEqual([null, null]);
  });

  it.each(["declared", "unknown"] as const)("refuses malformed explicit tempo even under %s authority", authority => {
    const input = inputFor("clock-malformed"); input.clock.authority = authority;
    expect(analyzeTechnique(input)).toMatchObject({ status: "refused", code: "invalid-clock" });
  });

  it("refuses out-of-order, inconsistent, null and nonfinite clock declarations", () => {
    const base = direct([event("a", 60, 0, 1, "R")]);
    for (const data of [null, { ...base.clock.data, tempoEvents: null }, { ...base.clock.data, division: 0 }, { ...base.clock.data, tempoBpm: NaN }, { ...base.clock.data, tempoEvents: [{ tick: 960, beat: 0, bpm: 120, microsecondsPerQuarter: 500000 }] }, { ...base.clock.data, tempoEvents: [{ tick: 960, beat: 1, bpm: 120, microsecondsPerQuarter: 500000 }, { tick: 0, beat: 0, bpm: 120, microsecondsPerQuarter: 500000 }] }]) {
      expect(analyzeTechnique({ ...base, clock: { ...base.clock, data } } as TechniqueInput)).toMatchObject({ status: "refused", code: "invalid-clock" });
    }
  });

  it("refuses simultaneous independent same-key multiplicity without selecting an input-order winner", () => {
    const input = direct([event("a", 60, 0, 1, "R"), event("b", 60, 0, 2, "R")]);
    expect(analyzeTechnique(input)).toMatchObject({ status: "refused", code: "ambiguous-same-key-onset" });
    expect(analyzeTechnique({ ...input, events: [...input.events].reverse() })).toEqual(analyzeTechnique(input));
  });

  it("refuses malformed notes, duplicate identities, nonfinite releases and invalid scenarios", () => {
    const base = direct([event("a", 60, 0, 1, "R")]);
    const variants: unknown[] = [null, { ...base, events: null }, { ...base, events: [null] }, { ...base, events: [base.events[0], base.events[0]] }, ...[NaN, Infinity, -1, 0].map(dur => ({ ...base, events: [event("a", 60, 0, dur, "R")] })), { ...base, events: [event("a", 60, Number.MAX_VALUE, Number.MAX_VALUE, "R")] }, ...[0, -1, NaN, Infinity].map(speedMultiplier => ({ ...base, speedMultiplier })), { ...base, events: [{ ...base.events[0], note: { ...base.events[0]!.note, sourceOrigins: [{ id: "x" }, { id: "x" }] } }] }];
    for (const input of variants) expect(analyzeTechnique(input as TechniqueInput)).toMatchObject({ status: "refused", code: "invalid-input" });
  });

  it("refuses malformed controller declarations instead of extending physical key duration", () => {
    const input = inputFor("pedal-envelope");
    input.pedal.timeline!.changes[0]!.value = NaN;
    expect(analyzeTechnique(input)).toMatchObject({ status: "refused", code: "invalid-pedal" });
  });

  it.each(["null speed", "nonnumeric attack"])("refuses %s before performing arithmetic", category => {
    const base = direct([event("a", 60, 0, 1, "R")]);
    const input: unknown = category === "null speed" ? { ...base, speedMultiplier: null } : { ...base, events: [{ eventId: "a", note: { ...base.events[0]!.note, start: Symbol("beat") } }] };
    expect(() => analyzeTechnique(input as TechniqueInput)).not.toThrow();
    expect(analyzeTechnique(input as TechniqueInput)).toMatchObject({ status: "refused", code: "invalid-input" });
  });

  it("accepts the event-count boundary and refuses one event beyond it", () => {
    const input = direct(Array.from({ length: TECHNIQUE_DIAGNOSTIC_LIMITS.maxEvents }, (_, i) => event(`event-${i}`, 60, i * 2, 0.5, "R")));
    expect(reported(input).events).toHaveLength(TECHNIQUE_DIAGNOSTIC_LIMITS.maxEvents);
    expect(analyzeTechnique({ ...input, events: [...input.events, event("one-too-many", 61, 9000, 1, "R")] })).toMatchObject({ status: "refused", code: "workload-limit" });
  });

  it("bounds tempo mapping work before conversion and materialized carried relationships before success", () => {
    const input = direct(Array.from({ length: 1000 }, (_, i) => event(`event-${i}`, 60 + i % 12, i, 2000, "R")));
    expect(analyzeTechnique(input)).toMatchObject({ status: "refused", code: "workload-limit" });
    input.events = input.events.slice(0, 600);
    input.clock.data.tempoEvents = Array.from({ length: 1000 }, (_, i) => ({ tick: i * 960, beat: i, bpm: 120, microsecondsPerQuarter: 500000 }));
    expect(analyzeTechnique(input)).toMatchObject({ status: "refused", code: "workload-limit" });
  });

  it("accepts exactly one million clock-point/tempo combinations and refuses the next note", () => {
    const input = direct(Array.from({ length: 500 }, (_, i) => event(`event-${i}`, 60, i * 2, 0.5, "R")));
    input.clock.data.tempoEvents = Array.from({ length: 1000 }, (_, i) => ({ tick: i * 960, beat: i, bpm: 120, microsecondsPerQuarter: 500000 }));
    expect(reported(input).events).toHaveLength(500);
    expect(analyzeTechnique({ ...input, events: [...input.events, event("next", 60, 1000, 0.5, "R")] })).toMatchObject({ status: "refused", code: "workload-limit" });
  });

  it("accepts dense carried relations below the cap and refuses the next attack without truncation", () => {
    const input = direct(Array.from({ length: 441 }, (_, i) => event(`event-${i}`, 60, i, 2000, "R")));
    const report = reported(input);
    expect(report.counts.materializedRelations).toBe(99661);
    expect(report.heldAtAttack[440]?.carriedEventIds).toHaveLength(440);
    const refused = analyzeTechnique({ ...input, events: [...input.events, event("next", 60, 441, 2000, "R")] });
    expect(refused).toMatchObject({ status: "refused", code: "workload-limit" });
    expect(refused).not.toHaveProperty("events");
  });
});
