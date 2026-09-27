import { CHORDS_TUNING, groupAttackClusters, inferHarmonyTimeline, type Note } from "@keyspilli/midi";
import type { ChordTimelineArtifact } from "@keyspilli/catalog";
import type { SongData } from "@keyspilli/player-core";
import { projectChordSources } from "./catalog-api";
import { replayChordsBacking } from "../components/player/chords-backing";
import { evaluateChordsBacking, snapshotChordsBacking } from "./chords-evaluation";

type Snapshot = ReturnType<typeof snapshotChordsBacking>;
function attacks(snapshot: Snapshot): Note[] {
  return [...snapshot.notes, ...snapshot.chords.flatMap(c => c.notes.map((midi, i) => ({
    midi, start: c.beat, dur: c.durationBeats ?? 0, vel: 80, hand: c.suggestedHands[i],
  })))];
}

/** Source support, not a chord-recognition accuracy score. Include uncovered notes in the denominator. */
export function leftHandSupport(notes: readonly Note[], snapshot: Snapshot): number | null {
  const audio = attacks(snapshot);
  let total = 0, supported = 0;
  for (const note of notes.filter(n => n.hand === "L")) {
    total += note.dur;
    const spans = audio.filter(a => a.midi % 12 === note.midi % 12)
      .map(a => [Math.max(a.start, note.start), Math.min(a.start + a.dur, note.start + note.dur)])
      .filter(([start, end]) => end! > start!).sort((a, b) => a[0]! - b[0]!);
    let end = note.start;
    for (const [start, stop] of spans) { supported += Math.max(0, stop! - Math.max(start!, end)); end = Math.max(end, stop!); }
  }
  return total ? supported / total : null;
}

/** Timestamped observations never turn a symbolic proxy into a listening verdict. */
export function diagnosePreparedChords(data: SongData) {
  const replay = replayChordsBacking(data), snapshot = snapshotChordsBacking(data, replay), audio = attacks(snapshot);
  const findings: Array<{ kind: string; classification: "defect" | "unresolved"; startBeat: number; endBeat: number; startSeconds: number; endSeconds: number; evidence: string }> = [];
  const add = (kind: string, classification: "defect" | "unresolved", start: number, end: number, evidence: string) =>
    findings.push({ kind, classification, startBeat: start, endBeat: end, startSeconds: start * 60 / data.tempoBpm, endSeconds: end * 60 / data.tempoBpm, evidence });
  for (const measure of data.measures) {
    const hits = audio.filter(n => n.start >= measure.startBeat && n.start < measure.endBeat);
    if (new Set(hits.map(n => `${n.start}:${n.midi}`)).size !== hits.length)
      add("duplicate-attack", "defect", measure.startBeat, measure.endBeat, "Both playback streams strike the same pitch at the same onset.");
    for (const hand of ["L", "R"] as const) {
      const byOnset = new Map<number, number[]>();
      for (const n of hits.filter(n => n.hand === hand)) byOnset.set(n.start, [...(byOnset.get(n.start) ?? []), n.midi]);
      for (const [beat, pitches] of byOnset) if (Math.max(...pitches) - Math.min(...pitches) > 12)
        add("wide-hand", "unresolved", beat, Math.min(beat + 1, measure.endBeat), `${hand} hand spans ${Math.max(...pitches) - Math.min(...pitches)} semitones.`);
    }
    const tops = new Map<number, Note>();
    for (const n of data.notes.filter(n => n.hand !== "L" && n.start >= measure.startBeat && n.start < measure.endBeat))
      if (n.midi > (tops.get(n.start)?.midi ?? -1)) tops.set(n.start, n);
    for (const [beat, n] of tops) {
      const sounding = audio.filter(a => a.start <= beat && a.start + a.dur > beat);
      if (sounding.some(a => [1, 11].includes(((a.midi - n.midi) % 12 + 12) % 12)))
        add("semitone-proxy", "unresolved", beat, Math.min(beat + n.dur, measure.endBeat), "Tune/backing semitone; passing tones and suspensions require reference evidence, not automatic deletion.");
    }
  }
  for (const span of replay.resolution.fallbackSpans) if (span.reason !== "explicit no-chord")
    add("unsupported-span", "unresolved", span.startBeat, span.endBeat, span.reason);
  return { sourceFingerprint: data.sourceFingerprint, leftHandSupport: leftHandSupport(data.notes, snapshot), findings,
    metrics: evaluateChordsBacking(data), musicalVerdict: "provisional: audio/reference evaluation still required" };
}

/** One bounded, source-anchored repair; reject regressions, preserve every original diagnosis. */
export function repairPreparedHarmony(data: SongData, timeline: ChordTimelineArtifact) {
  if (!data.sourceFingerprint || timeline.provenance.sourceRef !== `prepared:${data.sourceFingerprint}`
    || timeline.provenance.kind !== "midi-derived" || timeline.chords.some(c => c.sourceKind !== "inferred"))
    throw new Error("repair requires a prepared timeline pinned to this source");
  const beforeData = projectChordSources(data, timeline), before = diagnosePreparedChords(beforeData);
  const left = data.notes.filter(n => n.hand === "L"), pitches = left.map(n => n.midi).sort((a, b) => a - b);
  const ceiling = pitches[Math.floor(pitches.length / 2)] ?? 60;
  const anchors = groupAttackClusters(left).filter(a => a.notes.some(n => n.midi <= ceiling && n.dur >= 0.5)
    || new Set(a.notes.map(n => n.midi % 12)).size >= 2).map(a => a.start);
  const starts = [...new Set([0, ...anchors, ...data.measures.map(m => m.startBeat), timeline.durationBeats])].sort((a, b) => a - b);
  const spans = starts.slice(0, -1).map((startBeat, i) => ({ startBeat, endBeat: starts[i + 1]! }));
  const candidate: ChordTimelineArtifact = { ...timeline, chords: inferHarmonyTimeline(data.notes, spans, {
    key: data.key, tuning: { ...CHORDS_TUNING.harmony, changeGrid: "bar", pedal: "bar" },
  }).map(c => ({ ...c, durationBeats: c.durationBeats ?? 0, sourceKind: "inferred", inferred: true, inferenceType: "learner-harmonization" })) };
  const after = diagnosePreparedChords(projectChordSources(data, candidate));
  const retained = before.leftHandSupport !== null && after.leftHandSupport !== null
    && after.leftHandSupport - before.leftHandSupport >= 0.08
    && after.metrics.backing.listener.deadAirOnsets <= before.metrics.backing.listener.deadAirOnsets
    && (after.metrics.backing.listener.tuneSemitoneClashShare ?? 0) <= (before.metrics.backing.listener.tuneSemitoneClashShare ?? 0) + 0.03
    && after.findings.filter(f => f.kind === "wide-hand" || f.classification === "defect").length
      <= before.findings.filter(f => f.kind === "wide-hand" || f.classification === "defect").length;
  return { timeline: retained ? candidate : timeline, retained, before, after,
    reason: retained ? "Source-supported alignment improved without measured regressions." : "Candidate did not establish a safe improvement; original retained." };
}
