import { chordName } from "../analyze.js";
import { Note, ChordLabel } from "../types.js";
import { maxNoteEnd, maxNumber, minNumber } from "./shared.js";

/**
 * Pitches that sound for >= 30% of the song's total duration. Basic Pitch
 * tracks sustained background layers (pads/shimmer) that re-trigger on every
 * attack; choosing them as "the melody" produces a constant-note line. Voice
 * selection prefers non-pad pitches, falling back to a pad when nothing else
 * sounds in a slice.
 */
export function padPitches(notes: Note[]): Set<number> {
  const pads = new Set<number>();
  if (!notes.length) return pads;
  const total = maxNoteEnd(notes);
  const sounding = new Map<number, number>();
  for (const n of notes) sounding.set(n.midi, (sounding.get(n.midi) ?? 0) + n.dur);
  for (const [midi, dur] of sounding) {
    if (dur / total >= 0.3) pads.add(midi);
  }
  return pads;
}

export function chordsAt(
  notes: Note[],
  grid: number,
  arrangementEnd?: number,
  preserveShortLhStacks = false,
): ChordLabel[] {
  const bySlice = new Map<number, { all: Note[]; lh: Note[]; rh: Note[] }>();
  for (const note of notes) {
    const beat = Math.round(note.start / grid) * grid;
    const slice = bySlice.get(beat) ?? { all: [], lh: [], rh: [] };
    slice.all.push(note);
    if (note.hand === "L") slice.lh.push(note);
    else if (note.hand === "R") slice.rh.push(note);
    bySlice.set(beat, slice);
  }
  const out: ChordLabel[] = [];
  for (const [beat, slice] of [...bySlice.entries()].sort((a, b) => a[0] - b[0])) {
    const longNotes = slice.all.filter((note) => note.dur >= 0.25);
    const shortStackPitchClasses = new Set(slice.lh.map((note) => note.midi % 12));
    const eligibleShortLh = preserveShortLhStacks && shortStackPitchClasses.size >= 2
      ? slice.lh.filter((note) => note.dur < 0.25)
      : [];
    const eligible = [...longNotes, ...eligibleShortLh];
    // The left hand is the most reliable harmonic evidence in a piano
    // arrangement. If it has at least two distinct pitch classes, keep that
    // voicing and avoid allowing the highest melody note to rename the chord.
    // For melody-only/legacy material, use the full cluster minus its top
    // voice where possible, then fall back to the complete cluster.
    const lh = [...new Set(eligible.filter((note) => note.hand === "L").map((note) => note.midi))]
      .sort((a, b) => a - b);
    const all = [...new Set(eligible.map((note) => note.midi))].sort((a, b) => a - b);
    const lhPitchClasses = new Set(lh.map((midi) => midi % 12));
    const harmonic = lhPitchClasses.size >= 2
      ? lh
      : all.length > 2
        ? all.slice(0, -1)
        : all;
    // Generated chord playback is a learner accompaniment, not a verbatim
    // dump of every sounding pitch. Preserve the absolute bass and upper
    // shell while keeping the voicing compact and playable.
    const canonicalNotes = [...new Set(harmonic)].sort((a, b) => a - b);
    const compactNotes = canonicalNotes.length > 4
      ? [canonicalNotes[0]!, ...canonicalNotes.slice(-3)]
      : canonicalNotes;
    const pcs = [...new Set(compactNotes.map((m) => m % 12))].sort((a, b) => a - b);
    if (pcs.length < 2) continue;
    const bassPc = compactNotes[0]! % 12;
    const name = chordName(pcs, bassPc);
    if (!name) continue; // unlabelable dyad (root+3rd, chromatic clash, ...)
    out.push({
      beat,
      name,
      notes: compactNotes,
      sourceKind: "generated",
      inferred: true,
      inferenceType: "voicing",
    });
  }
  // Per-grid-slice analysis produces the same chord every 0.25 beats; collapse
  // consecutive same-name runs and keep only runs that hold >= 1 beat, so the
  // progression shows real changes instead of harmonic flashes.
  const kept: ChordLabel[] = [];
  if (out.length) {
    let runStart = out[0]!;
    for (let i = 1; i <= out.length; i++) {
      const current = out[i];
      if (current && current.name === runStart.name) continue;
      const runEndBeat = current?.beat ?? Math.max(
        arrangementEnd ?? 0,
        maxNoteEnd(notes),
        runStart.beat + 1,
      );
      if (runEndBeat - runStart.beat >= 1) {
        kept.push({
          ...runStart,
          durationBeats: runEndBeat - runStart.beat,
        });
      }
      if (current) runStart = current;
    }
  }
  return kept;
}

