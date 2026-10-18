import { splitHands } from "../analyze.js";
import { Note } from "../types.js";
import { mergedNoteLineage } from "../quantize.js";
import { learnerTraceRefs } from "./learner-trace.js";
import type { LearnerInternalNote } from "./learner-trace.js";
import { onsetGroups, maxNoteEnd, maxNumber, minNumber } from "./shared.js";

/** Remove unisons that overlap only because a simpler level re-voiced them. */
export function trimSamePitchOverlaps(notes: Note[], minDur = 0.125): Note[] {
  const groups = new Map<string, Note[]>();
  for (const n of notes) {
    const key = `${n.hand === "L" ? "L" : "R"}:${n.midi}`;
    const group = groups.get(key) ?? [];
    group.push({ ...n });
    groups.set(key, group);
  }
  const out: Note[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.start - b.start || b.vel - a.vel || b.dur - a.dur);
    const kept: Note[] = [];
    for (const n of group) {
      const prev = kept[kept.length - 1];
      if (!prev) {
        kept.push(n);
        continue;
      }
      if (Math.abs(prev.start - n.start) <= 1e-9) {
        // Re-voicing can collapse two source pitches onto the same attack;
        // retain one physical strike with the stronger dynamics and longest
        // written duration.
        prev.dur = Math.max(prev.dur, n.dur);
        prev.vel = Math.max(prev.vel, n.vel);
        Object.assign(prev, mergedNoteLineage(prev, n));
        const prevRefs = learnerTraceRefs(prev);
        const nextRefs = learnerTraceRefs(n);
        const mergedRefs = [...new Set([...prevRefs, ...nextRefs])].sort();
        if (mergedRefs.length) (prev as LearnerInternalNote).learnerTraceRefs = mergedRefs;
        continue;
      }
      if (prev.start + prev.dur > n.start + 1e-9) {
        prev.dur = n.start - prev.start;
        if (prev.dur < minDur - 1e-9) kept.pop();
      }
      kept.push(n);
    }
    out.push(...kept);
  }
  return out.sort(
    (a, b) =>
      a.start - b.start ||
      a.midi - b.midi ||
      (a.hand ?? "").localeCompare(b.hand ?? ""),
  );
}

/**
 * Select a uniform subset of attack groups when a generated level is faster
 * than its playability budget. Selection-only (no start shifting) keeps the
 * source pitches intact and makes the result eligible for the RH ladder.
 */
/** Limit short bursts without letting the rest of a sparse song hide them. */
export function spaceHandAttacks(notes: Note[], tempoBpm: number, minimumSeconds = 0.375): Note[] {
  const spacing = minimumSeconds * tempoBpm / 60;
  const kept: Note[][] = [];
  for (const group of onsetGroups(notes)) {
    const previous = kept.at(-1);
    if (!previous || group[0]!.start - previous[0]!.start >= spacing - 1e-9) {
      kept.push(group);
    } else if (Math.max(...group.map(n => n.dur)) > Math.max(...previous.map(n => n.dur)) + 1e-9) {
      // Favor a held landing over a short ornament; moving it later preserves spacing.
      kept[kept.length - 1] = group;
    }
  }
  return trimSamePitchOverlaps(kept.flatMap((group, i) => group.map(note => ({
    ...note,
    dur: Math.min(note.dur, kept[i + 1] ? kept[i + 1]![0]!.start - note.start : note.dur),
  }))));
}

export function capAttackDensity(notes: Note[], tempoBpm: number, maxDensity: number, minMedianIoi: number): Note[] {
  if (!notes.length || !Number.isFinite(tempoBpm) || tempoBpm <= 0) return notes;
  const span = maxNoteEnd(notes);
  const spanSec = span * 60 / tempoBpm;
  // maxDensity and minMedianIoi are both expressed in seconds. The IOI floor
  // therefore contributes an attack-rate ceiling of 1 / seconds, while the
  // source tempo is used only when converting the beat span to seconds.
  const targetDensity = Math.min(maxDensity, 1 / minMedianIoi);
  const maxAttacks = Math.max(1, Math.floor(targetDensity * spanSec));
  const byStart = new Map<number, Note[]>();
  for (const n of notes) {
    const key = Number(n.start.toFixed(6));
    const arr = byStart.get(key) ?? [];
    arr.push(n);
    byStart.set(key, arr);
  }
  const groups = [...byStart.entries()].sort((a, b) => a[0] - b[0]);
  if (groups.length <= maxAttacks) return notes;
  const keep = new Set<number>();
  if (maxAttacks === 1) keep.add(0);
  else {
    for (let i = 0; i < maxAttacks; i++) {
      keep.add(Math.round((i * (groups.length - 1)) / (maxAttacks - 1)));
    }
  }
  return groups.filter((_, i) => keep.has(i)).flatMap(([, ns]) => ns);
}

