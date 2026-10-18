import { describe, expect, it } from "vitest";
import { assertGenerationEvidence, type ExternalEvidenceCandidate } from "../src/external-evidence.js";
import { evaluatePianoCandidates } from "../src/piano-evaluation.js";
import { buildResearchReport, serializeResearchReport } from "../src/research-report.js";

// Worst-case inputs for patterns CodeQL flagged as polynomial ReDoS
// (alerts #3, #4, #5). With the old regular expressions these took seconds;
// they must now finish well inside the budget.
const BUDGET_MS = 1_000;
function timed<T>(run: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = run();
  return { value, ms: performance.now() - started };
}

function evidence(sourceRef: string): ExternalEvidenceCandidate {
  return {
    evidenceClass: "VERIFIED_NATIVE_SYMBOLIC",
    purpose: "GENERATION_CANDIDATE",
    provenance: { sourceRef, provider: "example", acquiredVia: "local-import", acquisition: "local-analysis", physicalPath: "/tmp/example/source.mid" },
    content: { sha256: "a".repeat(64), byteLength: 12, mediaType: "audio/midi" },
    confidence: { source: 0.9, parse: 1, identity: 0.8, alignment: 0.7 },
    roles: [{ role: "melody", confidence: 0.8 }],
    status: "parsed",
    notes: [{ pitch: 60 }],
  };
}

describe("ReDoS regressions", () => {
  it("classifies hostile source references in linear time (alert #3)", () => {
    // A line break after the last "#" stops the trailing `.*`, forcing the old
    // pattern to retry every split of the repeated segment.
    const hostile = `..mid#${"..mid#".repeat(30_000)}\nx`;
    const { ms } = timed(() => {
      expect(() => assertGenerationEvidence(evidence(hostile))).toThrow(/credentials, query, or fragment/);
    });
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("still treats relative media files as physical paths (alert #3)", () => {
    for (const ref of ["song.mid", "dir/song.MIDI", "dir\\song.json?x=1", "a/b.wav#frag/with/slash"]) {
      expect(() => assertGenerationEvidence(evidence(ref)), ref).toThrow(/physical/);
    }
    for (const ref of ["youtube:abc123", "catalog:song/mid", ".mid", "dir/.mid"]) {
      expect(() => assertGenerationEvidence(evidence(ref)), ref).not.toThrow();
    }
  });

  it("normalizes candidate ids with long dash runs in linear time (alert #4)", () => {
    const id = `a${"-".repeat(100_000)}b`;
    const { value, ms } = timed(() => evaluatePianoCandidates({ candidates: [{ id, notes: [], tempoBpm: 120, durationBeats: 2 }] }));
    expect(value.candidates[0]?.id).toMatch(/^a-+b$/);
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it("screens hostile error text in linear time and keeps redacting (alert #5)", () => {
    const hostileErrors = [`http://!:${"!:".repeat(50_000)}`];
    const { value, ms } = timed(() => serializeResearchReport(buildResearchReport({
      song: { title: "Song", artist: "Artist" },
      discoveryErrors: [...hostileErrors, "proxy https://user:pa:ss@example.test/x failed", "failed (cache.json): nope", "plain failure"],
    })));
    expect(ms).toBeLessThan(BUDGET_MS);
    expect(value).not.toMatch(/user:pa|cache\.json/);
    expect(value).toContain("plain failure");
  });
});
