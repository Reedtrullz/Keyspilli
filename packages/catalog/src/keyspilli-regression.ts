/**
 * Local-only, multi-song Keyspilli regression helpers.
 *
 * This adapter intentionally consumes already-built partial OMR references and
 * in-memory candidate notes. It never discovers, downloads, publishes, or
 * copies score/audio material. Unknown OMR regions are omitted from evaluation
 * rather than being treated as rests or failed candidate output.
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Note, ParsedMidi } from "@keyspilli/midi";
import {
  evaluateArrangement,
  type ArrangementEvaluationCandidate,
  type ArrangementEvaluationReport,
  type EvaluationWindow,
} from "./arrangement-evaluation.js";
import { sha256Hex } from "./fixture-evidence.js";
import {
  type PartialScoreReference,
  type RoleCoverage,
  type TrustedRole,
  type TrustedRoleEvent,
} from "./omr-role-reference.js";

export const KEYSPELLI_REGRESSION_SCHEMA_VERSION = 1 as const;
const ROLES: readonly TrustedRole[] = ["melody", "harmony", "rhythm"];
const ONSET_TOLERANCE = 0.125;

export interface KeyspilliCandidate extends ArrangementEvaluationCandidate {
  /** Optional explicit role lanes; this avoids guessing from hand/source labels. */
  roleNotes?: Partial<Record<TrustedRole, readonly Note[]>>;
}

export interface KeyspilliRegressionSong {
  id: string;
  artist?: string;
  title?: string;
  reference: PartialScoreReference;
  candidate: KeyspilliCandidate;
  expectedDurationBeats?: number;
}

export interface PartialRoleMetrics {
  exactPitch: { precision: number | null; recall: number | null; f1: number | null };
  pitchClass: { precision: number | null; recall: number | null; f1: number | null };
  onset: { precision: number | null; recall: number | null; f1: number | null };
  contour: { p95Leap: number | null; directionAgreement: number | null };
  ioi: { candidateMedian: number | null; referenceMedian: number | null };
  density: { candidate: number | null; reference: number | null };
  /** Harmony role aliases make its chroma/root checks explicit. */
  chroma: { precision: number | null; recall: number | null; f1: number | null };
  root: { matchRate: number | null; matched: number; compared: number };
}

export interface PartialRoleEvaluation {
  role: TrustedRole;
  status: "evaluated" | "ineligible";
  trustedRegionIds: string[];
  skippedRegionIds: string[];
  coverage: RoleCoverage;
  evaluatedBeatSpan: number;
  metrics: PartialRoleMetrics;
  failureClusters: string[];
  report?: ArrangementEvaluationReport;
}

export interface KeyspilliRegressionSongResult {
  songId: string;
  artist: string | null;
  title: string | null;
  baseline: {
    noteCount: number;
    durationBeats: number;
    arrangement: ArrangementEvaluationReport["metrics"];
  };
  roles: Record<TrustedRole, PartialRoleEvaluation>;
  failureClusters: string[];
}

export interface KeyspilliRoleAggregate {
  songsEligible: number;
  songsEvaluated: number;
  coverageMedian: number | null;
  exactPitchF1Median: number | null;
  pitchClassF1Median: number | null;
  onsetF1Median: number | null;
  failureClusters: string[];
}

export interface KeyspilliRegressionReport {
  schemaVersion: typeof KEYSPELLI_REGRESSION_SCHEMA_VERSION;
  kind: "keyspilli-multi-song-regression";
  songs: KeyspilliRegressionSongResult[];
  aggregate: {
    songs: number;
    roles: Record<TrustedRole, KeyspilliRoleAggregate>;
  };
  nonClaims: string[];
  determinism: { canonicalSha256: string };
}

export interface WriteKeyspilliRegressionOptions {
  fileName?: string;
}

export interface WrittenKeyspilliRegressionReport {
  path: string;
  json: string;
  report: KeyspilliRegressionReport;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = (sorted.length - 1) / 2;
  const low = Math.floor(middle);
  const high = Math.ceil(middle);
  return round(sorted[low]! + (sorted[high]! - sorted[low]!) * (middle - low));
}

function emptyMetrics(): PartialRoleMetrics {
  const empty = () => ({ precision: null, recall: null, f1: null });
  return {
    exactPitch: empty(), pitchClass: empty(), onset: empty(), chroma: empty(),
    contour: { p95Leap: null, directionAgreement: null },
    ioi: { candidateMedian: null, referenceMedian: null },
    density: { candidate: null, reference: null },
    root: { matchRate: null, matched: 0, compared: 0 },
  };
}

