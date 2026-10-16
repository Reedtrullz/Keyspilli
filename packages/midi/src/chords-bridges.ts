import { midiBeatToNativeSeconds } from "./parse.js";
import type { PhrasePlanV1, PhraseProtectionReport } from "./phrase-plan.js";
import type { Note } from "./types.js";

const EPS = 1e-8;
export const SOURCE_GAP_BRIDGE_CAPABILITY = Object.freeze({ sourceGapBridges: "source-gap-bridges-v1",
  maximumSourceQuarterBeats: 8, maximumNativeSeconds: 6, maximumEventsPerGap: 16 });
function requireBridge(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(`source-gap bridge: ${detail}`);
}

export function validateChordsBridges(plan: PhrasePlanV1): void {
  if (plan.chordsBridges === undefined) return;
  requireBridge(Array.isArray(plan.chordsBridges) && plan.chordsBridges.length <= 64, "invalid bridge inventory");
  requireBridge(plan.levels.includes("advanced"), "requires Advanced phrase protection");
  const events = new Map(plan.phrases.flatMap(p => p.events.map(e => [e.id, e] as const)));
  const ids = new Set<string>(), selected = new Set<string>();
  const spans: Array<{ start: number; end: number }> = [];
  for (const bridge of plan.chordsBridges) {
    requireBridge(bridge && typeof bridge === "object" && typeof bridge.id === "string" && bridge.id.length > 0
      && bridge.id.length <= 200 && !ids.has(bridge.id), "invalid/duplicate identity");
    ids.add(bridge.id);
    requireBridge(typeof bridge.basis === "string" && bridge.basis.trim().length > 0 && bridge.basis.length <= 1000,
      "missing source-selection basis");
    requireBridge(Number.isFinite(bridge.startBeat) && Number.isFinite(bridge.endBeat) && bridge.startBeat >= 0
      && bridge.endBeat > bridge.startBeat && bridge.endBeat <= plan.source.clock.durationBeats
      && bridge.endBeat - bridge.startBeat <= SOURCE_GAP_BRIDGE_CAPABILITY.maximumSourceQuarterBeats + EPS, "window exceeds eight source quarter beats");
    requireBridge(!plan.phrases.some(p => p.rests.some(r => r.scope === "all"
      && r.startBeat < bridge.endBeat - EPS && r.endBeat > bridge.startBeat + EPS)), "window crosses a whole-source rest");
    requireBridge(Array.isArray(bridge.events) && bridge.events.length > 0
      && bridge.events.length <= SOURCE_GAP_BRIDGE_CAPABILITY.maximumEventsPerGap, "requires one to sixteen source events");
    for (const selection of bridge.events) {
      requireBridge(selection && typeof selection === "object" && typeof selection.eventId === "string"
        && !selected.has(selection.eventId), "invalid/duplicate source selection");
      selected.add(selection.eventId);
      const event = events.get(selection.eventId), shift = selection.octaveShift === undefined ? 0 : selection.octaveShift;
      requireBridge(event?.role === "melody", "selection must name an explicit melody event; hooks and unknown roles remain excluded");
      requireBridge([0, -24, -12, 12, 24].includes(shift) && (!shift || !event.required
        && event.allowedTransformations.includes("octave-displacement")), "unpermitted octave displacement");
      const n = event.expected;
      requireBridge(n.startBeat >= bridge.startBeat - EPS && n.startBeat + n.durationBeats <= bridge.endBeat + EPS
        && n.midi + shift >= 21 && n.midi + shift <= 108, "event exceeds its window or piano range");
      spans.push({ start: n.startBeat, end: n.startBeat + n.durationBeats });
    }
  }
  spans.sort((a, b) => a.start - b.start);
  requireBridge(spans.every((span, i) => !i || span.start >= spans[i - 1]!.end - EPS), "selected voice is polyphonic");
}

