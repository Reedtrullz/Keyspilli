import { describe, expect, it } from "vitest";
import type { AudioFilePin, ReviewJob } from "./audio-review.js";
import {
  AUDIO_REVIEW_LIMITS,
  buildAntiListenArgs,
  buildRepairQueue,
  gatewayAudioRouteCatalogContractSha256,
  mapClipFindingToSource,
  parseAntiDryRunStdout,
  parseAntiLiveStdout,
  planResumableJobs,
  validateGatewayAudioRouteCatalog,
  validateListenEnvelope,
  validateReviewManifest,
} from "./audio-review.js";

const pin = (char: string) => char.repeat(64);
const clip = (name: string, startSeconds = 0): AudioFilePin => ({
  path: `/fixture/${name}.wav`,
  sha256: pin("a"),
  bytes: 1_852_244,
  sampleRate: 44_100,
  channels: 1,
  bitsPerSample: 16,
  durationSeconds: 21,
  assetStartSeconds: startSeconds,
});
const modeReplay = (mode: "original" | "chords") => ({
  difficulty: "medium",
  resolvedVariantId: `${mode}-medium-v1`,
  asset: { path: `/fixture/${mode}-full.wav`, sha256: pin(mode === "original" ? "c" : "d"), durationSeconds: 21 },
  replaySnapshot: { path: `/fixture/${mode}-replay.json`, sha256: pin(mode === "original" ? "e" : "f") },
  noteEvents: { path: `/fixture/${mode}.mid`, sha256: pin(mode === "original" ? "1" : "2") },
  tempoMapSha256: pin("3"),
  sustainSha256: pin("4"),
  playbackSettingsSha256: pin("5"),
  renderer: {
    backend: "fluidsynth",
    version: "2.4.0",
    sampleRate: 44_100,
    channels: 1,
    gain: 0.7,
    settingsSha256: pin("6"),
    instrument: { name: "Salamander Grand Piano", bankPath: "/fixture/piano.sf2", bankSha256: pin("7") },
    evidenceClass: "sampled-piano",
  },
  symbolicChecks: {
    exactNotes: { status: "passed", path: `/fixture/${mode}-notes.json`, sha256: pin("8") },
    playability: { status: "not-run", reason: "No independent physical-keyboard evidence" },
  },
});
const job = (mode: "original" | "chords", phraseId = "opening"): ReviewJob => ({
  id: `${mode}-${phraseId}`,
  mode,
  phraseId,
  referenceClip: clip(`reference-${phraseId}`),
  candidateClip: clip(`${mode}-${phraseId}`),
  alignment: {
    status: "verified",
    method: "anchors",
    evidence: { path: `/fixture/${mode}-${phraseId}-alignment.json`, sha256: pin("9") },
    referenceAnchors: [{ assetSeconds: 0, sourceBeat: 0 }, { assetSeconds: 21, sourceBeat: 42 }],
    candidateAnchors: [{ assetSeconds: 0, sourceBeat: 0 }, { assetSeconds: 21, sourceBeat: 42 }],
  },
});
const manifest = () => ({
  schemaVersion: 2,
  kind: "keyspilli-audio-review-manifest",
  source: { path: "/fixture/source.mid", sha256: pin("a"), format: "midi" },
  reference: {
    asset: { path: "/fixture/reference-full.wav", sha256: pin("b"), durationSeconds: 21 },
    identity: { title: "Synthetic piano control", evidence: "Locally generated fixture; not a source recording" },
  },
  phraseInventory: [
    { id: "opening", kind: "opening", startBeat: 0, endBeat: 42 },
    { id: "ending", kind: "ending", startBeat: 42, endBeat: 84 },
  ],
  replays: { original: modeReplay("original"), chords: modeReplay("chords") },
  jobs: [job("original"), job("chords"), job("original", "ending"), job("chords", "ending")],
});
const domainReview = (attachment: "reference" | "candidate" = "candidate") => ({
  summary: "A short advisory observation.",
  uncertainty: "medium",
  findings: [{
    attachment,
    startSeconds: 4,
    endSeconds: 5,
    area: "timing",
    classification: "defect",
    severity: "moderate",
    uncertainty: "medium",
    evidence: "The bass attack arrives after the upper part.",
    proposedRepair: "Check the bass onset against the pinned source events before editing.",
  }],
});
const envelope = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  runStatus: "success",
  mode: "listen",
  model: "gemini-3.1-pro-low",
  metadata: {
    result_quality: "complete",
    requested_model: "gemini-3.1-pro",
    actual_model: "gemini-3.1-pro-low",
    fallback_used: false,
    fallback_chain: ["gemini-3.1-pro"],
    media_coverage: {
      schemaVersion: 1,
      kind: "audio",
      status: "attempted",
      captured_count: 2,
      gateway_attempts: 1,
      audio: [{ index: 1, sha256: pin("a") }, { index: 2, sha256: pin("b") }],
      provider_audio_acceptance: "unverified",
      listening_verification: "not_run",
    },
  },
  output_text: JSON.stringify(domainReview()),
  ...overrides,
});
const listenExpected = (mode: "original" | "chords" = "original") => ({
  model: "gemini-3.1-pro",
  resolvedModel: "gemini-3.1-pro",
  allowedModelIds: ["gemini-3.1-pro", "gemini-3.1-pro-low"],
  mode,
  durations: { reference: 21, candidate: 21 },
  expectedAudioHashes: [pin("a"), pin("b")] as [string, string],
});

