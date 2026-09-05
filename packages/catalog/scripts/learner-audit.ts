/**
 * Learner-focused catalogue audit.
 *
 * quality-report.ts measures structural/source hygiene. This report focuses
 * on whether a learner is likely to hear and use the arrangement: a clear RH
 * melody, useful LH bass/chord support, balanced/playable hands, recognizable
 * lower levels, and preserved source-track/provenance metadata.
 *
 * Read-only. The default output is a bounded ranked list; pass --all to emit
 * every base with a learner-facing finding.
 *
 * Usage:
 *   npx tsx packages/catalog/scripts/learner-audit.ts
 *   npx tsx packages/catalog/scripts/learner-audit.ts --top=50
 *   npx tsx packages/catalog/scripts/learner-audit.ts --all
 */
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseMidi, type Note, type ParsedMidi } from "@keyspilli/midi";
import { getDb } from "../src/db.js";
import { ROOT, artifactsDir, dataDir, seedMidiDir } from "../src/paths.js";

const LEVELS = ["vb", "b", "ve", "e", "m", "a"] as const;
const AUDIO_TYPES = new Set(["youtube", "upload"]);
const TOP_DEFAULT = 40;

type Level = (typeof LEVELS)[number];

interface ManifestEntry {
  id: string;
  sourceFile?: string;
  sourceUrl?: string;
  category?: string;
  disabled?: boolean;
}

interface VariantJson {
  notes: Note[];
  tempoBpm: number;
  warnings?: string[];
}

interface HandRange {
  count: number;
  min: number | null;
  max: number | null;
  span: number;
}

interface LevelMetric {
  notes: number;
  tempoBpm: number;
  durationSec: number;
  onsetCount: number;
  density: number;
  maxSimultaneous: number;
  maxDur: number;
  pctLong4: number;
  pctOver1_5: number;
  p50Dur: number;
  p50DurSec: number;
  p90Dur: number;
  p99Dur: number;
  velocityP50: number;
  velocityP90: number;
  rhNotes: number;
  rhOnsets: number;
  rhDensity: number;
  rhChordMean: number;
  rhChordP90: number;
  rhChordMax: number;
  rhPolyphonicOnsetPct: number;
  melodyOnsets: number;
  melodyPitchRange: number;
  melodyGapP90: number;
  melodyGapMax: number;
  melodyLeapP90: number;
  melodyLeapMax: number;
  melodyRepeatedPct: number;
  lhNotes: number;
  lhOnsets: number;
  lhDensity: number;
  lhChordMean: number;
  lhChordP90: number;
  lhChordMax: number;
  lhChordOnsetPct: number;
  lhSingleOnsetPct: number;
  lhLargestGap: number;
  lhBassLeapP90: number;
  lhBassLeapMax: number;
  crossHandPct: number;
  left: HandRange;
  right: HandRange;
  samePitchOverlaps: number;
  contiguousRetriggers: number;
  retriggerRate: number;
  warnings: string[];
  melodyKeys: string[];
}

interface SourceMetric {
  file: string | null;
  available: boolean;
  notes: number;
  trackNames: string[];
  explicitHandNotes: number;
  explicitLeftShare: number | null;
  nonPianoTrackNames: string[];
}

interface LearnerReport {
  baseId: string;
  title: string;
  artist: string;
  syntheticFixture: boolean;
  category: string;
  contentType: string;
  acquiredVia: string | null;
  sourceYoutubeUrl: string | null;
  manifestSourceUrl: string | null;
  source: SourceMetric;
  levels: Partial<Record<Level, LevelMetric>>;
  variantIssues: string[];
  retention: {
    beginnerRhMelody: number;
    veryBeginnerRhMelody: number;
  };
  score: number;
  severity: "high" | "medium" | "low" | "none";
  findings: string[];
  recommendedAction: string;
}

function quantile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (index - lo);
}

