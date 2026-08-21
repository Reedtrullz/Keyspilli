/**
 * Read-only catalogue quality report.
 *
 * The release gate answers "can these artifacts be published?" This report
 * answers the broader audit question: which bases are exposed, what source
 * and variant shape do they have, and which songs deserve normalization,
 * re-import, or musical review?
 *
 * Usage:
 *   npx tsx packages/catalog/scripts/quality-report.ts
 *   npx tsx packages/catalog/scripts/quality-report.ts --all
 *   npx tsx packages/catalog/scripts/quality-report.ts --top=50
 *
 * The default output is bounded (summary + the highest-risk bases). --all
 * includes one compact classification record for every database base.
 */
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getDb } from "../src/db.js";
import { blockedLearnerBases } from "../src/learner-review.js";
import { ROOT, artifactsDir, dataDir, seedMidiDir, transcribedDir } from "../src/paths.js";
import { resolveYoutubeSource } from "../src/youtube-source.js";
import { arrangementQualityReport, melodyContinuity, rhLhBalance, soundingDensity } from "@keyspilli/midi";

const LEVELS = ["vb", "b", "ve", "e", "m", "a"] as const;
const ADVANCED = "a";
const AUDIO_DUR_CAP_BEATS = 1.5;
const QUALITY_LEVELS = [
  "healthy",
  "needs automatic normalization",
  "needs source re-transcription/reimport",
  "needs curated/manual musical repair",
  "blocked because required source material is unavailable",
] as const;
type QualityClass = (typeof QUALITY_LEVELS)[number];

interface ManifestEntry {
  id: string;
  sourceFile?: string;
  sourceUrl?: string;
  disabled?: boolean;
}

interface Note {
  midi: number;
  start: number;
  dur: number;
  vel: number;
  hand?: "L" | "R";
}

interface VariantJson {
  notes: Note[];
  tempoBpm: number;
  key?: string;
  warnings?: string[];
}

interface LevelMetric {
  notes: number;
  tempoBpm: number;
  spanBeats: number;
  durationSec: number;
  onsetCount: number;
  onsetDensity: number;
  maxSimultaneous: number;
  medianDur: number;
  p90Dur: number;
  p99Dur: number;
  maxDur: number;
  pctDurOver1_5: number;
  pctDurOver2: number;
  pctDurOver4: number;
  pctDurOver8: number;
  velocityP50: number;
  velocityP90: number;
  velocityMin: number;
  velocityMax: number;
  largestOnsetGapBeats: number;
  leadingSilenceBeats: number;
  grid16Pct: number;
  duplicateNotes: number;
  samePitchOverlaps: number;
  malformedNotes: number;
  leftHandNotes: number;
  rightHandNotes: number;
  warnings: string[];
}

interface BaseReport {
  baseId: string;
  title: string;
  artist: string;
  category: string;
  contentType: string;
  acquiredVia: string | null;
  sourceYoutubeUrl: string | null;
  manifestSourceUrl: string | null;
  manifest: "enabled" | "disabled" | "not-listed";
  sourceFile: string | null;
  sourceAvailable: boolean;
  artifactLevels: string[];
  missingArtifacts: string[];
  levelMetrics: Partial<Record<(typeof LEVELS)[number], LevelMetric>>;
  variantIssues: string[];
  classification: QualityClass;
  findings: string[];
  arrangementQuality?: {
    melodyContinuity: number;
    rhRatio: number;
    lhRatio: number;
    crossingCount: number;
    density: number;
    flags: string[];
  };
}

function quantile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (index - lo);
}

