import { describe, expect, it } from "vitest";
import {
  canonicalUpstreamManifest,
  normalizeUpstreamAttributionManifest,
  upstreamManifestSha256,
} from "../src/upstream-attribution-manifest.js";

const item = (id: string) => ({
  id,
  performance: ["single-note", "palm-mute"],
  modalities: [
    { kind: "midi", sha256: "b".repeat(64), status: "available" },
    { kind: "di", sha256: "a".repeat(64), status: "available" },
  ],
  acquisitionPath: `/Users/example/private/${id}.wav`,
});

const manifest = (items = [item("z-item"), item("a-item")]) => ({
  schemaVersion: 1,
  dataset: {
    name: "Guitar-TECHS",
    version: "1.0",
    license: { spdx: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  },
  items,
});

describe("upstream attribution manifest", () => {
  it("sorts IDs and modalities and excludes local paths from canonical identity", () => {
    const first = normalizeUpstreamAttributionManifest(manifest());
    const second = normalizeUpstreamAttributionManifest(manifest([item("a-item"), item("z-item")]));

    expect(first.items.map(({ id }) => id)).toEqual(["a-item", "z-item"]);
    expect(canonicalUpstreamManifest(first)).toBe(canonicalUpstreamManifest(second));
    expect(upstreamManifestSha256(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalUpstreamManifest(first)).not.toContain("/Users/example");
  });

  it.each([
    ["invalid license", { ...manifest(), dataset: { ...manifest().dataset, license: { spdx: "MIT" } } }],
    ["missing modality", { ...manifest(), items: [{ ...item("a-item"), modalities: [] }] }],
    ["invalid performance", { ...manifest(), items: [{ ...item("a-item"), performance: [""] }] }],
  ])("rejects %s", (_name, value) => {
    expect(() => normalizeUpstreamAttributionManifest(value)).toThrow();
  });
});
