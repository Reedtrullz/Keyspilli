import { tryParseChordSymbol, type Note, type StrikeTuning } from "@keyspilli/midi";
import type { AccompanimentChord } from "./accompaniment.js";

const EPSILON = 1e-7;
/** Bounded delivery window; the shared, transitive detector remains unchanged. */
const ONSET_WINDOW_BEATS = 0.08;

/** One source-backed strike per bounded onset group, never one per new label. */
export function supportedSourceStrikes(
  sourceNotes: readonly Note[],
  chords: readonly AccompanimentChord[],
  tuning: StrikeTuning,
): Map<AccompanimentChord, AccompanimentChord[]> {
  const source = sourceNotes.filter(note => note.identitySource !== "vocals" && !note.lyrics
    && Number.isFinite(note.start) && Number.isFinite(note.dur) && note.dur > 0)
    .slice().sort((a, b) => a.start - b.start || a.midi - b.midi);
  const groups: Note[][] = [];
  for (const note of source) {
    const last = groups.at(-1);
    if (last && note.start - last[0]!.start <= ONSET_WINDOW_BEATS + EPSILON) last.push(note);
    else groups.push([note]);
  }
  const generated = chords.filter(chord => chord.sourceKind === "generated" && chord.inferenceType === "harmony-window");
  const result = new Map<AccompanimentChord, AccompanimentChord[]>();
  let previous: AccompanimentChord | undefined;

  for (const members of groups) {
    let chosen: { source: AccompanimentChord; strike: AccompanimentChord } | undefined;
    for (const beat of [...new Set(members.map(note => note.start))]) {
      const chord = generated.find(item => item.beat <= beat + EPSILON && item.beat + (item.durationBeats ?? 0) > beat + EPSILON);
      if (!chord) continue;
      const pcs = new Set(chord.notes.map(midi => midi % 12));
      if (pcs.size < 2 || !members.some(note => Math.abs(note.start - beat) <= EPSILON && pcs.has(note.midi % 12))) continue;
      const active = members.filter(note => note.start <= beat + EPSILON && note.start + note.dur > beat + EPSILON);
      const byPc = new Map<number, number>();
      for (const note of active) byPc.set(note.midi % 12, Math.max(byPc.get(note.midi % 12) ?? -Infinity, note.start + note.dur));
      if (![...pcs].every(pc => byPc.has(pc))) continue;

      const sounding = source.filter(note => note.start <= beat + EPSILON && note.start + note.dur > beat + EPSILON);
      const lowest = Math.min(...sounding.map(note => note.midi));
      const symbol = tryParseChordSymbol(chord.name);
      if (!symbol || lowest % 12 !== (symbol.bassPc ?? symbol.rootPc)) continue;
      // A future note or an upper octave cannot extend the currently held bass.
      const bassEnd = Math.max(...sounding.filter(note => note.midi === lowest).map(note => note.start + note.dur));
      const end = Math.min(chord.beat + chord.durationBeats!, ...[...pcs].map(pc => byPc.get(pc)!), bassEnd,
        beat + (chord.maxStrikeDurationBeats ?? Infinity));
      if (end <= beat + EPSILON) continue;
      chosen = { source: chord, strike: { ...chord, beat, durationBeats: end - beat } };
      // Keep a complete first attack exactly where it was. Only an incomplete
      // group entrance waits for its last valid complete member onset.
      if (beat === members[0]!.start) break;
    }
    if (!chosen) continue;
    const spacing = Math.max(tuning.minSpacingBeats, chosen.source.strikeSpacingBeats ?? 0);
    if (previous && chosen.strike.beat - previous.beat < spacing - EPSILON) continue;
    if (previous) previous.durationBeats = Math.min(previous.durationBeats!, chosen.strike.beat - previous.beat);
    const strikes = result.get(chosen.source) ?? [];
    strikes.push(chosen.strike);
    result.set(chosen.source, strikes);
    previous = chosen.strike;
  }
  return result;
}