function round(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function groupByOnset(notes: Note[], hand: "L" | "R"): Array<[number, Note[]]> {
  const groups = new Map<number, Note[]>();
  for (const note of notes) {
    const noteHand = note.hand === "L" ? "L" : "R";
    if (noteHand !== hand) continue;
    const key = Number(note.start.toFixed(3));
    const group = groups.get(key) ?? [];
    group.push(note);
    groups.set(key, group);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

function rangeOf(notes: Note[]): HandRange {
  if (!notes.length) return { count: 0, min: null, max: null, span: 0 };
  const min = Math.min(...notes.map((note) => note.midi));
  const max = Math.max(...notes.map((note) => note.midi));
  return { count: notes.length, min, max, span: max - min };
}

function intervals(values: number[]): number[] {
  return values.slice(1).map((value, index) => Math.abs(value - values[index]!));
}

function maxSimultaneous(notes: Note[]): number {
  const events: Array<[number, number]> = [];
  for (const note of notes) {
    if (!Number.isFinite(note.start) || !Number.isFinite(note.dur) || note.dur <= 0) continue;
    events.push([note.start, 1], [note.start + note.dur, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let current = 0;
  let result = 0;
  for (const [, delta] of events) {
    current += delta;
    result = Math.max(result, current);
  }
  return result;
}

function samePitchOverlaps(notes: Note[]): number {
  const groups = new Map<string, Note[]>();
  for (const note of notes) {
    const key = `${note.hand === "L" ? "L" : "R"}:${note.midi}`;
    const group = groups.get(key) ?? [];
    group.push(note);
    groups.set(key, group);
  }
  let overlaps = 0;
  for (const group of groups.values()) {
    group.sort((a, b) => a.start - b.start || a.dur - b.dur);
    for (let i = 0; i < group.length; i++) {
      const current = group[i]!;
      for (let j = i + 1; j < group.length && group[j]!.start < current.start + current.dur - 1e-9; j++) {
        if (group[j]!.start > current.start + 1e-9) overlaps++;
      }
    }
  }
  return overlaps;
}

function retriggers(notes: Note[]): { contiguousRetriggers: number; retriggerRate: number } {
  const groups = new Map<string, Note[]>();
  for (const note of notes) {
    const key = `${note.hand === "L" ? "L" : "R"}:${note.midi}`;
    const group = groups.get(key) ?? [];
    group.push(note);
    groups.set(key, group);
  }
  let pairs = 0;
  let contiguousRetriggers = 0;
  for (const group of groups.values()) {
    group.sort((a, b) => a.start - b.start || a.dur - b.dur);
    for (let index = 1; index < group.length; index++) {
      const previous = group[index - 1]!;
      const current = group[index]!;
      pairs++;
      if (current.start - previous.start <= 0.75 && current.start - (previous.start + previous.dur) <= 0.125) {
        contiguousRetriggers++;
      }
    }
  }
  return { contiguousRetriggers, retriggerRate: contiguousRetriggers / Math.max(1, pairs) };
}

function readMetric(variant: VariantJson): LevelMetric {
  const notes = variant.notes;
  const tempoBpm = Number.isFinite(variant.tempoBpm) && variant.tempoBpm > 0 ? variant.tempoBpm : 120;
  const spanBeats = Math.max(1, ...notes.map((note) => note.start + note.dur).filter(Number.isFinite));
  const durationSec = (spanBeats * 60) / tempoBpm;
  const allOnsets = [...new Set(notes.map((note) => Number(note.start.toFixed(3))))].sort((a, b) => a - b);
  const rhNotes = notes.filter((note) => note.hand !== "L");
  const lhNotes = notes.filter((note) => note.hand === "L");
  const rhGroups = groupByOnset(notes, "R");
  const lhGroups = groupByOnset(notes, "L");
  const melody = rhGroups.map(([start, group]) => [start, group.reduce((best, note) => (note.midi > best.midi ? note : best))] as const);
  const melodyPitches = melody.map(([, note]) => note.midi);
  const melodyStarts = melody.map(([start]) => start);
  const melodyGaps = melodyStarts.slice(1).map((start, index) => start - melodyStarts[index]!);
  const melodyLeaps = intervals(melodyPitches);
  const lhBass = lhGroups.map(([, group]) => Math.min(...group.map((note) => note.midi)));
  const lhBassLeaps = intervals(lhBass);
  const rhChordSizes = rhGroups.map(([, group]) => group.length);
  const lhChordSizes = lhGroups.map(([, group]) => group.length);
  const handL = rangeOf(lhNotes);
  const handR = rangeOf(rhNotes);
  const rhMedian = quantile(rhNotes.map((note) => note.midi), 0.5);
  const lhMedian = quantile(lhNotes.map((note) => note.midi), 0.5);
  const crossHandNotes = lhNotes.filter((note) => note.midi > rhMedian).length + rhNotes.filter((note) => note.midi < lhMedian).length;
  const durations = notes.map((note) => note.dur).filter(Number.isFinite);
  const velocities = notes.map((note) => note.vel).filter(Number.isFinite);
  const melodyKeys = melody.map(([start, note]) => `${note.midi}@${start.toFixed(3)}`);
  const articulation = retriggers(notes);
  return {
    notes: notes.length,
    tempoBpm,
    durationSec,
    onsetCount: allOnsets.length,
    density: allOnsets.length / durationSec,
    maxSimultaneous: maxSimultaneous(notes),
    maxDur: durations.length ? Math.max(...durations) : 0,
    pctLong4: (100 * durations.filter((duration) => duration > 4).length) / Math.max(1, durations.length),
    pctOver1_5: (100 * durations.filter((duration) => duration > 1.5).length) / Math.max(1, durations.length),
    p50Dur: quantile(durations, 0.5),
    p50DurSec: quantile(durations, 0.5) * 60 / tempoBpm,
    p90Dur: quantile(durations, 0.9),
    p99Dur: quantile(durations, 0.99),
    velocityP50: quantile(velocities, 0.5),
    velocityP90: quantile(velocities, 0.9),
    rhNotes: rhNotes.length,
    rhOnsets: rhGroups.length,
    rhDensity: rhGroups.length / durationSec,
    rhChordMean: rhNotes.length / Math.max(1, rhGroups.length),
    rhChordP90: quantile(rhChordSizes, 0.9),
    rhChordMax: Math.max(0, ...rhChordSizes),
    rhPolyphonicOnsetPct: (100 * rhChordSizes.filter((size) => size > 1).length) / Math.max(1, rhChordSizes.length),
    melodyOnsets: melody.length,
    melodyPitchRange: melodyPitches.length ? Math.max(...melodyPitches) - Math.min(...melodyPitches) : 0,
    melodyGapP90: quantile(melodyGaps, 0.9),
    melodyGapMax: Math.max(0, ...melodyGaps),
    melodyLeapP90: quantile(melodyLeaps, 0.9),
    melodyLeapMax: Math.max(0, ...melodyLeaps),
    melodyRepeatedPct: (100 * melodyPitches.filter((pitch, index) => index > 0 && pitch === melodyPitches[index - 1]).length) / Math.max(1, melodyPitches.length - 1),
    lhNotes: lhNotes.length,
    lhOnsets: lhGroups.length,
    lhDensity: lhGroups.length / durationSec,
    lhChordMean: lhNotes.length / Math.max(1, lhGroups.length),
    lhChordP90: quantile(lhChordSizes, 0.9),
    lhChordMax: Math.max(0, ...lhChordSizes),
    lhChordOnsetPct: (100 * lhChordSizes.filter((size) => size > 1).length) / Math.max(1, lhChordSizes.length),
    lhSingleOnsetPct: (100 * lhChordSizes.filter((size) => size === 1).length) / Math.max(1, lhChordSizes.length),
    lhLargestGap: Math.max(0, ...lhGroups.slice(1).map(([start], index) => start - lhGroups[index]![0])),
    lhBassLeapP90: quantile(lhBassLeaps, 0.9),
    lhBassLeapMax: Math.max(0, ...lhBassLeaps),
    crossHandPct: (100 * crossHandNotes) / Math.max(1, notes.length),
    left: handL,
    right: handR,
    samePitchOverlaps: samePitchOverlaps(notes),
    ...articulation,
    warnings: variant.warnings ?? [],
    melodyKeys,
  };
}

function sourceTrackMetric(file: string | null, parsed: ParsedMidi | null): SourceMetric {
  if (!file || !parsed) {
    return {
      file,
      available: false,
      notes: 0,
      trackNames: [],
      explicitHandNotes: 0,
      explicitLeftShare: null,
      nonPianoTrackNames: [],
    };
  }
  const explicit = parsed.notes.filter((note) => note.hand === "L" || note.hand === "R");
  const nonPianoTrackNames = parsed.trackNames.filter((name) => /drum|percussion|guitar|vocal|voice|orchestra/i.test(name));
  return {
    file,
    available: true,
    notes: parsed.notes.length,
    trackNames: parsed.trackNames,
    explicitHandNotes: explicit.length,
    explicitLeftShare: explicit.length ? explicit.filter((note) => note.hand === "L").length / explicit.length : null,
    nonPianoTrackNames,
  };
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(() => true).catch(() => false);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function melodyRetention(harder: LevelMetric | undefined, easier: LevelMetric | undefined, tolerance = 0.26): number {
  if (!harder || !easier || !harder.melodyKeys.length) return 1;
  const easierKeys = easier.notes === 0 ? [] : easier.melodyKeys;
  let retained = 0;
  for (const key of harder.melodyKeys) {
    const [midiText, startText] = key.split("@");
    const midi = Number(midiText);
    const start = Number(startText);
    if (easierKeys.some((candidate) => {
      const [candidateMidi, candidateStart] = candidate.split("@");
      return Number(candidateMidi) === midi && Math.abs(Number(candidateStart) - start) <= tolerance;
    })) retained++;
  }
  return retained / harder.melodyKeys.length;
}

function sourceConcern(report: LearnerReport): boolean {
  const audioByManifest = /youtube\.com|youtu\.be/i.test(report.manifestSourceUrl ?? "") || report.category.toLowerCase() === "youtube";
  const audioByRow = AUDIO_TYPES.has(report.contentType) || report.acquiredVia === "youtube";
  const provenanceMissing = audioByManifest && !audioByRow;
  const explicitHandsLost = report.source.explicitHandNotes > 0 && report.levels.a && report.levels.a.left.count + report.levels.a.right.count < (report.levels.a.notes * 0.95);
  const sourceBalanceDrift = report.source.explicitLeftShare !== null && report.levels.a
    ? Math.abs(report.source.explicitLeftShare - report.levels.a.left.count / Math.max(1, report.levels.a.notes)) > 0.4
    : false;
  return provenanceMissing || explicitHandsLost || sourceBalanceDrift || report.source.nonPianoTrackNames.length > 0;
}

function compact(report: LearnerReport) {
  const a = report.levels.a;
  return {
    baseId: report.baseId,
    title: report.title,
    artist: report.artist,
    contentType: report.contentType,
    syntheticFixture: report.syntheticFixture,
    score: report.score,
    severity: report.severity,
    findings: report.findings,
    recommendedAction: report.recommendedAction,
    source: {
      file: report.source.file,
      trackNames: report.source.trackNames,
      explicitHandNotes: report.source.explicitHandNotes,
      nonPianoTrackNames: report.source.nonPianoTrackNames,
    },
    advanced: a
      ? {
          notes: a.notes,
          tempoBpm: round(a.tempoBpm),
          rhOnsets: a.rhOnsets,
          melodyOnsets: a.melodyOnsets,
          melodyGapMax: round(a.melodyGapMax),
          melodyLeapP90: round(a.melodyLeapP90),
          rhChordMean: round(a.rhChordMean),
          lhNotes: a.lhNotes,
          lhChordOnsetPct: round(a.lhChordOnsetPct, 1),
          lhSingleOnsetPct: round(a.lhSingleOnsetPct, 1),
          lhLargestGap: round(a.lhLargestGap),
          lhBassLeapP90: round(a.lhBassLeapP90),
          crossHandPct: round(a.crossHandPct, 1),
          leftRange: a.left,
          rightRange: a.right,
          density: round(a.density),
          maxSimultaneous: a.maxSimultaneous,
          samePitchOverlaps: a.samePitchOverlaps,
          contiguousRetriggers: a.contiguousRetriggers,
          retriggerRate: round(a.retriggerRate),
          p50DurSec: round(a.p50DurSec),
          maxDur: round(a.maxDur),
        }
      : null,
    retention: {
      beginnerRhMelody: round(report.retention.beginnerRhMelody, 3),
      veryBeginnerRhMelody: round(report.retention.veryBeginnerRhMelody, 3),
    },
    variantIssues: report.variantIssues,
  };
}

function parseArgs(): { all: boolean; canonical: boolean; top: number } {
  const all = process.argv.includes("--all");
  const canonical = process.argv.includes("--canonical");
  const topText = process.argv.find((arg) => arg.startsWith("--top="))?.slice("--top=".length);
  const top = topText === undefined ? TOP_DEFAULT : Number(topText);
  return { all, canonical, top: Number.isFinite(top) && top >= 0 ? Math.floor(top) : TOP_DEFAULT };
}

const args = parseArgs();
const db = getDb();
const rows = db
  .prepare(
    `SELECT base_id AS baseId, title, artist, category, content_type AS contentType,
            acquired_via AS acquiredVia, source_youtube_url AS sourceYoutubeUrl
       FROM songs
      GROUP BY base_id
      ORDER BY base_id`,
  )
  .all() as Array<{
  baseId: string;
  title: string;
  artist: string;
  category: string;
  contentType: string;
  acquiredVia: string | null;
  sourceYoutubeUrl: string | null;
}>;

const manifest = await readFile(join(ROOT, "catalog", "manifest.json"), "utf8")
  .then((raw) => JSON.parse(raw) as { generatedAt?: string; songs?: ManifestEntry[] })
  .catch(() => ({ generatedAt: undefined, songs: [] as ManifestEntry[] }));
const manifestById = new Map((manifest.songs ?? []).map((entry) => [entry.id, entry]));
const seedFiles = new Set((await readdir(seedMidiDir()).catch(() => [] as string[])).filter((file) => /\.(mid|midi)$/i.test(file)));

const baseResults = await mapLimit(rows, 24, async (row): Promise<LearnerReport> => {
  const manifestEntry = manifestById.get(row.baseId);
  const sourceFile = manifestEntry?.sourceFile ?? [...seedFiles].find((file) => file.replace(/\.(mid|midi)$/i, "") === row.baseId) ?? null;
  const sourcePath = sourceFile ? join(seedMidiDir(), sourceFile) : null;
  const sourceParsed = sourcePath && await exists(sourcePath)
    ? await readFile(sourcePath).then((buffer) => parseMidi(new Uint8Array(buffer))).catch(() => null)
    : null;
  const source = sourceTrackMetric(sourceFile, sourceParsed);
  const levels: Partial<Record<Level, LevelMetric>> = {};
  for (const level of LEVELS) {
    const file = join(artifactsDir(row.baseId, level), "notes.json");
    const variant = await readFile(file, "utf8").then((raw) => JSON.parse(raw) as VariantJson).catch(() => null);
    if (variant) levels[level] = readMetric(variant);
  }
  const advanced = levels.a;
  const medium = levels.m;
  const variantIssues: string[] = [];
  if (!advanced || LEVELS.some((level) => !levels[level])) variantIssues.push("missing-level-artifact");
  if (advanced && medium && advanced.notes === medium.notes) variantIssues.push("advanced-equals-medium");
  const counts = LEVELS.map((level) => levels[level]?.notes);
  if (counts.some((count, index) => index > 0 && count !== undefined && counts[index - 1] !== undefined && count < counts[index - 1]!)) {
    variantIssues.push("difficulty-count-not-monotonic");
  }
  if (levels.a && levels.b && Math.abs(levels.a.tempoBpm - levels.b.tempoBpm) > 1e-6) variantIssues.push("tempo-mismatch");
  const retention = {
    beginnerRhMelody: melodyRetention(levels.a, levels.b),
    veryBeginnerRhMelody: melodyRetention(levels.a, levels.vb, 0.51),
  };
  const findings: string[] = [];
  let score = 0;
  const add = (finding: string, points: number) => {
    findings.push(finding);
    score += points;
  };
  const syntheticFixture = row.baseId.startsWith("keyspilli-upload-test-") || (row.title === "Upload Test" && row.artist === "Keyspilli");
  const transcriptionDerived = row.contentType === "youtube" || row.acquiredVia === "youtube" || row.category.toLowerCase() === "youtube";
  if (syntheticFixture) {
    return {
      baseId: row.baseId,
      title: row.title,
      artist: row.artist,
      syntheticFixture,
      category: row.category,
      contentType: row.contentType,
      acquiredVia: row.acquiredVia,
      sourceYoutubeUrl: row.sourceYoutubeUrl,
      manifestSourceUrl: manifestEntry?.sourceUrl ?? null,
      source,
      levels,
      variantIssues,
      retention,
      score: 0,
      severity: "none",
      findings: [],
      recommendedAction: "Synthetic upload-test fixture; exclude from learner-facing catalogue metrics.",
    };
  }
  if (!advanced) {
    add("advanced artifact unavailable", 40);
  } else {
    if (advanced.melodyOnsets < 32) add(`very sparse RH melody candidate (${advanced.melodyOnsets} attacks)`, 20);
    else if (advanced.melodyOnsets < 64) add(`sparse RH melody candidate (${advanced.melodyOnsets} attacks)`, 10);
    if (advanced.melodyGapMax > 16) add(`RH melody gap ${round(advanced.melodyGapMax)} beats`, 18);
    else if (advanced.melodyGapMax > 8) add(`RH melody gap ${round(advanced.melodyGapMax)} beats`, 10);
    if (advanced.rhChordMean > 3) add(`RH chord-heavy (${round(advanced.rhChordMean)} notes/attack)`, 14);
    else if (advanced.rhChordMean > 2) add(`RH chord density ${round(advanced.rhChordMean)} notes/attack`, 8);
    if (advanced.lhNotes === 0 && advanced.notes > 100) add("no left-hand material", 25);
    else if (advanced.lhNotes / Math.max(1, advanced.notes) < 0.1) add(`left hand is only ${round(100 * advanced.lhNotes / advanced.notes, 1)}% of notes`, 14);
    if (advanced.lhNotes > 32 && advanced.lhSingleOnsetPct > 90) add(`LH is almost entirely single-note (${round(advanced.lhSingleOnsetPct, 1)}%)`, 6);
    if (advanced.lhLargestGap > 16) add(`LH support gap ${round(advanced.lhLargestGap)} beats`, 10);
    if (advanced.lhBassLeapP90 > 24) add(`LH bass leap p90 ${round(advanced.lhBassLeapP90)} semitones`, 8);
    if (advanced.crossHandPct > 25) add(`cross-hand pitch overlap ${round(advanced.crossHandPct, 1)}%`, 8);
    if (advanced.maxSimultaneous > 12) add(`simultaneous sounding notes ${advanced.maxSimultaneous}`, 20);
    else if (advanced.maxSimultaneous > 8) add(`dense sounding texture (${advanced.maxSimultaneous} simultaneous)`, 8);
    if (advanced.density > 6) add(`attack density ${round(advanced.density)} attacks/sec`, 8);
    if (advanced.samePitchOverlaps > 20) add(`${advanced.samePitchOverlaps} same-pitch overlaps`, 8);
    if (advanced.maxDur > 8) add(`long sustain ${round(advanced.maxDur)} beats`, 10);
    if (transcriptionDerived && advanced.p50DurSec <= 0.25 && advanced.pctOver1_5 <= 30 && advanced.density >= 3) {
      add(`transcription articulation fragmented (median ${round(advanced.p50DurSec)}s)`, 12);
    }
    if (transcriptionDerived && advanced.contiguousRetriggers >= 50 && advanced.retriggerRate >= 0.25) {
      add(`${round(100 * advanced.retriggerRate, 1)}% contiguous transcription retriggers`, 12);
    }
    if (retention.beginnerRhMelody < 0.5) add(`beginner RH melody retention ${round(100 * retention.beginnerRhMelody, 1)}%`, 12);
    if (retention.veryBeginnerRhMelody < 0.25) add(`very-beginner RH melody retention ${round(100 * retention.veryBeginnerRhMelody, 1)}%`, 8);
  }
  if (variantIssues.includes("advanced-equals-medium")) add("advanced and medium have equal note counts", 6);
  if (sourceConcern({
    baseId: row.baseId,
    title: row.title,
    artist: row.artist,
    syntheticFixture,
    category: row.category,
    contentType: row.contentType,
    acquiredVia: row.acquiredVia,
    sourceYoutubeUrl: row.sourceYoutubeUrl,
    manifestSourceUrl: manifestEntry?.sourceUrl ?? null,
    source,
    levels,
    variantIssues,
    retention,
    score: 0,
    severity: "none",
    findings: [],
    recommendedAction: "",
  })) {
    const audioByManifest = /youtube\.com|youtu\.be/i.test(manifestEntry?.sourceUrl ?? "") || row.category.toLowerCase() === "youtube";
    const audioByRow = AUDIO_TYPES.has(row.contentType) || row.acquiredVia === "youtube";
    if (audioByManifest && !audioByRow) add("YouTube provenance missing from row metadata", 15);
    if (source.explicitHandNotes > 0 && advanced && advanced.left.count + advanced.right.count < advanced.notes * 0.95) add("explicit source hand labels not preserved", 12);
    if (source.explicitLeftShare !== null && advanced && Math.abs(source.explicitLeftShare - advanced.left.count / Math.max(1, advanced.notes)) > 0.4) add("source/artifact hand balance diverges", 10);
    if (source.nonPianoTrackNames.length) add(`source includes non-piano tracks: ${source.nonPianoTrackNames.join(", ")}`, 8);
  }
  const severity = score >= 30 ? "high" : score >= 15 ? "medium" : score > 0 ? "low" : "none";
  const melodyIssue = findings.some((finding) => /melody|RH chord|RH melody|cross-hand/i.test(finding));
  const lhIssue = findings.some((finding) => /left-hand|left hand|LH |LH|bass/i.test(finding));
  const sourceIssue = findings.some((finding) => /source|provenance|track/i.test(finding));
  const playabilityIssue = findings.some((finding) => /simultaneous|density|overlap|sustain/i.test(finding));
  const recommendedAction = sourceIssue
    ? "Audit source track/provenance mapping before changing notes; preserve explicit RH/LH labels."
    : melodyIssue && lhIssue
      ? "Trace source-to-artifact lineage before restoring RH melody or LH support."
      : melodyIssue
        ? "Trace melody survival or use a source-backed re-transcription; preserve supported attacks."
        : lhIssue
          ? "Trace accompaniment evidence before changing LH bass or chord events."
          : playabilityIssue
            ? "Apply only a source-backed automatic cleanup and rerun structural evidence gates."
            : findings.length
              ? "Review the variant ladder and confirm the simplification is intentional."
              : "No learner-facing issue detected by these structural heuristics.";
  return {
    baseId: row.baseId,
    title: row.title,
    artist: row.artist,
    syntheticFixture,
    category: row.category,
    contentType: row.contentType,
    acquiredVia: row.acquiredVia,
    sourceYoutubeUrl: row.sourceYoutubeUrl,
    manifestSourceUrl: manifestEntry?.sourceUrl ?? null,
    source,
    levels,
    variantIssues,
    retention,
    score,
    severity,
    findings,
    recommendedAction,
  };
});

const metricSummary = (reports: LearnerReport[], key: keyof LevelMetric): Record<string, number> => {
  const values = reports.map((report) => report.levels.a?.[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    p50: round(quantile(values, 0.5)),
    p90: round(quantile(values, 0.9)),
    max: round(values.length ? Math.max(...values) : 0),
  };
};

const reportsWithFindings = baseResults.filter((report) => report.findings.length > 0);
const ranked = [...reportsWithFindings].sort((a, b) => b.score - a.score || a.baseId.localeCompare(b.baseId));
const severityCounts = Object.fromEntries(["high", "medium", "low", "none"].map((severity) => [severity, baseResults.filter((report) => report.severity === severity).length]));
const byContentType = Object.fromEntries(
  [...new Set(baseResults.map((report) => report.contentType))].sort().map((contentType) => {
    const subset = baseResults.filter((report) => report.contentType === contentType);
    return [contentType, {
      bases: subset.length,
      findings: subset.filter((report) => report.findings.length > 0).length,
      severity: Object.fromEntries(["high", "medium", "low"].map((severity) => [severity, subset.filter((report) => report.severity === severity).length])),
      advanced: {
        notes: metricSummary(subset, "notes"),
        rhOnsets: metricSummary(subset, "rhOnsets"),
        melodyOnsets: metricSummary(subset, "melodyOnsets"),
        rhChordMean: metricSummary(subset, "rhChordMean"),
        lhNotes: metricSummary(subset, "lhNotes"),
        lhChordOnsetPct: metricSummary(subset, "lhChordOnsetPct"),
        lhSingleOnsetPct: metricSummary(subset, "lhSingleOnsetPct"),
        melodyGapMax: metricSummary(subset, "melodyGapMax"),
        melodyLeapP90: metricSummary(subset, "melodyLeapP90"),
        crossHandPct: metricSummary(subset, "crossHandPct"),
        maxSimultaneous: metricSummary(subset, "maxSimultaneous"),
        samePitchOverlaps: metricSummary(subset, "samePitchOverlaps"),
      },
    }];
  }),
);

const compactFindings = args.all ? ranked : ranked.slice(0, args.top);
const report = {
  ...(args.canonical ? {} : { generatedAt: new Date().toISOString(), dataDir: dataDir() }),
  grain: "one DB base with six difficulty variants; advanced metrics are used for ranking",
  coverage: {
    dbBases: baseResults.length,
    dbRows: baseResults.length * LEVELS.length,
    completeSixLevelSets: baseResults.filter((result) => LEVELS.every((level) => result.levels[level])).length,
  },
  thresholds: {
    sparseMelody: "<64 RH melody attacks; <32 high risk",
    melodyGapBeats: ">8 warning, >16 high risk",
    lhSparse: "<10% of advanced notes",
    lhSingleOnly: ">90% single-note LH onsets",
    denseTexture: ">8 sounding notes or >6 attacks/sec",
    samePitchOverlap: ">20 advanced pairs",
    transcriptionRetriggers: ">=50 same-pitch restarts and >=25% of same-pitch transitions",
    sourceBalanceDrift: ">40 percentage points versus explicit source hand share",
  },
  severityCounts,
  byContentType,
  findingsCount: reportsWithFindings.length,
  rankedIssues: compactFindings.map(compact),
};
console.log(JSON.stringify(report, null, 2));
