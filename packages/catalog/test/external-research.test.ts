import { describe, expect, it } from "vitest";
import { writeMidi, type Note } from "@keyspilli/midi";
import {
  classifyExternalRoles,
  ingestExternalSymbolicCandidate,
  researchExternalCandidates,
  serializeExternalResearchInventory,
  type ExternalResearchInventory,
} from "../src/external-research.js";
import { adaptNativeSymbolicBytes } from "../src/native-score-adapter.js";

const song = { title: "External Test Song", artist: "Test Artist" };

function midiBytes(notes: Note[], tracks = [{ name: "Lead Voice", notes }]): Uint8Array {
  return writeMidi(notes, { tempoBpm: 120, title: "External Test Song", tracks });
}

const musicXml = `<?xml version="1.0"?><score-partwise version="4.0">
  <work><work-title>External XML</work-title></work>
  <part-list><score-part id="P1"><part-name>Lead Voice</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>
  </measure></part>
</score-partwise>`;

describe("external symbolic research bridge", () => {
  it("normalizes explicit MIDI and MusicXML bytes into generation-safe evidence", async () => {
    const midi = await ingestExternalSymbolicCandidate({
      id: "midi:external-lead",
      sourceRef: "external:fixture-lead",
      bytes: midiBytes([{ midi: 60, start: 0, dur: 1, vel: 96, hand: "R" }]),
      format: "midi",
      purpose: "GENERATION_CANDIDATE",
    });
    expect(midi.status).toBe("parsed");
    expect(midi.candidate).toMatchObject({
      evidenceClass: "VERIFIED_NATIVE_SYMBOLIC",
      purpose: "GENERATION_CANDIDATE",
      status: "parsed",
      provenance: { sourceRef: "external:fixture-lead", acquiredVia: "local-bytes" },
    });
    expect(midi.score?.parts).toHaveLength(1);
    expect(midi.canonical?.performedTokens).toHaveLength(1);

    const xml = await ingestExternalSymbolicCandidate({
      id: "xml:external-lead",
      sourceRef: "external:fixture-xml",
      bytes: new TextEncoder().encode(musicXml),
      format: "musicxml",
    });
    expect(xml.status).toBe("parsed");
    expect(xml.candidate?.content.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(xml.score?.parts[0]?.name).toBe("Lead Voice");
  });

  it("reports MXL and unsupported formats without inventing parsers", async () => {
    const mxl = await ingestExternalSymbolicCandidate({
      sourceRef: "external:invalid-mxl",
      bytes: Uint8Array.from([1, 2, 3]),
      format: "mxl",
    });
    expect(mxl.status).toBe("invalid");
    expect(mxl.candidate).toBeNull();
    expect(mxl.rejectionReasons?.join(" ")).toMatch(/parse|MXL|invalid/i);

    const guitarPro = await ingestExternalSymbolicCandidate({
      sourceRef: "external:guitar-pro-lead",
      bytes: Uint8Array.from([1, 2, 3]),
      format: "guitar-pro",
    });
    expect(guitarPro.status).toBe("unsupported");
    expect(guitarPro.candidate).toBeNull();
    expect(guitarPro.rejectionReasons?.join(" ")).toMatch(/unsupported|parser/i);
  });

  it("keeps malformed bytes and percussion out of generation evidence", async () => {
    const malformed = await ingestExternalSymbolicCandidate({
      sourceRef: "external:malformed",
      bytes: Uint8Array.from([1, 2, 3]),
      format: "midi",
    });
    expect(malformed.status).toBe("invalid");
    expect(malformed.candidate).toBeNull();

    const percussion = adaptNativeSymbolicBytes(midiBytes([], [{ name: "Drums", notes: [] }]), "midi");
    expect(percussion.status).toBe("parsed");
    if (percussion.status === "parsed") {
      const roles = classifyExternalRoles(percussion.score);
      expect(roles.some((role) => role.role === "timing-only" || role.percussion)).toBe(true);
      expect(roles.every((role) => role.certainty !== "certain")).toBe(true);
    }
  });

  it("keeps discovery provider-neutral and metadata-only until local bytes are supplied", async () => {
    const inventory = await researchExternalCandidates(song, {
      discoveryRecords: [
        { id: "lead", title: "External lead MIDI", provider: "Provider A", sourceRef: "provider-a:lead", format: "midi" },
        { id: "benchmark", title: "Reference", provider: "Provider B", sourceRef: "provider-b:reference", purpose: "BENCHMARK_REFERENCE" },
      ],
    });
    expect(inventory.records).toHaveLength(2);
    expect(inventory.records.find((record) => record.id === "lead")).toMatchObject({
      purpose: "RESEARCH_LEAD",
      acquisition: { status: "not-supplied" },
    });
    expect(inventory.records.find((record) => record.id === "lead")?.candidate).toBeNull();
    expect(inventory.records.find((record) => record.id === "benchmark")?.generationUsable).toBe(false);
    expect(inventory.records.find((record) => record.id === "benchmark")?.rejectionReasons?.join(" ")).toMatch(/benchmark/i);

    const withReferenceBytes = await researchExternalCandidates(song, {
      discoveryRecords: [{ id: "benchmark", sourceRef: "provider-b:reference", purpose: "BENCHMARK_REFERENCE" }],
      localInputs: [{ id: "benchmark", sourceRef: "provider-b:reference", purpose: "BENCHMARK_REFERENCE", bytes: midiBytes([{ midi: 60, start: 0, dur: 1, vel: 96, hand: "R" }]), format: "midi" }],
    });
    expect(withReferenceBytes.records[0]?.candidate).toBeNull();
    expect(withReferenceBytes.records[0]?.generationUsable).toBe(false);
    expect(withReferenceBytes.records[0]?.rejectionReasons.join(" ")).toMatch(/benchmark/i);
  });

  it("records conservative identity and version statuses for acquired candidates", async () => {
    const inventory = await researchExternalCandidates(song, {
      discoveryRecords: [{ id: "lead", title: "Test Artist External Test Song MIDI", provider: "Provider", sourceRef: "provider:lead", format: "midi" }],
      localInputs: [{ id: "lead", title: "Test Artist External Test Song piano cover", sourceRef: "provider:lead", bytes: midiBytes([{ midi: 60, start: 0, dur: 1, vel: 96, hand: "R" }]), format: "midi" }],
    });
    expect(inventory.records[0]).toMatchObject({ identityStatus: "COVER_VERSION", versionStatus: "AMBIGUOUS" });
    expect(inventory.records[0]?.identityReasons).toEqual(expect.arrayContaining([expect.stringMatching(/title|artist/i)]));
  });

  it("uses explicit local files and redacts physical paths in deterministic serialization", async () => {
    const inventory = await researchExternalCandidates(song, {
      discoveryRecords: [{ id: "local", title: "Local lead", sourceRef: "local:lead", format: "midi" }],
      localInputs: [{ id: "local", sourceRef: "local:lead", bytes: midiBytes([{ midi: 60, start: 0, dur: 1, vel: 96, hand: "R" }]), format: "midi" }],
    });
    const json = serializeExternalResearchInventory(inventory);
    expect(inventory.records.find((record) => record.id === "local")?.candidate?.status).toBe("parsed");
    expect(json).not.toMatch(/\/Users\/|\/private\/|localPath|notes|events/);
    const reordered = await researchExternalCandidates(song, {
      localInputs: [{ id: "local", sourceRef: "local:lead", bytes: midiBytes([{ midi: 60, start: 0, dur: 1, vel: 96, hand: "R" }]), format: "midi" }],
      discoveryRecords: [{ id: "local", title: "Local lead", sourceRef: "local:lead", format: "midi" }],
    });
    expect(serializeExternalResearchInventory(inventory)).toBe(serializeExternalResearchInventory(reordered));

    const first = { bytes: midiBytes([{ midi: 60, start: 0, dur: 1, vel: 96, hand: "R" }]), format: "midi" } as const;
    const second = { bytes: midiBytes([{ midi: 67, start: 0, dur: 1, vel: 96, hand: "R" }]), format: "midi" } as const;
    const forward = await researchExternalCandidates(song, { localInputs: [first, second] });
    const reverse = await researchExternalCandidates(song, { localInputs: [second, first] });
    expect(serializeExternalResearchInventory(forward)).toBe(serializeExternalResearchInventory(reverse));
  });

  it("preserves sanitized HTTP URLs while redacting physical roots and path-bearing errors", async () => {
    const inventory = await researchExternalCandidates(song, {
      discoveryRecords: [{ id: "url", title: "URL lead", provider: "Provider", sourceRef: "provider:url", sourcePage: "https://example.com/page?token=secret#section" }],
      discoveryErrors: ["failed reading /opt/keyspilli/a.mid, /root/private/b.mid, /unknownroot/secret.mid, /unknownroot/secret, \\\\server\\share\\song.mid, and file://server/share/other.mid; see https://example.com/page, youtube:abc/section, A/B, provider/path"],
    });
    const json = serializeExternalResearchInventory(inventory);
    expect(json).toContain("https://example.com/page");
    expect(json).not.toContain("http[redacted-path]");
    expect(json).not.toMatch(/\/opt\/|\/root\/|\/srv\/|\/etc\/|\/mnt\/|\/data\/|\/unknownroot\/|server\\share|file:\/\/server|\$1/);
    expect(json).toMatch(/youtube:abc\/section|A\/B|provider\/path/);
    expect(json).toContain("[redacted-path]");
  });

  it("classifies invalid and unsupported local evidence as non-native records", async () => {
    const inventory = await researchExternalCandidates(song, {
      localInputs: [
        { id: "guitar-pro", sourceRef: "provider:guitar-pro", format: "guitar-pro", bytes: Uint8Array.from([1, 2, 3]) },
        { id: "bad-midi", sourceRef: "provider:bad-midi", format: "midi", bytes: Uint8Array.from([1, 2, 3]) },
      ],
    });
    expect(inventory.records.map((record) => record.evidenceClass)).toEqual(["TAB_OR_CHORD_EVIDENCE", "TAB_OR_CHORD_EVIDENCE"]);
    expect(inventory.records.every((record) => record.generationUsable === false)).toBe(true);
    expect(inventory.records.every((record) => record.candidate === null)).toBe(true);
  });

  it("merges a metadata discovery record with local bytes by logical sourceRef", async () => {
    const bytes = midiBytes([{ midi: 60, start: 0, dur: 1, vel: 96, hand: "R" }]);
    const inventory = await researchExternalCandidates(song, {
      discoveryRecords: [{ id: "discovery-id", title: "Lead metadata", provider: "Provider", sourceRef: "provider:shared-lead", format: "midi" }],
      localInputs: [{ sourceRef: "provider:shared-lead", title: "Lead bytes", bytes, format: "midi", purpose: "GENERATION_CANDIDATE" }],
    });
    expect(inventory.records).toHaveLength(1);
    expect(inventory.records[0]).toMatchObject({ id: "discovery-id", provider: "Provider", parser: { status: "parsed" }, content: { sha256: expect.any(String) } });
  });

  it("retains an aligned generation purpose when discovery supplies the metadata", async () => {
    const bytes = midiBytes([{ midi: 67, start: 0, dur: 1, vel: 96, hand: "R" }]);
    const inventory = await researchExternalCandidates(song, {
      discoveryRecords: [{
        id: "generation-discovery",
        title: "Aligned lead metadata",
        provider: "Provider",
        sourceRef: "provider:aligned-lead",
        format: "midi",
        purpose: "GENERATION_CANDIDATE",
      }],
      localInputs: [{
        sourceRef: "provider:aligned-lead",
        bytes,
        format: "midi",
        alignment: { status: "aligned", reason: null },
      }],
    });

    expect(inventory.records).toHaveLength(1);
    expect(inventory.records[0]).toMatchObject({
      purpose: "GENERATION_CANDIDATE",
      alignment: { status: "aligned" },
      generationUsable: true,
    });
  });

  it("keeps benchmark/reference discovery authoritative over a local purpose override", async () => {
    const inventory = await researchExternalCandidates(song, {
      discoveryRecords: [{ id: "protected", sourceRef: "provider:protected", purpose: "BENCHMARK_REFERENCE", evidenceClass: "BENCHMARK_REFERENCE" }],
      localInputs: [{ sourceRef: "provider:protected", purpose: "GENERATION_CANDIDATE", evidenceClass: "VERIFIED_NATIVE_SYMBOLIC", bytes: midiBytes([{ midi: 60, start: 0, dur: 1, vel: 96, hand: "R" }]), format: "midi" }],
    });
    expect(inventory.records).toHaveLength(1);
    expect(inventory.records[0]).toMatchObject({ purpose: "BENCHMARK_REFERENCE", evidenceClass: "BENCHMARK_REFERENCE", candidate: null, generationUsable: false });
    expect(inventory.records[0]?.rejectionReasons.join(" ")).toMatch(/benchmark|override/i);
  });

  it("reports uncertain role evidence from register, monophony, density, and metadata", () => {
    const result = adaptNativeSymbolicBytes(midiBytes([], [
      { name: "Lead Voice", notes: [
        { midi: 72, start: 0, dur: 1, vel: 96, hand: "R" },
        { midi: 74, start: 1, dur: 1, vel: 96, hand: "R" },
      ] },
      { name: "Piano accompaniment", notes: [{ midi: 48, start: 0, dur: 2, vel: 80, hand: "L" }] },
    ]), "midi");
    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") throw new Error("expected parsed score");
    const roles = classifyExternalRoles(result.score);
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.every((role) => role.confidence < 1 && role.certainty !== "certain")).toBe(true);
    expect(roles.some((role) => role.role === "melody")).toBe(true);
    expect(roles.some((role) => role.role === "harmony" || role.role === "bass-root")).toBe(true);
    expect(JSON.stringify(roles)).not.toMatch(/\/Users\/|\/private\//);
  });
});
