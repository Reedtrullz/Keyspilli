import { describe, expect, it } from "vitest";
import {
  canonicalSourceIdentity,
  canonicalSourceRef,
  canonicalizeSourceProvenance,
  compareProvenanceSnapshots,
  extractYoutubeVideoId,
  sourceIdentitiesAgree,
  sourceKindMismatch,
} from "../src/provenance.js";

const videoId = "JZ6uGVghbT8";
const youtubeUrl = "https://www.youtube.com/watch?v=" + videoId + "&feature=share";

describe("canonical source provenance", () => {
  it("extracts common YouTube URL forms and normalizes the logical ref", () => {
    expect(extractYoutubeVideoId(youtubeUrl)).toBe(videoId);
    expect(extractYoutubeVideoId("https://youtu.be/" + videoId)).toBe(videoId);
    expect(extractYoutubeVideoId("https://www.youtube.com/embed/" + videoId)).toBe(videoId);
    expect(canonicalSourceRef("seed:your-song.mid", youtubeUrl)).toBe("youtube:" + videoId);
    expect(canonicalSourceRef("youtube:" + videoId, null)).toBe("youtube:" + videoId);
  });

  it("keeps a physical seed locator without treating it as a source change", () => {
    const normalized = canonicalizeSourceProvenance({
      kind: "youtube",
      acquiredVia: "youtube",
      sourceRef: "seed:the-theorist-elton-john-your-song.mid",
      sourceYoutubeUrl: youtubeUrl,
    });
    expect(normalized).toMatchObject({
      kind: "youtube",
      acquiredVia: "youtube",
      sourceRef: "youtube:" + videoId,
      sourceYoutubeUrl: youtubeUrl,
      sourceArtifactRef: "seed:the-theorist-elton-john-your-song.mid",
    });
    expect(canonicalSourceIdentity(normalized)).toMatchObject({
      canonicalSourceRef: "youtube:" + videoId,
      youtubeVideoId: videoId,
    });
  });

  it("compares DB, manifest, and notes metadata without a seed-path false positive", () => {
    const diffs = compareProvenanceSnapshots([
      { label: "database", contentType: "youtube", acquiredVia: "youtube", sourceYoutubeUrl: youtubeUrl },
      {
        label: "artifact manifest",
        provenance: {
          kind: "youtube",
          acquiredVia: "youtube",
          sourceRef: "youtube:" + videoId,
          sourceYoutubeUrl: youtubeUrl,
          sourceArtifactRef: "seed:your-song.mid",
        },
      },
      {
        label: "notes.json/a",
        provenance: {
          kind: "youtube",
          acquiredVia: "youtube",
          sourceRef: "youtube:" + videoId,
          sourceYoutubeUrl: youtubeUrl,
        },
      },
    ]);
    expect(diffs).toEqual([]);
    expect(sourceIdentitiesAgree(
      { sourceRef: "seed:your-song.mid", sourceYoutubeUrl: youtubeUrl },
      { sourceRef: "youtube:" + videoId },
    )).toBe(true);
  });

  it("reports explicit identity and metadata drift, while legacy absence is a warning", () => {
    const diffs = compareProvenanceSnapshots([
      { label: "database", contentType: "youtube", acquiredVia: "youtube", sourceYoutubeUrl: youtubeUrl },
      { label: "notes.json/a", provenance: { kind: "upload", acquiredVia: "upload", sourceRef: "youtube:OTHERVIDEO1" } },
      { label: "notes.json/b", provenance: {} },
    ]);
    expect(diffs.filter((diff) => diff.severity === "error").map((diff) => diff.code)).toEqual(expect.arrayContaining([
      "identity-drift",
      "kind-drift",
      "acquired-via-drift",
    ]));
    expect(diffs.some((diff) => diff.code === "missing-identity" && diff.labels.includes("notes.json/b"))).toBe(true);
  });

  it("treats a legacy seed-only label versus a YouTube id as migration evidence", () => {
    const diffs = compareProvenanceSnapshots([
      { label: "database", contentType: "youtube", acquiredVia: "youtube", sourceYoutubeUrl: youtubeUrl },
      { label: "notes.json/a", provenance: { kind: "youtube", acquiredVia: "youtube", sourceRef: "seed:your-song.mid" } },
    ]);
    expect(diffs).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", code: "identity-drift" }),
    ]));
    expect(diffs.some((diff) => diff.severity === "error" && diff.code === "identity-drift")).toBe(false);
  });

  it("does not warn when every layer is anonymous legacy metadata", () => {
    expect(compareProvenanceSnapshots([
      { label: "database", contentType: "standard" },
      { label: "notes.json/a", provenance: {} },
    ])).toEqual([]);
  });
});

describe("chord source origin verification", () => {
  it("rejects generated events in a chart and authored events in a generated source", () => {
    expect(sourceKindMismatch("chart", ["authored", "generated"])).toEqual([
      "chart source contains generated events (authored, generated)",
    ]);
    expect(sourceKindMismatch("midi-derived", ["generated", "authored"])).toEqual([
      "midi-derived source contains authored events (generated, authored)",
    ]);
    expect(sourceKindMismatch("chart", ["authored", "inferred"])).toEqual([]);
  });
});
