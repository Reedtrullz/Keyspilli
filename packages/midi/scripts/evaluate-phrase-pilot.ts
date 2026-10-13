/** Fixed authored controls; stdout JSON is evidence, never an acceptance receipt. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { LEVEL_ORDER, buildVariants, parseMidi, parseMusicXmlNotes, sourcePhraseClock,
  suggestPhrasePlan, writeVariantArtifacts, type Note, type ParsedMidi, type PhrasePlanV1, type PhraseRole } from "../src/index.js";

const input = fileURLToPath(new URL("../test/fixtures/phrase-corpus.json", import.meta.url));
const bytes = readFileSync(input);
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const corpus = JSON.parse(bytes.toString("utf8")) as { cases: Array<{ compositionId: string; performanceId: string;
  split: string; role: PhraseRole; source: ParsedMidi; protectedOrigins: string[] }> };
if (process.argv.length > 2) throw new Error("This fixed authored-control evaluator takes no arguments; run with Node --import tsx.");
const same = (a: Note | undefined, b: Note, tolerance = 1e-9) => !!a && a.midi === b.midi && a.hand === b.hand
  && Math.abs(a.start - b.start) <= tolerance && Math.abs(a.start + a.dur - b.start - b.dur) <= tolerance;
const rows = corpus.cases.map(item => {
  const source = item.source;
  const sourceSha256 = sha(JSON.stringify(source));
  const selected = new Set(item.protectedOrigins);
  const identityNotes = source.notes.filter(n => selected.has(n.sourceOrigins![0]!.id));
  const proposal = suggestPhrasePlan(source, { sha256: sourceSha256, compositionId: item.compositionId, performanceId: item.performanceId });
  const proposed = proposal.phrases[0]!.events.filter(e => e.role === "melody");
  const truePositive = proposed.filter(e => selected.has(e.sourceOriginId)).length;
  const plan: PhrasePlanV1 = { ...proposal, levels: [...LEVEL_ORDER], phrases: [{
    id: "declared-identity", occurrenceId: "performance-1", startBeat: 0, endBeat: source.durationBeats,
    evidence: { authority: "self-authored", confidence: 1, basis: "Original synthetic control, authored by the implementation team." },
    events: identityNotes.map((n, i) => ({ id: `protected-${i}`, sourceOriginId: n.sourceOrigins![0]!.id,
      sourceOccurrence: n.sourceOrigins![0]!.occurrence, role: item.role, priority: 100, required: true, allowedTransformations: [],
      expected: { midi: n.midi, startBeat: n.start, durationBeats: n.dur, hand: n.hand } })),
    rests: [{ id: "ending", startBeat: 16, endBeat: 18, scope: "all" }],
  }] };
  // This fixture's independently specified tempo change is 120 -> 60 at beat8.
  // Keep the closed-form reference separate from the production clock mapper.
  const expectedBeat = (beat: number) => item.compositionId === "tempo-pickup" && beat > 8 ? 8 + (beat - 8) * 2 : beat;
  const expected = identityNotes.map(n => ({ ...n, start: expectedBeat(n.start), dur: expectedBeat(n.start + n.dur) - expectedBeat(n.start) }));
  const meta = { title: item.compositionId, artist: "Keyspilli authored controls" };
  const options = { arrangementProfile: "source" as const, normalizeRange: false, maxDurBeats: null };
  const ordinary = buildVariants(source, meta, options);
  const protectedVariants = buildVariants(source, meta, { ...options, phrasePlan: plan, sourceSha256 });
  const tiers = protectedVariants.map((variant, i) => {
    const count = (notes: Note[]) => expected.filter(n => same(notes.find(actual => actual.sourceOrigins?.some(o => o.id === n.sourceOrigins![0]!.id)), n)).length;
    const artifacts = writeVariantArtifacts(variant, meta.title, meta.artist);
    const formats = [["midi", parseMidi(artifacts.midi)], ["musicxml", parseMusicXmlNotes(artifacts.xml)]] as const;
    const roundtrips = formats.map(([format, parsed]) => {
      let retained = 0, maxAttackErrorBeats = 0, maxReleaseErrorBeats = 0;
      for (const n of expected) {
        const actual = parsed.notes.filter(candidate => candidate.midi === n.midi && candidate.hand === n.hand)
          .sort((a, b) => Math.abs(a.start - n.start) - Math.abs(b.start - n.start))[0];
        if (same(actual, n, 1 / 960 + 1e-9)) retained++;
        if (actual) { maxAttackErrorBeats = Math.max(maxAttackErrorBeats, Math.abs(actual.start - n.start));
          maxReleaseErrorBeats = Math.max(maxReleaseErrorBeats, Math.abs(actual.start + actual.dur - n.start - n.dur)); }
      }
      return { format, requiredEvents: expected.length, retained, maxAttackErrorBeats, maxReleaseErrorBeats,
        sha256: sha(format === "midi" ? artifacts.midi : artifacts.xml) };
    });
    return { level: variant.level, requiredEvents: expected.length, ordinaryExactRetention: count(ordinary[i]!.notes),
      protectedExactRetention: count(variant.notes), outputEndBeat: variant.measures.at(-1)!.endBeat, roundtrips };
  });
  return { compositionId: item.compositionId, performanceId: item.performanceId, assignedSplit: item.split,
    declaredIdentityRole: item.role, sourceFixtureSha256: sourceSha256, sourceClock: sourcePhraseClock(source),
    existingMelodySelectorAgainstDeclaredIdentity: { selected: proposed.length, requiredIdentityEvents: selected.size, truePositive,
      precision: proposed.length ? truePositive / proposed.length : null, recall: truePositive / selected.size,
      basis: "Existing melody selector compared with this control's declared identity; not full semantic role accuracy." }, tiers };
});
const tiers = rows.flatMap(row => row.tiers);
const formats = tiers.flatMap(tier => tier.roundtrips);
const sum = <T>(items: T[], value: (item: T) => number) => items.reduce((total, item) => total + value(item), 0);
const report = { schemaVersion: 1, kind: "keyspilli-phrase-pilot-evaluation", corpusSha256: sha(bytes),
  sourceBoundary: "Original authored parsed-note JSON fixtures; real MIDI/XML/MXL intake is covered by separate CLI tests.",
  independence: "Implementer-authored controls, exercised during development. Split labels are organizational; this is not untouched holdout or independent musical acceptance.",
  selectionAccuracy: "not-established", musicalAcceptance: "not-established", rows,
  summary: { compositions: rows.length, tiers: tiers.length, requiredEventComparisons: sum(tiers, t => t.requiredEvents),
    ordinaryExactRetention: sum(tiers, t => t.ordinaryExactRetention), protectedExactRetention: sum(tiers, t => t.protectedExactRetention),
    artifactRoundtrips: formats.length, roundtripComparisons: sum(formats, f => f.requiredEvents), roundtripRetention: sum(formats, f => f.retained),
    proposedIdentityTruePositive: sum(rows, r => r.existingMelodySelectorAgainstDeclaredIdentity.truePositive),
    proposedIdentityCount: sum(rows, r => r.existingMelodySelectorAgainstDeclaredIdentity.selected),
    declaredIdentityCount: sum(rows, r => r.existingMelodySelectorAgainstDeclaredIdentity.requiredIdentityEvents) } };
console.log(JSON.stringify(report, null, 2));
if (report.summary.protectedExactRetention !== report.summary.requiredEventComparisons
  || report.summary.roundtripRetention !== report.summary.roundtripComparisons) process.exitCode = 2;
