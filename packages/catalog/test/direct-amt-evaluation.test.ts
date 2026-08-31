import { describe, expect, it } from "vitest";
import {
  canonicalDirectAmtJson,
  classifyDirectAmtSongBottleneck,
  extractDirectAmtWindows,
  evaluateDirectAmtSong,
  hashDirectAmtSource,
  hashDirectAmtWindow,
  normalizeDirectAmtTrackOutputs,
  runDirectAmtWindow,
  scoreDirectAmtWindow,
  summarizeDirectAmtSongTiming,
  timingForDirectAmtWindow,
  type DirectAmtPcmSource,
  type DirectAmtTrackOutputInput,
  type DirectAmtWindowMetadata,
} from "../src/direct-amt-evaluation.js";

const source: DirectAmtPcmSource = {
  bytes: Uint8Array.from({ length: 128 }, (_, index) => index),
  sampleRate: 8,
  channels: 2,
  bytesPerSample: 2,
};

const specs = [
  { id: "late", startSample: 4, endSample: 8 },
  { id: "early", startSample: 0, endSample: 4 },
];

function window(id = "w1", startSample = 0, endSample = 8): DirectAmtWindowMetadata {
  return extractDirectAmtWindows(source, [{ id, startSample, endSample }])[0]!;
}

function track(role: string, notes: DirectAmtTrackOutputInput["notes"]): DirectAmtTrackOutputInput {
  return { id: `${role}-track`, role, notes };
}

