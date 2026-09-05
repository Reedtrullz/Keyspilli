import { auditMidiBytes, type CanonicalMidi, type CanonicalMidiNote } from "./midi-corpus.js";
import { scoreDirectAmtWindow, type DirectAmtMatchMetrics } from "./direct-amt-evaluation.js";

export const DENSE_METAL_AMT_EVALUATION_SCHEMA_VERSION = 1 as const;
export const DENSE_METAL_AMT_ONSET_TOLERANCE_SECONDS = 0.08;
export const DENSE_METAL_PERCUSSION_TOLERANCE_SECONDS = 0.05;

export type DenseMetalFamily = "GUITAR" | "BASS" | "OTHER_PITCHED" | "PERCUSSION" | "UNKNOWN";

export interface DenseMetalReferenceEvent {
  role: "rhythm-guitar" | "bass" | "lead" | "harmony" | "drums";
  midi: number;
  startBeat: number;
  durationBeats: number;
  velocity: number;
}

export interface DenseMetalEvalNote {
  family: DenseMetalFamily;
  midi: number;
  onsetSeconds: number;
  offsetSeconds: number;
  percussion: boolean;
}

interface MatchSummary extends DirectAmtMatchMetrics {}

export interface DenseMetalFixtureResult {
  schemaVersion: typeof DENSE_METAL_AMT_EVALUATION_SCHEMA_VERSION;
  fixtureId: string;
  pitched: ReturnType<typeof scoreDirectAmtWindow>;
  families: Record<"GUITAR" | "BASS" | "OTHER_PITCHED", ReturnType<typeof scoreDirectAmtWindow>>;
  percussion: {
    kick: MatchSummary & { medianOnsetErrorSeconds: number | null; p95OnsetErrorSeconds: number | null };
    snare: MatchSummary & { medianOnsetErrorSeconds: number | null; p95OnsetErrorSeconds: number | null };
    all: MatchSummary & { medianOnsetErrorSeconds: number | null; p95OnsetErrorSeconds: number | null };
  };
  diagnostics: {
    referencePitchedNotes: number;
    predictedPitchedNotes: number;
    densityRatio: number;
    referenceMedianIoiSeconds: number | null;
    predictedMedianIoiSeconds: number | null;
    referenceMaxSimultaneity: number;
    predictedMaxSimultaneity: number;
    failureStates: string[];
  };
}

const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const compareNote = (left: DenseMetalEvalNote, right: DenseMetalEvalNote): number => left.onsetSeconds - right.onsetSeconds || left.midi - right.midi || left.offsetSeconds - right.offsetSeconds || (left.family < right.family ? -1 : left.family > right.family ? 1 : 0);

function referenceFamily(role: DenseMetalReferenceEvent["role"]): DenseMetalFamily {
  if (role === "rhythm-guitar" || role === "lead") return "GUITAR";
  if (role === "bass") return "BASS";
  if (role === "drums") return "PERCUSSION";
  return "OTHER_PITCHED";
}

function predictionFamily(note: CanonicalMidiNote): DenseMetalFamily {
  if (note.percussion || note.channel === 9) return "PERCUSSION";
  if (note.program >= 24 && note.program <= 31) return "GUITAR";
  if (note.program >= 32 && note.program <= 39) return "BASS";
  if (note.midi >= 0 && note.midi <= 127) return "OTHER_PITCHED";
  return "UNKNOWN";
}

function secondsAtTick(midi: CanonicalMidi, targetTick: number): number {
  const tempos = midi.tempos.slice().sort((left, right) => left.tick - right.tick || left.bpm - right.bpm);
  let previousTick = 0;
  let bpm = 120;
  let seconds = 0;
  for (const tempo of tempos) {
    if (tempo.tick > targetTick) break;
    seconds += (tempo.tick - previousTick) / midi.division * 60 / bpm;
    previousTick = tempo.tick;
    bpm = tempo.bpm;
  }
  return seconds + (targetTick - previousTick) / midi.division * 60 / bpm;
}