function round(n: number, digits = 3): number {
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function metricSummary(reports: BaseReport[], key: keyof LevelMetric): Record<string, number> {
  const values = reports
    .map((r) => r.levelMetrics[ADVANCED]?.[key])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return {
    p50: round(quantile(values, 0.5)),
    p90: round(quantile(values, 0.9)),
    p99: round(quantile(values, 0.99)),
    max: round(values.length ? Math.max(...values) : 0),
  };
}

function inspectNotes(notes: Note[], tempoBpm: number, warnings: string[]): LevelMetric {
  const durs = notes.map((n) => n.dur).filter(Number.isFinite);
  const velocities = notes.map((n) => n.vel).filter(Number.isFinite);
  const starts = notes.map((n) => n.start).filter(Number.isFinite);
  const malformedNotes = notes.filter(
    (n) =>
      !Number.isFinite(n.midi) ||
      n.midi < 21 ||
      n.midi > 108 ||
      !Number.isFinite(n.start) ||
      n.start < 0 ||
      !Number.isFinite(n.dur) ||
      n.dur <= 0 ||
      !Number.isFinite(n.vel) ||
      n.vel < 0 ||
      n.vel > 127,
  ).length;

  const exact = new Map<string, number>();
  const samePitch = new Map<string, Note[]>();
  for (const note of notes) {
    const exactKey = `${note.midi}@${note.start.toFixed(6)}:${note.dur.toFixed(6)}:${note.hand ?? ""}`;
    exact.set(exactKey, (exact.get(exactKey) ?? 0) + 1);
    const pitchKey = `${note.hand === "L" ? "L" : "R"}:${note.midi}`;
    const group = samePitch.get(pitchKey) ?? [];
    group.push(note);
    samePitch.set(pitchKey, group);
  }
  const duplicateNotes = [...exact.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  let samePitchOverlaps = 0;
  for (const group of samePitch.values()) {
    group.sort((a, b) => a.start - b.start || a.dur - b.dur);
    for (let i = 0; i < group.length; i++) {
      const current = group[i]!;
      for (let j = i + 1; j < group.length && group[j]!.start < current.start + current.dur - 1e-9; j++) {
        if (Math.abs(group[j]!.start - current.start) > 1e-9) samePitchOverlaps++;
      }
    }
  }

  const events: [number, number][] = [];
  for (const note of notes) {
    if (!Number.isFinite(note.start) || !Number.isFinite(note.dur) || note.dur <= 0) continue;
    events.push([note.start, 1], [note.start + note.dur, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let sounding = 0;
  let maxSimultaneous = 0;
  for (const [, delta] of events) {
    sounding += delta;
    maxSimultaneous = Math.max(maxSimultaneous, sounding);
  }

  const onsetValues = [...new Set(starts.map((start) => start.toFixed(6)).map(Number))].sort((a, b) => a - b);
  const onsetGaps = onsetValues.slice(1).map((start, i) => start - onsetValues[i]!);
  const spanBeats = Math.max(0, ...notes.map((note) => note.start + note.dur).filter(Number.isFinite));
  const tempo = Number.isFinite(tempoBpm) && tempoBpm > 0 ? tempoBpm : 120;
  const durationSec = (spanBeats * 60) / tempo;
  return {
    notes: notes.length,
    tempoBpm: tempo,
    spanBeats,
    durationSec,
    onsetCount: onsetValues.length,
    onsetDensity: durationSec > 0 ? onsetValues.length / durationSec : 0,
    maxSimultaneous,
    medianDur: quantile(durs, 0.5),
    p90Dur: quantile(durs, 0.9),
    p99Dur: quantile(durs, 0.99),
    maxDur: durs.length ? Math.max(...durs) : 0,
    pctDurOver1_5: (100 * durs.filter((dur) => dur > 1.5).length) / Math.max(1, durs.length),
    pctDurOver2: (100 * durs.filter((dur) => dur > 2).length) / Math.max(1, durs.length),
    pctDurOver4: (100 * durs.filter((dur) => dur > 4).length) / Math.max(1, durs.length),
    pctDurOver8: (100 * durs.filter((dur) => dur > 8).length) / Math.max(1, durs.length),
    velocityP50: quantile(velocities, 0.5),
    velocityP90: quantile(velocities, 0.9),
    velocityMin: velocities.length ? Math.min(...velocities) : 0,
    velocityMax: velocities.length ? Math.max(...velocities) : 0,
    largestOnsetGapBeats: onsetGaps.length ? Math.max(...onsetGaps) : 0,
    leadingSilenceBeats: onsetValues.length ? onsetValues[0]! : 0,
    grid16Pct: (100 * notes.filter((note) => Math.abs(note.start / 0.25 - Math.round(note.start / 0.25)) < 1e-6).length) / Math.max(1, notes.length),
    duplicateNotes,
    samePitchOverlaps,
    malformedNotes,
    leftHandNotes: notes.filter((note) => note.hand === "L").length,
    rightHandNotes: notes.filter((note) => note.hand !== "L").length,
    warnings,
  };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

function classify(report: BaseReport): QualityClass {
  if (report.missingArtifacts.length) {
    return report.sourceAvailable
      ? "needs source re-transcription/reimport"
      : "blocked because required source material is unavailable";
  }
  const advanced = report.levelMetrics[ADVANCED];
  if (!advanced) return report.sourceAvailable ? "needs source re-transcription/reimport" : "blocked because required source material is unavailable";
  const audioDerived =
    report.contentType === "youtube" ||
    report.acquiredVia === "youtube" ||
    report.category.toLowerCase() === "youtube" ||
    /youtube\.com|youtu\.be/i.test(report.manifestSourceUrl ?? "");
  if (advanced.malformedNotes > 0 || advanced.duplicateNotes > 0) {
    return audioDerived ? "needs source re-transcription/reimport" : "needs curated/manual musical repair";
  }
  if (audioDerived && advanced.maxDur > AUDIO_DUR_CAP_BEATS + 1e-9) return "needs automatic normalization";
  if (audioDerived && advanced.largestOnsetGapBeats > 16) return "needs source re-transcription/reimport";
  if (
    report.variantIssues.includes("advanced-equals-medium") ||
    advanced.samePitchOverlaps >= 20 ||
    advanced.warnings.length > 0 ||
    (!audioDerived && advanced.largestOnsetGapBeats > 16)
  ) {
    return "needs curated/manual musical repair";
  }
  return "healthy";
}

function parseArgs(): { all: boolean; top: number } {
  const all = process.argv.includes("--all");
  const raw = process.argv.find((arg) => arg.startsWith("--top="))?.slice("--top=".length);
  const parsed = raw ? Number(raw) : 25;
  return { all, top: Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 25 };
}

const args = parseArgs();
const db = getDb();
const rows = db
  .prepare(
    `SELECT base_id AS baseId, title, artist, category, content_type AS contentType,
            acquired_via AS acquiredVia, source_youtube_url AS sourceYoutubeUrl,
            level, tempo, duration
       FROM songs
      ORDER BY base_id, level`,
  )
  .all() as Array<{
  baseId: string;
  title: string;
  artist: string;
  category: string;
  contentType: string;
  acquiredVia: string | null;
  sourceYoutubeUrl: string | null;
  level: string;
  tempo: number;
  duration: number;
}>;

const manifest = await readFile(join(ROOT, "catalog", "manifest.json"), "utf8")
  .then((raw) => JSON.parse(raw) as { generatedAt?: string; songs?: ManifestEntry[] })
  .catch(() => ({ generatedAt: undefined, songs: [] as ManifestEntry[] }));
const manifestById = new Map((manifest.songs ?? []).map((entry) => [entry.id, entry]));
const seedFiles = new Set((await readdir(seedMidiDir()).catch(() => [] as string[])).filter((file) => file.endsWith(".mid")));
const transcribedDirs = new Set<string>();
for (const entry of await readdir(transcribedDir(), { withFileTypes: true }).catch(() => [])) {
  if (!entry.isDirectory()) continue;
  // Use the same validated root/strict/auto source boundary as rebuilds so a
  // strict MIDI paired with root audio is not misclassified as unavailable.
  if (await resolveYoutubeSource(join(transcribedDir(), entry.name), "auto")) {
    transcribedDirs.add(entry.name);
  }
}
const uploadFiles = new Set(
  (await readdir(join(dataDir(), "uploads")).catch(() => [] as string[])).filter((file) => /\.(mid|midi|xml|musicxml|mxl)$/i.test(file)),
);
const dbByBase = new Map<string, (typeof rows)[number]>();
for (const row of rows) if (!dbByBase.has(row.baseId)) dbByBase.set(row.baseId, row);

const reports: BaseReport[] = [];
for (const [baseId, row] of dbByBase) {
  const manifestEntry = manifestById.get(baseId);
  const sourceFile = manifestEntry?.sourceFile ?? (seedFiles.has(`${baseId}.mid`) ? `${baseId}.mid` : null);
  const youtubeJobIds = (db
    .prepare("SELECT id FROM conversion_jobs WHERE song_id = ? OR song_id LIKE ?")
    .all(`${baseId}-e`, `${baseId}-%`) as Array<{ id: string }>).map((job) => job.id);
  const hasTranscribedSource = youtubeJobIds.some((jobId) => transcribedDirs.has(jobId));
  const hasUploadSource = [...uploadFiles].some((file) => file.toLowerCase().startsWith(`${baseId.toLowerCase()}.`));
  const sourceAvailable = Boolean(
    (sourceFile && seedFiles.has(sourceFile)) ||
      hasTranscribedSource ||
      hasUploadSource,
  );
  const artifactLevels: string[] = [];
  const missingArtifacts: string[] = [];
  const levelMetrics: BaseReport["levelMetrics"] = {};
  for (const level of LEVELS) {
    const dir = artifactsDir(baseId, level);
    const required = ["notes.json", "variant.mid", "variant.xml"];
    const missing = [] as string[];
    for (const file of required) if (!(await exists(join(dir, file)))) missing.push(`${level}/${file}`);
    if (missing.length) {
      missingArtifacts.push(...missing);
      continue;
    }
    try {
      const variant = JSON.parse(await readFile(join(dir, "notes.json"), "utf8")) as VariantJson;
      levelMetrics[level] = inspectNotes(variant.notes, variant.tempoBpm, variant.warnings ?? []);
      artifactLevels.push(level);
    } catch {
      missingArtifacts.push(`${level}/notes.json (invalid JSON)`);
    }
  }
  const variantIssues: string[] = [];
  const advanced = levelMetrics.a;
  const medium = levelMetrics.m;
  if (advanced && medium && advanced.notes === medium.notes) variantIssues.push("advanced-equals-medium");
  if (advanced && medium && advanced.tempoBpm !== medium.tempoBpm) variantIssues.push("tempo-mismatch");
  const levelCounts = LEVELS.map((level) => levelMetrics[level]?.notes);
  if (levelCounts.some((count, i) => i > 0 && count !== undefined && levelCounts[i - 1] !== undefined && count < levelCounts[i - 1]!)) {
    variantIssues.push("difficulty-count-not-monotonic");
  }
  const report: BaseReport = {
    baseId,
    title: row.title,
    artist: row.artist,
    category: row.category,
    contentType: row.contentType,
    acquiredVia: row.acquiredVia,
    sourceYoutubeUrl: row.sourceYoutubeUrl,
    manifestSourceUrl: manifestEntry?.sourceUrl ?? null,
    manifest: manifestEntry ? (manifestEntry.disabled ? "disabled" : "enabled") : "not-listed",
    sourceFile,
    sourceAvailable,
    artifactLevels,
    missingArtifacts,
    levelMetrics,
    variantIssues,
    classification: "healthy",
    findings: [],
  };
  if (advanced) {
    const manifestYoutube =
      row.category.toLowerCase() === "youtube" ||
      /youtube\.com|youtu\.be/i.test(manifestEntry?.sourceUrl ?? "");
    const audioDerived = row.contentType === "youtube" || row.acquiredVia === "youtube" || manifestYoutube;
    if (manifestYoutube && row.contentType !== "youtube" && row.acquiredVia !== "youtube") {
      report.findings.push("YouTube provenance is not represented in contentType/acquiredVia");
    }
    if (advanced.maxDur > AUDIO_DUR_CAP_BEATS && audioDerived) report.findings.push(`audio-derived max duration ${round(advanced.maxDur)} beats > ${AUDIO_DUR_CAP_BEATS}`);
    if (advanced.pctDurOver8 > 0) report.findings.push(`${round(advanced.pctDurOver8, 1)}% of advanced notes > 8 beats`);
    if (advanced.samePitchOverlaps > 0) report.findings.push(`${advanced.samePitchOverlaps} same-pitch overlapping attacks`);
    if (advanced.duplicateNotes > 0) report.findings.push(`${advanced.duplicateNotes} exact duplicate notes`);
    if (advanced.malformedNotes > 0) report.findings.push(`${advanced.malformedNotes} malformed notes`);
    if (advanced.largestOnsetGapBeats > 16) report.findings.push(`largest onset gap ${round(advanced.largestOnsetGapBeats)} beats`);
    if (advanced.warnings.length) report.findings.push(...advanced.warnings);
  }
  // Attach library-computed arrangement quality for the advanced variant when
  // its notes are available. This replaces ad-hoc metric duplication with the
  // tested shared functions.
  const advNotes = levelMetrics.a ? undefined : undefined; // notes not stored on LevelMetric
  try {
    const advDir = join(dataDir(), "artifacts", baseId, "a");
    const advRaw = await readFile(join(advDir, "notes.json"), "utf8");
    const advData = JSON.parse(advRaw) as { notes: import("@keyspilli/midi").Note[]; durationBeats?: number };
    if (Array.isArray(advData.notes) && advData.notes.length > 0) {
      const durationBeats = advData.durationBeats ?? advData.notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
      const aq = arrangementQualityReport(advData.notes, durationBeats);
      const balance = rhLhBalance(advData.notes);
      report.arrangementQuality = {
        melodyContinuity: round(melodyContinuity(advData.notes), 3),
        rhRatio: round(balance.rhRatio, 3),
        lhRatio: round(balance.lhRatio, 3),
        crossingCount: balance.crossingCount,
        density: round(soundingDensity(advData.notes, durationBeats), 3),
        flags: aq.flags,
      };
    }
  } catch {
    // Arrangement quality is supplementary; never block the main report.
  }
  report.findings.push(...variantIssues);
  report.classification = classify(report);
  reports.push(report);
}

const artifactEntries = await readdir(join(dataDir(), "artifacts"), { withFileTypes: true }).catch(() => []);
const artifactBases = artifactEntries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
const dbBases = [...dbByBase.keys()].sort();
const manifestEnabled = (manifest.songs ?? []).filter((entry) => !entry.disabled).map((entry) => entry.id);
const manifestDisabled = (manifest.songs ?? []).filter((entry) => entry.disabled).map((entry) => entry.id);
const blockedBases = blockedLearnerBases();
const hiddenBases = new Set([...manifestDisabled, ...blockedBases]);
const manifestMissingInDb = manifestEnabled.filter((id) => !dbByBase.has(id));
const dbNotInManifest = dbBases.filter((id) => !manifestById.has(id));
const artifactNotInDb = artifactBases.filter((id) => !dbByBase.has(id));
const dbNotInArtifacts = dbBases.filter((id) => !artifactBases.includes(id));
const conversionJobs = db
  .prepare("SELECT id, status, song_id AS songId FROM conversion_jobs ORDER BY created_at, id")
  .all() as Array<{ id: string; status: string; songId: string | null }>;
const conversionJobBaseId = (songId: string | null): string | null => {
  if (!songId) return null;
  return songId.replace(/-(?:vb|b|ve|e|m|a)$/, "");
};
const orphanConversionJobs = conversionJobs.filter((job) => {
  const baseId = conversionJobBaseId(job.songId);
  return Boolean(baseId && !dbByBase.has(baseId));
});
const conversionJobsByStatus = Object.fromEntries(
  [...new Set(conversionJobs.map((job) => job.status))].sort().map((status) => [status, conversionJobs.filter((job) => job.status === status).length]),
);
const counts = Object.fromEntries(QUALITY_LEVELS.map((quality) => [quality, reports.filter((report) => report.classification === quality).length]));
const byContentType = Object.fromEntries(
  [...new Set(reports.map((report) => report.contentType))].sort().map((contentType) => {
    const subset = reports.filter((report) => report.contentType === contentType);
    return [contentType, {
      bases: subset.length,
      rows: subset.length * LEVELS.length,
      classification: Object.fromEntries(QUALITY_LEVELS.map((quality) => [quality, subset.filter((report) => report.classification === quality).length])),
      advanced: {
        notes: metricSummary(subset, "notes"),
        medianDur: metricSummary(subset, "medianDur"),
        p90Dur: metricSummary(subset, "p90Dur"),
        p99Dur: metricSummary(subset, "p99Dur"),
        maxDur: metricSummary(subset, "maxDur"),
        pctOver1_5: metricSummary(subset, "pctDurOver1_5"),
        pctOver2: metricSummary(subset, "pctDurOver2"),
        pctOver4: metricSummary(subset, "pctDurOver4"),
        pctOver8: metricSummary(subset, "pctDurOver8"),
        velocityP50: metricSummary(subset, "velocityP50"),
        velocityP90: metricSummary(subset, "velocityP90"),
        onsetDensity: metricSummary(subset, "onsetDensity"),
        grid16Pct: metricSummary(subset, "grid16Pct"),
        samePitchOverlaps: metricSummary(subset, "samePitchOverlaps"),
        duplicateNotes: metricSummary(subset, "duplicateNotes"),
        largestOnsetGapBeats: metricSummary(subset, "largestOnsetGapBeats"),
      },
    }];
  }),
);

const riskRank: Record<QualityClass, number> = {
  "blocked because required source material is unavailable": 5,
  "needs source re-transcription/reimport": 4,
  "needs curated/manual musical repair": 3,
  "needs automatic normalization": 2,
  healthy: 1,
};
const suspicious = reports
  .filter((report) => report.classification !== "healthy")
  .sort((a, b) => riskRank[b.classification]! - riskRank[a.classification]! || b.findings.length - a.findings.length || a.baseId.localeCompare(b.baseId));

function compactReport(report: BaseReport) {
  const advanced = report.levelMetrics[ADVANCED];
  return {
    baseId: report.baseId,
    title: report.title,
    artist: report.artist,
    contentType: report.contentType,
    acquiredVia: report.acquiredVia,
    sourceFile: report.sourceFile,
    classification: report.classification,
    findings: report.findings,
    arrangementQuality: report.arrangementQuality ?? undefined,
    advanced: advanced
      ? {
          notes: advanced.notes,
          tempoBpm: round(advanced.tempoBpm),
          maxDur: round(advanced.maxDur),
          pctDurOver1_5: round(advanced.pctDurOver1_5, 1),
          pctDurOver2: round(advanced.pctDurOver2, 1),
          pctDurOver4: round(advanced.pctDurOver4, 1),
          pctDurOver8: round(advanced.pctDurOver8, 1),
          velocityP50: round(advanced.velocityP50, 1),
          velocityP90: round(advanced.velocityP90, 1),
          onsetDensity: round(advanced.onsetDensity),
          grid16Pct: round(advanced.grid16Pct, 1),
          maxSimultaneous: advanced.maxSimultaneous,
          samePitchOverlaps: advanced.samePitchOverlaps,
          duplicateNotes: advanced.duplicateNotes,
          largestOnsetGapBeats: round(advanced.largestOnsetGapBeats),
          leftHandNotes: advanced.leftHandNotes,
          rightHandNotes: advanced.rightHandNotes,
        }
      : null,
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  dataDir: dataDir(),
  manifest: {
    generatedAt: manifest.generatedAt ?? null,
    totalEntries: (manifest.songs ?? []).length,
    enabledEntries: manifestEnabled.length,
    disabledEntries: manifestDisabled.length,
    disabledIds: manifestDisabled,
    enabledMissingInDb: manifestMissingInDb,
  },
  coverage: {
    dbBases: dbBases.length,
    dbRows: rows.length,
    publicDbBases: dbBases.filter((id) => !hiddenBases.has(id)).length,
    publicDbRows: rows.filter((row) => !hiddenBases.has(row.baseId)).length,
    expectedRowsFromSixLevels: dbBases.length * LEVELS.length,
    artifactBases: artifactBases.length,
    dbNotInManifestCount: dbNotInManifest.length,
    dbNotInManifestSample: args.all ? dbNotInManifest : dbNotInManifest.slice(0, 25),
    disabledManifestPresentInDb: manifestDisabled.filter((id) => dbByBase.has(id)),
    blockedLearnerPresentInDb: [...blockedBases].filter((id) => dbByBase.has(id)),
    artifactNotInDbCount: artifactNotInDb.length,
    artifactNotInDb,
    dbNotInArtifactsCount: dbNotInArtifacts.length,
    dbNotInArtifacts,
    basesWithSixArtifacts: reports.filter((r) => r.artifactLevels.length === LEVELS.length && r.missingArtifacts.length === 0).length,
    conversionJobs: {
      total: conversionJobs.length,
      byStatus: conversionJobsByStatus,
      orphanCount: orphanConversionJobs.length,
      orphan: (args.all ? orphanConversionJobs : orphanConversionJobs.slice(0, 25)).map((job) => ({
        id: job.id,
        status: job.status,
        songId: job.songId,
        baseId: conversionJobBaseId(job.songId),
      })),
    },
  },
  checks: {
    verifierEquivalent: "Run npm run verify-catalog for the fail-closed artifact/ladder gate; this report is diagnostic and classifies musical risk.",
    thresholds: { audioDerivedMaxDurBeats: AUDIO_DUR_CAP_BEATS, largestGapReimportBeats: 16, samePitchManualReviewCount: 20 },
  },
  classifications: counts,
  byContentType,
  suspiciousCount: suspicious.length,
  suspicious: (args.all ? suspicious : suspicious.slice(0, args.top)).map(compactReport),
};

console.log(JSON.stringify(report, null, 2));
