import { describe, expect, it } from "vitest";
import { writeMidi, type Note } from "@keyspilli/midi";
import {
  buildResearchReport,
  runResearch,
  serializeResearchReport,
  type LocalSymbolicInput,
} from "../src/research-report.js";

const song = {
  title: "SABATON - Defence Of Moscow (Official Music Video)",
  artist: "Sabaton",
  sourceYoutubeUrl: "https://youtu.be/9TjXanLjpTU?t=2",
  durationSeconds: 255.792,
  version: "studio",
};

function midiBytes(notes: Note[], tempoBpm = 110): Uint8Array {
  return writeMidi(notes, { tempoBpm, title: "Defence Of Moscow", tracks: [{ name: "Piano", notes }] });
}

function local(bytes: Uint8Array, overrides: Partial<LocalSymbolicInput> = {}): LocalSymbolicInput {
  return { bytes, format: "midi", ...overrides };
}

const candidateBytes = midiBytes([
  { midi: 60, start: 0, dur: 1, vel: 96, hand: "R" },
  { midi: 64, start: 1, dur: 1, vel: 96, hand: "R" },
  { midi: 67, start: 2, dur: 2, vel: 96, hand: "R" },
]);

const musicXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Local Test Score</work-title></work>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>110</per-minute></metronome></direction-type><sound tempo="110"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

