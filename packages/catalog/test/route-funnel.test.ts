import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMidi, writeMidi, type Note, type ParsedMidi } from "@keyspilli/midi";
import { canonicalRouteFunnelJson, evaluateRouteFunnel } from "../src/route-funnel.js";
import { runRouteFunnelCli } from "../scripts/route-funnel.js";

const note = (midi: number, start: number): Note => ({ midi, start, dur: 1, vel: 90, hand: "R" });
const parsed = (notes: Note[]): ParsedMidi => ({
  format: 1,
  division: 480,
  tempoBpm: 120,
  keySig: 0,
  keyMode: 0,
  timeSig: [4, 4],
  notes,
  trackNames: ["Piano"],
  durationBeats: 132,
});
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("local A/B/C route funnel", () => {
  it("keeps route identity and applies existing structural/reference oracles", () => {
    const referenceNotes = [0, 44, 88].map((start) => note(60, start));
    const report = evaluateRouteFunnel({
      fixture: { id: "synthetic-route" },
      mode: "reference",
      windows: [0, 44, 88].map((start, index) => ({
        id: `bar-${index}`,
        candidate: [start, start + 44] as [number, number],
        reference: [start, start + 44] as [number, number],
      })),
      reference: { parsed: parsed(referenceNotes) },
      routes: [
        { id: "C", label: "YourMT3+", parsed: parsed(referenceNotes) },
        { id: "B", label: "alternative", parsed: parsed(referenceNotes.map((item) => ({ ...item, midi: item.midi + 1 }))) },
        { id: "A", label: "current", parsed: parsed(referenceNotes) },
      ],
    });

    expect(report.routes.map((route) => route.id)).toEqual(["A", "B", "C"]);
    expect(report.routes.map((route) => route.label)).toEqual(["current", "alternative", "YourMT3+"]);
    expect(report.routes.every((route) => route.funnel.structural === "pass")).toBe(true);
    expect(report.routes[0]?.reference?.status).toBe("aligned");
    expect(report.routes[0]?.reference?.exactPitch.f1).toBe(1);
    expect(report.routes[1]?.reference?.exactPitch.f1).toBe(0);
    expect(report.coverage.referenceAlignedCount).toBe(3);
    expect(report.ranking[0]?.id).toBe("A");
    expect(report.ranking[0]?.score).toBe(report.ranking[2]?.score);
    expect(canonicalRouteFunnelJson(report)).not.toContain("/private");
  });

  it("fails closed for a missing route without hiding the other routes", () => {
    const report = evaluateRouteFunnel({
      fixture: { id: "synthetic-missing" },
      routes: [
        { id: "A", parsed: parsed([note(60, 0)]) },
        { id: "B", parsed: parsed([note(62, 0)]) },
        { id: "C", unavailableReason: "backend unavailable" },
      ],
    });
    expect(report.coverage.availableCount).toBe(2);
    expect(report.routes[2]?.status).toBe("unavailable");
    expect(report.routes[2]?.funnel.disposition).toBe("unavailable");
    expect(report.routes[2]?.structural).toBeNull();
    expect(report.routes[2]?.piano.status).toBe("unavailable");
  });

  it("writes a deterministic path-free report from synthetic local MIDIs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keyspilli-route-funnel-test-"));
    try {
      const bytes = writeMidi([note(60, 0), note(62, 1)], { tempoBpm: 120, tracks: [{ name: "Piano", notes: [note(60, 0), note(62, 1)] }] });
      const midiPath = join(dir, "candidate.mid");
      const manifestPath = join(dir, "manifest.json");
      const out = join(dir, "report.json");
      await writeFile(midiPath, bytes);
      await writeFile(manifestPath, JSON.stringify({
        schemaVersion: 1,
        fixture: { id: "synthetic-cli" },
        routes: [
          { id: "A", label: "current", path: midiPath, sha256: sha256(bytes) },
          { id: "B", label: "alternative", path: midiPath },
          { id: "C", label: "YourMT3+", path: join(dir, "missing.mid") },
        ],
      }), "utf8");
      const first = await runRouteFunnelCli(["--manifest", manifestPath, "--out", out]);
      const firstBytes = await readFile(out, "utf8");
      const second = await runRouteFunnelCli(["--manifest", manifestPath, "--out", out]);
      expect(second.json).toBe(first.json);
      expect(firstBytes).toBe(first.json);
      expect(first.json).not.toContain(midiPath);
      expect(JSON.parse(first.json).routes[2].status).toBe("unavailable");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects source paths resolving into this repository and keeps output under the system temp directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "keyspilli-route-funnel-path-"));
    try {
      const manifestPath = join(dir, "manifest.json");
      const out = join(dir, "report.json");
      await writeFile(manifestPath, JSON.stringify({
        schemaVersion: 1,
        fixture: { id: "path-test" },
        routes: [{ id: "A", path: join(process.cwd(), "package.json") }],
      }), "utf8");
      await expect(runRouteFunnelCli(["--manifest", manifestPath, "--out", out])).rejects.toThrow(/inside repository/i);
      await expect(runRouteFunnelCli(["--manifest", manifestPath, "--out", join(process.cwd(), "route-report.json")])).rejects.toThrow(/under the system temp directory/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
