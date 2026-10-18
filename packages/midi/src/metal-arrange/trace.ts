import type { Note } from "../types.js";
import type { IdentityNote, MetalArrangementTraceEvent, MetalArrangementTraceSink, MetalStem, MetalStemRole } from "./types.js";
import { validNotes } from "./shared.js";

export function traceNote(note: IdentityNote | Note): MetalArrangementTraceEvent["note"] {
  const internal = note as Note & { rawMidi?: number };
  return {
    midi: note.midi,
    ...(internal.rawMidi === undefined ? {} : { rawMidi: internal.rawMidi }),
    start: note.start,
    dur: note.dur,
    vel: note.vel,
    ...(note.hand ? { hand: note.hand } : {}),
  };
}

export function traceParents(note: IdentityNote | Note): string[] {
  const internal = note as Note & { traceRefs?: readonly string[] };
  return internal.traceRefs ? [...internal.traceRefs].sort() : [];
}

/** Stable canonical-note key shared with the optional difficulty trace. */
export function metalTraceFinalKey(note: Note): string {
  return `final:${note.hand ?? "?"}:${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}:${note.identitySource ?? "unknown"}`;
}

export function emitTrace(
  sink: MetalArrangementTraceSink | undefined,
  event: MetalArrangementTraceEvent,
): void {
  if (!sink) return;
  const operation = event.operation ?? (event.selected === false
    ? "REJECTED"
    : event.stage === "raw" || event.stage === "chord" || event.stage === "left-hand"
      ? "GENERATED"
      : "RETAINED");
  sink.record({
    ...event,
    operation,
    parentKeys: [...event.parentKeys].sort(),
  });
}

export function traceRawNotes(
  stem: MetalStem | undefined,
  role: MetalStemRole,
  sink: MetalArrangementTraceSink | undefined,
): IdentityNote[] {
  if (!stem) return [];
  const actualRole = stem.sourceStem ?? role;
  const identitySource = actualRole === "vocals" || actualRole === "guitar" || actualRole === "other"
    ? actualRole
    : undefined;
  // Canonical ordering makes IDs stable under input-note reordering. Exact
  // duplicates receive occurrence suffixes; they are indistinguishable by
  // content, so the suffix is deterministic regardless of source order.
  const counts = new Map<string, number>();
  const sourceNotes = validNotes(stem);
  // Keep the historical `validNotes` order when tracing is disabled. The
  // sidecar is opt-in and must not perturb public arrangement decisions.
  if (!sink) return sourceNotes as IdentityNote[];
  const canonical = sourceNotes.slice().sort((a, b) =>
    a.start - b.start || a.midi - b.midi || a.dur - b.dur || a.vel - b.vel
    || (a.lyrics ?? "").localeCompare(b.lyrics ?? ""));
  const idsByTuple = new Map<string, string[]>();
  const canonicalCounts = new Map<string, number>();
  for (const note of canonical) {
    const tuple = `${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}:${note.lyrics ?? ""}`;
    const occurrence = canonicalCounts.get(tuple) ?? 0;
    canonicalCounts.set(tuple, occurrence + 1);
    const ids = idsByTuple.get(tuple) ?? [];
    ids.push(`raw:${actualRole}:${tuple}:${occurrence}`);
    idsByTuple.set(tuple, ids);
  }
  return sourceNotes.map((note) => {
    const tuple = `${note.start.toFixed(6)}:${note.midi}:${note.dur.toFixed(6)}:${note.vel}:${note.lyrics ?? ""}`;
    const occurrence = counts.get(tuple) ?? 0;
    counts.set(tuple, occurrence + 1);
    // Consume canonical IDs by tuple rather than object identity. Synthetic
    // callers may intentionally reuse the same object for multiple events.
    const ids = idsByTuple.get(tuple);
    const key = ids?.shift() ?? `raw:${actualRole}:${tuple}:${occurrence}`;
    const tagged: IdentityNote = {
      ...note,
      ...(identitySource ? { identitySource } : {}),
      traceRefs: [key],
      traceSourceStem: actualRole,
    };
    emitTrace(sink, {
      key,
      stage: "raw",
      parentKeys: [],
      source: identitySource ?? null,
      sourceStem: actualRole,
      note: traceNote({ ...tagged, rawMidi: note.midi }),
      selected: true,
      selectionReason: "source-note",
      ...(stem.confidence === undefined ? {} : { confidence: stem.confidence }),
    });
    return tagged;
  });
}