function trusted(state: unknown): boolean {
  return state === "TRUSTED_NATIVE" || state === "TRUSTED_CONSENSUS" || state === "TRUSTED_SINGLE_ENGINE";
}

function noteFromReference(event: TrustedRoleEvent): Note {
  return {
    midi: event.midi,
    start: event.onset,
    dur: event.duration,
    vel: 127,
    hand: event.role === "harmony" ? "L" : "R",
    identitySource: event.role === "melody" ? "vocals" : event.role === "harmony" ? "guitar" : "other",
  };
}

function parsedFor(notes: readonly Note[], durationBeats: number): ParsedMidi {
  return {
    format: 1, division: 480, tempoBpm: 120, keySig: 0, keyMode: 0,
    timeSig: [4, 4], notes: [...notes], trackNames: ["partial-reference"],
    durationBeats: Math.max(durationBeats, ...notes.map((note) => note.start + note.dur), 0),
  };
}

function notesForCandidate(candidate: KeyspilliCandidate, role: TrustedRole): Note[] {
  const explicit = candidate.roleNotes?.[role];
  if (explicit) return [...explicit];
  const notes = candidate.notes ?? candidate.parsed?.notes ?? [];
  if (role === "melody") return notes.filter((note) => note.identitySource === "vocals" || (note.identitySource === undefined && note.hand === "R"));
  if (role === "harmony") return notes.filter((note) => note.identitySource === "guitar" || (note.identitySource === undefined && note.hand === "L"));
  return [...notes];
}

function trustedRegions(reference: PartialScoreReference, role: TrustedRole): PartialScoreReference["regions"] {
  return reference.regions.filter((region) => {
    const cell = region.roles[role];
    return Boolean(cell && trusted(cell.state) && cell.eventCount > 0 && !region.unknownRoles.includes(role));
  });
}

function roleEvents(reference: PartialScoreReference, role: TrustedRole, regions: readonly PartialScoreReference["regions"][number][]): TrustedRoleEvent[] {
  const allowed = new Set(regions.flatMap((region) => region.roles[role].eventIds));
  return reference.lanes[role].filter((event) => allowed.has(event.id)).map((event) => ({ ...event }));
}

function f1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null || precision + recall <= 0) return precision === 0 && recall === 0 ? 0 : null;
  return round((2 * precision * recall) / (precision + recall));
}

function onsetGroups(notes: readonly Note[]): Note[][] {
  const sorted = [...notes].sort((left, right) => left.start - right.start || left.midi - right.midi);
  const groups: Note[][] = [];
  for (const note of sorted) {
    const previous = groups.at(-1);
    if (previous && note.start - previous[0]!.start <= ONSET_TOLERANCE) previous.push(note);
    else groups.push([note]);
  }
  return groups;
}

function rootComparison(candidate: readonly Note[], reference: readonly Note[], windows: readonly EvaluationWindow[]): PartialRoleMetrics["root"] {
  let matched = 0;
  let compared = 0;
  for (const window of windows) {
    const c = onsetGroups(candidate.filter((note) => note.start >= window.candidate[0] && note.start < window.candidate[1]));
    const r = onsetGroups(reference.filter((note) => note.start >= (window.reference?.[0] ?? window.candidate[0]) && note.start < (window.reference?.[1] ?? window.candidate[1])));
    for (const group of r) {
      const referenceRoot = Math.min(...group.map((note) => note.midi)) % 12;
      const candidateGroup = c.find((value) => Math.abs(value[0]!.start - group[0]!.start) <= ONSET_TOLERANCE);
      if (!candidateGroup) continue;
      compared++;
      if (Math.min(...candidateGroup.map((note) => note.midi)) % 12 === referenceRoot) matched++;
    }
  }
  return { matchRate: compared ? round(matched / compared) : null, matched, compared };
}

