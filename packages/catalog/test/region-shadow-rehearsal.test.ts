import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeMidi, type Note } from "@keyspilli/midi";
import type { ExternalResearchRecord } from "../src/external-research.js";
import {
  buildRegionClaims,
  canonicalRegionShadowRehearsalJson,
  runRegionShadowRehearsal,
} from "../src/region-shadow-rehearsal.js";
import { resolveRegionEvidence } from "../src/region-ownership.js";

function record(): ExternalResearchRecord {
  return { id: "real-source", songId: "song", title: "Source", provider: "local", evidenceClass: "VERIFIED_NATIVE_SYMBOLIC", purpose: "GENERATION_CANDIDATE", identityStatus: "UNKNOWN", versionStatus: "UNKNOWN", identityReasons: [], discovery: { status: "local-supplied", sourceRef: "user:source", sourcePage: null }, acquisition: { status: "local-bytes", method: "local-bytes" }, content: { sha256: "a".repeat(64), byteLength: 1, mediaType: "audio/midi" }, parser: { status: "parsed", format: "midi", adapter: "test", warnings: [], error: null }, roles: [{ partId: "lead", partName: "Lead", role: "melody", confidence: 0.9, certainty: "uncertain", signals: [], eventCount: 8, pitchRange: [60, 67], monophonic: true, density: 1, percussion: false, timingOnly: false, alternatives: [] }], alignment: { status: "aligned", reason: null }, generationUsable: true, rejectionReasons: [], candidate: { id: "real-source", evidenceClass: "VERIFIED_NATIVE_SYMBOLIC", purpose: "GENERATION_CANDIDATE", provenance: { sourceRef: "user:source", acquiredVia: "local-bytes", provenanceClass: "USER_SUPPLIED_PRIVATE" }, content: { sha256: "a".repeat(64), byteLength: 1, mediaType: "audio/midi" }, confidence: { parse: 0.9, identity: 0.9, role: 0.9 }, roles: [{ role: "melody", confidence: 0.9 }], status: "parsed" }, score: null, canonical: null };
}

describe("region-aware real shadow rehearsal", () => {
  it("creates deterministic owned and withheld regions without changing source timing", () => {
    const claims = buildRegionClaims(record(), 8, { splitAtBeat: 4 });
    const resolution = resolveRegionEvidence(claims);
    expect(resolution.readiness).toBe("GENERATION_PARTIAL");
    expect(resolution.decisions.filter((decision) => decision.ownershipState === "OWNED")).toHaveLength(1);
    expect(resolution.decisions.filter((decision) => decision.ownershipState === "WITHHELD")).toHaveLength(1);
    expect(resolution.decisions.find((decision) => decision.id === "withheld:melody")?.reasonCodes).toContain("ALIGNMENT_REJECTED");
  });

  it("runs a local real-symbolic-shaped source through intake, arrangement, artifacts, and public projection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "keyspilli-region-shadow-"));
    try {
      const notes: Note[] = Array.from({ length: 16 }, (_, index) => ({ midi: 60 + (index % 5), start: index, dur: 0.75, vel: 96, hand: "R" }));
      const path = join(directory, "performance.mid");
      await writeFile(path, writeMidi(notes, { tempoBpm: 120, title: "Local performance" }));
      const first = await runRegionShadowRehearsal({ laneAMidi: path });
      const second = await runRegionShadowRehearsal({ laneAMidi: path });
      expect(first.lanes.laneA.sources[0]).toMatchObject({ purpose: "GENERATION_CANDIDATE", provenanceClass: "USER_SUPPLIED_PRIVATE", parser: "parsed" });
      expect(first.lanes.laneA.ownership.eventCounts.owned).toBeGreaterThan(0);
      expect(first.lanes.laneA.downstream?.physicalLevels).toHaveLength(6);
      expect(first.lanes.laneA.downstream?.publicLevels).toHaveLength(5);
      expect(first.controlledPolicyTest.status).toBe("pass");
      expect(first.determinism.canonicalSha256).toBe(second.determinism.canonicalSha256);
      expect(canonicalRegionShadowRehearsalJson(first)).toBe(canonicalRegionShadowRehearsalJson(second));
      expect(canonicalRegionShadowRehearsalJson(first)).not.toContain(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