/**
 * Medium-level rhythmic reduction: drop short off-eighth passing tones that
 * are not an outer voice of their hand's slice. A note is a passing tone when
 * the next same-hand onset lands < 0.25 beats after it. Slice top (melody)
 * and bottom (bass) survive; single-note slices have no outer voice, so
 * scalar 16th-note runs collapse to eighths on the grid. Selection-only (no
 * start shifts), so the ladder stays a true subset of advanced.
 */
export function reduceMediumRhythm(notes: Note[]): Note[] {
  const handOf = (n: Note) => (n.hand === "L" ? "L" : "R");
  const sliceKey = (n: Note) => `${handOf(n)}:${Math.round(n.start / 0.125)}`;
  const bySlice = new Map<string, Note[]>();
  const onsetsByHand = new Map<string, number[]>();
  for (const n of notes) {
    const key = sliceKey(n);
    const arr = bySlice.get(key) ?? [];
    arr.push(n);
    bySlice.set(key, arr);
    const hand = handOf(n);
    const onsets = onsetsByHand.get(hand) ?? [];
    onsets.push(n.start);
    onsetsByHand.set(hand, onsets);
  }
  const high = new Map<string, number>();
  const low = new Map<string, number>();
  for (const [key, ns] of bySlice) {
    high.set(key, maxNumber(ns.map((n) => n.midi)));
    low.set(key, minNumber(ns.map((n) => n.midi)));
  }
  const sortedOnsets = new Map<string, number[]>();
  for (const [hand, onsets] of onsetsByHand) {
    sortedOnsets.set(hand, [...new Set(onsets)].sort((a, b) => a - b));
  }
  return notes.filter((n) => {
    const hand = handOf(n);
    const key = sliceKey(n);
    const k = Math.round(n.start / 0.125);
    // Passing tones are defined by onset spacing: a sustained note attacked
    // 0.125 beats after an off-eighth start is still a passing tone.
    if (k % 2 !== 1) return true;
    const ns = bySlice.get(key)!;
    const isOuter = ns.length >= 2 && (n.midi === high.get(key) || n.midi === low.get(key));
    if (isOuter) return true;
    const next = sortedOnsets.get(hand)!.find((o) => o > n.start + 1e-9);
    return next === undefined || next - n.start >= 0.25;
  });
}

export function melodyOnly(notes: Note[], grid: number, minDur: number, pads?: Set<number>): Note[] {
  const bySlice = new Map<number, Note[]>();
  for (const n of notes) {
    const k = Math.round(n.start / grid);
    const arr = bySlice.get(k) ?? [];
    arr.push(n);
    bySlice.set(k, arr);
  }
  const out: Note[] = [];
  const slices = [...bySlice.keys()].sort((a, b) => a - b);
  for (let i = 0; i < slices.length; i++) {
    const k = slices[i]!;
    const group = bySlice.get(k)!;
    // Prefer the highest non-pad voice; a sustained background pad is not the
    // melody. Fall back to the pad when it is the only note sounding.
    const nonPad = pads ? group.filter((n) => !pads.has(n.midi)) : group;
    const top = (nonPad.length ? nonPad : group).reduce((a, b) => (b.midi > a.midi ? b : a));
    const next = slices[i + 1];
    // Cap the legato fill: stretching across rests makes sparse sections ring
    // for 10+ seconds. Notes keep their attack, rests stay rests.
    const gap = next === undefined ? top.dur : (next - k) * grid;
    const dur = next === undefined ? Math.max(minDur, Math.min(2.5, top.dur)) : Math.min(2.5, Math.max(minDur, gap <= 1.5 ? gap : Math.min(top.dur, gap)));
    out.push({ ...top, dur });
  }
  return out;
}