/**
 * Respect explicit staff/track labels while still giving unlabeled material
 * a deterministic pitch-based split. MIDI imports can contain one named LH
 * track plus auxiliary unlabeled tracks, so an all-or-nothing branch would
 * either discard the label or force every auxiliary note onto the RH staff.
 */
export function splitPreservingHands(notes: Note[], forceUnlabeledToRh = false): { rh: Note[]; lh: Note[] } {
  const labeledRh = notes.filter((n) => n.hand === "R");
  const labeledLh = notes.filter((n) => n.hand === "L");
  const unlabeled = notes.filter((n) => n.hand === undefined);
  if (!unlabeled.length) return { rh: labeledRh, lh: labeledLh };
  if (forceUnlabeledToRh) {
    return {
      rh: [...labeledRh, ...unlabeled.map((n) => ({ ...n, hand: "R" as const }))],
      lh: labeledLh,
    };
  }
  const inferred = splitHands(unlabeled);
  return { rh: [...labeledRh, ...inferred.rh], lh: [...labeledLh, ...inferred.lh] };
}

function handStats(notes: Note[]): { left: Note[]; right: Note[]; pitchSpan: number; chordSlices: number } {
  const left = notes.filter((n) => n.hand === "L");
  const right = notes.filter((n) => n.hand !== "L");
  const pitches = notes.map((n) => n.midi);
  const bySlice = new Map<number, Set<number>>();
  for (const n of notes) {
    const key = Math.round(n.start / 0.125);
    const slice = bySlice.get(key) ?? new Set<number>();
    slice.add(n.midi);
    bySlice.set(key, slice);
  }
  const chordSlices = [...bySlice.values()].filter((slice) => {
    if (slice.size < 2) return false;
    const sorted = [...slice].sort((a, b) => a - b);
    return sorted[sorted.length - 1]! - sorted[0]! >= 3;
  }).length;
  return {
    left,
    right,
    pitchSpan: pitches.length ? maxNumber(pitches) - minNumber(pitches) : 0,
    chordSlices,
  };
}

/**
 * Imported MIDI labels are frequently copied from a single source staff (all
 * notes say RH, or the bass staff contains almost everything). That is legal
 * MIDI but a poor teaching arrangement: the learner sees no useful left-hand
 * part. Re-split only when the shape provides evidence for a two-hand texture
 * (a meaningful pitch span and repeated chord/voice slices), leaving genuinely
 * monophonic pieces and balanced/cross-handed arrangements untouched.
 */
export function shouldRebalanceForLearner(notes: Note[]): boolean {
  if (notes.length < 16) return false;
  const { left, right, pitchSpan, chordSlices } = handStats(notes);
  const smaller = Math.min(left.length, right.length);
  const larger = Math.max(left.length, right.length);
  const oneSided = smaller === 0;
  const severelyImbalanced = larger > 0 && smaller / larger < 0.15;
  if (!oneSided && !severelyImbalanced) return false;
  if (pitchSpan < 24) return false;
  // At least a few independent attacks must support a harmony/bass reading;
  // a single high-register melody should not acquire invented left-hand notes.
  return chordSlices >= Math.max(3, Math.floor(notes.length / 80)) || minNumber(notes.map((n) => n.midi)) <= 48;
}

/**
 * Detect the common audio-transcription shape where the pitch split is
 * numerically balanced but musically useless: a high melody sits above
 * recurring bass-plus-inner-voice attacks, while the preliminary LH contains
 * almost no multi-note onsets. Keep this gate narrow so melody-only songs and
 * already-labelled piano arrangements are not rewritten.
 */
export function shouldRedistributeInnerVoices(notes: Note[]): boolean {
  if (notes.length < 24 || notes.some((note) => note.hand !== undefined)) return false;
  const preliminary = splitHands(notes);
  const lhGroups = onsetGroups(preliminary.lh);
  if (lhGroups.length < 8) return false;
  const lhMultiRatio = lhGroups.filter((group) => group.length > 1).length / lhGroups.length;
  if (lhMultiRatio >= 0.15) return false;
  const candidateGroups = onsetGroups(notes).filter((group) => {
    if (group.length < 2) return false;
    const sorted = [...group].sort((a, b) => a.midi - b.midi);
    return sorted[0]!.midi <= 50 && sorted[sorted.length - 1]!.midi - sorted[0]!.midi >= 7;
  });
  return candidateGroups.length >= Math.max(8, Math.floor(onsetGroups(notes).length * 0.08));
}

