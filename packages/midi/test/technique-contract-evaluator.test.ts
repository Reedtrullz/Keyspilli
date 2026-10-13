import { describe, expect, it } from "vitest";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMidi, parseMusicXmlNotes, writeVariantArtifacts, validateArtifactFiles, type Note, type ParsedMidi, type Variant } from "../src/index.js";
import { checkSourceProtection, correspondPhysicalNotes, type ContractCase, type TierPolicy } from "../scripts/technique-contract-support.js";
import { readFrozenTechniquePacket, TECHNIQUE_CORPUS_MANIFEST_SHA256 } from "../scripts/evaluate-technique-contract.js";

const n = (start = 0, extra: Partial<Note> = {}): Note => ({ midi: 60, start, dur: 1, vel: 88, hand: "R", ...extra });
const variant = (notes: Note[]): Variant => ({ level: "advanced", notes, chords: [], bassPattern: "none", key: "C", tempoBpm: 120,
  timeSig: [4, 4], difficultyScore: 0, measures: [{ index: 0, startBeat: 0, endBeat: 4 }, { index: 1, startBeat: 4, endBeat: 8 }] });
const packet = new URL("./fixtures/technique-contract-v1/", import.meta.url);
const corpus = JSON.parse(readFileSync(new URL("technique-contract-corpus-v1.json", packet), "utf8")) as { cases: ContractCase[] };
const policies = JSON.parse(readFileSync(new URL("technique-contract-policy-v1.json", packet), "utf8")) as { caseTierPolicies: Array<{ caseId: string; tiers: TierPolicy[] }> };