function roleMetrics(report: ArrangementEvaluationReport, candidate: readonly Note[], reference: readonly Note[], windows: readonly EvaluationWindow[], role: TrustedRole): PartialRoleMetrics {
  const value = report.reference;
  if (!value) return emptyMetrics();
  const onsetPrecision = value.windows.reduce((sum, window) => sum + window.matchedOnsets, 0);
  const candidateOnsets = value.windows.reduce((sum, window) => sum + window.candidateOnsetCount, 0);
  const referenceOnsets = value.windows.reduce((sum, window) => sum + window.referenceOnsetCount, 0);
  const onsetP = candidateOnsets ? round(onsetPrecision / candidateOnsets) : referenceOnsets ? 0 : null;
  const onsetR = referenceOnsets ? round(onsetPrecision / referenceOnsets) : candidateOnsets ? 0 : null;
  const metrics: PartialRoleMetrics = {
    exactPitch: value.exactPitch,
    pitchClass: value.pitchClass,
    onset: { precision: onsetP, recall: onsetR, f1: f1(onsetP, onsetR) },
    contour: {
      p95Leap: median(value.windows.map((window) => window.contour.p95Leap).filter((entry): entry is number => entry !== null)),
      directionAgreement: median(value.windows.map((window) => window.contour.directionAgreement).filter((entry): entry is number => entry !== null)),
    },
    ioi: {
      candidateMedian: median(value.windows.map((window) => window.ioi.candidateMedian).filter((entry): entry is number => entry !== null)),
      referenceMedian: median(value.windows.map((window) => window.ioi.referenceMedian).filter((entry): entry is number => entry !== null)),
    },
    density: {
      candidate: median(value.windows.map((window) => window.density.candidate)),
      reference: median(value.windows.map((window) => window.density.reference)),
    },
    chroma: value.pitchClass,
    root: rootComparison(candidate, reference, windows),
  };
  // The same exact/pitch-class fields are deliberately retained for every
  // role; role-specific aliases make downstream tables self-explanatory.
  void role;
  return metrics;
}

function failureClusters(role: TrustedRole, metrics: PartialRoleMetrics): string[] {
  const failures: string[] = [];
  if (metrics.exactPitch.f1 !== null && metrics.exactPitch.f1 < 1) failures.push(`${role}:exact-pitch`);
  if (metrics.pitchClass.f1 !== null && metrics.pitchClass.f1 < 1) failures.push(`${role}:pitch-class`);
  if (metrics.onset.f1 !== null && metrics.onset.f1 < 1) failures.push(`${role}:onset`);
  if (role === "harmony" && metrics.root.matchRate !== null && metrics.root.matchRate < 1) failures.push("harmony:root");
  return failures.sort(compareText);
}

function roleEvaluation(song: KeyspilliRegressionSong, role: TrustedRole): PartialRoleEvaluation {
  const coverage = song.reference.coverage[role];
  const regions = trustedRegions(song.reference, role);
  const skippedRegionIds = song.reference.regions.filter((region) => !regions.includes(region)).map((region) => region.id).sort(compareText);
  const base = {
    role,
    trustedRegionIds: regions.map((region) => region.id).sort(compareText),
    skippedRegionIds,
    coverage,
    evaluatedBeatSpan: round(regions.reduce((sum, region) => sum + Math.max(0, region.endBeat - region.startBeat), 0)),
  };
  if (!regions.length) return { ...base, status: "ineligible", metrics: emptyMetrics(), failureClusters: [] };
  const referenceEvents = roleEvents(song.reference, role, regions);
  const referenceNotes = referenceEvents.map(noteFromReference);
  const candidateNotes = notesForCandidate(song.candidate, role);
  const windows: EvaluationWindow[] = regions.map((region) => ({ id: region.id, candidate: [region.startBeat, region.endBeat], reference: [region.startBeat, region.endBeat] }));
  const report = evaluateArrangement({
    fixture: { id: `${song.id}:${role}` },
    candidate: { ...song.candidate, selector: `${song.candidate.selector}:${role}`, notes: candidateNotes, parsed: undefined },
    reference: { selector: `partial:${song.id}:${role}`, parsed: parsedFor(referenceNotes, song.reference.regions.at(-1)?.endBeat ?? 0), windows },
    windows,
    mode: "reference",
  });
  const metrics = roleMetrics(report, candidateNotes, referenceNotes, windows, role);
  return { ...base, status: "evaluated", metrics, failureClusters: failureClusters(role, metrics), report };
}

function aggregateRole(rows: readonly KeyspilliRegressionSongResult[], role: TrustedRole): KeyspilliRoleAggregate {
  const evaluated = rows.map((row) => row.roles[role]).filter((entry) => entry.status === "evaluated");
  const values = (selector: (entry: PartialRoleEvaluation) => number | null) => evaluated.map(selector).filter((value): value is number => value !== null);
  return {
    songsEligible: rows.filter((row) => row.roles[role].coverage.trustedEventCount > 0).length,
    songsEvaluated: evaluated.length,
    coverageMedian: median(values((entry) => entry.coverage.coverage)),
    exactPitchF1Median: median(values((entry) => entry.metrics.exactPitch.f1)),
    pitchClassF1Median: median(values((entry) => entry.metrics.pitchClass.f1)),
    onsetF1Median: median(values((entry) => entry.metrics.onset.f1)),
    failureClusters: [...new Set(evaluated.flatMap((entry) => entry.failureClusters))].sort(compareText),
  };
}

