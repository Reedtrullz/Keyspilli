import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  canonicalKeyspilliRegressionJson,
  runKeyspilliRegression,
  writeKeyspilliRegressionReport,
  type KeyspilliRegressionSong,
} from "../src/keyspilli-regression.js";
import type { Note } from "@keyspilli/midi";
import type { PartialScoreReference, TrustedRole, TrustedRoleRegion } from "../src/omr-role-reference.js";

const roles: readonly TrustedRole[] = ["melody", "harmony", "rhythm"];

function reference(id: string, trustedRoles: readonly TrustedRole[]): PartialScoreReference {
  const events = {
    melody: [{ id: `${id}-melody`, role: "melody" as const, measureId: `${id}:m1`, onset: 0, duration: 1, midi: 72, pitchClass: 0, sourceEventId: "e-m" }],
    harmony: [{ id: `${id}-harmony`, role: "harmony" as const, measureId: `${id}:m1`, onset: 0, duration: 2, midi: 48, pitchClass: 0, sourceEventId: "e-h" }],
    rhythm: [{ id: `${id}-rhythm`, role: "rhythm" as const, measureId: `${id}:m1`, onset: 2, duration: 1, midi: 36, pitchClass: 0, sourceEventId: "e-r" }],
  };
  const regionRoles = Object.fromEntries(roles.map((role) => [role, {
    state: trustedRoles.includes(role) ? "TRUSTED_CONSENSUS" : "UNKNOWN",
    confidence: trustedRoles.includes(role) ? 1 : null,
    eventIds: trustedRoles.includes(role) ? [events[role][0]!.id] : [],
    eventCount: trustedRoles.includes(role) ? 1 : 0,
    provenance: trustedRoles.includes(role)
      ? { kind: "dual-omr-consensus" as const, engineIds: ["a", "b"], versions: ["1"], independenceGroups: ["a", "b"], sourceSha256: null }
      : { kind: "unknown" as const, engineIds: [], versions: [], independenceGroups: [], sourceSha256: null },
  }])) as TrustedRoleRegion["roles"];
  const region: TrustedRoleRegion = {
    id: `${id}:r1`, measureIds: [`${id}:m1`], startBeat: 0, endBeat: 4,
    roles: regionRoles,
    unknownRoles: roles.filter((role) => !trustedRoles.includes(role)),
    pageSystems: [{ page: 1, system: 1 }],
  };
  const coverage = Object.fromEntries(roles.map((role) => [role, {
    trustedBeatSpan: trustedRoles.includes(role) ? 4 : 0,
    eligibleBeatSpan: trustedRoles.includes(role) ? 4 : 0,
    unknownBeatSpan: trustedRoles.includes(role) ? 0 : 4,
    trustedEventCount: trustedRoles.includes(role) ? 1 : 0,
    unknownEventCount: trustedRoles.includes(role) ? 0 : 1,
    coverage: trustedRoles.includes(role) ? 1 : 0,
  }])) as PartialScoreReference["coverage"];
  return {
    schemaVersion: 1, score: { id }, source: { sha256: null, artifactType: "synthetic", accessMethod: "fixture" },
    alignment: "hierarchical", measureOrder: [`${id}:m1`], regions: [region], lanes: events,
    unknownMasks: roles.filter((role) => !trustedRoles.includes(role)).map((role) => ({ role, startBeat: 0, endBeat: 4, measureIds: [`${id}:m1`], reason: "review-required" as const })),
    coverage,
    nonClaims: [],
  };
}

function song(id: string, trustedRoles: readonly TrustedRole[], wrongRole?: TrustedRole): KeyspilliRegressionSong {
  const ref = reference(id, trustedRoles);
  const roleNotes: Partial<Record<TrustedRole, Note[]>> = {};
  for (const role of trustedRoles) {
    const event = ref.lanes[role][0]!;
    roleNotes[role] = [{ midi: event.midi + (wrongRole === role ? 1 : 0), start: event.onset, dur: event.duration, vel: 100, hand: role === "harmony" ? "L" : "R" }];
  }
  return {
    id,
    reference: ref,
    candidate: { selector: `fixtures/${id}.mid`, roleNotes, notes: Object.values(roleNotes).flat() },
  };
}

describe("Keyspilli multi-song regression", () => {
  it("evaluates only trusted roles and keeps aggregate denominators role-specific", () => {
    const report = runKeyspilliRegression([
      song("melody-harmony", ["melody", "harmony"]),
      song("melody-only", ["melody"]),
      song("rhythm-harmony", ["rhythm", "harmony"]),
    ]);
    expect(report.songs.map((row) => row.songId)).toEqual(["melody-harmony", "melody-only", "rhythm-harmony"]);
    expect(report.songs[1]?.roles.harmony.status).toBe("ineligible");
    expect(report.songs[1]?.roles.melody.metrics.exactPitch.f1).toBe(1);
    expect(report.aggregate.roles.melody.songsEvaluated).toBe(2);
    expect(report.aggregate.roles.harmony.songsEvaluated).toBe(2);
    expect(report.aggregate.roles.rhythm.songsEvaluated).toBe(1);
    expect(report.aggregate.roles.rhythm.coverageMedian).toBe(1);
  });

  it("localizes a genuinely wrong role and ignores an unknown middle region", () => {
    const base = song("partial", ["melody", "harmony"] , "melody");
    base.reference.regions[0]!.roles.harmony = { ...base.reference.regions[0]!.roles.harmony, state: "UNKNOWN", eventIds: [], eventCount: 0, confidence: null, provenance: { kind: "unknown", engineIds: [], versions: [], independenceGroups: [], sourceSha256: null } };
    base.reference.regions[0]!.unknownRoles = ["harmony"];
    base.reference.lanes.harmony = [];
    const report = runKeyspilliRegression([base]);
    expect(report.songs[0]?.roles.melody.metrics.exactPitch.f1).toBe(0);
    expect(report.songs[0]?.roles.melody.failureClusters).toContain("melody:exact-pitch");
    expect(report.songs[0]?.roles.harmony.status).toBe("ineligible");
    expect(report.songs[0]?.roles.harmony.metrics.exactPitch.f1).toBeNull();
  });

  it("is deterministic and writes a path-safe report", async () => {
    const songs = [song("zeta", ["melody"]), song("alpha", ["melody"])];
    const first = runKeyspilliRegression(songs);
    const second = runKeyspilliRegression([...songs].reverse());
    expect(canonicalKeyspilliRegressionJson(first)).toBe(canonicalKeyspilliRegressionJson(second));
    const output = await mkdtemp(join(tmpdir(), "keyspilli-regression-"));
    try {
      const written = await writeKeyspilliRegressionReport(output, first);
      expect(await readFile(written.path, "utf8")).toBe(written.json);
      expect(written.json).not.toContain("fixtures/");
      expect(written.json).not.toContain(output);
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  });
});