/**
 * Choose the Easy RH voice without treating pitch alone as melody evidence.
 * A short, quiet co-onset decoration is not allowed to displace a longer or
 * louder principal event; otherwise `melodyOnly` can turn a two-voice score
 * into the wrong (usually upper) line.  The fallback remains pitch-biased for
 * ambiguous groups, and a small continuity bonus keeps the selected line
 * stable across adjacent attacks without flattening real leaps.
 * ponytail: this stays a greedy per-onset pass; use phrase DP only if a
 * measured Easy contour regression survives this bounded selector.
 */
export function selectEasyMelody(notes: Note[], grid: number, minDur: number, pads?: Set<number>): Note[] {
  const bySlice = new Map<number, Note[]>();
  for (const note of notes) {
    const key = Math.round(note.start / grid);
    const group = bySlice.get(key) ?? [];
    group.push(note);
    bySlice.set(key, group);
  }
  const slices = [...bySlice.keys()].sort((a, b) => a - b);
  const candidates = slices.map((slice) => {
    const group = bySlice.get(slice)!;
    // A pad is a fallback voice, not a competing melody. Exclude it only when
    // the slice also has credible non-pad evidence; a quiet short detector
    // fragment should not displace a sustained pad that is the sole real voice.
    const nonPad = pads ? group.filter((note) => !pads.has(note.midi)) : group;
    const maxGroupVelocity = Math.max(...group.map((note) => note.vel), 1);
    const credibleNonPad = nonPad.filter((note) => note.dur > 0.25 + 1e-9
      || note.vel >= maxGroupVelocity * 0.7
      || note.identitySource === "vocals");
    const considered = credibleNonPad.length ? nonPad : group;
    const credible = considered.filter((note) => !pads?.has(note.midi)
      || note.vel >= maxGroupVelocity * 0.7
      || note.dur >= 0.5
      || note.identitySource === "vocals");
    const pool = credible.length ? credible : considered;
    const maxVelocity = Math.max(...pool.map((note) => note.vel), 1);
    const meaningful = pool.filter((note) => {
      // A short/quiet upper event is usually a decorative chord partial. Keep
      // it when it is the only evidence, but let a credible co-onset voice win.
      const decorative = note.dur <= 0.25 + 1e-9 && note.vel < maxVelocity * 0.75;
      return !decorative || pool.every((other) => other === note || (
        other.dur <= note.dur + 1e-9 && other.vel < note.vel
      ));
    });
    return (meaningful.length ? meaningful : pool).sort(
      (a, b) => a.midi - b.midi || b.vel - a.vel || b.dur - a.dur,
    );
  });
  const chosen: Note[] = [];
  let previous: Note | undefined;
  for (const group of candidates) {
    let best = group[0]!;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const note of group) {
      const dynamic = Math.max(0, Math.min(1, note.vel / 127));
      const duration = Math.max(0, Math.min(1, note.dur / 0.5));
      const continuity = previous
        ? (() => {
          const gap = note.start - previous.start;
          if (gap > 1.5 + 1e-9) return 0;
          const leap = Math.abs(note.midi - previous.midi);
          return (leap <= 5 ? 0.35 : leap <= 9 ? 0.1 : -0.2) + (leap === 0 ? 0.1 : 0);
        })()
        : 0;
      const sourceBonus = note.identitySource === "vocals" ? 0.35 : 0;
      const score = dynamic * 1.5 + duration * 0.9 + sourceBonus + note.midi * 0.002 + continuity;
      if (score > bestScore + 1e-9) {
        best = note;
        bestScore = score;
      }
    }
    chosen.push({ ...best });
    previous = best;
  }
  return melodyOnly(chosen, grid, minDur);
}