/**
 * Move inner voices from a one-staff transcription into a compact LH shell.
 * The highest co-onset remains the melody; lower co-onsets are octave-revoiced
 * into a playable bass/register. This is deliberately an inferred learner
 * arrangement, not a claim that Basic Pitch supplied staff assignments.
 */
export function redistributeInnerVoices(notes: Note[]): Note[] {
  return onsetGroups(notes).flatMap((group) => {
    if (group.length === 1) {
      const note = group[0]!;
      return [{ ...note, hand: note.midi <= 50 ? "L" as const : "R" as const }];
    }
    const sorted = [...group].sort((a, b) => a.midi - b.midi || b.vel - a.vel);
    const melody = sorted[sorted.length - 1]!;
    const moveToLeft = sorted.length >= 2 && (sorted[0]!.midi <= 50 || sorted.length >= 3)
      ? new Set(sorted.slice(0, -1))
      : new Set<Note>();
    return group.map((note) => {
      if (note === melody) return { ...note, hand: "R" as const };
      if (!moveToLeft.has(note)) return { ...note, hand: "R" as const };
      let midi = note.midi;
      while (midi > 55) midi -= 12;
      while (midi < 36) midi += 12;
      return { ...note, midi, hand: "L" as const };
    });
  });
}

/** Detect the continuous-pitch, high-overlap walls that need a percentile
 * hand split. A large pitch gap is a real bass/treble boundary and should
 * continue to win; only dense material with no such boundary is rebalanced.
 * Curated piano arrangements and sources with explicit hand labels are
 * already meaningful two-hand material, so their metadata must override this
 * transcription-wall safeguard. */
export function isDenseContinuousWall(notes: Note[], trackNames: string[] = []): boolean {
  if (notes.some((n) => n.hand !== undefined)) return false;
  const namedPiano = trackNames.some((name) => /\b(?:piano|keyboard|keys?)\b/i.test(name));
  // A named Piano track is normally a curated arrangement, but a staggered
  // wall of very long notes can still carry that generic writer-generated
  // name. Keep the wall safeguard for that malformed shape; real curated
  // material has a varied duration distribution (as in Dear God).
  const longSustainRatio = notes.filter((n) => n.dur >= 4).length / Math.max(1, notes.length);
  if (namedPiano && longSustainRatio < 0.5) return false;
  if (notes.length < 12) return false;
  const distinct = [...new Set(notes.map((n) => n.midi))].sort((a, b) => a - b);
  if (distinct.length < 2) return false;
  const maxGap = maxNumber(distinct.slice(1).map((m, i) => m - distinct[i]!));
  if (maxGap >= 5) return false;
  const events = notes.flatMap((n) => [[n.start, 1], [n.start + n.dur, -1]] as [number, number][])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  let maxSounding = 0;
  for (const [, delta] of events) { active += delta; maxSounding = Math.max(maxSounding, active); }
  return maxSounding >= 8;
}

function fallbackRhSubset(harder: Note[], maxSim: number, minNotes: number): Note[] {
  const byStart = new Map<number, Note[]>();
  for (const n of harder) {
    if (n.hand === "L") continue;
    const key = Number(n.start.toFixed(6));
    const arr = byStart.get(key) ?? [];
    arr.push(n);
    byStart.set(key, arr);
  }
  const groups = [...byStart.entries()].sort((a, b) => a[0] - b[0]);
  if (!groups.length) return [];
  // Use one attack group per requested note at minimum; most scalar lines
  // have one note per group, while chords may contribute up to maxSim notes.
  const neededGroups = Math.min(groups.length, Math.max(1, minNotes));
  const out: Note[] = [];
  for (let i = 0; i < neededGroups; i++) {
    const index = neededGroups === 1 ? 0 : Math.round((i * (groups.length - 1)) / (neededGroups - 1));
    const notes = groups[index]![1]!
      .slice()
      .sort((a, b) => b.midi - a.midi)
      .slice(0, Math.max(1, maxSim));
    out.push(...notes);
  }
  return out;
}

