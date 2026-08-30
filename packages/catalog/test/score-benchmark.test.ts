import { describe, expect, it } from "vitest";
import {
  assessScoreConfidence,
  canonicalScoreProvenanceJson,
  createBenchmarkCorpusManifest,
  createScoreProvenance,
  eligibleCorpusSongs,
  canonicalBenchmarkCorpusJson,
  scoreCorpusManifestHash,
  scoreDensityPitchDiagnostics,
  validateBenchmarkCorpusManifest,
  validateMusicXmlStructure,
  type ScoreNote,
} from "../src/score-benchmark.js";

const validXml = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><tie type="start"/><notations><tied type="start"/></notations></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>2</voice><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><voice>2</voice></note>
    </measure>
    <measure number="2">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><tie type="stop"/><notations><tied type="stop"/></notations></note>
    </measure>
  </part>
</score-partwise>`;

const invalidXml = `<score-partwise version="4.0">
  <part id="P1"><measure number="1">
    <attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>20</duration><voice>1</voice><tie type="stop"/></note>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><time-modification><actual-notes>0</actual-notes><normal-notes>2</normal-notes></time-modification></note>
  </measure></part>
</score-partwise>`;

const twoPartsOnStaffOneXml = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Lead</part-name></score-part>
    <score-part id="P2"><part-name>Harmony</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

describe("score benchmark core", () => {
  it("creates path-free deterministic provenance metadata", () => {
    const provenance = createScoreProvenance({
      sourcePdfPath: "/Users/reidar/Downloads/The Pretty Reckless - Kill Me.pdf",
      sourcePdfSha256: "a".repeat(64),
      sourcePdfBytes: 1234,
      omrBackend: "Audiveris",
      omrVersion: "5.4.0",
      conversionTimestamp: "2026-08-30T12:00:00.000Z",
      normalizationVersion: "score-benchmark-v1",
      musicXmlSha256: "b".repeat(64),
      midiSha256: "c".repeat(64),
      validationStatus: "PASS_WITH_WARNINGS",
      manualReviewStatus: "pending",
    });
    expect(provenance.sourcePdf.logicalName).toBe("The Pretty Reckless - Kill Me.pdf");
    expect(JSON.stringify(provenance)).not.toContain("/Users/");
    const canonical = canonicalScoreProvenanceJson(provenance);
    expect(canonical).toBe(canonicalScoreProvenanceJson({ ...provenance }));
    expect(canonical).not.toContain("sourcePdfPath");
    expect(() => JSON.parse(canonical)).not.toThrow();
  });

  it("validates MusicXML structure without treating conversion as ground truth", () => {
    const report = validateMusicXmlStructure(validXml);
    expect(report.status).toBe("PASS");
    expect(report.valid).toBe(true);
    expect(report.parts).toHaveLength(1);
    expect(report.parts[0]?.partName).toBe("Piano");
    expect(report.measureCount).toBe(2);
    expect(report.staffCount).toBe(1);
    expect(report.voiceCount).toBe(2);
    expect(report.clefs).toEqual([{ sign: "G", line: 2, number: 1 }]);
    expect(report.keySignatures).toEqual([{ fifths: 0, mode: "major" }]);
    expect(report.timeSignatures).toEqual([{ beats: 4, beatType: 4 }]);
    expect(report.tempos).toEqual([120]);
    expect(report.ties.starts).toBe(1);
    expect(report.ties.stops).toBe(1);
    expect(report.ties.orphanStops).toBe(0);
    expect(report.tuplets.valid).toBe(1);
    expect(report.measures.every((measure) => measure.status === "ok")).toBe(true);
  });

  it("counts distinct staves across parts rather than taking the maximum staff number", () => {
    const report = validateMusicXmlStructure(twoPartsOnStaffOneXml);

    expect(report.valid).toBe(true);
    expect(report.staffCount).toBe(2);
    expect(report.parts.map((part) => part.staffCount)).toEqual([1, 1]);
  });

  it("fails closed for broken arithmetic, ties, and tuplets", () => {
    const report = validateMusicXmlStructure(invalidXml);
    expect(report.valid).toBe(false);
    expect(report.status).toBe("FAILED");
    expect(report.errors.some((message) => message.includes("overfull"))).toBe(true);
    expect(report.errors.some((message) => message.includes("orphan tie stop"))).toBe(true);
    expect(report.errors.some((message) => message.includes("tuplet"))).toBe(true);
  });

  it("reports density explosions and suspicious pitch continuity", () => {
    const notes: ScoreNote[] = [
      ...Array.from({ length: 8 }, (_, index) => ({ pitch: 60 + (index % 3), onset: index * 0.5, duration: 0.25, measure: 1 })),
      { pitch: 100, onset: 4, duration: 0.25, measure: 2 },
      ...Array.from({ length: 40 }, (_, index) => ({ pitch: 61 + (index % 4), onset: 4 + index * 0.05, duration: 0.1, measure: 2 })),
    ];
    const diagnostics = scoreDensityPitchDiagnostics(notes, { densityExplosionFactor: 2 });
    expect(diagnostics.noteCount).toBe(49);
    expect(diagnostics.pitch.max).toBe(100);
    expect(diagnostics.suspiciousPitchJumps).toBeGreaterThan(0);
    expect(diagnostics.densityAnomalies.some((anomaly) => anomaly.measure === 2)).toBe(true);
    expect(diagnostics.measures.find((measure) => measure.measure === 2)?.maxPolyphony).toBeGreaterThan(1);
  });

  it("downgrades unresolved or suspicious references instead of passing them", () => {
    const structural = validateMusicXmlStructure(invalidXml);
    const confidence = assessScoreConfidence({
      structural,
      pitch: { suspiciousPitchJumps: 4, suspiciousPitches: 3 },
      manualReviewStatus: "pending",
    });
    expect(confidence.status).toBe("FAILED");
    expect(confidence.trustedReference).toBe(false);
    expect(confidence.reasons.length).toBeGreaterThan(0);
  });

  it("sorts and sanitizes corpus manifests and excludes review-required songs", () => {
    const manifest = createBenchmarkCorpusManifest({
      songs: [
        {
          id: "z-song",
          artist: "Z",
          title: "Zed",
          score: { sha256: "d".repeat(64), pages: 2, omrStatus: "converted" },
          references: { fullScore: "normalized/reference.musicxml" },
          validation: { status: "REVIEW_REQUIRED", warnings: ["missing tempo"] },
        },
        {
          id: "a-song",
          artist: "A",
          title: "Alpha",
          score: { sha256: "a".repeat(64), pages: 1, omrStatus: "converted" },
          references: { piano: "../private/piano.mid" },
          validation: { status: "PASS", warnings: [] },
        },
      ],
    });
    expect(manifest.songs.map((song) => song.id)).toEqual(["a-song", "z-song"]);
    expect(manifest.songs[0]?.references.piano).toBe("private/piano.mid");
    expect(eligibleCorpusSongs(manifest).map((song) => song.id)).toEqual(["a-song"]);
    const reordered = createBenchmarkCorpusManifest({ songs: [...manifest.songs].reverse() });
    expect(scoreCorpusManifestHash(manifest)).toBe(scoreCorpusManifestHash(reordered));
  });

  it("keeps the corpus identity hash stable across conversion timestamps", () => {
    const provenance = createScoreProvenance({
      sourcePdfSha256: "a".repeat(64),
      sourcePdfBytes: 100,
      omrBackend: "Audiveris",
      omrVersion: "5.11.0",
      conversionTimestamp: "2026-08-30T12:00:00.000Z",
      normalizationVersion: "score-benchmark-v1",
      musicXmlSha256: "b".repeat(64),
      musicXmlBytes: 200,
      midiSha256: "c".repeat(64),
      midiBytes: 300,
      validationStatus: "REVIEW_REQUIRED",
    });
    const first = createBenchmarkCorpusManifest({
      songs: [{
        id: "timestamped-score",
        artist: "Artist",
        title: "Title",
        score: { sha256: "d".repeat(64), omrStatus: "converted" },
        references: { fullScore: "normalized/reference.musicxml" },
        validation: { status: "REVIEW_REQUIRED", warnings: [] },
        provenance,
      }],
    });
    const second = createBenchmarkCorpusManifest({
      songs: [{
        ...first.songs[0]!,
        provenance: { ...provenance, conversionTimestamp: "2026-08-31T12:00:00.000Z" },
      }],
    });
    expect(canonicalBenchmarkCorpusJson(first)).not.toBe(canonicalBenchmarkCorpusJson(second));
    expect(scoreCorpusManifestHash(first)).toBe(scoreCorpusManifestHash(second));
  });

  it("keeps note diagnostics deterministic when metadata tie-breakers are reordered", () => {
    const notes: ScoreNote[] = [
      { pitch: 60, onset: 0, duration: 0.5, velocity: 80, part: "b", staff: 2, voice: "2", measure: 2, source: "other" },
      { pitch: 60, onset: 0, duration: 0.5, velocity: 80, part: "a", staff: 1, voice: "1", measure: 1, source: "guitar" },
      { pitch: 120, onset: 0.5, duration: 0.25, velocity: 80, part: "a", staff: 1, voice: "1", measure: 1, source: "guitar" },
    ];
    const first = scoreDensityPitchDiagnostics(notes);
    const second = scoreDensityPitchDiagnostics([...notes].reverse());
    expect(second).toEqual(first);
  });

  it("rejects malformed corpus records and unsafe reference paths", () => {
    const result = validateBenchmarkCorpusManifest({
      schemaVersion: 1,
      songs: [
        {
          id: "bad-song",
          artist: "Artist",
          title: "Title",
          score: { sha256: "not-a-hash", bytes: -1, pages: 0, omrStatus: "" },
          references: { piano: "/Users/reidar/secret.mid", fullScore: "https://user:password@example.test/score.mxl?token=secret" },
          validation: { status: "NOT_A_STATUS", warnings: null },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("sha256"))).toBe(true);
    expect(result.errors.some((error) => error.includes("safe relative corpus path"))).toBe(true);
    expect(result.errors.some((error) => error.includes("validation status"))).toBe(true);
    expect(result.errors.some((error) => error.includes("validation warnings"))).toBe(true);
  });

  it("canonicalizes an unsorted manifest and strips URL credentials/query data", () => {
    const manifest = createBenchmarkCorpusManifest({
      songs: [
        {
          id: "b-song",
          artist: "B",
          title: "Beta",
          score: { sha256: "b".repeat(64), omrStatus: "converted" },
          references: { piano: "https://user:password@example.test/score.mid?token=secret" },
          validation: { status: "PASS", warnings: [] },
        },
        {
          id: "a-song",
          artist: "A",
          title: "Alpha",
          score: { sha256: "a".repeat(64), omrStatus: "converted" },
          references: { piano: "normalized/a.mid" },
          validation: { status: "PASS", warnings: [] },
        },
      ],
    });
    const canonical = canonicalBenchmarkCorpusJson({ schemaVersion: 1, songs: [...manifest.songs].reverse() });
    expect(canonical.indexOf('"id":"a-song"')).toBeLessThan(canonical.indexOf('"id":"b-song"'));
    expect(canonical).toContain("score.mid");
    expect(canonical).not.toContain("password");
    expect(canonical).not.toContain("token=secret");
    expect(validateBenchmarkCorpusManifest(JSON.parse(canonical)).valid).toBe(true);
  });
});
