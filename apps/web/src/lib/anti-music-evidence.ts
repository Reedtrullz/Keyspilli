import {
  assertMusic,
  isHash,
} from "@keyspilli/catalog/src/acoustic-receipt.js";
import type { MusicReviewReport } from "./music-review.js";
export const ANTI_MUSIC_EVIDENCE_SCHEMA_SHA256 =
  "b18d587a80d3d335b9a5e1a02bd5331ce0f0cc8112fa34c01261c1329d4abd23";
export interface AntiMusicEvidence {
  schemaVersion: 1;
  kind: "anti-music-evidence";
  clips: Array<{ id: string; sha256: string; durationSeconds: number }>;
  claims: Array<{
    id: string;
    clipId: string;
    startSeconds: number;
    endSeconds: number;
    text: string;
    origin:
      | "measurement"
      | "authored"
      | "human-observation"
      | "model-estimate"
      | "unknown";
    uncertainty: string;
  }>;
  context: {
    sourceAuthority: "unknown" | "self-authored" | "human-validated";
    allowedDifferences: string[];
  };
  limitations: string[];
}
/** Explicit selection is required for more than two clips. Never export local paths. */
export function exportAntiMusicEvidence(
  report: MusicReviewReport,
): AntiMusicEvidence {
  assertMusic(
    report.schemaVersion === 1 &&
      report.kind === "keyspilli-music-review" &&
      report.clips.length >= 1 &&
      report.clips.length <= 2,
    "Select one or two pinned clips explicitly",
  );
  assertMusic(
    report.musicalAcceptance === "not-established",
    "Automated report cannot attest",
  );
  const clips = report.clips.map((c) => {
    assertMusic(isHash(c.audio.sha256), "invalid clip pin");
    return {
      id: c.id,
      sha256: c.audio.sha256,
      durationSeconds: c.audio.durationSeconds,
    };
  });
  const claims = report.clips.flatMap((c) =>
    c.findings.map((f) => ({
      id: f.id,
      clipId: c.id,
      startSeconds: f.startSeconds,
      endSeconds: f.endSeconds,
      text: f.description,
      origin:
        f.origin === "authored-source"
          ? ("authored" as const)
          : ("model-estimate" as const),
      uncertainty: f.uncertainty,
    })),
  );
  assertMusic(claims.length <= 64, "Evidence exceeds portable claim ceiling");
  return {
    schemaVersion: 1,
    kind: "anti-music-evidence",
    clips,
    claims,
    context: { sourceAuthority: "unknown", allowedDifferences: [] },
    limitations: [
      ...report.limitations,
      "Unvalidated source authority is not upgraded by this bridge",
    ],
  };
}
