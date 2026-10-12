import { inferHarmonyTimeline, type ChordLabel, type Note } from "@keyspilli/midi";
import { arithmeticMeasures, type AccompanimentResolution, type SongData } from "@keyspilli/player-core";
import { replayChordsBacking } from "../components/player/chords-backing";
import { HARMONY_PILOT_LIMITS, validateHarmonyPilotCase, validateHarmonyPilotNotes, validateHarmonyPilotReference, validateHarmonyPilotSource } from "./harmony-pilot-validation";

/** A comparison profile, not a source-authority or confidence claim. */
export type HarmonyPilotPolicy = "legacy-backing" | "conservative-backing-v1";
export interface HarmonyReferenceSpan {
  startBeat: number;
  endBeat: number;
  kind: "supported" | "unknown" | "rest";
  allowedPitchClasses: number[];
  bassPc?: number;
  name?: string;
}
export interface HarmonyPilotCase {
  id: string;
  compositionId: string;
  split: "development" | "holdout";
  category: string;
  description?: string;
  key: string;
  durationBeats: number;
  notes: Note[];
  reference: HarmonyReferenceSpan[];
}
export interface HarmonyPilotMetrics {
  durationBeats: number;
  supportedReferenceBeats: number;
  unknownReferenceBeats: number;
  restReferenceBeats: number;
  /** Union duration with an unsupported pitch/bass, or playback in an unknown span. */
  wrongHarmonyBeats: number;
  /** Playback inside a reference rest; reported separately from harmony mistakes. */
  restViolationBeats: number;
  audibleSupportedBeats: number;
  /** Audible duration / supported reference duration; wrong notes still count as audible. */
  supportedCoverage: number | null;
  audibleReferenceBeats: number;
  /** Audible duration / all non-rest reference duration. */
  audibleCoverage: number | null;
  /** Empty/missing label duration over non-rest reference spans, independent of actual playback. */
  abstentionBeats: number;
  abstentionRate: number | null;
}
export interface HarmonyPilotResult {
  id: string;
  compositionId: string;
  split: HarmonyPilotCase["split"];
  category: string;
  policy: HarmonyPilotPolicy;
  measures: SongData["measures"];
  labels: ChordLabel[];
  resolution: AccompanimentResolution;
  realizedEvents: Array<{ beat: number; durationBeats: number; name: string; notes: number[]; pitchClasses: number[]; bassPc: number }>;
  metrics: HarmonyPilotMetrics;
}

const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : null;
const pitchClasses = (notes: readonly number[]) => [...new Set(notes.map(midi => midi % 12))].sort((a, b) => a - b);
const silentLabel = (label: ChordLabel | undefined) => !label || label.notes.length === 0 || label.name === "N.C.";

/** Exact event-boundary accounting; no frame count or repeated-note double counting. */
export function measureHarmonyRealization(
  reference: readonly HarmonyReferenceSpan[],
  labels: readonly ChordLabel[],
  realizedNotes: readonly Note[],
  durationBeats: number,
): HarmonyPilotMetrics {
  validateHarmonyPilotReference(reference, durationBeats);
  validateHarmonyPilotNotes(realizedNotes, durationBeats, HARMONY_PILOT_LIMITS.notes * 4);
  if (!Array.isArray(labels) || labels.length > HARMONY_PILOT_LIMITS.notes * 2 + HARMONY_PILOT_LIMITS.measures * 2
    || labels.some(label => !label || typeof label.beat !== "number" || !Number.isFinite(label.beat) || label.beat < 0
      || typeof label.durationBeats !== "number" || !Number.isFinite(label.durationBeats) || label.durationBeats <= 0 || label.beat + label.durationBeats > durationBeats + 1e-7
      || typeof label.name !== "string" || !Array.isArray(label.notes) || label.notes.length > 128
      || label.notes.some((midi: unknown) => typeof midi !== "number" || !Number.isInteger(midi) || midi < 0 || midi > 127))) throw new Error("Labels must contain valid bounded pitches and duration timing");
  const boundaries = new Set([0, durationBeats]);
  for (const span of reference) { boundaries.add(span.startBeat); boundaries.add(span.endBeat); }
  for (const chord of labels) { boundaries.add(chord.beat); boundaries.add(chord.beat + (chord.durationBeats ?? 0)); }
  for (const note of realizedNotes) { boundaries.add(note.start); boundaries.add(note.start + note.dur); }
  const ordered = [...boundaries].filter(beat => Number.isFinite(beat) && beat >= 0 && beat <= durationBeats).sort((a, b) => a - b);
  let supportedReferenceBeats = 0, unknownReferenceBeats = 0, restReferenceBeats = 0;
  let wrongHarmonyBeats = 0, restViolationBeats = 0, audibleSupportedBeats = 0, audibleReferenceBeats = 0, abstentionBeats = 0;
  for (let index = 0; index + 1 < ordered.length; index++) {
    const start = ordered[index]!, end = ordered[index + 1]!, beat = (start + end) / 2, length = end - start;
    const truth = reference.find(span => span.startBeat <= beat && span.endBeat > beat)!;
    const active = realizedNotes.filter(note => note.start <= beat && note.start + note.dur > beat);
    const label = labels.find(chord => chord.beat <= beat && chord.beat + (chord.durationBeats ?? 0) > beat);
    if (truth.kind === "rest") {
      restReferenceBeats += length;
      if (active.length) restViolationBeats += length;
      continue;
    }
    if (truth.kind === "supported") supportedReferenceBeats += length;
    else unknownReferenceBeats += length;
    if (silentLabel(label)) abstentionBeats += length;
    if (!active.length) continue;
    audibleReferenceBeats += length;
    if (truth.kind === "supported") audibleSupportedBeats += length;
    const bass = Math.min(...active.map(note => note.midi)) % 12;
    if (truth.kind === "unknown" || active.some(note => !truth.allowedPitchClasses.includes(note.midi % 12)) || bass !== truth.bassPc) {
      wrongHarmonyBeats += length;
    }
  }
  const referenceBeats = supportedReferenceBeats + unknownReferenceBeats;
  return {
    durationBeats, supportedReferenceBeats, unknownReferenceBeats, restReferenceBeats,
    wrongHarmonyBeats, restViolationBeats, audibleSupportedBeats,
    supportedCoverage: ratio(audibleSupportedBeats, supportedReferenceBeats),
    audibleReferenceBeats, audibleCoverage: ratio(audibleReferenceBeats, referenceBeats),
    abstentionBeats, abstentionRate: ratio(abstentionBeats, referenceBeats),
  };
}