/**
 * Shorten overlapping attacks instead of throwing them away when a simplified
 * level inherits a dense source wall. This keeps the melody/ladder pitches
 * while ensuring the easier level never asks for more than `maxSim` held
 * fingers at once.
 */
export function capPlayableSounding(notes: Note[], maxSim: number, minDur = 0.125): Note[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const out: Note[] = [];
  const active: { end: number; note: Note; outIndex: number }[] = [];
  for (const original of sorted) {
    const n = { ...original };
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i]!.end <= n.start + 1e-9) active.splice(i, 1);
    }
    if (active.length >= maxSim) {
      // Prefer ending the longest-held/oldest note at this new attack. The
      // attack itself is retained whenever a positive grid-sized duration is
      // available; only same-time chords beyond the budget are dropped.
      const candidates = active
        .filter((entry) => n.start - entry.note.start >= minDur - 1e-9)
        .sort((a, b) => b.note.start - a.note.start || b.note.dur - a.note.dur);
      const target = candidates[0];
      if (!target) continue;
      const shortened = n.start - target.note.start;
      target.note.dur = Math.max(minDur, shortened);
      target.end = target.note.start + target.note.dur;
      out[target.outIndex] = { ...target.note };
      active.splice(active.indexOf(target), 1);
    }
    const outIndex = out.push(n) - 1;
    active.push({ end: n.start + n.dur, note: n, outIndex });
  }
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/**
 * A semantic beginner reduction has one job per hand: the RH carries the
 * identity line and the LH supplies a sparse harmonic anchor.  Applying the
 * ordinary global two-finger cap to that texture is subtly unsafe because it
 * sorts low pitches first; a sustained LH note can therefore consume the
 * budget and make a simultaneous RH melody attack disappear.  Cap each hand
 * to one sounding note instead, which both preserves melody priority and
 * keeps the combined sounding budget at two.
 */
export function capSemanticBeginnerHands(notes: Note[]): Note[] {
  return [
    ...capPlayableSounding(notes.filter((note) => note.hand === "L"), 1),
    ...capPlayableSounding(notes.filter((note) => note.hand !== "L"), 1),
  ].sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/**
 * Keep one deterministic LH harmonic anchor in each rhythmic window.  The
 * lowest note at the first LH attack wins, so a role-aware arranger's bass or
 * chord root survives while repeated metal/guitar pulses do not overwhelm a
 * beginning pianist.  This is selection-only: pitches and attacks remain
 * traceable to the next harder level.
 */
export function sparseLeftHandAnchors(notes: Note[], windowBeats: number): Note[] {
  const lhGroups = onsetGroups(notes.filter((note) => note.hand === "L"));
  if (!lhGroups.length) return [];
  const groupsByWindow = new Map<number, Note[][]>();
  for (const group of lhGroups) {
    const window = Math.floor((group[0]!.start + 1e-9) / windowBeats);
    const groups = groupsByWindow.get(window) ?? [];
    groups.push(group);
    groupsByWindow.set(window, groups);
  }
  return [...groupsByWindow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, groups]) => {
      const first = groups[0]!;
      return [...first].sort((a, b) => a.midi - b.midi || b.vel - a.vel)[0]!;
    });
}

/**
 * Apply the frozen generic-learner Beginner sparse-LH policy.  This remains
 * separate from the metal anchor path so metal output is unchanged: use
 * existing Very Easy LH evidence, choose at most one lowest attack per
 * source-meter window, and skip an attack when its full sounding overlap
 * would exceed the two-hand budget. Every emitted note is an existing event;
 * no retiming or RH mutation is performed.
 */