export function sourceGapBridgeNotes(notes: readonly Note[], backing: readonly Note[], report: PhraseProtectionReport): {
  notes: Note[]; changes: PhraseProtectionReport["changes"];
} {
  const plan = report.plan;
  validateChordsBridges(plan);
  const additions: Note[] = [], changes: PhraseProtectionReport["changes"] = [];
  if (!plan.chordsBridges?.length) return { notes: additions, changes };
  const tempo = report.outputClock.sourceTempoBpm;
  const source = { division: plan.source.clock.division, tempoBpm: plan.source.clock.tempoBpm, tempoEvents: plan.source.clock.tempoEvents };
  const beat = (value: number) => midiBeatToNativeSeconds(source, value) * tempo / 60;
  const sourceBeat = (value: number) => {
    requireBridge(Number.isFinite(value) && value >= -EPS && value <= beat(plan.source.clock.durationBeats) + EPS,
      "retained backing boundary exceeds the mapped source clock domain");
    let low = 0, high = plan.source.clock.durationBeats;
    for (let i = 0; i < 48; i++) {
      const mid = (low + high) / 2;
      if (beat(mid) < value) low = mid; else high = mid;
    }
    return (low + high) / 2;
  };
  const entries = new Map(plan.phrases.flatMap(p => p.events.map(e => [e.id, { phrase: p, event: e }] as const)));
  const gapCounts = new Map<string, number>();
  for (const bridge of plan.chordsBridges) {
    const start = beat(bridge.startBeat), end = beat(bridge.endBeat);
    requireBridge(!backing.some(n => n.start < end - EPS && n.start + n.dur > start + EPS), "window overlaps retained backing");
    const previous = backing.filter(n => n.start + n.dur <= start + EPS).reduce((last, n) => Math.max(last, n.start + n.dur), -Infinity);
    const next = backing.filter(n => n.start >= end - EPS).reduce((first, n) => Math.min(first, n.start), Infinity);
    requireBridge(Number.isFinite(previous) && Number.isFinite(next), "window must lie between retained backing events");
    requireBridge(sourceBeat(next) - sourceBeat(previous) <= SOURCE_GAP_BRIDGE_CAPABILITY.maximumSourceQuarterBeats + EPS
      && (next - previous) * 60 / tempo <= SOURCE_GAP_BRIDGE_CAPABILITY.maximumNativeSeconds + EPS,
      "backing gap exceeds eight source quarter beats or six native seconds");
    const key = `${previous}:${next}`, count = (gapCounts.get(key) ?? 0) + bridge.events.length;
    requireBridge(count <= SOURCE_GAP_BRIDGE_CAPABILITY.maximumEventsPerGap, "backing gap exceeds sixteen bridge events");
    gapCounts.set(key, count);
    for (const selection of bridge.events) {
      const { event, phrase } = entries.get(selection.eventId)!;
      const matches = notes.filter(n => n.sourceOrigins?.some(o => o.id === event.sourceOriginId
        && (event.sourceOccurrence === undefined || o.occurrence === event.sourceOccurrence)));
      requireBridge(matches.length === 1 && matches[0]!.sourceOrigins?.length === 1, "missing or shared selected source lineage");
      const before = matches[0]!, expected = event.expected;
      requireBridge(before.midi === expected.midi && Math.abs(before.start - beat(expected.startBeat)) < EPS
        && Math.abs(before.start + before.dur - beat(expected.startBeat + expected.durationBeats)) < EPS,
      "selected source pitch/timing changed; reselect an exact retained event");
      const after = { ...structuredClone(before), midi: before.midi + (selection.octaveShift === undefined ? 0 : selection.octaveShift) };
      additions.push(after);
      changes.push({ eventId: event.id, phraseId: phrase.id, occurrenceId: phrase.occurrenceId, role: event.role,
        operation: "source-gap-bridge", before: [structuredClone(before)], after: [structuredClone(after)] });
    }
  }
  return { notes: additions, changes };
}
