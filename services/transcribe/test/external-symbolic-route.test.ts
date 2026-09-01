import { describe, expect, it } from "vitest";
import { selectTranscriptionRoute, type ExternalSymbolicRouteInput } from "../src/external-symbolic-route.js";

const hash = "a".repeat(64);

function frozenCandidateSet(overrides: Record<string, unknown> = {}) {
  const candidate = Object.freeze({
    evidenceClass: "VERIFIED_NATIVE_SYMBOLIC",
    purpose: "GENERATION_CANDIDATE",
    status: "parsed",
    provenance: Object.freeze({ sourceRef: "synthetic:piano", acquisition: "local-bytes" }),
    content: Object.freeze({ sha256: hash }),
  });
  const entry = Object.freeze({ recordId: "synthetic-record", candidate });
  return Object.freeze({ schemaVersion: 1, digest: hash, selected: Object.freeze([entry]), ...overrides });
}

const notes = Object.freeze([{ midi: 60, start: 0, dur: 1, vel: 90, hand: "R" as const }]);

describe("selectTranscriptionRoute", () => {
  it("keeps the existing audio/metal route when no external input is supplied", () => {
    expect(selectTranscriptionRoute()).toMatchObject({ route: "AUDIO_AMT_FALLBACK" });
    expect(selectTranscriptionRoute().notes).toBeUndefined();
  });

  it("selects external symbolic output only when a frozen candidate set and lineage are present", () => {
    const input: ExternalSymbolicRouteInput = {
      candidateSet: frozenCandidateSet(),
      output: {
        notes,
        sourceLineage: [{ recordId: "synthetic-record", role: "melody", startBeat: 0, endBeat: 1 }],
      },
    };

    expect(selectTranscriptionRoute(input)).toMatchObject({
      route: "EXTERNAL_SYMBOLIC_FIRST",
      selectedRecordIds: ["synthetic-record"],
      notes,
    });
  });

  it("fails closed to the audio fallback for benchmark candidates", () => {
    const set = frozenCandidateSet({
      selected: Object.freeze([Object.freeze({
        recordId: "benchmark-record",
        candidate: Object.freeze({
          evidenceClass: "BENCHMARK_REFERENCE",
          purpose: "BENCHMARK_REFERENCE",
          status: "parsed",
          provenance: Object.freeze({ sourceRef: "synthetic:reference", acquisition: "local-bytes" }),
          content: Object.freeze({ sha256: hash }),
        }),
      })]),
    });
    const result = selectTranscriptionRoute({
      candidateSet: set,
      output: { notes, sourceLineage: [{ recordId: "benchmark-record", role: "melody", startBeat: 0, endBeat: 1 }] },
    });

    expect(result.route).toBe("AUDIO_AMT_FALLBACK");
    expect(result.notes).toBeUndefined();
    expect(result.fallbackReason).toMatch(/benchmark/i);
  });

  it("fails closed when output lineage names a candidate outside the frozen set", () => {
    const result = selectTranscriptionRoute({
      candidateSet: frozenCandidateSet(),
      output: { notes, sourceLineage: [{ recordId: "unfrozen", role: "melody", startBeat: 0, endBeat: 1 }] },
    });

    expect(result.route).toBe("AUDIO_AMT_FALLBACK");
    expect(result.fallbackReason).toMatch(/lineage|frozen/i);
  });

  it("does not accept physical source references or malformed notes", () => {
    const physical = frozenCandidateSet({
      selected: Object.freeze([Object.freeze({
        recordId: "physical",
        candidate: Object.freeze({
          evidenceClass: "VERIFIED_NATIVE_SYMBOLIC",
          purpose: "GENERATION_CANDIDATE",
          status: "parsed",
          provenance: Object.freeze({ sourceRef: "/private/reference.mid", acquisition: "local-bytes" }),
          content: Object.freeze({ sha256: hash }),
        }),
      })]),
    });
    const result = selectTranscriptionRoute({
      candidateSet: physical,
      output: { notes: [{ midi: 128, start: 0, dur: 1, vel: 90 }], sourceLineage: [{ recordId: "physical", role: "melody", startBeat: 0, endBeat: 1 }] },
    });

    expect(result.route).toBe("AUDIO_AMT_FALLBACK");
    expect(result.notes).toBeUndefined();
    expect(result.fallbackReason).toMatch(/source|note|invalid|provenance/i);
  });
});