describe("KS-11 evaluator verifies the preimplementation raw-byte freeze", () => {
  it("accounts for all11 sources and66 frozen tier policies before generation", () => {
    const frozen = readFrozenTechniquePacket();
    expect(TECHNIQUE_CORPUS_MANIFEST_SHA256).toBe("7114d50aabd64d706739e1083ca9f9f36e8de7149a307c47739904cfed5bff65");
    expect(frozen.corpus.cases).toHaveLength(11);
    expect(frozen.policy.caseTierPolicies.flatMap(c => c.tiers)).toHaveLength(66);
    expect(frozen.files.size).toBe(24);
  });
  it.each(["changed-source", "changed-plan", "extra-file"])("refuses %s before using it as a source authority", mutation => {
    const directory = mkdtempSync(join(tmpdir(), "ks11-freeze-test-"));
    try {
      cpSync(fileURLToPath(packet), directory, { recursive: true });
      if (mutation === "changed-source") appendFileSync(join(directory, "sources/aperture-open.source.json"), " ");
      if (mutation === "changed-plan") appendFileSync(join(directory, "phrase-plans/aperture-open.plans.json"), " ");
      if (mutation === "extra-file") writeFileSync(join(directory, "unfrozen-reference.json"), "{}\n");
      expect(() => readFrozenTechniquePacket(directory)).toThrow(/Frozen|frozen/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe("KS-11 physical correspondence is separate from source identity", () => {
  it("matches actual exports with a barline tie, a triplet, chords and velocity contrast", () => {
    const v = variant([n(0, { vel: 20 }), n(0, { midi: 64, vel: 100 }), n(3, { midi: 69, dur: 2 }), n(5, { midi: 72, dur: 1 / 3 })]);
    const bytes = writeVariantArtifacts(v, "Original physical controls", "Keyspilli");
    expect(validateArtifactFiles(v, bytes)).toEqual([]);
    for (const [format, notes] of [["midi", parseMidi(bytes.midi).notes], ["musicxml", parseMusicXmlNotes(bytes.xml).notes]] as const) {
      const result = correspondPhysicalNotes(v.notes, notes, format, false);
      expect(result.status).toBe("unambiguous");
      expect(result.pairs).toHaveLength(4);
      expect(new Set(result.pairs.map(p => p.artifactIndex)).size).toBe(4);
      expect(result.sourceIdsEncoded).toBe(false);
    }
  });
  it("uses writer tick quantization, never the nearest available event", () => {
    const expected = [n(0.04, { dur: 0.71 })];
    const quantized = [n(19 / 480, { dur: 0.75 - 19 / 480 })];
    expect(correspondPhysicalNotes(expected, quantized, "midi", false).status).toBe("unambiguous");
    expect(correspondPhysicalNotes(expected, [n(0.04 + 0.002)], "midi", false).status).toBe("refused");
  });
  it("does not infer a unique correspondence for identical physical descriptors", () => {
    const a = n(0, { sourceOrigins: [{ id: "source-a" }] }), b = n(0, { sourceOrigins: [{ id: "source-b" }] });
    const result = correspondPhysicalNotes([a, b], [n(), n()], "musicxml", false);
    expect(result.status).toBe("refused");
    expect(result.issues.join(" ")).toMatch(/ambiguous/i);
  });
  it("never reuses one artifact attack to satisfy two canonical events", () => {
    const result = correspondPhysicalNotes([n(), n(2)], [n()], "midi", false);
    expect(result.status).toBe("refused");
    expect(result.issues.join(" ")).toMatch(/count|missing/i);
  });
  it.each([{ vel: 89 }, { hand: "L" as const }, { midi: 61 }, { dur: 0.999 }, { sourceMidiChannel: 3 }])("refuses a changed descriptor %j", change => {
    expect(correspondPhysicalNotes([n(0, { sourceMidiChannel: 2 })], [n(0, { sourceMidiChannel: 2, ...change })], "musicxml", true).status).toBe("refused");
  });
  it("accepts one physical attack with several source origins without certifying parser origins", () => {
    const result = correspondPhysicalNotes([n(0, { sourceOrigins: [{ id: "authored:1" }, { id: "authored:2" }] })],
      [n(0, { sourceOrigins: [{ id: "xml:P1:0" }] })], "musicxml", false);
    expect(result.status).toBe("unambiguous");
    expect(result.pairs).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("authored:");
  });
  it("a broken selected tie fails physical multiplicity even though the general parser returns notes", () => {
    const v = variant([n(3, { midi: 69, dur: 2 })]);
    const bytes = writeVariantArtifacts(v, "Tie control", "Keyspilli");
    expect(correspondPhysicalNotes(v.notes, parseMusicXmlNotes(bytes.xml).notes, "musicxml", false).status).toBe("unambiguous");
    const broken = bytes.xml.replace(/<(?:tie|tied)\b[^>]*\/>/g, "");
    expect(parseMusicXmlNotes(broken).notes).toHaveLength(2);
    expect(correspondPhysicalNotes(v.notes, parseMusicXmlNotes(broken).notes, "musicxml", false).status).toBe("refused");
  });
  it("refuses an unbounded workload before allocating correspondence relations", () => {
    expect(correspondPhysicalNotes(Array.from({ length: 4097 }, () => n()), [], "midi", false).issues.join(" ")).toMatch(/limit|workload/i);
  });
});

describe("KS-11 source obligations use source IDs and a once-integrated clock", () => {
  function fixture(id: string) {
    const item = corpus.cases.find(c => c.caseId === id)!;
    const policy = policies.caseTierPolicies.find(c => c.caseId === id)!.tiers.find(t => t.tier === "advanced")!;
    const source = JSON.parse(readFileSync(new URL(item.sourceFile.path, packet), "utf8")) as ParsedMidi;
    const v = { ...variant(structuredClone(source.notes)), measures: source.notationMeasures! };
    return { item, policy, source, v };
  }
  it("retains all source occurrences of a compatible unison and checks exact rests/endings", () => {
    const { item, policy, source, v } = fixture("prism-barline");
    const result = checkSourceProtection(item, policy, source, v);
    expect(result.status).toBe("preserved");
    expect(result.requiredOriginOccurrences).toHaveLength(policy.requiredSourceOriginOccurrenceCount);
    expect(result.requiredEvents).toHaveLength(policy.requiredPhysicalEventCount);
    expect(result.rests.map(r => r.phrasePlanId)).toEqual(policy.requiredRestIds.map(id => `${item.caseId}:${id}`));
    const loss = structuredClone(v);
    const unison = loss.notes.find(note => (note.sourceOrigins?.length ?? 0) === 2)!;
    unison.sourceOrigins!.pop();
    expect(checkSourceProtection(item, policy, source, loss).status).toBe("refused");
  });
  it("does not replace a missing required source occurrence with equal musical notes", () => {
    const { item, policy, source, v } = fixture("aperture-open");
    v.notes[0]!.sourceOrigins = [{ id: "unrelated" }];
    expect(checkSourceProtection(item, policy, source, v).status).toBe("refused");
  });
  it("keeps unknown source hands distinct from declared output assumptions", () => {
    const { item, policy, source, v } = fixture("unnamed-hands");
    v.notes = v.notes.map(note => ({ ...note, hand: note.hand ?? "R" }));
    const result = checkSourceProtection(item, policy, source, v);
    expect(result.status).toBe("preserved");
    expect(result.generatedHandAuthority).toBe("arrangement-assumption");
  });
  it("checks native time across the tempo change exactly once", () => {
    const { item, policy, source, v } = fixture("changing-hourglass");
    const beat = (b: number) => b <= 4 ? b : 4 + (b - 4) * 2;
    v.notes = v.notes.map(note => ({ ...note, start: beat(note.start), dur: beat(note.start + note.dur) - beat(note.start) }));
    v.measures = v.measures.map(m => ({ ...m, startBeat: beat(m.startBeat), endBeat: beat(m.endBeat) }));
    expect(checkSourceProtection(item, policy, source, v).status).toBe("preserved");
    const doubled = structuredClone(v);
    doubled.notes = doubled.notes.map(note => ({ ...note, start: beat(note.start), dur: beat(note.start + note.dur) - beat(note.start) }));
    expect(checkSourceProtection(item, policy, source, doubled).status).toBe("refused");
  });
  it("retains an intrusion into a frozen rest as a source-protection failure", () => {
    const { item, policy, source, v } = fixture("aperture-open");
    v.notes.push(n(9, { midi: 82, sourceOrigins: [{ id: "observed-extra" }] }));
    expect(checkSourceProtection(item, policy, source, v).status).toBe("refused");
  });
  it("does not qualify a reduction that omitted the frozen source CC64 timeline", () => {
    const { item, policy, source, v } = fixture("pedal-envelope");
    v.sourcePedal = structuredClone(source.sourcePedal!);
    expect(checkSourceProtection(item, policy, source, v).status).toBe("preserved");
    delete v.sourcePedal;
    expect(checkSourceProtection(item, policy, source, v).status).toBe("refused");
  });
  it("requires exact channel correspondence for the declared source CC64", () => {
    const { item, policy, source, v } = fixture("pedal-envelope");
    v.sourcePedal = structuredClone(source.sourcePedal!);
    v.notes[0]!.sourceMidiChannel = 1;
    expect(checkSourceProtection(item, policy, source, v).status).toBe("refused");
  });
});
