import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  pathSafeScoreReference,
  renderScoreListeningPackWorksheet,
  selectRotatingScoreListeningPack,
  selectRoleAwareRotatingScoreListeningPack,
  writeRotatingScoreListeningPackBundle,
  writeRotatingScoreListeningPackManifest,
  type ScoreCorpusSong,
} from "../src/score-listening-pack.js";

function song(
  id: string,
  status: string,
  sectionCount = 3,
  sectionDuration = 24,
): ScoreCorpusSong {
  return {
    id,
    artist: `${id} artist`,
    title: `${id} title`,
    validation: { status },
    references: {
      piano: `scores/${id}/reference.mid`,
      source: `/private/corpus/${id}/source.wav`,
    },
    sections: Array.from({ length: sectionCount }, (_, index) => ({
      id: ["opening", "chorus", "lead"][index] ?? `section-${index}`,
      label: `Section ${index + 1}`,
      role: index === 2 ? "lead" : "main",
      startSeconds: index * sectionDuration,
      endSeconds: (index + 1) * sectionDuration,
    })),
  };
}

describe("rotating score listening pack", () => {
  it("selects a short multi-song pack and is invariant to corpus input order", () => {
    const corpus = [
      song("sleep-token", "PASS_WITH_WARNINGS"),
      song("sabaton", "PASS"),
      song("pretty-reckless", "PASS"),
      song("not-trusted", "REVIEW_REQUIRED"),
    ];
    const options = { seed: "checkpoint-17", targetSeconds: 120, minSeconds: 90, maxSeconds: 180 };
    const first = selectRotatingScoreListeningPack(corpus, options);
    const reordered = selectRotatingScoreListeningPack([...corpus].reverse(), options);

    expect(first).toEqual(reordered);
    expect(first.status).toBe("ready");
    expect(first.totalSeconds).toBeGreaterThanOrEqual(90);
    expect(first.totalSeconds).toBeLessThanOrEqual(180);
    expect(new Set(first.excerpts.map((excerpt) => excerpt.songId)).size).toBeGreaterThanOrEqual(2);
    expect(first.excerpts.every((excerpt) => excerpt.durationSeconds <= 30)).toBe(true);
    expect(first.songs.map((entry) => entry.id)).not.toContain("not-trusted");
    expect(first.excerpts.every((excerpt) => !excerpt.references.source?.startsWith("/"))).toBe(true);
  });

  it("rotates section choice with the seed without making selection nondeterministic", () => {
    const corpus = [song("alpha", "PASS"), song("beta", "PASS"), song("gamma", "PASS")];
    const one = selectRotatingScoreListeningPack(corpus, { seed: "one", targetSeconds: 96, minSeconds: 90, maxSeconds: 180 });
    const two = selectRotatingScoreListeningPack(corpus, { seed: "two", targetSeconds: 96, minSeconds: 90, maxSeconds: 180 });
    expect(one).not.toEqual(two);
    expect(one.status).toBe("ready");
    expect(two.status).toBe("ready");
    expect(one.totalSeconds).toBeGreaterThanOrEqual(90);
    expect(two.totalSeconds).toBeGreaterThanOrEqual(90);
  });

  it("fails closed when fewer than two accepted songs have usable sections", () => {
    expect(() => selectRotatingScoreListeningPack([
      song("accepted", "PASS"),
      song("review", "REVIEW_REQUIRED"),
      song("failed", "FAILED"),
    ])).toThrow(/at least 2 accepted songs/);
  });

  it("reports an explicitly insufficient pack instead of inventing duration", () => {
    const result = selectRotatingScoreListeningPack([
      song("short-a", "PASS", 1, 12),
      song("short-b", "PASS", 1, 12),
    ] satisfies ScoreCorpusSong[], { targetSeconds: 120, minSeconds: 90, maxSeconds: 180 });
    expect(result.status).toBe("insufficient");
    expect(result.totalSeconds).toBe(24);
    expect(result.warnings.join(" ")).toMatch(/below requested minimum/);
  });

  it("includes review-required material only with an explicit opt-in and marks it provisional", () => {
    const result = selectRotatingScoreListeningPack([
      song("trusted", "PASS"),
      song("provisional", "REVIEW_REQUIRED"),
    ], {
      seed: "review-listening",
      targetSeconds: 48,
      minSeconds: 48,
      maxSeconds: 60,
      includeReviewRequired: true,
    });

    expect(result.status).toBe("ready");
    expect(result.songs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "provisional", validationStatus: "REVIEW_REQUIRED" }),
      expect.objectContaining({ id: "trusted", validationStatus: "PASS" }),
    ]));
    expect(result.warnings).toContain(
      "pack includes REVIEW_REQUIRED scores for listening only; manual notation review is pending",
    );
  });

  it("writes portable references and a stable manifest without reading artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-score-pack-"));
    try {
      const pack = selectRotatingScoreListeningPack([
        song("alpha", "PASS"),
        song("beta", "PASS_WITH_WARNINGS"),
        song("ignored", "REVIEW_REQUIRED"),
      ], { seed: "portable", targetSeconds: 96, minSeconds: 90, maxSeconds: 180 });
      const written = await writeRotatingScoreListeningPackManifest(directory, pack);
      const fromDisk = await readFile(written.path, "utf8");
      expect(fromDisk).toBe(written.json);
      expect(JSON.parse(fromDisk)).toMatchObject({
        kind: "score-rotating-listening-pack",
        pathSafe: true,
        status: "ready",
      });
      expect(fromDisk).not.toContain(directory);
      expect(fromDisk).not.toContain("/private/corpus/");
      expect(fromDisk).not.toContain("file://");
      expect(createHash("sha256").update(fromDisk).digest("hex")).toBe(
        createHash("sha256").update(written.json).digest("hex"),
      );
      await expect(writeRotatingScoreListeningPackManifest(directory, pack, { fileName: "../escape.json" })).rejects.toThrow(/path-safe/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("writes a minimal path-safe worksheet for the rotating bundle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-score-pack-bundle-"));
    try {
      const pack = selectRotatingScoreListeningPack([
        song("alpha", "PASS"),
        song("beta", "PASS_WITH_WARNINGS"),
      ], { seed: "worksheet", targetSeconds: 48, minSeconds: 48, maxSeconds: 60 });
      const rendered = renderScoreListeningPackWorksheet(pack);
      expect(rendered).toContain("Recognizable? YES / NO:");
      expect(rendered).toContain("Anything obviously wrong? YES / NO:");
      expect(rendered).toContain("A or B better? A / B / SAME / N/A:");
      expect(rendered).not.toContain("/private/corpus/");

      const written = await writeRotatingScoreListeningPackBundle(directory, pack);
      expect(await readFile(written.worksheetPath, "utf8")).toBe(rendered);
      expect(written.worksheetPath).toBe(join(directory, "LISTENING.md"));
      expect(written.worksheet).toBe(rendered);
      expect(written.blindMapPath).toBe(join(directory, "blind-map.json"));
      const blindMap = JSON.parse(await readFile(written.blindMapPath, "utf8")) as { entries: Record<string, { excerptHash: string }> };
      expect(Object.keys(blindMap.entries)).toEqual(["A001", "A002"]);
      expect(Object.values(blindMap.entries).every((entry) => /^[a-f0-9]{64}$/.test(entry.excerptHash))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("role-aware mode selects trusted role regions only and reports insufficiency explicitly", () => {
    const trusted = (id: string, role: string, label: string) => ({
      id, label, role, startSeconds: 0, endSeconds: 24,
      trusted: true, trustedRoles: [role], preference: label.toLowerCase(),
      provenance: "/private/corpus/omr.json",
      references: { midi: `/private/corpus/${id}.mid`, wav: `/private/corpus/${id}.wav` },
    });
    const result = selectRoleAwareRotatingScoreListeningPack([
      { ...song("alpha", "PASS", 0), sections: [trusted("opening", "melody", "Intro"), trusted("chorus", "harmony", "Chorus")] },
      { ...song("beta", "PASS", 0), sections: [trusted("lead", "melody", "Lead")] },
      { ...song("untrusted", "PASS", 0), sections: [{ ...trusted("bad", "melody", "Intro"), trusted: false }] },
    ], { seed: "roles", targetSeconds: 48, minSeconds: 48, maxSeconds: 60 });
    expect(result.status).toBe("ready");
    expect(new Set(result.excerpts.map((excerpt) => excerpt.songId)).size).toBeGreaterThanOrEqual(2);
    expect(result.excerpts.every((excerpt) => excerpt.trusted === true)).toBe(true);
    expect(result.excerpts.every((excerpt) => !excerpt.references.midi?.startsWith("/"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("/private/corpus/");
    expect(result.excerpts.map((excerpt) => excerpt.sectionId)).toContain("opening");

    const insufficient = selectRoleAwareRotatingScoreListeningPack([
      { ...song("only", "PASS", 0), sections: [trusted("opening", "melody", "Intro")] },
    ], { seed: "roles-insufficient", targetSeconds: 48, minSeconds: 48, maxSeconds: 60 });
    expect(insufficient.status).toBe("insufficient");
    expect(insufficient.warnings.join(" ")).toMatch(/distinct trusted songs/);

    const missingRoleMetadata = selectRoleAwareRotatingScoreListeningPack([
      { ...song("alpha", "PASS", 0), sections: [{ ...trusted("no-role", "melody", "Intro"), trustedRoles: [] }] },
      { ...song("beta", "PASS", 0), sections: [{ ...trusted("also-no-role", "melody", "Intro"), trustedRoles: [] }] },
    ], { seed: "roles-empty", targetSeconds: 48, minSeconds: 48, maxSeconds: 60 });
    expect(missingRoleMetadata.status).toBe("insufficient");
  });

  it("sanitizes absolute, traversal, and credential-bearing references", () => {
    expect(pathSafeScoreReference("/Users/reidar/private/song.mid")).toBe("external/song.mid");
    expect(pathSafeScoreReference("../private/song.mid")).toBe("external/song.mid");
    expect(pathSafeScoreReference("file:///Users/reidar/private/song.mid")).toBe("external/song.mid");
    expect(pathSafeScoreReference("https://user:secret@example.test/song.mid?token=secret#fragment")).toBe("https://example.test/song.mid");
    expect(pathSafeScoreReference("https://example.test/song.mid")).toBe("https://example.test/song.mid");
    expect(pathSafeScoreReference("corpus/song.mid")).toBe("corpus/song.mid");
  });

  it("ignores malformed null sections instead of crashing or inventing excerpts", () => {
    const malformed = song("malformed", "PASS");
    malformed.sections = [null as never, { id: "bad", startSeconds: 4, endSeconds: Number.NaN }];
    const result = selectRotatingScoreListeningPack([
      malformed,
      song("valid-a", "PASS"),
      song("valid-b", "PASS"),
    ], { seed: "malformed-sections", targetSeconds: 24, minSeconds: 8, maxSeconds: 30 });
    expect(result.excerpts.every((excerpt) => excerpt.songId !== "malformed")).toBe(true);
  });

  it("atomically replaces a manifest symlink without touching its target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-score-pack-atomic-"));
    try {
      const victim = join(directory, "victim.json");
      const manifestPath = join(directory, "manifest.json");
      await writeFile(victim, "keep me", "utf8");
      await symlink(victim, manifestPath);
      const pack = selectRotatingScoreListeningPack([
        song("alpha", "PASS"),
        song("beta", "PASS"),
      ], { seed: "atomic", targetSeconds: 96, minSeconds: 90, maxSeconds: 180 });

      await writeRotatingScoreListeningPackManifest(directory, pack);

      expect(await readFile(victim, "utf8")).toBe("keep me");
      expect((await lstat(manifestPath)).isSymbolicLink()).toBe(false);
      expect(JSON.parse(await readFile(manifestPath, "utf8")).kind).toBe("score-rotating-listening-pack");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