export function collisionAwareSparseLeftHandAnchors(
  beginnerRh: Note[],
  veryEasy: Note[],
  windowBeats: number,
  tempoBpm: number,
  maxDensity: number,
): Note[] {
  const width = Number.isFinite(windowBeats) && windowBeats > 0 ? windowBeats : 4;
  const rejectedRoles = new Set([
    "unknown",
    "unsafe",
    "decorative",
    "arpeggio",
    "arpeggio-filler",
    "filler",
    "repeated-filler",
    "repeated_same_harmony_filler",
    "drum",
    "drums",
  ]);
  const eligible = veryEasy
    .filter((note) => (
      note.hand === "L"
      && (note.identitySource === undefined || note.identitySource === "guitar")
      && !rejectedRoles.has(String((note as Note & { role?: unknown }).role ?? "").toLowerCase())
    ))
    .sort((a, b) => a.start - b.start || a.midi - b.midi || b.vel - a.vel);
  if (!eligible.length) return [];

  const byWindow = new Map<number, Map<string, Note[]>>();
  for (const note of eligible) {
    const index = Math.floor((note.start + 1e-9) / width);
    const groups = byWindow.get(index) ?? new Map<string, Note[]>();
    const key = note.start.toFixed(6);
    const group = groups.get(key) ?? [];
    group.push(note);
    groups.set(key, group);
    byWindow.set(index, groups);
  }

  const maxSounding = (notes: Note[]): number => {
    const events = notes
      .flatMap((note) => [[note.start, 1], [note.start + note.dur, -1]] as [number, number][])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let active = 0;
    let max = 0;
    for (const [, delta] of events) {
      active += delta;
      max = Math.max(max, active);
    }
    return max;
  };

  const emitted: Note[] = [];
  for (const [, groups] of [...byWindow.entries()].sort(([a], [b]) => a - b)) {
    const ordered = [...groups.values()]
      .map((group) => group[0]!)
      .sort((a, b) => a.start - b.start || a.midi - b.midi || b.vel - a.vel);
    for (const candidate of ordered) {
      const combined = [...beginnerRh, ...emitted, candidate];
      const spanSeconds = maxNoteEnd(combined) * 60 / tempoBpm;
      const attackDensity = new Set(combined.map((note) => note.start.toFixed(3))).size / spanSeconds;
      if (maxSounding(combined) <= 2 && attackDensity <= maxDensity + 1e-9) {
        emitted.push({ ...candidate });
        break;
      }
    }
  }
  return emitted;
}