describe("local song research report", () => {
  it("emits a path-free no-network report with a direct fallback", async () => {
    const result = await runResearch({ song, noNetwork: true });
    expect(result.report.song).toMatchObject({
      artist: "Sabaton",
      title: "Defence Of Moscow",
      youtubeVideoId: "9TjXanLjpTU",
    });
    expect(result.report.queries).toContain("Sabaton Defence Of Moscow MIDI");
    expect(result.report.recommended).toEqual([]);
    expect(result.report.fallback).toMatch(/^metal-transcription:/);
    expect(result.report.candidates.find((candidate) => candidate.selection === "fallback")).toMatchObject({
      extractionStrategy: "audio-transcription",
      fallbackTier: 1,
    });
    expect(result.json).not.toMatch(/\/Users\/|\/private\/|localPath|password/i);
  });

  it("does not invent discovery queries for a metadata-limited URL-only run", async () => {
    let called = false;
    const result = await runResearch({
      song: { title: "Submitted YouTube source", artist: "Unknown artist", sourceYoutubeUrl: "https://youtu.be/9TjXanLjpTU" },
      metadataLimited: true,
      search: async () => { called = true; return []; },
    });
    expect(called).toBe(false);
    expect(result.report.queries).toEqual([]);
    expect(result.report.discoveryErrors).toContain("song metadata is required for source discovery; provide --artist and --title");
  });

  it("classifies injected tutorial and performance candidates deterministically", async () => {
    const discovery = [
      {
        videoId: "BBBBBBBBBBB",
        url: "https://youtu.be/BBBBBBBBBBB",
        title: "Sabaton Defence Of Moscow Synthesia piano tutorial",
        uploader: "Tutor",
        durationSeconds: 256,
        isLive: false,
      },
      {
        videoId: "AAAAAAAAAAA",
        url: "https://youtu.be/AAAAAAAAAAA",
        title: "Sabaton Defence Of Moscow piano cover performance",
        uploader: "Performer",
        durationSeconds: 255,
        isLive: false,
      },
    ];
    const search = async () => [...discovery].reverse();
    const result = await runResearch({ song, noNetwork: false, search, limit: 4 });
    expect(result.report.candidates.find((candidate) => candidate.id === "youtube:BBBBBBBBBBB")).toMatchObject({
      sourceType: "piano-tutorial-video",
      extractionStrategy: "visual-midi",
      provider: "Tutor",
      isLive: false,
    });
    expect(result.report.candidates.find((candidate) => candidate.id === "youtube:AAAAAAAAAAA")).toMatchObject({
      sourceType: "piano-cover-video",
      extractionStrategy: "audio-midi",
    });
    expect(result.report.discoveredBy["youtube:AAAAAAAAAAA"]).toContain("Sabaton Defence Of Moscow piano");
    const resultReordered = await runResearch({ song, noNetwork: false, search: async () => discovery, limit: 4 });
    expect(result.json).toBe(resultReordered.json);
  });

  it("rejects malformed video ids instead of constructing unsafe candidate urls", () => {
    const report = buildResearchReport({
      song,
      discoveryCandidates: [{
        videoId: "https://user:pass@evil.test/video",
        url: "https://user:pass@evil.test/video",
        title: "malformed result",
        uploader: "attacker",
        durationSeconds: 120,
        isLive: false,
      }],
      discoveredBy: {
        "https://user:pass@evil.test/video": ["untrusted query"],
      },
    });

    expect(report.candidates.some((candidate) => candidate.id.includes("evil.test"))).toBe(false);
    expect(report.candidates.some((candidate) => candidate.title === "malformed result")).toBe(false);
    expect(report.discoveredBy).toEqual({});
    expect(serializeResearchReport(report)).not.toMatch(/evil\.test|user:pass|malformed result/);
  });

  it("parses local MIDI and MusicXML, hashes artifacts, and aligns local MIDI", () => {
    const xmlBytes = new TextEncoder().encode(musicXml);
    const report = buildResearchReport({
      song,
      localCandidates: [
        local(candidateBytes, { title: "Local piano MIDI" }),
        { bytes: xmlBytes, format: "musicxml", title: "Local MusicXML" },
      ],
      reference: { bytes: candidateBytes, format: "midi", id: "reference:fixture" },
    });
    const midiId = report.symbolicArtifacts.find((artifact) => artifact.format === "midi" && artifact.parser)?.id;
    const xmlArtifact = report.symbolicArtifacts.find((artifact) => artifact.format === "musicxml");
    expect(midiId).toMatch(/^local:/);
    expect(report.symbolicArtifacts.find((artifact) => artifact.id === midiId)?.parser?.noteCount).toBe(3);
    expect(report.symbolicArtifacts.find((artifact) => artifact.id === midiId)?.parser?.tempoBpm).toBeCloseTo(110, 3);
    expect(xmlArtifact?.parser).toMatchObject({ noteCount: 2, tempoBpm: 110, title: "Local Test Score" });
    expect(report.alignments[midiId!]?.metrics.exactPitch.f1).toBe(1);
    expect(report.alignments[midiId!]?.status).toMatch(/aligned|partial/);
    expect(report.symbolicArtifacts.every((artifact) => artifact.sha256.length === 64)).toBe(true);
  });

  it("rejects unsupported/corrupt local inputs without recommending them", () => {
    const report = buildResearchReport({
      song,
      localCandidates: [
        local(new Uint8Array([1, 2, 3]), { title: "/Users/reidar/Downloads/private.mid" }),
        { bytes: new Uint8Array([4, 5, 6]), format: "mxl", title: "packed score" },
        { bytes: new Uint8Array([7, 8, 9]), format: "unknown", title: "unknown input" },
      ],
    });
    expect(report.symbolicArtifacts).toHaveLength(3);
    expect(report.symbolicArtifacts.every((artifact) => artifact.error)).toBe(true);
    expect(report.recommended).toEqual([]);
    expect(report.candidates.find((candidate) => candidate.title === "unknown input")).toMatchObject({ sourceType: "unknown", extractionStrategy: "none" });
    expect(serializeResearchReport(report)).not.toMatch(/\/Users\/reidar|private\.mid/i);
    expect(serializeResearchReport(report)).toMatch(/MXL containers are unsupported|symbolic candidate could not be parsed/);
  });

  it("records sanitized discovery errors and human rejection metadata", async () => {
    const result = await runResearch({
      song,
      search: async () => { throw new Error("yt-dlp --proxy https://user:pass@example.test /Users/reidar/secret.mid"); },
      humanAcceptance: { verdict: "reject", note: "unrecognizable and sounds bad", raterCount: 1 },
    });
    expect(result.report.discoveryErrors).toEqual(["query failed: source discovery failed"]);
    expect(result.report.humanAcceptance).toMatchObject({ status: "reject", note: "unrecognizable and sounds bad", raterCount: 1 });
    expect(result.json).not.toMatch(/user:pass|\/Users\/reidar|secret\.mid/);
  });

  it("redacts embedded absolute and relative filenames from report text", () => {
    const report = buildResearchReport({
      song,
      discoveryErrors: ["failed /opt/keyspilli/foo.mid", "failed relative.mid"],
      humanAcceptance: { verdict: "reject", note: "bad at /private/tmp/listen.wav and secret.mid" },
    });
    const json = serializeResearchReport(report);
    expect(json).not.toMatch(/\/opt\/keyspilli|relative\.mid|\/private\/tmp|listen\.wav|secret\.mid/);
    expect(json).toContain("[redacted]");
  });

  it("keeps a malformed reference as a diagnostic and does not invent alignment", () => {
    const report = buildResearchReport({
      song,
      localCandidates: [local(candidateBytes)],
      reference: { bytes: new Uint8Array([0, 1, 2]), format: "midi", id: "/Users/reidar/reference.mid" },
    });
    expect(report.symbolicArtifacts.find((artifact) => artifact.id.startsWith("reference:"))?.error).toBeTruthy();
    expect(report.alignments).toEqual({});
    expect(serializeResearchReport(report)).not.toMatch(/reference\.mid|\/Users\/reidar/i);
  });

  it("does not silently collapse different bytes sharing a declared local id", () => {
    const otherBytes = midiBytes([{ midi: 62, start: 0, dur: 1, vel: 90, hand: "R" }]);
    const report = buildResearchReport({
      song,
      localCandidates: [
        local(candidateBytes, { id: "local:declared-collision-000000" }),
        local(otherBytes, { id: "local:declared-collision-000000" }),
      ],
    });
    expect(report.symbolicArtifacts).toHaveLength(2);
    expect(new Set(report.symbolicArtifacts.map((artifact) => artifact.id)).size).toBe(2);
    expect(report.discoveryErrors).toContain("local candidate id collision normalized by content hash");
  });
});
