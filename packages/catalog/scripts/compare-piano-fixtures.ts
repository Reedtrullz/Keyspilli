/**
 * Read-only comparison for the three piano fixtures used in the Demucs
 * listening check.  The mapping is deliberately explicit: filename/title
 * heuristics have previously selected the wrong source generation.
 *
 * Usage:
 *   npx tsx packages/catalog/scripts/compare-piano-fixtures.ts
 *
 * The output is diagnostic evidence, not an accuracy score.  Broadband audio
 * onset agreement cannot establish that a MIDI pitch is musically correct.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseMidi, type Note, type ParsedMidi } from "@keyspilli/midi";
import { readArrangementManifest, type ArrangementManifest } from "../src/artifact-manifest.js";
import { fixtureTempoEvidence, sha256Hex, type FixtureTempoEvidence } from "../src/fixture-evidence.js";
import { artifactsDir, ROOT, transcribedDir } from "../src/paths.js";
import { resolveYoutubeAudio, resolveYoutubeSource } from "../src/youtube-source.js";

const execFileP = promisify(execFile);
const PYTHON = process.env.KEYSPILLI_PYTHON ?? join(ROOT, "services", "transcribe", ".venv", "bin", "python");
const ONSET_DETECTOR = join(ROOT, "services", "transcribe", "src", "audio_onsets.py");
const ONSET_TOLERANCE_SEC = Number(process.env.KEYSPILLI_ONSET_MATCH_SEC ?? 0.15);

interface Fixture {
  name: string;
  baseId: string;
  jobId: string;
  tempoBpm: number;
}

const FIXTURES: Fixture[] = [
  {
    name: "river-flows-in-you",
    baseId: "paul-gassa-yiruma-river-flows-in-you-emotional-piano-cover-msl98ing",
    jobId: "job-msl8vnh6-o7lfc5",
    tempoBpm: 144,
  },
  {
    name: "fur-elise",
    baseId: "steinway-sons-fur-elise-performed-by-lang-lang-msl9vn1h",
    jobId: "job-msl8vni0-uvcaqs",
    tempoBpm: 108,
  },
  {
    name: "bach-prelude-c",
    baseId: "rousseau-j-s-bach-prelude-in-c-major-mslaeupl",
    jobId: "job-msla8yl6-0poi26",
    tempoBpm: 129,
  },
];

interface OnsetMetrics {
  detectorOnsets: number;
  toleranceSec: number;
  noteHitRate: number;
  noteHits: number;
  noteCount: number;
  onsetCoverage: number;
  coveredOnsets: number;
}

interface MidiMetrics {
  notes: number;
  tempoBpm: number;
  tempoEvidence: FixtureTempoEvidence;
  durationBeats: number;
  pitchMin: number | null;
  pitchMax: number | null;
  lowUnderMidi48: number;
  lowUnderMidi48Ratio: number;
  maxSimultaneous: number;
  maxOnsetGapBeats: number;
  medianDurationBeats: number;
  p90DurationBeats: number;
  velocityMin: number | null;
  velocityMax: number | null;
  grid16Pct: number;
}

interface SourceMetrics extends MidiMetrics {
  path: string;
  bytes: number;
  sha256: string;
  sourceTempoBpm: number;
  onset?: OnsetMetrics;
  artifactIdentity?: ArtifactIdentity;
}

interface ArtifactIdentity {
  status: "missing" | "valid" | "invalid";
  identityStatus?: ArrangementManifest["identityStatus"];
  sourceArtifactHash?: string;
  configFingerprint?: string;
  artifactWrittenAt?: string;
  transcription?: ArrangementManifest["transcription"];
  error?: string;
}

function quantile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

function maxSimultaneous(notes: Note[]): number {
  const events: Array<[number, number]> = [];
  for (const note of notes) {
    events.push([note.start, 1], [note.start + note.dur, -1]);
  }
  // End before start at an identical beat; a released note is not sounding
  // simultaneously with its replacement.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let maximum = 0;
  for (const [, delta] of events) {
    current += delta;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function maxOnsetGapBeats(notes: Note[]): number {
  const starts = [...new Set(notes.map((note) => note.start))].sort((a, b) => a - b);
  let maximum = 0;
  for (let i = 1; i < starts.length; i++) maximum = Math.max(maximum, starts[i]! - starts[i - 1]!);
  return maximum;
}

function midiMetrics(parsed: ParsedMidi, expectedTempoBpm: number): MidiMetrics {
  const durations = parsed.notes.map((note) => note.dur);
  const velocities = parsed.notes.map((note) => note.vel);
  const grid16 = parsed.notes.filter((note) => {
    const nearest = Math.round(note.start / 0.25) * 0.25;
    return Math.abs(note.start - nearest) <= 0.01;
  }).length;
  return {
    notes: parsed.notes.length,
    tempoBpm: parsed.tempoBpm,
    tempoEvidence: fixtureTempoEvidence(expectedTempoBpm, parsed.tempoBpm),
    durationBeats: parsed.durationBeats,
    pitchMin: parsed.notes.length ? Math.min(...parsed.notes.map((note) => note.midi)) : null,
    pitchMax: parsed.notes.length ? Math.max(...parsed.notes.map((note) => note.midi)) : null,
    lowUnderMidi48: parsed.notes.filter((note) => note.midi < 48).length,
    lowUnderMidi48Ratio: parsed.notes.length
      ? parsed.notes.filter((note) => note.midi < 48).length / parsed.notes.length
      : 0,
    maxSimultaneous: maxSimultaneous(parsed.notes),
    maxOnsetGapBeats: maxOnsetGapBeats(parsed.notes),
    medianDurationBeats: quantile(durations, 0.5),
    p90DurationBeats: quantile(durations, 0.9),
    velocityMin: velocities.length ? Math.min(...velocities) : null,
    velocityMax: velocities.length ? Math.max(...velocities) : null,
    grid16Pct: parsed.notes.length ? (100 * grid16) / parsed.notes.length : 0,
  };
}

function onsetMetrics(notes: Note[], tempoBpm: number, onsets: number[]): OnsetMetrics {
  const secondsPerBeat = 60 / tempoBpm;
  const noteHits = notes.filter((note) =>
    onsets.some((onset) => Math.abs(onset - note.start * secondsPerBeat) <= ONSET_TOLERANCE_SEC),
  ).length;
  const coveredOnsets = onsets.filter((onset) =>
    notes.some((note) => Math.abs(onset - note.start * secondsPerBeat) <= ONSET_TOLERANCE_SEC),
  ).length;
  return {
    detectorOnsets: onsets.length,
    toleranceSec: ONSET_TOLERANCE_SEC,
    noteHitRate: notes.length ? noteHits / notes.length : 0,
    noteHits,
    noteCount: notes.length,
    onsetCoverage: onsets.length ? coveredOnsets / onsets.length : 0,
    coveredOnsets,
  };
}

async function parseSource(path: string, audioOnsets: number[], expectedTempoBpm: number): Promise<SourceMetrics> {
  const bytes = new Uint8Array(await readFile(path));
  const parsed = parseMidi(bytes);
  return {
    path,
    bytes: bytes.byteLength,
    sha256: sha256Hex(bytes),
    sourceTempoBpm: parsed.tempoBpm,
    ...midiMetrics(parsed, expectedTempoBpm),
    // Use the tempo carried by this exact MIDI candidate. Raw Basic Pitch
    // files are normally 120 BPM even when the arrangement was later
    // calibrated to a detected tempo; using the fixture's catalog tempo here
    // would make a source-drift bug look like onset inaccuracy.
    onset: onsetMetrics(parsed.notes, parsed.tempoBpm, audioOnsets),
  };
}

async function optionalSource(path: string, audioOnsets: number[], expectedTempoBpm: number): Promise<SourceMetrics | undefined> {
  try {
    return await parseSource(path, audioOnsets, expectedTempoBpm);
  } catch {
    return undefined;
  }
}

async function readArtifactIdentity(baseId: string): Promise<ArtifactIdentity> {
  const result = await readArrangementManifest(baseId);
  if (result.status === "missing") return { status: "missing" };
  if (result.status === "invalid") {
    return { status: "invalid", error: result.errors.join("; ") };
  }
  const { manifest } = result;
  return {
    status: "valid",
    identityStatus: manifest.identityStatus,
    ...(manifest.sourceArtifactHash ? { sourceArtifactHash: manifest.sourceArtifactHash } : {}),
    ...(manifest.configFingerprint ? { configFingerprint: manifest.configFingerprint } : {}),
    artifactWrittenAt: manifest.artifactWrittenAt,
    ...(manifest.transcription ? { transcription: manifest.transcription } : {}),
  };
}

async function main(): Promise<void> {
  const fixtures = [] as Array<Fixture & {
    audio: string;
    audioBytes: number;
    audioSha256: string;
    sources: Record<string, SourceMetrics | undefined>;
  }>;
  for (const fixture of FIXTURES) {
    const jobDir = join(transcribedDir(), fixture.jobId);
    // Use the same completed-audio boundary as worker/re-ingest code. The
    // fixture currently stores MP3, but a valid job may use another supported
    // extension and must not be rejected by this read-only report.
    const strictSource = await resolveYoutubeSource(jobDir, "strict");
    const audio = (await resolveYoutubeAudio(jobDir)) ?? strictSource?.audioPath;
    if (!audio) throw new Error(`${fixture.name}: no usable fixture audio`);
    const audioBytes = new Uint8Array(await readFile(audio));
    const { stdout } = await execFileP(PYTHON, [ONSET_DETECTOR, audio], {
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const onsets = JSON.parse(stdout) as number[];
    // Resolve both candidates through the shared validator. In particular,
    // do not let a corrupt preferred re/ file hide a valid lower-priority
    // candidate or silently pair a strict MIDI with the wrong audio.
    const rootSource = await resolveYoutubeSource(jobDir, "root");
    const reSource = strictSource;
    const advanced = await optionalSource(
      join(artifactsDir(fixture.baseId, "a"), "variant.mid"),
      onsets,
      fixture.tempoBpm,
    );
    if (advanced) advanced.artifactIdentity = await readArtifactIdentity(fixture.baseId);
    const sources: Record<string, SourceMetrics | undefined> = {
      root: rootSource ? await optionalSource(rootSource.midiPath, onsets, fixture.tempoBpm) : undefined,
      re: reSource ? await optionalSource(reSource.midiPath, onsets, fixture.tempoBpm) : undefined,
      advanced,
    };
    fixtures.push({
      ...fixture,
      audio,
      audioBytes: audioBytes.byteLength,
      audioSha256: sha256Hex(audioBytes),
      sources,
    });
  }
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    onsetToleranceSec: ONSET_TOLERANCE_SEC,
    note: "Audio-onset agreement is a broadband timing diagnostic, not pitch or musical accuracy. tempoEvidence compares each embedded MIDI tempo with the fixture's calibrated catalog tempo; raw root/re candidates are expected to remain at Basic Pitch's 120 BPM before re-ingest.",
    fixtures,
  }, null, 2));
}

await main();