function canonicalize(value: unknown, key?: string): unknown {
  if (key === "report" || key === "selector" || key === "path" || key === "candidate") return undefined;
  if (typeof value === "string") return value.replaceAll(/(?:^|[\\/])(?:Users|private|tmp|var|home|root)[\\/][^\\s"']*/gi, "[redacted-path]");
  if (Array.isArray(value)) return value.map((item) => canonicalize(item)).filter((item) => item !== undefined);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const objectKey of Object.keys(value as Record<string, unknown>).sort(compareText)) {
      const item = canonicalize((value as Record<string, unknown>)[objectKey], objectKey);
      if (item !== undefined) output[objectKey] = item;
    }
    return output;
  }
  return value;
}

export function canonicalKeyspilliRegressionJson(report: KeyspilliRegressionReport): string {
  return JSON.stringify(canonicalize({ ...report, determinism: undefined }));
}

export function runKeyspilliRegression(songs: readonly KeyspilliRegressionSong[]): KeyspilliRegressionReport {
  const rows = [...songs].map((song) => ({ ...song, id: String(song.id).trim() })).sort((left, right) => compareText(left.id, right.id)).map((song) => {
    const candidateNotes = song.candidate.notes ?? song.candidate.parsed?.notes ?? [];
    const baselineReport = evaluateArrangement({
      fixture: { id: song.id, ...(song.title ? { label: song.title } : {}) },
      candidate: song.candidate,
      expectedDurationBeats: song.expectedDurationBeats,
      mode: "structural",
    });
    const roleResults = Object.fromEntries(ROLES.map((role) => [role, roleEvaluation(song, role)])) as Record<TrustedRole, PartialRoleEvaluation>;
    const failureClusters = [...new Set([...ROLES.flatMap((role) => roleResults[role].failureClusters), ...baselineReport.gate.failures.map((failure) => `arrangement:${failure}`)])].sort(compareText);
    return {
      songId: song.id,
      artist: typeof song.artist === "string" && song.artist.trim() ? song.artist.trim() : null,
      title: typeof song.title === "string" && song.title.trim() ? song.title.trim() : null,
      baseline: { noteCount: candidateNotes.length, durationBeats: baselineReport.candidate.parser.durationBeats, arrangement: baselineReport.metrics },
      roles: roleResults,
      failureClusters,
    } satisfies KeyspilliRegressionSongResult;
  });
  const aggregate = { songs: rows.length, roles: Object.fromEntries(ROLES.map((role) => [role, aggregateRole(rows, role)])) as Record<TrustedRole, KeyspilliRoleAggregate> };
  const withoutHash = {
    schemaVersion: KEYSPELLI_REGRESSION_SCHEMA_VERSION,
    kind: "keyspilli-multi-song-regression" as const,
    songs: rows,
    aggregate,
    nonClaims: [
      "Only trusted role regions are evaluated; unknown OMR spans are not rests and do not count as candidate failures.",
      "A trusted OMR lane is a benchmark reference projection, not proof of notation correctness or piano playability.",
      "Aggregate medians exclude ineligible roles and do not hide missing role coverage.",
    ],
  };
  const canonical = JSON.stringify(canonicalize(withoutHash));
  return { ...withoutHash, determinism: { canonicalSha256: sha256Hex(new TextEncoder().encode(canonical)) } };
}

function safeFileName(value: string): string {
  const fileName = value.trim();
  if (!fileName || basename(fileName) !== fileName || !/^[A-Za-z0-9._-]+\.json$/i.test(fileName)) throw new Error("fileName must be a path-safe JSON file name");
  return fileName;
}

export async function writeKeyspilliRegressionReport(outputDirectory: string, report: KeyspilliRegressionReport, options: WriteKeyspilliRegressionOptions = {}): Promise<WrittenKeyspilliRegressionReport> {
  const directory = outputDirectory.trim();
  if (!directory) throw new Error("outputDirectory must be non-empty");
  const fileName = safeFileName(options.fileName ?? "keyspilli-regression.json");
  const json = `${JSON.stringify(canonicalize(report), null, 2)}\n`;
  await mkdir(directory, { recursive: true });
  const path = join(directory, fileName);
  const temporary = join(directory, `.${fileName}.${process.pid}.tmp`);
  try {
    await writeFile(temporary, json, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return { path, json, report };
}

export const evaluateKeyspilliRegression = runKeyspilliRegression;
