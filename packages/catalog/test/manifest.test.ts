import { describe, expect, it } from "vitest";
import { disabledManifestBases, mergeSeedEntries } from "../src/manifest.js";

describe("mergeSeedEntries", () => {
  it("preserves available local sources while preferring fetched metadata", () => {
    const fetched = [
      { id: "fresh", title: "Upstream title", sourceFile: "fresh.mid" },
      { id: "same", title: "New title", sourceFile: "same.mid" },
    ];
    const existing = [
      { id: "curated", title: "Hand repair", sourceFile: "curated.mid" },
      { id: "same", title: "Old title", sourceFile: "same.mid" },
      { id: "missing", title: "Unavailable", sourceFile: "missing.mid" },
    ];
    const merged = mergeSeedEntries(fetched, existing, new Set(["fresh.mid", "same.mid", "curated.mid"]));

    expect(merged.map((entry) => entry.id)).toEqual(["curated", "fresh", "same"]);
    expect(merged.find((entry) => entry.id === "same")?.title).toBe("New title");
    expect(merged.find((entry) => entry.id === "curated")?.title).toBe("Hand repair");
  });

  it("does not preserve a manifest entry whose source is unavailable", () => {
    const merged = mergeSeedEntries([], [{ id: "missing", sourceFile: "missing.mid" }], new Set());
    expect(merged).toEqual([]);
  });

  it("preserves disabled policy entries even when their source is unavailable", () => {
    const merged = mergeSeedEntries(
      [],
      [{ id: "blocked-source", sourceFile: "missing.mid", disabled: true }],
      new Set(),
    );
    expect(merged).toEqual([{ id: "blocked-source", sourceFile: "missing.mid", disabled: true }]);
  });
});

describe("disabledManifestBases", () => {
  it("loads disabled sources as a runtime visibility gate", () => {
    const disabled = disabledManifestBases();
    expect(disabled).toContain("coldplay-viva-la-vida");
    expect(disabled).not.toContain("taylor-swift-shake-it-off");
  });
});