/** Keep the highest `keep` voices per slice; pad pitches rank below real voices. */
export function topVoices(
  notes: Note[],
  grid: number,
  keep: number,
  pads?: Set<number>,
  protectedIdentitySources: ReadonlySet<NonNullable<Note["identitySource"]>> = new Set(),
): Note[] {
  const bySlice = new Map<number, Note[]>();
  for (const n of notes) {
    const k = Math.round(n.start / grid);
    const arr = bySlice.get(k) ?? [];
    arr.push(n);
    bySlice.set(k, arr);
  }
  const out: Note[] = [];
  for (const ns of bySlice.values()) {
    const sorted = [...ns].sort((a, b) => {
      const protectedA = a.identitySource && protectedIdentitySources.has(a.identitySource) ? 1 : 0;
      const protectedB = b.identitySource && protectedIdentitySources.has(b.identitySource) ? 1 : 0;
      const pa = pads?.has(a.midi) ? 1 : 0;
      const pb = pads?.has(b.midi) ? 1 : 0;
      return protectedB - protectedA || pa - pb || b.midi - a.midi;
    });
    for (const n of sorted.slice(0, keep)) out.push(n);
  }
  return out;
}

/**
 * Drop notes that would make one hand's SOUNDING pitch span exceed `maxSpan`
 * (notes overlap across slices even when their starts are different). The
 * hand's melodic extreme (highest for RH, lowest for LH) is kept and only
 * unreachable inner/outer voices are removed, so the line survives.
 */
export function capSoundingSpan(
  notes: Note[],
  maxSpan: number,
  anchor: "high" | "low",
  protectedIdentitySources: ReadonlySet<NonNullable<Note["identitySource"]>> = new Set(),
): Note[] {
  const sorted = [...notes].sort(
    (a, b) => a.start - b.start || (anchor === "high" ? b.midi - a.midi : a.midi - b.midi),
  );
  const out: Note[] = [];
  const active: { end: number; midi: number; note: Note }[] = [];
  for (const n of sorted) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]!.end <= n.start) active.splice(i, 1);
    }
    const mids = active.map((a) => a.midi);
    if (mids.length === 0) {
      active.push({ end: n.start + n.dur, midi: n.midi, note: n });
      out.push(n);
      continue;
    }
    const activeHigh = maxNumber(mids, n.midi);
    const activeLow = minNumber(mids, n.midi);
    const span = activeHigh - activeLow;
    const extendsAnchor = anchor === "high" ? n.midi > activeHigh : n.midi < activeLow;
    const protectedIncoming = n.identitySource !== undefined && protectedIdentitySources.has(n.identitySource);
    const protectedActive = active.filter((entry) => entry.note.identitySource !== undefined
      && protectedIdentitySources.has(entry.note.identitySource));
    if (span <= maxSpan) {
      active.push({ end: n.start + n.dur, midi: n.midi, note: n });
      out.push(n);
    } else if (protectedIncoming) {
      // Experimental source-preserving mode keeps the protected attack while
      // still enforcing the hand's register span: discard unprotected held
      // voices, and keep only protected predecessors that fit around it.
      const kept: typeof active = [{ end: n.start + n.dur, midi: n.midi, note: n }];
      for (const entry of [...protectedActive].sort((a, b) => Math.abs(a.midi - n.midi) - Math.abs(b.midi - n.midi))) {
        const mids = kept.map((item) => item.midi);
        if (Math.max(...mids, entry.midi) - Math.min(...mids, entry.midi) <= maxSpan) kept.push(entry);
      }
      const removed = new Set(active.filter((entry) => !kept.includes(entry)).map((entry) => entry.note));
      for (let i = out.length - 1; i >= 0; i -= 1) {
        const note = out[i];
        if (note !== undefined && removed.has(note)) out.splice(i, 1);
      }
      active.length = 0;
      active.push(...kept);
      out.push(n);
    } else if (protectedActive.length) {
      // Do not let an unprotected accompaniment attack evict a protected
      // source note merely to satisfy the span anchor.
      continue;
    } else if (extendsAnchor) {
      const kept = active.filter((a) => Math.abs(a.midi - n.midi) <= maxSpan);
      const removed = new Set(active.filter((a) => !kept.includes(a)).map((a) => a.note));
      for (let i = out.length - 1; i >= 0; i--) {
        const note = out[i];
        if (note !== undefined && removed.has(note)) out.splice(i, 1);
      }
      active.length = 0;
      active.push(...kept, { end: n.start + n.dur, midi: n.midi, note: n });
      out.push(n);
    }
  }
  return out;
}