/** Read-only candidate playback. Its generated projection does not inherit authored charts or pinned overrides. */
export function replayHarmonyPolicy(
  source: Pick<SongData, "notes" | "measures" | "key" | "timeSig" | "tempoBpm">,
  policy: HarmonyPilotPolicy,
) {
  validateHarmonyPilotSource(source);
  if (policy !== "legacy-backing" && policy !== "conservative-backing-v1") throw new Error("Unknown harmony pilot policy");
  const labels = inferHarmonyTimeline(source.notes, source.measures, {
    key: source.key, backingOnly: true,
    ...(policy === "conservative-backing-v1" ? { policy } : {}),
  });
  return replayChordsBacking({
    notes: source.notes, measures: source.measures, key: source.key,
    tempoBpm: source.tempoBpm, timeSig: source.timeSig, chords: labels,
  }, "generated");
}

export function evaluateHarmonyPilotCase(item: HarmonyPilotCase, policy: HarmonyPilotPolicy): HarmonyPilotResult {
  validateHarmonyPilotCase(item);
  const measures = arithmeticMeasures(item.durationBeats, [4, 4]).map(measure => ({ ...measure, endBeat: Math.min(measure.endBeat, item.durationBeats) }));
  const replay = replayHarmonyPolicy({ notes: item.notes, measures, key: item.key, timeSig: [4, 4], tempoBpm: 60 }, policy);
  return {
    id: item.id, compositionId: item.compositionId, split: item.split, category: item.category, policy, measures,
    labels: replay.chords, resolution: replay.resolution,
    realizedEvents: replay.resolution.chords.map(chord => ({
      beat: chord.beat, durationBeats: chord.durationBeats!, name: chord.name, notes: chord.notes,
      pitchClasses: pitchClasses(chord.notes), bassPc: Math.min(...chord.notes) % 12,
    })),
    metrics: measureHarmonyRealization(item.reference, replay.chords, replay.resolution.guidanceNotes, item.durationBeats),
  };
}

export function summarizeHarmonyPilot(rows: readonly HarmonyPilotResult[]): HarmonyPilotMetrics & { cases: number } {
  const sum = (key: keyof HarmonyPilotMetrics) => rows.reduce((total, row) => total + (row.metrics[key] ?? 0), 0);
  const supportedReferenceBeats = sum("supportedReferenceBeats"), unknownReferenceBeats = sum("unknownReferenceBeats");
  const audibleSupportedBeats = sum("audibleSupportedBeats"), audibleReferenceBeats = sum("audibleReferenceBeats"), abstentionBeats = sum("abstentionBeats");
  const referenceBeats = supportedReferenceBeats + unknownReferenceBeats;
  return {
    cases: rows.length, durationBeats: sum("durationBeats"), supportedReferenceBeats, unknownReferenceBeats,
    restReferenceBeats: sum("restReferenceBeats"), wrongHarmonyBeats: sum("wrongHarmonyBeats"), restViolationBeats: sum("restViolationBeats"),
    audibleSupportedBeats, supportedCoverage: ratio(audibleSupportedBeats, supportedReferenceBeats),
    audibleReferenceBeats, audibleCoverage: ratio(audibleReferenceBeats, referenceBeats),
    abstentionBeats, abstentionRate: ratio(abstentionBeats, referenceBeats),
  };
}