describe("Keyspilli pairwise audio review contracts", () => {
  it("accepts a version 2 manifest with resolved playback, sampled renderer, symbolic lane, anchors, and pairwise jobs", () => {
    const result = validateReviewManifest(manifest());
    expect(result.jobs).toHaveLength(4);
    expect(result.replays.original.difficulty).toBe("medium");
    expect(result.replays.original.symbolicChecks.exactNotes.status).toBe("passed");
    expect(result.replays.original.symbolicChecks.playability.status).toBe("not-run");
  });

  it("refuses three-stream and unpinned legacy manifests", () => {
    expect(() => validateReviewManifest({ schemaVersion: 1, segments: [{ reference: {}, original: {}, chords: {} }] })).toThrow(/schemaVersion 2/);
    const bad = manifest() as any;
    delete bad.replays.chords.renderer.instrument.bankSha256;
    expect(() => validateReviewManifest(bad)).toThrow(/renderer|SoundFont|bank/);
  });

  it("requires a sampled piano claim to have an explicit bank identity and settings pin", () => {
    const bad = manifest() as any;
    bad.replays.original.renderer.instrument.bankSha256 = null;
    expect(() => validateReviewManifest(bad)).toThrow(/bank/);
  });

  it("pins source-beat mapping to the selected attachment clock and refuses extrapolation", () => {
    const review = validateListenEnvelope(envelope(), listenExpected());
    const mapped = mapClipFindingToSource(job("original"), review.findings[0]!);
    expect(mapped.sourceBeatStart).toBe(8);
    expect(mapped.sourceBeatEnd).toBe(10);
    expect(mapClipFindingToSource(job("original"), { ...review.findings[0]!, endSeconds: 22 }).sourceBeatEnd).toBeNull();
  });

  it("validates complete Anti envelopes and domain JSON without fabricated AUDIO-token attestations", () => {
    const result = validateListenEnvelope(envelope(), listenExpected());
    expect(result.findings).toHaveLength(1);
    expect(result.listeningAttestation).toBe("unverified");
    expect(() => validateListenEnvelope(envelope({ runStatus: "partial" }), listenExpected())).toThrow(/complete|incomplete/);
    expect(() => validateListenEnvelope(envelope({ mode: "consult" }), listenExpected())).toThrow(/mode/);
    expect(() => validateListenEnvelope(envelope({ metadata: { ...envelope().metadata, result_quality: "partial" } }), listenExpected())).toThrow(/complete|partial/);
    expect(() => validateListenEnvelope(envelope({ model: "another-model" }), listenExpected())).toThrow(/model|route/);
    expect(() => validateListenEnvelope(envelope({ model: "claude-opus-4-6-thinking", metadata: { ...envelope().metadata, actual_model: "claude-opus-4-6-thinking" } }), listenExpected())).toThrow(/model|route|alias/);
    expect(() => validateListenEnvelope(envelope({ metadata: { ...envelope().metadata, fallback_used: true } }), listenExpected())).toThrow(/fallback/);
    expect(() => validateListenEnvelope(envelope({ metadata: { ...envelope().metadata, actual_model: "another-model" } }), listenExpected())).toThrow(/actual|effective|model/);
    expect(() => validateListenEnvelope(envelope({ metadata: { ...envelope().metadata, media_coverage: undefined } }), listenExpected())).toThrow(/media|receipt/);
  });

  it("accepts one complete json fence around the domain review and rejects surrounding text", () => {
    const json = JSON.stringify(domainReview());
    const fenced = `\`\`\`json\n${json}\n\`\`\``;
    expect(validateListenEnvelope(envelope({ output_text: fenced }), listenExpected()).findings).toHaveLength(1);
    expect(() => validateListenEnvelope(envelope({ output_text: `Review:\n${fenced}` }), listenExpected())).toThrow(/JSON|review/i);
    expect(() => validateListenEnvelope(envelope({ output_text: `${fenced}\nextra` }), listenExpected())).toThrow(/JSON|review/i);
    expect(() => validateListenEnvelope(envelope({ output_text: `${fenced}\n\`\`\`json\n${json}\n\`\`\`` }), listenExpected())).toThrow(/JSON|review/i);
  });

  it("requires an ordered two-audio submission receipt with one gateway attempt", () => {
    expect(validateListenEnvelope(envelope(), listenExpected()).findings).toHaveLength(1);
    const media = envelope().metadata.media_coverage;
    expect(() => validateListenEnvelope(envelope({ metadata: { ...envelope().metadata, media_coverage: { ...media, gateway_attempts: 0, status: "not_sent" } } }), listenExpected())).toThrow(/attempt|not.sent/);
    expect(() => validateListenEnvelope(envelope({ metadata: { ...envelope().metadata, media_coverage: { ...media, audio: [...media.audio].reverse() } } }), listenExpected())).toThrow(/order|clip|hash/);
    expect(() => validateListenEnvelope(envelope({ metadata: { ...envelope().metadata, media_coverage: { ...media, captured_count: 1 } } }), listenExpected())).toThrow(/count|clip/);
  });

  it("binds effective model aliases to the selected gateway route and its one-attempt audio contract", () => {
    const catalog = {
      models: [{
        id: "gemini-3.1-pro",
        canonical_id: "gemini-3.1-pro",
        capabilities: {
          canonical_id: "gemini-3.1-pro",
          backend_id: "gemini-3.1-pro-low",
          aliases: ["gemini-3.1-pro-low", "gemini-pro-agent"],
          audio_input: {
            version: 1, format: "pcm_wav", content_type: "antigravity_audio",
            transport_supported: true, backend_acceptance: "unverified",
            requires_probe_opt_in: true, streaming: false, backend_attempt_limit: 1,
            max_files: 2, max_file_bytes: 2_000_000, max_total_bytes: 4_000_000,
            max_duration_seconds: 30,
          },
        },
      }],
    };
    const route = validateGatewayAudioRouteCatalog(catalog, { model: "gemini-3.1-pro", resolvedModel: "gemini-3.1-pro", audioBytes: [1_852_244, 1_852_244], audioDurations: [21, 21] });
    expect(route.allowedModelIds).toContain("gemini-3.1-pro-low");
    expect(route.backendAttemptLimit).toBe(1);
    expect(() => validateGatewayAudioRouteCatalog(catalog, { model: "unrelated-requested-model", resolvedModel: "gemini-3.1-pro", audioBytes: [1_852_244, 1_852_244], audioDurations: [21, 21] })).toThrow(/requested model|explicit model|selected route/i);
    expect(gatewayAudioRouteCatalogContractSha256({ ...catalog, created: 1, models: catalog.models.map(row => ({ ...row, created: 1 })) }))
      .toBe(gatewayAudioRouteCatalogContractSha256({ ...catalog, created: 2, models: catalog.models.map(row => ({ ...row, created: 2 })) }));
    expect(() => validateGatewayAudioRouteCatalog({ models: catalog.models.map(row => ({ ...row, capabilities: { ...row.capabilities, audio_input: { ...row.capabilities.audio_input, backend_attempt_limit: 2 } } })) }, { model: "gemini-3.1-pro", resolvedModel: "gemini-3.1-pro", audioBytes: [1_852_244, 1_852_244], audioDurations: [21, 21] })).toThrow(/single backend attempt/);
  });

  it("rejects malformed, truncated, wrong-mode, or out-of-clip findings", () => {
    expect(() => validateListenEnvelope(envelope({ output_text: "{\"summary\":\"cut off\"" }), listenExpected())).toThrow(/JSON|findings/);
    expect(() => validateListenEnvelope(envelope({ output_text: JSON.stringify({ ...domainReview(), findings: [{ ...domainReview().findings[0]!, attachment: "chords" }] }) }), listenExpected())).toThrow(/attachment/);
    expect(() => validateListenEnvelope(envelope({ output_text: JSON.stringify({ ...domainReview(), findings: [{ ...domainReview().findings[0]!, endSeconds: 22 }] }) }), listenExpected())).toThrow(/timestamp|interval/);
    expect(() => validateListenEnvelope(envelope({ output_text: "" }), listenExpected())).toThrow(/output/);
  });

  it("accepts only one whitespace-bounded live envelope, while dry-run permits its exact appended prompt", () => {
    expect(parseAntiLiveStdout("\n{\"mode\":\"listen\"}\n")).toEqual({ mode: "listen" });
    expect(() => parseAntiLiveStdout("{\"mode\":\"listen\"}\n{\"mode\":\"other\"}")).toThrow(/exactly one|trailing/);
    expect(() => parseAntiLiveStdout("{\"mode\":\"listen\"}garbage")).toThrow(/exactly one|trailing/);
    expect(parseAntiDryRunStdout("{\"mode\":\"listen\"}\n\nPROMPT TEXT\n", "PROMPT TEXT")).toEqual({ mode: "listen" });
    expect(() => parseAntiDryRunStdout("{\"mode\":\"listen\"}\n\n{\"second\":true}", "PROMPT TEXT")).toThrow(/prompt|trailing/);
    expect(() => parseAntiDryRunStdout("{\"mode\":\"listen\"}\n\nPROMPT TEXTsuffix", "PROMPT TEXT")).toThrow(/prompt|trailing/);
  });

  it("builds exactly one bounded explicit Anti listen call for the reference and selected replay", () => {
    const args = buildAntiListenArgs({
      python: "/opt/python/bin/python3",
      antiScript: "/opt/anti/scripts/anti.py",
      baseUrl: "http://127.0.0.1:8080/v1",
      model: "gemini-3.1-pro",
      referenceAudio: "/run/ref.wav",
      candidateAudio: "/run/original.wav",
      promptFile: "/run/prompt.txt",
      dryRun: false,
    });
    expect(args.slice(0, 2)).toEqual(["/opt/anti/scripts/anti.py", "listen"]);
    expect(args).toContain("--probe-unverified-audio");
    expect(args).toContain("--no-pre-read");
    expect(args).toContain("--json");
    expect(args).toContain("--max-calls");
    expect(args[args.indexOf("--max-calls") + 1]).toBe("1");
    expect(args[args.indexOf("--retry") + 1]).toBe("0");
    expect(args[args.indexOf("--fallback-policy") + 1]).toBe("never");
    expect(args[args.indexOf("--max-output-tokens") + 1]).toBe("2048");
    expect(args.filter(value => value === "--audio")).toHaveLength(2);
    expect(args).not.toContain("--dry-run");
    expect(AUDIO_REVIEW_LIMITS).toMatchObject({ maxClipBytes: 2 * 1024 * 1024, maxPairBytes: 4 * 1024 * 1024, maxClipSeconds: 30, maxOutputTokens: 2048, maxProviderCallsPerJob: 1 });
  });

  it("keeps only complete jobs on resume and leaves a submitted job ambiguous instead of replaying it", () => {
    const state = {
      schemaVersion: 1,
      manifestSha256: pin("a"),
      fingerprint: pin("b"),
      maxRequests: 4,
      attemptsUsed: 2,
      jobs: {
        "original-opening": { status: "complete", attempts: 1, envelopeSha256: pin("c") },
        "chords-opening": { status: "submitted", attempts: 1 },
        "original-ending": { status: "planned", attempts: 0 },
        "chords-ending": { status: "planned", attempts: 0 },
      },
    };
    const plan = planResumableJobs(state as any, manifest() as any, pin("a"), 4);
    expect(plan.completed).toEqual(["original-opening"]);
    expect(plan.pending).toEqual(["original-ending", "chords-ending"]);
    expect(plan.ambiguous).toEqual(["chords-opening"]);
    expect(() => planResumableJobs(state as any, manifest() as any, pin("c"), 4)).toThrow(/stale|changed/);
    expect(() => planResumableJobs(state as any, manifest() as any, pin("a"), 1)).toThrow(/budget|attempts/);
  });

  it("builds a phrase-local repair queue but requires separate symbolic confirmation and recheck", () => {
    const review = validateListenEnvelope(envelope(), listenExpected());
    const queue = buildRepairQueue(job("original"), review.findings);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ mode: "original", phraseId: "opening", status: "requires-symbolic-confirmation", sourceBeatStart: 8, sourceBeatEnd: 10 });
    expect(queue[0]!.acceptance).toContain("rerender");
  });
});