describe("direct AMT evaluation harness", () => {
  it("extracts sample-aligned windows and hashes independently of input order", () => {
    const first = extractDirectAmtWindows(source, specs);
    const second = extractDirectAmtWindows(source, [...specs].reverse());

    expect(first.map((item) => item.id)).toEqual(["early", "late"]);
    expect(first).toEqual(second);
    const sourceBytes = source.bytes as Uint8Array;
    expect(first[0]!.bytes).toEqual(Uint8Array.from(sourceBytes.slice(0, 16)));
    expect(first[1]!.bytes).toEqual(Uint8Array.from(sourceBytes.slice(16, 32)));
    expect(hashDirectAmtSource(source.bytes)).toBe(hashDirectAmtSource(Uint8Array.from(sourceBytes)));
    expect(hashDirectAmtWindow(first[0]!.bytes)).toBe(first[0]!.windowSha256);
    expect(first[0]!.sourceSha256).toBe(hashDirectAmtSource(sourceBytes));
    expect(first[0]!.sampleRate).toBe(source.sampleRate);
    expect(first[0]!.channels).toBe(source.channels);
  });

  it("rejects fractional, empty, out-of-range, overlapping-id, and unaligned bounds", () => {
    expect(() => extractDirectAmtWindows(source, [{ id: "fraction", startSample: 0.5, endSample: 2 }])).toThrow(/sample/i);
    expect(() => extractDirectAmtWindows(source, [{ id: "empty", startSample: 2, endSample: 2 }])).toThrow(/bounds/i);
    expect(() => extractDirectAmtWindows(source, [{ id: "outside", startSample: 0, endSample: 33 }])).toThrow(/bounds/i);
    expect(() => extractDirectAmtWindows(source, [
      { id: "duplicate", startSample: 0, endSample: 2 },
      { id: "duplicate", startSample: 2, endSample: 4 },
    ])).toThrow(/duplicate/i);
    expect(() => extractDirectAmtWindows({ ...source, bytes: Uint8Array.from([1]) }, [{ id: "unaligned", startSample: 0, endSample: 1 }])).toThrow(/frame-aligned/i);
  });

  it("keeps canonical evidence independent of timestamps and absolute paths", () => {
    const a = canonicalDirectAmtJson({
      generatedAt: "2026-09-01T10:00:00Z",
      sourcePath: "/Users/reidar/private/reference.wav",
      windows: [{ id: "early", startSample: 0, endSample: 4 }],
    });
    const b = canonicalDirectAmtJson({
      generatedAt: "2026-09-01T10:01:00Z",
      sourcePath: "/tmp/other/reference.wav",
      windows: [{ id: "early", startSample: 0, endSample: 4 }],
    });
    expect(a).toBe(b);
    expect(a).not.toMatch(/Users|private|tmp|generatedAt/);

    const redacted = canonicalDirectAmtJson({
      trace: {
        source: "/Volumes/Work/reference.mid",
        sourcePath: "../../secret/reference.mid",
        sourceStem: "./windows/lead.wav",
      },
    });
    expect(redacted).not.toMatch(/Volumes|secret|windows|reference\.mid|lead\.wav/);
  });

  it("scores each window locally with one-to-one exact, pitch-class, onset, contour, and density metrics", () => {
    const result = scoreDirectAmtWindow({
      window: window("local", 8, 24),
      reference: [track("melody", [
        { pitch: 60, onset: 0 },
        { pitch: 64, onset: 1 },
      ])],
      prediction: [track("melody", [
        { pitch: 60, onset: 0.01 },
        { pitch: 77, onset: 1.01 },
        { pitch: 67, onset: 2 },
      ])],
      onsetToleranceSeconds: 0.05,
    });

    expect(result.referenceNoteCount).toBe(2);
    expect(result.predictedNoteCount).toBe(2);
    expect(result.exact.matches).toBe(1);
    expect(result.pitchClass.matches).toBe(1);
    expect(result.onset.matches).toBe(2);
    expect(result.exact.f1).toBeCloseTo(0.5);
    expect(result.contour.directionAgreement).toBe(1);
    expect(result.unsupportedDensity).toEqual({ count: 0, total: 2, rate: 0 });
  });

  it("chooses a maximum-cardinality one-to-one assignment", () => {
    const result = scoreDirectAmtWindow({
      window: window("cardinality", 0, 8),
      reference: [track("melody", [
        { pitch: 60, onset: 0.10 },
        { pitch: 60, onset: 0.15 },
      ])],
      prediction: [track("melody", [
        { pitch: 60, onset: 0.04 },
        { pitch: 60, onset: 0.14 },
      ])],
      onsetToleranceSeconds: 0.06,
    });

    expect(result.byRole.melody!.exact.matches).toBe(2);
    expect(result.byRole.melody!.onset.matches).toBe(2);
  });

  it("does not match notes across distinct tracks sharing one role", () => {
    const result = scoreDirectAmtWindow({
      window: window("track-identity", 0, 8),
      reference: [
        { id: "guitar-a", role: "guitar", notes: [{ pitch: 60, onset: 0 }] },
        { id: "guitar-b", role: "guitar", notes: [{ pitch: 64, onset: 0 }] },
      ],
      prediction: [
        { id: "guitar-a", role: "guitar", notes: [{ pitch: 64, onset: 0 }] },
        { id: "guitar-b", role: "guitar", notes: [{ pitch: 60, onset: 0 }] },
      ],
    });

    expect(result.byRole.guitar!.exact.matches).toBe(0);
    expect(result.byTrack).toHaveLength(2);
    expect(result.byTrack.every((item) => item.metrics.exact.matches === 0)).toBe(true);
  });

  it("preserves role labels while normalizing deterministic track and note order", () => {
    const tracks = normalizeDirectAmtTrackOutputs([
      track("bass", [{ pitch: 40, onset: 1 }]),
      track("melody", [{ pitch: 64, onset: 0 }, { pitch: 60, onset: 0 }]),
    ]);
    expect(tracks.map((item) => item.role)).toEqual(["bass", "melody"]);
    expect(tracks[1]!.notes.map((note) => note.pitch)).toEqual([60, 64]);
    expect(normalizeDirectAmtTrackOutputs([...tracks].reverse())).toEqual(tracks);
  });

  it("derives stable identities for reordered tracks without explicit ids", () => {
    const tracks = [
      { role: "guitar", notes: [{ pitch: 60, onset: 0 }] },
      { role: "guitar", notes: [{ pitch: 64, onset: 0 }] },
    ];
    const first = normalizeDirectAmtTrackOutputs(tracks);
    const second = normalizeDirectAmtTrackOutputs([...tracks].reverse());
    expect(second).toEqual(first);
    expect(first.map((item) => item.id)).not.toEqual(["track-0", "track-1"]);
  });

  it("does not match notes across different preserved roles", () => {
    const result = scoreDirectAmtWindow({
      window: window("roles", 0, 8),
      reference: [track("melody", [{ pitch: 60, onset: 0 }])],
      prediction: [track("bass", [{ pitch: 60, onset: 0 }])],
    });
    expect(result.exact.matches).toBe(0);
    expect(result.onset.matches).toBe(0);
    expect(result.byRole.melody!.exact.matches).toBe(0);
    expect(result.byRole.bass!.exact.matches).toBe(0);
  });

  it("rejects malformed score windows instead of silently scoring an empty range", () => {
    expect(() => scoreDirectAmtWindow({
      window: { id: "negative", startSeconds: -1, endSeconds: 1, durationSeconds: 2 },
      reference: [],
      prediction: [],
    })).toThrow(/window/i);
    expect(() => scoreDirectAmtWindow({
      window: { id: "reversed", startSeconds: 2, endSeconds: 1, durationSeconds: -1 },
      reference: [],
      prediction: [],
    })).toThrow(/window/i);
  });

  it("does not claim contour agreement when matched attacks do not move", () => {
    const result = scoreDirectAmtWindow({
      window: window("flat-contour"),
      reference: [track("melody", [{ pitch: 60, onset: 0 }, { pitch: 60, onset: 1 }])],
      prediction: [track("melody", [{ pitch: 60, onset: 0 }, { pitch: 60, onset: 1 }])],
    });
    expect(result.contour.directionAgreement).toBeNull();
    expect(result.contour.matchedTransitions).toBe(0);
  });

  it("reports unsupported density without allowing unsupported notes to leak into another window", () => {
    const result = scoreDirectAmtWindow({
      window: window("unsupported", 0, 8),
      reference: [track("melody", [{ pitch: 60, onset: 0 }])],
      prediction: [track("melody", [
        { pitch: 60, onset: 0 },
        { pitch: 200, onset: 0.25 },
        { pitch: 61, onset: 1 },
      ])],
      onsetToleranceSeconds: 0.05,
    });
    expect(result.predictedNoteCount).toBe(2);
    expect(result.unsupportedDensity).toEqual({ count: 1, total: 2, rate: 0.5 });
  });

  it("records MPS-to-CPU fallback provenance and fails closed for malformed and timed-out routes", async () => {
    const calls: string[] = [];
    const fallback = await runDirectAmtWindow({
      songId: "synthetic-song",
      window: window(),
      preferredDevice: "mps",
      runner: async ({ device }) => {
        calls.push(device);
        if (device === "mps") return { status: "unavailable", error: "MPS unavailable" };
        return { status: "available", durationMs: 12, tracks: [track("melody", [{ pitch: 60, onset: 0 }])] };
      },
    });
    expect(calls).toEqual(["mps", "cpu"]);
    expect(fallback.status).toBe("available");
    expect(fallback.selectedDevice).toBe("cpu");
    expect(fallback.fallback?.kind).toBe("mps-to-cpu");
    expect(fallback.tracks[0]!.role).toBe("melody");

    const malformed = await runDirectAmtWindow({
      songId: "synthetic-song",
      window: window(),
      preferredDevice: "cpu",
      runner: async () => ({ status: "available", tracks: [{ role: "melody", notes: "not-notes" }] }),
    });
    expect(malformed.status).toBe("malformed");

    const timedOut = await runDirectAmtWindow({
      songId: "synthetic-song",
      window: window(),
      preferredDevice: "cpu",
      timeoutMs: 5,
      runner: () => new Promise(() => undefined),
    });
    expect(timedOut.status).toBe("timeout");

    const failed = await runDirectAmtWindow({
      songId: "synthetic-song",
      window: window(),
      preferredDevice: "cpu",
      runner: async () => { throw new Error("injected route failure"); },
    });
    expect(failed.status).toBe("failed");
  });

  it("protects extracted window provenance from runner mutation", async () => {
    const evaluation = await evaluateDirectAmtSong({
      songId: "mutation-song",
      source,
      windows: [{ id: "immutable", startSample: 2, endSample: 6 }],
      runner: async ({ window: routedWindow }) => {
        routedWindow.id = "tampered";
        routedWindow.bytes[0] = 255;
        routedWindow.startSample = 999;
        return { status: "available", tracks: [] };
      },
    });
    expect(evaluation.windows[0]!.window).toMatchObject({
      id: "immutable",
      startSample: 2,
      endSample: 6,
      windowSha256: hashDirectAmtWindow(Uint8Array.from(source.bytes as Uint8Array).slice(8, 24)),
    });
  });

  it("validates runtime song and device inputs even when no windows are routed", async () => {
    await expect(evaluateDirectAmtSong({
      songId: "",
      source,
      windows: [],
      runner: async () => ({ status: "available", tracks: [] }),
    })).rejects.toThrow(/songId/i);
    await expect(runDirectAmtWindow({
      songId: "synthetic-song",
      window: window(),
      preferredDevice: "gpu" as never,
      runner: async () => ({ status: "available", tracks: [] }),
    })).rejects.toThrow(/device/i);
  });

  it("classifies the dominant per-song bottleneck from window evidence", () => {
    const classification = classifyDirectAmtSongBottleneck({
      windows: [
        { windowId: "w1", route: { status: "available" }, metrics: { unsupportedDensity: { rate: 0.8 } }, timing: { totalMs: 10 } },
        { windowId: "w2", route: { status: "available" }, metrics: { unsupportedDensity: { rate: 0.7 } }, timing: { totalMs: 11 } },
      ],
    });
    expect(classification.primary).toBe("unsupported-density");
    expect(classification.reasons.length).toBeGreaterThan(0);

    const timeout = classifyDirectAmtSongBottleneck({
      windows: [{ windowId: "w1", route: { status: "timeout" }, metrics: null, timing: { totalMs: null } }],
    });
    expect(timeout.primary).toBe("timeout");
  });

  it("reports deterministic per-window and per-song timing summaries", () => {
    const route = {
      windowId: "timed",
      status: "available" as const,
      requestedDevice: "cpu" as const,
      selectedDevice: "cpu" as const,
      durationMs: 12,
      fallback: null,
    };
    const timing = timingForDirectAmtWindow(route, 3);
    expect(timing.totalMs).toBe(15);
    const summary = summarizeDirectAmtSongTiming([
      { windowId: "timed", route, metrics: null, timing },
      { windowId: "missing", route: { status: "unavailable" }, metrics: null, timing: { totalMs: null } },
    ]);
    expect(summary.windowCount).toBe(2);
    expect(summary.availableWindowCount).toBe(1);
    expect(summary.unavailableWindowCount).toBe(1);
    expect(summary.totalMs).toBe(15);
    expect(summary.p95Ms).toBe(15);
  });

  it("retains sample provenance and fails closed for malformed references", async () => {
    const evaluation = await evaluateDirectAmtSong({
      songId: "synthetic-song",
      source,
      windows: [{ id: "provenance", startSample: 2, endSample: 6 }],
      runner: async () => ({ status: "available", tracks: [] }),
      referenceByWindow: { provenance: { notes: "not-tracks" } },
    });

    expect(evaluation.sourceMetadata).toMatchObject({
      sampleRate: source.sampleRate,
      channels: source.channels,
      bytesPerSample: source.bytesPerSample,
      frameCount: 32,
    });
    expect(evaluation.windows[0]!.window).toMatchObject({
      id: "provenance",
      startSample: 2,
      endSample: 6,
      sampleCount: 4,
      sourceSha256: hashDirectAmtSource(source.bytes),
    });
    expect(evaluation.windows[0]!.window).not.toHaveProperty("bytes");
    expect(evaluation.windows[0]!.metrics).toBeNull();
    expect(evaluation.windows[0]!.referenceError).toMatch(/tracks/i);
    expect(evaluation.bottleneck.categories).toContain("malformed-reference");
  });
});
