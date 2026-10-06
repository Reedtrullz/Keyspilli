import { it, expect } from "vitest";
import {
  exportAntiMusicEvidence,
  ANTI_MUSIC_EVIDENCE_SCHEMA_SHA256,
} from "./anti-music-evidence.js";
import { buildMusicReview } from "./music-review.js";
import { sampleReceipt } from "../../../../packages/catalog/test/music-fixtures.js";
import { identityHash } from "@keyspilli/catalog/src/acoustic-receipt.js";
it("exports generic units pins and conservative origins", () => {
  const r = sampleReceipt();
  const report = buildMusicReview({
    clips: [
      {
        id: "x",
        audio: { ...r.audio, path: "/clip.wav" },
        eventsSha256: null,
        analyzerSha256: identityHash(r.analyzer),
        acoustic: r,
      },
    ],
  });
  const out = exportAntiMusicEvidence(report);
  expect(out.kind).toBe("anti-music-evidence");
  expect(out.clips[0]!.sha256).toBe(r.audio.sha256);
  expect(out.context.sourceAuthority).toBe("unknown");
  expect(JSON.stringify(out)).not.toContain("/clip.wav");
  expect(ANTI_MUSIC_EVIDENCE_SCHEMA_SHA256).toMatch(/^[a-f0-9]{64}$/);
});
it("does not silently drop excess clips", () => {
  const r = sampleReceipt();
  const report = buildMusicReview({
    clips: Array.from({ length: 3 }, (_, i) => ({
      id: "x" + i,
      audio: { ...r.audio, path: "/clip.wav" },
      eventsSha256: null,
      analyzerSha256: null,
    })),
  });
  expect(() => exportAntiMusicEvidence(report)).toThrow();
});
