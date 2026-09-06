import { describe, expect, it } from "vitest";
import {
  buildResearchQueries,
  canonicalCandidateKey,
  classifyArrangementCandidate,
  createSongIdentity,
  mergeArrangementCandidates,
  analyzePianoCandidate,
  selectPianoExtractionStrategy,
  rankArrangementCandidates,
  serializeResearchManifest,
  type ArrangementCandidate,
} from "../src/song-research.js";

const identity = createSongIdentity({
  title: "Sabaton - Defence Of Moscow (Official Music Video)",
  artist: "Sabaton",
  sourceYoutubeUrl: "https://youtu.be/9TjXanLjpTU?t=2",
  durationSeconds: 255.792,
});

function candidate(overrides: Partial<ArrangementCandidate> = {}): ArrangementCandidate {
  return {
    id: "candidate-a",
    sourceType: "midi",
    title: "Defence Of Moscow piano transcription",
    url: "https://example.test/defence.mid",
    provenance: { kind: "midi", acquiredVia: "catalog", sourceRef: "example:defence" },
    durationSeconds: 255,
    coverage: { startSeconds: 0, endSeconds: 255, completeness: 1 },
    ...overrides,
  };
}

describe("song research foundation", () => {
  it("classifies piano metadata deterministically and keeps provenance safe", () => {
    const analysis = analyzePianoCandidate(candidate({
      id: "synthesia",
      sourceType: "unknown",
      title: "Sabaton Defence Of Moscow Synthesia piano tutorial",
      url: "https://youtu.be/abc12345678?t=44",
      localPath: "/Users/reidar/private/source.wav",
      provenance: {
        kind: "youtube",
        sourceRef: "youtube:stale000000",
        sourceYoutubeUrl: "https://youtu.be/stale000000",
        sourceArtifactRef: "/Users/reidar/private/source.wav",
      },
    }));
    expect(analysis).toMatchObject({
      candidateId: "synthesia",
      classification: "synthesia",
      strategy: "visual-synthesia-extraction",
      provenance: {
        sourceRef: "youtube:abc12345678",
        sourceYoutubeUrl: "https://www.youtube.com/watch?v=abc12345678",
      },
    });
    expect(JSON.stringify(analysis)).not.toMatch(/Users\/reidar|source\.wav|stale000000/);
    expect(selectPianoExtractionStrategy(analyzePianoCandidate(candidate({ sourceType: "piano-cover-video", title: "Defence Of Moscow solo piano cover" })))).toBe("piano-audio-transcription");
    expect(analyzePianoCandidate(candidate({ title: "Defence Of Moscow piano karaoke vocals" })).classification).toBe("bad-cover");
    expect(analyzePianoCandidate(candidate({ sourceType: "unknown", title: "Defence Of Moscow" })).classification).toBe("ambiguous");
  });
  it("selects an explicit semantic extraction lane for each candidate kind", () => {
    const midi = analyzePianoCandidate(candidate({ id: "existing-midi", sourceType: "midi", title: "Defence Of Moscow arrangement", url: "https://example.test/defence.mid" }));
    expect(midi).toMatchObject({ classification: "solo-piano", strategy: "existing-symbolic-link", usable: true, symbolicCandidateId: "existing-midi", provenance: { extractionStrategy: "existing-symbolic-link" } });
    const audio = analyzePianoCandidate(candidate({ id: "piano-audio", sourceType: "piano-cover-audio", title: "Defence Of Moscow piano cover audio" }));
    expect(audio).toMatchObject({ classification: "solo-piano", strategy: "piano-audio-transcription", usable: true });
    const synthesia = analyzePianoCandidate(candidate({ id: "visual", sourceType: "piano-cover-video", title: "Defence Of Moscow Synthesia Piano Tutorial" }));
    expect(synthesia).toMatchObject({ classification: "synthesia", strategy: "visual-synthesia-extraction", usable: true });
    const tutorial = analyzePianoCandidate(candidate({ id: "tutorial", sourceType: "piano-tutorial-video", title: "Defence Of Moscow piano lesson" }));
    expect(tutorial).toMatchObject({ classification: "tutorial", strategy: "visual-synthesia-extraction", usable: true });
    const drum = analyzePianoCandidate(candidate({ id: "drums", sourceType: "unknown", title: "Defence Of Moscow drum cover" }));
    expect(drum).toMatchObject({ classification: "bad-cover", strategy: "unsupported", usable: false });
    expect(analyzePianoCandidate(candidate({ sourceType: "metal-transcription", title: "Defence Of Moscow direct transcription" }))).toMatchObject({ strategy: "unsupported", usable: false });
    expect(analyzePianoCandidate(candidate({ sourceType: "piano-cover-video", title: "Defence Of Moscow piano cover", url: "https://example.test/download.mid" })).strategy).toBe("piano-audio-transcription");
    expect(selectPianoExtractionStrategy(candidate({ sourceType: "metal-transcription" }))).toBe("unsupported");
  });
  it("does not expose path-like candidate ids in piano analysis", () => {
    const fromLogicalSource = analyzePianoCandidate(candidate({
      id: "/Users/reidar/Downloads/Defence Of Moscow.mid",
      sourceType: "midi",
      localPath: "/Users/reidar/Downloads/Defence Of Moscow.mid",
      provenance: {
        kind: "midi",
        acquiredVia: "upload",
        sourceRef: "midi-pack:defence-of-moscow",
        sourceArtifactRef: "/Users/reidar/Downloads/Defence Of Moscow.mid",
      },
    }));
    expect(fromLogicalSource).toMatchObject({
      candidateId: "midi-pack:defence-of-moscow",
      symbolicCandidateId: "midi-pack:defence-of-moscow",
      strategy: "existing-symbolic-link",
      usable: true,
    });
    expect(JSON.stringify(fromLogicalSource)).not.toMatch(/Users\/reidar|Defence Of Moscow\.mid/);

    const metadataFallback = analyzePianoCandidate(candidate({
      id: "/tmp/opaque/cover.mid",
      sourceType: "midi",
      title: "Defence Of Moscow arrangement",
      url: "https://example.test/download.mid",
      provenance: { kind: "midi", acquiredVia: "catalog" },
    }));
    expect(metadataFallback.candidateId).toBe("midi:defence-of-moscow-arrangement");
    expect(metadataFallback.strategy).toBe("existing-symbolic-link");
    expect(JSON.stringify(metadataFallback)).not.toMatch(/opaque|cover\.mid|example\.test/);
  });
  it("normalizes song identity and canonical YouTube provenance", () => {
    expect(identity).toMatchObject({
      title: "Defence Of Moscow",
      artist: "Sabaton",
      normalizedTitle: "defence of moscow",
      normalizedArtist: "sabaton",
      youtubeVideoId: "9TjXanLjpTU",
      sourceYoutubeUrl: "https://www.youtube.com/watch?v=9TjXanLjpTU",
    });
  });

  it("builds stable, deduplicated query variants", () => {
    expect(buildResearchQueries(identity)).toEqual([
      "Sabaton Defence Of Moscow piano",
      "Sabaton Defence Of Moscow transcription",
      "defence moscow Sabaton piano",
      "Sabaton Defence Of Moscow Synthesia",
      "Sabaton Defence Of Moscow MIDI",
    ]);
    expect(buildResearchQueries(identity)).toEqual(buildResearchQueries({ ...identity }));
  });

  it("classifies piano, tutorial, synthesia and direct fallback candidates", () => {
    expect(classifyArrangementCandidate(candidate({ title: "Defence Of Moscow Synthesia piano tutorial" }), { overrideSourceType: true })).toMatchObject({
      sourceType: "piano-tutorial-video",
      extractionStrategy: "visual-midi",
    });
    expect(classifyArrangementCandidate(candidate({ title: "Defence Of Moscow Synthesia piano tutorial" })).sourceType).toBe("midi");
    expect(classifyArrangementCandidate(candidate({ extractionStrategy: "not-a-strategy" as never })).extractionStrategy).toBe("symbolic");
    expect(classifyArrangementCandidate(candidate({ title: "Defence Of Moscow piano cover performance" }), { overrideSourceType: true }).sourceType).toBe("piano-cover-video");
    expect(classifyArrangementCandidate(candidate({ title: "Defence Of Moscow metal transcription" }), { overrideSourceType: true })).toMatchObject({
      sourceType: "metal-transcription",
      extractionStrategy: "audio-transcription",
      selection: "fallback",
    });
  });

  it("does not infer piano provenance from generic official videos", () => {
    expect(classifyArrangementCandidate(candidate({
      sourceType: "unknown",
      title: "Sabaton Defence Of Moscow (Official Music Video)",
      url: null,
    }), { overrideSourceType: true }).sourceType).toBe("unknown");
    expect(classifyArrangementCandidate(candidate({
      sourceType: "unknown",
      title: "Sabaton Defence Of Moscow piano",
    }), { overrideSourceType: true })).toMatchObject({
      sourceType: "piano-cover-video",
      extractionStrategy: "audio-midi",
    });
  });

  it("does not classify karaoke metadata as a piano cover", () => {
    expect(classifyArrangementCandidate(candidate({
      sourceType: "unknown",
      title: "Sabaton Defence Of Moscow piano karaoke",
      url: null,
    }), { overrideSourceType: true })).toMatchObject({
      sourceType: "unknown",
      extractionStrategy: "none",
    });
  });

  it("ranks with inspectable reasons and keeps direct transcription as fallback", () => {
    const ranked = rankArrangementCandidates(identity, [
      candidate({ id: "direct", sourceType: "metal-transcription", title: "direct AI transcription", confidence: 0.4 }),
      candidate({ id: "piano", sourceType: "piano-cover-video", title: "Sabaton Defence Of Moscow piano cover", confidence: 0.8 }),
      candidate({ id: "partial", title: "Sabaton Defence Of Moscow piano", durationSeconds: 80, coverage: { startSeconds: 0, endSeconds: 80, completeness: 0.3 } }),
    ]);
    expect(ranked[0]?.id).toBe("piano");
    expect(ranked.find((item) => item.id === "direct")!.reasons!.join(" ")).toMatch(/fallback|transcription/i);
    expect(ranked.find((item) => item.id === "partial")!.score!).toBeLessThan(ranked[0]!.score!);
    expect(ranked[0]?.scoreBreakdown).toBeDefined();
  });

  it("matches title and artist tokens at boundaries", () => {
    const ranked = rankArrangementCandidates(identity, [
      candidate({ id: "substring", title: "Defence Of Moscowian piano", provenance: { kind: "midi", acquiredVia: "catalog", sourceRef: "example:substring" } }),
      candidate({ id: "exact", title: "Sabaton Defence Of Moscow piano", provenance: { kind: "midi", acquiredVia: "catalog", sourceRef: "example:exact" } }),
    ]);
    expect(ranked.find((item) => item.id === "exact")!.score!).toBeGreaterThan(ranked.find((item) => item.id === "substring")!.score!);
    expect(ranked.find((item) => item.id === "substring")!.reasons!.join(" ")).toMatch(/title tokens|0\/3|1\/3/i);
  });

  it("matches multi-word artists as a contiguous token sequence", () => {
    const song = createSongIdentity({ title: "The Signal", artist: "The Birthday Massacre" });
    const ranked = rankArrangementCandidates(song, [
      candidate({ id: "contiguous", title: "The Birthday Massacre The Signal piano", provenance: { kind: "midi", acquiredVia: "catalog", sourceRef: "example:contiguous" } }),
      candidate({ id: "fragmented", title: "The Signal Birthday piano", provenance: { kind: "midi", acquiredVia: "catalog", sourceRef: "example:fragmented" } }),
    ]);
    expect(ranked[0]?.id).toBe("contiguous");
    expect(ranked.find((item) => item.id === "contiguous")?.reasons?.join(" ")).toMatch(/artist match/);
    expect(ranked.find((item) => item.id === "fragmented")?.reasons?.join(" ")).toMatch(/artist mismatch/);
  });

  it("merges canonical duplicates and is deterministic for equal ids", () => {
    const one = candidate({ id: "same", url: "https://youtu.be/abc12345678?t=4", title: "Defence Of Moscow piano", confidence: 0.4 });
    const two = candidate({ id: "same", url: "https://www.youtube.com/watch?v=abc12345678", title: "Defence Of Moscow piano cover", confidence: 0.9 });
    const merged = mergeArrangementCandidates([one, two]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "same", url: "https://www.youtube.com/watch?v=abc12345678", confidence: 0.9 });
    expect(mergeArrangementCandidates([one, two])).toEqual(mergeArrangementCandidates([two, one]));
    expect(rankArrangementCandidates(identity, [two, one])).toEqual(rankArrangementCandidates(identity, [one, two]));
  });

  it("normalizes invalid numeric metadata instead of emitting NaN or out-of-range values", () => {
    const invalid = candidate({
      durationSeconds: Number.NaN,
      confidence: 4,
      coverage: { startSeconds: -10, endSeconds: 2, completeness: 4 },
    });
    const normalized = rankArrangementCandidates(identity, [invalid])[0]!;
    expect(normalized.durationSeconds).toBeNull();
    expect(normalized.confidence).toBe(1);
    expect(normalized.coverage).toBeNull();
    expect(JSON.stringify(normalized)).not.toMatch(/NaN|Infinity/);
  });

  it("keeps ranked score fields finite when caller metadata is non-finite", () => {
    const invalid = candidate({
      durationSeconds: Number.POSITIVE_INFINITY,
      confidence: Number.NaN,
      coverage: { startSeconds: Number.NaN, endSeconds: Number.POSITIVE_INFINITY, completeness: Number.NaN },
      score: Number.NaN,
      scoreBreakdown: { stale: Number.POSITIVE_INFINITY },
    });
    const ranked = rankArrangementCandidates({ ...identity, durationSeconds: Number.POSITIVE_INFINITY }, [invalid])[0]!;
    expect(ranked.durationSeconds).toBeNull();
    expect(ranked.confidence).toBeUndefined();
    expect(typeof ranked.score).toBe("number");
    expect(Number.isFinite(ranked.score)).toBe(true);
    expect(Object.values(ranked.scoreBreakdown ?? {}).every((value) => Number.isFinite(value))).toBe(true);
    expect(JSON.stringify(ranked)).not.toMatch(/NaN|Infinity/);
  });

  it("forces direct metal transcription to a safe audio fallback", () => {
    const classified = classifyArrangementCandidate(candidate({
      sourceType: "metal-transcription",
      extractionStrategy: "symbolic",
      selection: "preferred",
      fallbackTier: 0,
    }));
    expect(classified).toMatchObject({
      sourceType: "metal-transcription",
      extractionStrategy: "audio-transcription",
      selection: "fallback",
      fallbackTier: 1,
    });
    expect(classifyArrangementCandidate(candidate({ sourceType: "piano-cover-video", extractionStrategy: "symbolic" })).extractionStrategy).toBe("audio-midi");
    expect(classifyArrangementCandidate(candidate({ sourceType: "midi", extractionStrategy: "visual-midi" })).extractionStrategy).toBe("symbolic");
  });

  it("serializes a stable path-free manifest", () => {
    const manifestCandidates = [
      candidate({ id: "zeta", localPath: "/Users/reidar/Downloads/secret.mid" }),
      candidate({ id: "alpha", localPath: "/tmp/other.mid" }),
    ];
    const manifest = serializeResearchManifest(identity, manifestCandidates);
    expect(manifest).not.toContain("/Users/reidar");
    expect(JSON.parse(manifest)).toMatchObject({ schemaVersion: 1, song: { normalizedTitle: "defence of moscow" } });
    expect(serializeResearchManifest(identity, [...manifestCandidates].reverse())).toBe(manifest);
  });

  it("redacts nested paths, URL userinfo, and credential-like query values", () => {
    const nestedCandidate = {
      ...candidate({
      id: "nested",
      url: "https://user:password@example.test/defence.mid?token=secret&v=abc12345678",
      provenance: {
        kind: "midi",
        acquiredVia: "upload",
        sourceRef: "upload:local",
        sourceArtifactRef: "/Users/reidar/Downloads/private.mid",
        nested: { absolutePath: "/tmp/private.mid", credential: "secret", client_secret: "also-secret" },
      } as never,
      }),
      extra: { arbitrary: "/tmp/hidden" },
    } as ArrangementCandidate;
    const manifest = serializeResearchManifest(identity, [nestedCandidate]);
    expect(manifest).not.toMatch(/password|secret|\/Users\/reidar|\/tmp\/private/);
    expect(manifest).toContain("example.test");
    expect(manifest).toContain("v=abc12345678");
  });

  it("does not serialize relative paths or invalid file URLs", () => {
    const nestedCandidate = {
      ...candidate({
        id: "relative-paths",
        localPath: "./private/defence.mid",
        provenance: {
          kind: "midi",
          acquiredVia: "upload",
          sourceRef: "catalog:defence-of-moscow",
          sourceArtifactRef: "relative/secret.mid",
          nested: {
            path: "cache/secret.mid",
            file: "secret.mid",
            fileUrl: "file:relative/secret.mid",
            safeRef: "catalog:defence-of-moscow",
          },
        } as never,
      }),
      nestedPath: "./nested/secret",
      nestedFile: "secret.mid",
      fileUrl: "file:relative/secret.mid",
      extra: { safeRef: "catalog:defence-of-moscow" },
    } as ArrangementCandidate;
    const manifest = serializeResearchManifest(identity, [nestedCandidate]);
    expect(manifest).not.toMatch(/private|secret|file:/i);
    expect(manifest).toContain("catalog:defence-of-moscow");
  });

  it("uses a canonical candidate YouTube URL over stale provenance", () => {
    const item = candidate({
      id: "youtube-conflict",
      url: "https://www.youtube.com/watch?v=abc12345678",
      provenance: {
        kind: "youtube",
        acquiredVia: "catalog",
        sourceYoutubeUrl: "https://www.youtube.com/watch?v=def12345678",
        sourceRef: "youtube:def12345678",
      },
    });
    expect(mergeArrangementCandidates([item])[0]).toMatchObject({
      url: "https://www.youtube.com/watch?v=abc12345678",
      provenance: {
        sourceYoutubeUrl: "https://www.youtube.com/watch?v=abc12345678",
        sourceRef: "youtube:abc12345678",
      },
    });
    expect(canonicalCandidateKey(item)).toContain("youtube:abc12345678");
  });
});