export function notesFromMidi(bytes: Uint8Array): DenseMetalEvalNote[] {
  const audited = auditMidiBytes(bytes);
  if (audited.status === "invalid") throw new Error(`invalid prediction MIDI: ${audited.issues.map((item) => item.code).join(",")}`);
  return audited.canonical.notes.map((note) => ({
    family: predictionFamily(note),
    midi: note.midi,
    onsetSeconds: round(secondsAtTick(audited.canonical, note.startTick)),
    offsetSeconds: round(secondsAtTick(audited.canonical, note.endTick)),
    percussion: note.percussion,
  })).sort(compareNote);
}

function referenceNotes(events: readonly DenseMetalReferenceEvent[], bpm: number): DenseMetalEvalNote[] {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error("reference BPM must be positive");
  return events.map((event) => ({
    family: referenceFamily(event.role),
    midi: event.midi,
    onsetSeconds: round(event.startBeat * 60 / bpm),
    offsetSeconds: round((event.startBeat + event.durationBeats) * 60 / bpm),
    percussion: event.role === "drums",
  })).sort(compareNote);
}

function scoreTrack(reference: readonly DenseMetalEvalNote[], prediction: readonly DenseMetalEvalNote[], durationSeconds: number, tolerance: number) {
  const track = (id: string, notes: readonly DenseMetalEvalNote[]) => [{ id, role: id, timeBase: "window" as const, notes: notes.map((note) => ({ pitch: note.midi, onset: note.onsetSeconds, offset: note.offsetSeconds })) }];
  return scoreDirectAmtWindow({
    window: { id: "full", startSeconds: 0, endSeconds: durationSeconds, durationSeconds },
    reference: track("events", reference),
    prediction: track("events", prediction),
    onsetToleranceSeconds: tolerance,
  });
}

function ratioMetrics(predictedCount: number, referenceCount: number, matches: number): MatchSummary {
  const precision = predictedCount > 0 ? matches / predictedCount : null;
  const recall = referenceCount > 0 ? matches / referenceCount : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? 2 * precision * recall / (precision + recall) : null;
  return { predictedCount, referenceCount, matches, precision, recall, f1 };
}

function quantile(values: readonly number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return round(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower));
}

function onsetMatch(reference: readonly DenseMetalEvalNote[], prediction: readonly DenseMetalEvalNote[], tolerance: number) {
  const expected = [...reference].sort(compareNote);
  const actual = [...prediction].sort(compareNote);
  const errors: number[] = [];
  let left = 0;
  let right = 0;
  while (left < expected.length && right < actual.length) {
    const delta = actual[right]!.onsetSeconds - expected[left]!.onsetSeconds;
    if (Math.abs(delta) <= tolerance + 1e-9) {
      errors.push(Math.abs(delta));
      left += 1;
      right += 1;
    } else if (delta < 0) right += 1;
    else left += 1;
  }
  return {
    ...ratioMetrics(actual.length, expected.length, errors.length),
    medianOnsetErrorSeconds: quantile(errors, 0.5),
    p95OnsetErrorSeconds: quantile(errors, 0.95),
  };
}

function medianIoi(notes: readonly DenseMetalEvalNote[]): number | null {
  const starts = [...new Set(notes.map((note) => note.onsetSeconds))].sort((left, right) => left - right);
  return quantile(starts.slice(1).map((start, index) => start - starts[index]!), 0.5);
}

