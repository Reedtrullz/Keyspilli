import { it, expect } from "vitest";
import { buildMusicReview, type MusicReviewInput } from "./music-review.js";
import { sampleReceipt } from "../../../../packages/catalog/test/music-fixtures.js";
import { identityHash } from "@keyspilli/catalog/src/acoustic-receipt.js";
const input = (): MusicReviewInput => {
  const r = sampleReceipt();
  return {
    clips: [
      {
        id: "clip",
        audio: { ...r.audio, path: "/owned/clip.wav" },
        eventsSha256: null,
        analyzerSha256: identityHash(r.analyzer),
        acoustic: r,
      },
    ],
  };
};
it("no evidence never means approved", () => {
  const v = input();
  delete v.clips[0]!.acoustic;
  const report = buildMusicReview(v);
  expect(report.musicalAcceptance).toBe("not-established");
  expect(report.clips[0]!.channels.acoustic).toBe("not-provided");
  expect(report.providerCalls).toBe(0);
});
it("stale audio and model hashes refuse", () => {
  const v = input();
  v.clips[0]!.audio.sha256 = "0".repeat(64);
  expect(() => buildMusicReview(v)).toThrow();
  v.clips[0]!.audio.sha256 = "a".repeat(64);
  v.clips[0]!.analyzerSha256 = "0".repeat(64);
  expect(() => buildMusicReview(v)).toThrow();
});
it("duplicate clips refuse", () => {
  const v = input();
  v.clips.push(v.clips[0]!);
  expect(() => buildMusicReview(v)).toThrow();
});
it("failed receipts remain separate unavailable channels", () => {
  const v = input();
  v.clips[0]!.acoustic!.status = "failed";
  v.clips[0]!.acoustic!.notes = [];
  expect(buildMusicReview(v).clips[0]!.channels.acoustic).toBe("failed");
});
it("contradictory blind and renderer claims both survive", () => {
  const v = input();
  v.clips[0]!.renderer = {
    schemaVersion: 1,
    kind: "keyspilli-renderer-verification",
    status: "ok",
    audioSha256: "a".repeat(64),
    templateBankSha256: "b".repeat(64),
    origin: "renderer-informed",
    unexpectedPitches: [61],
    missingExpectedPitches: [60],
    matchedPitches: [],
    limitations: ["Shared bank"],
  };
  const report = buildMusicReview(v);
  expect(report.clips[0]!.acoustic!.notes[0]!.midi).toBe(60);
  expect(
    report.clips[0]!.findings.some((f) => f.origin === "renderer-informed"),
  ).toBe(true);
});

it("keeps source replay and resolved playback event identities separate", () => {
 const v=input();v.clips[0]!.eventsSha256="b".repeat(64);v.clips[0]!.replaySha256="c".repeat(64);v.clips[0]!.correspondence={status:"available",sourceSha256:"d".repeat(64),replaySha256:"c".repeat(64),landmarks:[],difficulty:{status:"not-assessed",reason:"unknown tempo"},musicalAcceptance:"not-established",limitations:[]};
 expect(buildMusicReview(v).clips[0]!.channels.source).toBe("available");v.clips[0]!.replaySha256="e".repeat(64);expect(()=>buildMusicReview(v)).toThrow("stale source correspondence");
});

it("exposes source authority and timing without claiming acceptance", () => {
  const v = input();
  v.clips[0]!.eventsSha256 = "b".repeat(64);
  v.clips[0]!.replaySha256 = "c".repeat(64);
  v.clips[0]!.correspondence = { status: "available", sourceSha256: "d".repeat(64), replaySha256: "c".repeat(64), authority: "human-validated", timingKnown: true, landmarks: [], difficulty: { status: "not-assessed", reason: "unknown tempo" }, musicalAcceptance: "not-established", limitations: [] };
  const report = buildMusicReview(v);
  expect(report.clips[0]!.channels.sourceAuthority).toBe("human-validated");
  expect(report.clips[0]!.channels.sourceTimingKnown).toBe(true);
  expect(report.musicalAcceptance).toBe("not-established");
});