export function thinChord(notes: Note[], keep: number): Note[] {
  const bySlice = new Map<number, Note[]>();
  for (const n of notes) {
    const k = Math.round(n.start / 0.25) * 0.25;
    const arr = bySlice.get(k) ?? [];
    arr.push(n);
    bySlice.set(k, arr);
  }
  const out: Note[] = [];
  for (const [k, ns] of bySlice) {
    const sorted = [...ns].sort((a, b) => a.midi - b.midi);
    const kept = sorted.slice(0, Math.min(keep, sorted.length));
    // The quarter-note bin is only a selection window. Keep each attack at
    // its imported (eighth-note) onset: snapping here can move two sequential
    // same-pitch re-attacks onto one another and create an overlap that did
    // not exist in the source arrangement.
    for (const n of kept) out.push({ ...n });
  }
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/**
 * Reduce an explicit metal rhythm lane without touching the harmonic shell.
 * Separated guitar stems can contain a quarter-note wall even after the RH
 * lead has been selected; copying every attack into the LH makes a learner
 * play a drum-machine pattern underneath long root/fifth blocks. Keep one
 * source attack per spacing window, preserving the original onset/pitch so
 * the difficulty ladder can still match it to the next harder level.
 */
function thinMetalRhythm(notes: Note[], minimumSpacingBeats: number): Note[] {
  const sorted = notes
    .filter((note) => note.identitySource === "guitar" || note.identitySource === "other")
    .sort((a, b) => a.start - b.start || b.vel - a.vel || a.midi - b.midi);
  if (!sorted.length || !Number.isFinite(minimumSpacingBeats) || minimumSpacingBeats <= 0) return sorted;
  const selected: Note[] = [];
  for (const note of sorted) {
    const previous = selected.at(-1);
    if (!previous || note.start - previous.start >= minimumSpacingBeats - 1e-9) {
      selected.push({ ...note });
      continue;
    }
    // Co-onset detector duplicates are one physical strike. If the later
    // duplicate is stronger, let it represent the window; otherwise keep the
    // first attack so phrase starts and downbeats are stable.
    if (Math.abs(note.start - previous.start) <= 1e-9
      && (note.vel > previous.vel || (note.vel === previous.vel && note.midi < previous.midi))) {
      selected[selected.length - 1] = { ...note };
    }
  }
  return selected;
}

/** Build the metal LH texture: sparse harmonic shell plus a source-aware
 * rhythm lane. `rhythmGap` is a beat floor that increases for easier levels. */
export function metalLeftHandTexture(notes: Note[], rhythmGap: number, harmonicVoices: number): Note[] {
  const harmonic = thinChord(
    notes.filter((note) => note.identitySource !== "guitar" && note.identitySource !== "other"),
    harmonicVoices,
  );
  const rhythm = thinMetalRhythm(notes, rhythmGap);
  return [...harmonic, ...rhythm].sort((a, b) => a.start - b.start || a.midi - b.midi);
}