function maxSimultaneity(notes: readonly DenseMetalEvalNote[]): number {
  const changes = notes.flatMap((note) => [{ time: note.onsetSeconds, change: 1 }, { time: note.offsetSeconds, change: -1 }])
    .sort((left, right) => left.time - right.time || left.change - right.change);
  let active = 0;
  let maximum = 0;
  for (const change of changes) {
    active += change.change;
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

export function evaluateDenseMetalFixture(input: {
  id: string;
  bpm: number;
  durationSeconds: number;
  reference: readonly DenseMetalReferenceEvent[];
  prediction: readonly DenseMetalEvalNote[];
}): DenseMetalFixtureResult {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) throw new Error("fixture durationSeconds must be positive");
  const reference = referenceNotes(input.reference, input.bpm);
  const prediction = [...input.prediction].sort(compareNote);
  const referencePitched = reference.filter((note) => !note.percussion);
  const predictedPitched = prediction.filter((note) => !note.percussion);
  const families = Object.fromEntries((["GUITAR", "BASS", "OTHER_PITCHED"] as const).map((family) => [family, scoreTrack(referencePitched.filter((note) => note.family === family), predictedPitched.filter((note) => note.family === family), input.durationSeconds, DENSE_METAL_AMT_ONSET_TOLERANCE_SECONDS)])) as DenseMetalFixtureResult["families"];
  const referencePercussion = reference.filter((note) => note.percussion);
  const predictedPercussion = prediction.filter((note) => note.percussion);
  const category = (notes: readonly DenseMetalEvalNote[], pitches: readonly number[]) => notes.filter((note) => pitches.includes(note.midi));
  const densityRatio = referencePitched.length > 0 ? predictedPitched.length / referencePitched.length : 0;
  const failureStates = [
    ...(predictedPitched.length === 0 && referencePitched.length > 0 ? ["EMPTY_OUTPUT"] : []),
    ...(densityRatio < 0.2 ? ["SEVERE_UNDERTRANSCRIPTION"] : []),
    ...(densityRatio > 5 ? ["SEVERE_OVERTRANSCRIPTION"] : []),
  ];
  return {
    schemaVersion: DENSE_METAL_AMT_EVALUATION_SCHEMA_VERSION,
    fixtureId: input.id,
    pitched: scoreTrack(referencePitched, predictedPitched, input.durationSeconds, DENSE_METAL_AMT_ONSET_TOLERANCE_SECONDS),
    families,
    percussion: {
      kick: onsetMatch(category(referencePercussion, [35, 36]), category(predictedPercussion, [35, 36]), DENSE_METAL_PERCUSSION_TOLERANCE_SECONDS),
      snare: onsetMatch(category(referencePercussion, [38, 40]), category(predictedPercussion, [38, 40]), DENSE_METAL_PERCUSSION_TOLERANCE_SECONDS),
      all: onsetMatch(referencePercussion, predictedPercussion, DENSE_METAL_PERCUSSION_TOLERANCE_SECONDS),
    },
    diagnostics: {
      referencePitchedNotes: referencePitched.length,
      predictedPitchedNotes: predictedPitched.length,
      densityRatio: round(densityRatio),
      referenceMedianIoiSeconds: medianIoi(referencePitched),
      predictedMedianIoiSeconds: medianIoi(predictedPitched),
      referenceMaxSimultaneity: maxSimultaneity(referencePitched),
      predictedMaxSimultaneity: maxSimultaneity(predictedPitched),
      failureStates,
    },
  };
}

export function evaluateHeadroom(muscriptorF1: readonly number[], baselineF1: readonly number[]) {
  if (muscriptorF1.length !== 3 || baselineF1.length !== 3 || [...muscriptorF1, ...baselineF1].some((value) => !Number.isFinite(value))) throw new Error("headroom requires three finite scores per system");
  const wins = muscriptorF1.filter((value, index) => value > baselineF1[index]!).length;
  const muscriptorMacroF1 = muscriptorF1.reduce((sum, value) => sum + value, 0) / 3;
  const baselineMacroF1 = baselineF1.reduce((sum, value) => sum + value, 0) / 3;
  const catastrophicRegressions = muscriptorF1.filter((value, index) => baselineF1[index]! - value > 0.1).length;
  const absoluteDelta = muscriptorMacroF1 - baselineMacroF1;
  return {
    decision: wins >= 2 && absoluteDelta + 1e-12 >= 0.05 && catastrophicRegressions === 0
      ? "MUSCRIPTOR_SYNTHETIC_DENSE_METAL_HEADROOM_PROVEN" as const
      : "MUSCRIPTOR_SYNTHETIC_DENSE_METAL_HEADROOM_NOT_PROVEN" as const,
    wins,
    fixtureCount: 3,
    muscriptorMacroF1: round(muscriptorMacroF1),
    baselineMacroF1: round(baselineMacroF1),
    absoluteDelta: round(absoluteDelta),
    catastrophicRegressions,
  };
}

export function classifyRealKickSignal(value: { f1: number | null; recall: number | null }) {
  if ((value.f1 ?? 0) >= 0.6 && (value.recall ?? 0) >= 0.6) return "REAL_METAL_KICK_REFERENCE_SIGNAL_PRESENT" as const;
  if ((value.f1 ?? 0) >= 0.25) return "REAL_METAL_KICK_REFERENCE_SIGNAL_WEAK" as const;
  return "REAL_METAL_KICK_REFERENCE_SIGNAL_ABSENT" as const;
}