/** Select a deterministic mixed-hand subset from a harder level. */
function fallbackPlayableSubset(harder: Note[], maxSim: number, minNotes: number, existing: Note[]): Note[] {
  const byStart = new Map<number, Note[]>();
  for (const n of harder) {
    const key = Number(n.start.toFixed(6));
    const arr = byStart.get(key) ?? [];
    arr.push(n);
    byStart.set(key, arr);
  }
  const groups = [...byStart.entries()].sort((a, b) => a[0] - b[0]);
  if (!groups.length) return existing;
  const seen = new Set(existing.map((n) => `${n.midi}@${n.start.toFixed(6)}`));
  const out = [...existing];
  const addFromGroup = (group: Note[]) => {
    const candidates = [...group].sort((a, b) => {
      const hand = (a.hand === "L" ? 0 : 1) - (b.hand === "L" ? 0 : 1);
      return hand || b.vel - a.vel || b.midi - a.midi;
    });
    let added = 0;
    for (const n of candidates) {
      if (added >= maxSim) break;
      const key = `${n.midi}@${n.start.toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...n });
      added++;
    }
  };
  // First pass samples across the whole song so a collapsed quantization
  // grid still yields a recognizable beginning, middle, and ending.
  const firstPass = Math.min(groups.length, Math.max(1, minNotes));
  for (let i = 0; i < firstPass && out.length < minNotes; i++) {
    const index = firstPass === 1 ? 0 : Math.round((i * (groups.length - 1)) / (firstPass - 1));
    addFromGroup(groups[index]![1]!);
  }
  // If those groups did not contain enough voices, fill deterministically
  // from the remaining attacks without exceeding the per-attack chord budget.
  for (const [, group] of groups) {
    if (out.length >= minNotes) break;
    addFromGroup(group);
  }
  return out;
}

export function preserveRhLadder(
  easier: Note[],
  harder: Note[],
  tolerance: number,
  maxSim: number,
  allowFallback = false,
  semanticTwoHand = false,
): Note[] {
  const capSounding = (notes: Note[]) => semanticTwoHand
    ? capSemanticBeginnerHands(notes)
    : capPlayableSounding(notes, maxSim);
  const starts = new Map<number, number[]>();
  for (const n of harder) {
    if (n.hand === "L") continue;
    const arr = starts.get(n.midi) ?? [];
    arr.push(n.start);
    starts.set(n.midi, arr);
  }
  const collect = (matchTolerance: number, preserveStarts: boolean): Note[] => easier.flatMap((n) => {
    if (n.hand === "L") return [n];
    const candidates = starts.get(n.midi) ?? [];
    if (!candidates.length) return [];
    let match = candidates[0]!;
    let distance = Math.abs(match - n.start);
    for (const s of candidates.slice(1)) {
      const d = Math.abs(s - n.start);
      if (d < distance) {
        match = s;
        distance = d;
      }
    }
    if (distance > matchTolerance) return [];
    return [preserveStarts ? { ...n } : { ...n, start: match }];
  });
  let kept = collect(tolerance, allowFallback);
  // Quantizing a melody to a coarser grid can change which pitch wins a slice,
  // leaving an otherwise healthy level with only a handful of RH notes that
  // match the harder level exactly.  In that case, choose a sparse subset of
  // the already validated harder RH material instead of publishing an invalid
  // (<8-note) level or inventing new pitches.  The fallback is capped per
  // attack so it remains within the easier level's chord-size budget.
  let result = capSounding(kept);
  // Quarter-grid reductions can legitimately move an onset by half of the
  // eighth-note grid used by the harder level. If the strict ladder match
  // would leave an otherwise substantial level with fewer than eight RH
  // notes, retry with that quantization tolerance and snap the recovered
  // notes onto the harder level's actual onsets. This is still a true subset
  // of harder-level pitches/attacks; it only repairs the grid mismatch.
  if (!allowFallback && result.filter((n) => n.hand !== "L").length < 8) {
    const recovered = capSounding(collect(Math.max(tolerance, 0.13), false));
    if (recovered.filter((n) => n.hand !== "L").length > result.filter((n) => n.hand !== "L").length) {
      kept = recovered;
      result = recovered;
    }
  }
  const resultRhCount = result.filter((n) => n.hand !== "L").length;
  const harderRhCount = harder.filter((n) => n.hand !== "L").length;
  // A semantic beginner level needs an identity task as well as its sparse
  // LH anchor.  Counting only the combined note total lets eight LH notes
  // satisfy the fallback even when the harder tier still has RH material;
  // that publishes an unplayable one-handed level.  If the harder tier has no
  // RH material there is nothing traceable to recover, so retain the source's
  // genuinely LH-only texture rather than inventing a hand assignment.
  const fallbackTargetReached = semanticTwoHand
    ? result.length >= 8 && (resultRhCount > 0 || harderRhCount === 0)
    : resultRhCount >= 8;
  if (allowFallback && !fallbackTargetReached) {
    const lh = result.filter((n) => n.hand === "L");
    const needed = semanticTwoHand
      ? Math.max(8 - result.length, resultRhCount > 0 || harderRhCount === 0 ? 0 : 1)
      : Math.max(0, 8 - resultRhCount);
    const fallback = fallbackRhSubset(harder, maxSim, Math.max(needed, 8));
    if (fallback.length >= needed) {
      const seen = new Set(result.filter((n) => n.hand !== "L").map((n) => `${n.midi}@${n.start.toFixed(6)}`));
      const rh = result.filter((n) => n.hand !== "L");
      for (const n of fallback) {
        const key = `${n.midi}@${n.start.toFixed(6)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rh.push(n);
        if (semanticTwoHand
          ? lh.length + rh.length >= 8 && (rh.length > 0 || harderRhCount === 0)
          : rh.length >= 8) break;
      }
      if (semanticTwoHand
        ? lh.length + rh.length >= 8 && (rh.length > 0 || harderRhCount === 0)
        : rh.length >= 8) {
        result = [...lh, ...rh].sort((a, b) => a.start - b.start || a.midi - b.midi);
      }
    }
  }
  if (allowFallback && result.length < 8) result = fallbackPlayableSubset(harder, maxSim, 8, result);
  return capSounding(result);
}

/**
 * Keep metal accompaniment attacks traceable through the difficulty ladder.
 * RH already has a dedicated matcher above; LH anchors need the same
 * treatment because quarter-/half-bar quantization can otherwise invent a
 * new bass onset that never existed in the next harder tier. Matching uses
 * the level's normal tolerance and snaps to the harder level's exact attack,
 * so the resulting note is a true semantic subset rather than a re-timed
 * accompaniment event.
 */
export function preserveMetalLhLadder(easier: Note[], harder: Note[], tolerance: number): Note[] {
  const starts = new Map<number, number[]>();
  for (const note of harder) {
    if (note.hand !== "L") continue;
    const values = starts.get(note.midi) ?? [];
    values.push(note.start);
    starts.set(note.midi, values);
  }
  return easier.flatMap((note) => {
    if (note.hand !== "L") return [note];
    const candidates = starts.get(note.midi) ?? [];
    let match: number | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const nextDistance = Math.abs(candidate - note.start);
      if (nextDistance < distance) {
        match = candidate;
        distance = nextDistance;
      }
    }
    if (match === undefined || distance > tolerance) return [];
    return [{ ...note, start: match }];
  });
}
