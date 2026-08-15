import { splitHands, detectBassPattern, detectKey, chordName } from "./analyze.js";
import { Note, ParsedMidi, SongMeta, Variant, DifficultyLevel, LEVEL_ORDER, ChordLabel } from "./types.js";
import { quantize } from "./quantize.js";
import { LADDER_TOL, PLAYABILITY_LIMITS } from "./validate.js";
import { sanitizeImportedNotes } from "./clean.js";

export interface VariantOptions {
  /** 16th-note grid (beats) used for note slicing */
  grid?: number;
  /** octave-shift notes outside the piano range (21-108) into it */
  normalizeRange?: boolean;
}

export const SAFE_TEMPO_BPM = 120;

/** Return a publishable integer tempo, falling back for malformed MIDI meta. */
export function normalizeTempoBpm(value: number | undefined, fallback = SAFE_TEMPO_BPM): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 20 || n > 300) return fallback;
  return Math.round(n);
}

/** Shift out-of-piano-range notes by octaves so everything is playable. */
export function normalizePianoRange(notes: Note[]): Note[] {
  return notes.map((n) => {
    let midi = n.midi;
    while (midi < 21) midi += 12;
    while (midi > 108) midi -= 12;
    return midi === n.midi ? n : { ...n, midi };
  });
}

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
  const total = Math.max(...notes.map((n) => n.start + n.dur));
  const sounding = new Map<number, number>();
  for (const n of notes) sounding.set(n.midi, (sounding.get(n.midi) ?? 0) + n.dur);
  for (const [midi, dur] of sounding) {
    if (dur / total >= 0.3) pads.add(midi);
  }
  return pads;
}

function chordsAt(notes: Note[], grid: number): ChordLabel[] {
  const bySlice = new Map<number, number[]>();
  for (const n of notes) {
    if (n.dur < 0.25) continue; // passing tones are not harmony
    const k = Math.round(n.start / grid) * grid;
    const arr = bySlice.get(k) ?? [];
    arr.push(n.midi);
    bySlice.set(k, arr);
  }
  const out: ChordLabel[] = [];
  for (const [beat, mids] of [...bySlice.entries()].sort((a, b) => a[0] - b[0])) {
    const pcs = [...new Set(mids.map((m) => m % 12))].sort((a, b) => a - b);
    if (pcs.length < 2) continue;
    const bassPc = Math.min(...mids) % 12;
    const name = chordName(pcs, bassPc);
    if (!name) continue; // unlabelable dyad (root+3rd, chromatic clash, ...)
    out.push({ beat, name, notes: mids });
  }
  // Per-grid-slice analysis produces the same chord every 0.25 beats; collapse
  // consecutive same-name runs and keep only runs that hold >= 1 beat, so the
  // progression shows real changes instead of harmonic flashes.
  const kept: ChordLabel[] = [];
  for (let i = 0; i < out.length; i++) {
    const c = out[i]!;
    const next = out[i + 1];
    if (next && next.name === c.name) continue;
    const runBeats = (next?.beat ?? c.beat + 1) - c.beat;
    if (runBeats < 1) continue;
    kept.push(c);
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
    high.set(key, Math.max(...ns.map((n) => n.midi)));
    low.set(key, Math.min(...ns.map((n) => n.midi)));
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

/** Keep the highest `keep` voices per slice; pad pitches rank below real voices. */
function topVoices(notes: Note[], grid: number, keep: number, pads?: Set<number>): Note[] {
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
      const pa = pads?.has(a.midi) ? 1 : 0;
      const pb = pads?.has(b.midi) ? 1 : 0;
      return pa - pb || b.midi - a.midi;
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
function capSoundingSpan(notes: Note[], maxSpan: number, anchor: "high" | "low"): Note[] {
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
    const span = Math.max(...mids, n.midi) - Math.min(...mids, n.midi);
    const extendsAnchor = anchor === "high" ? n.midi > Math.max(...mids) : n.midi < Math.min(...mids);
    if (span <= maxSpan) {
      active.push({ end: n.start + n.dur, midi: n.midi, note: n });
      out.push(n);
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

function thinChord(notes: Note[], keep: number): Note[] {
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
    for (const n of kept) out.push({ ...n, start: k });
  }
  return out.sort((a, b) => a.start - b.start || a.midi - b.midi);
}

/**
 * Select a uniform subset of attack groups when a generated level is faster
 * than its playability budget. Selection-only (no start shifting) keeps the
 * source pitches intact and makes the result eligible for the RH ladder.
 */
function capAttackDensity(notes: Note[], tempoBpm: number, maxDensity: number, minMedianIoi: number): Note[] {
  if (!notes.length || !Number.isFinite(tempoBpm) || tempoBpm <= 0) return notes;
  const span = Math.max(...notes.map((n) => n.start + n.dur));
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

/** Detect the continuous-pitch, high-overlap walls that need a percentile
 * hand split. A large pitch gap is a real bass/treble boundary and should
 * continue to win; only dense material with no such boundary is rebalanced.
 * Curated piano arrangements and sources with explicit hand labels are
 * already meaningful two-hand material, so their metadata must override this
 * transcription-wall safeguard. */
function isDenseContinuousWall(notes: Note[], trackNames: string[] = []): boolean {
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
  const maxGap = Math.max(...distinct.slice(1).map((m, i) => m - distinct[i]!));
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
function capPlayableSounding(notes: Note[], maxSim: number, minDur = 0.125): Note[] {
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

function preserveRhLadder(
  easier: Note[],
  harder: Note[],
  tolerance: number,
  maxSim: number,
  allowFallback = false,
): Note[] {
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
  let keptRh = kept.filter((n) => n.hand !== "L");
  let result = capPlayableSounding(kept, maxSim);
  // Quarter-grid reductions can legitimately move an onset by half of the
  // eighth-note grid used by the harder level. If the strict ladder match
  // would leave an otherwise substantial level with fewer than eight RH
  // notes, retry with that quantization tolerance and snap the recovered
  // notes onto the harder level's actual onsets. This is still a true subset
  // of harder-level pitches/attacks; it only repairs the grid mismatch.
  if (!allowFallback && result.filter((n) => n.hand !== "L").length < 8) {
    const recovered = capPlayableSounding(collect(Math.max(tolerance, 0.13), false), maxSim);
    if (recovered.filter((n) => n.hand !== "L").length > result.filter((n) => n.hand !== "L").length) {
      kept = recovered;
      keptRh = recovered.filter((n) => n.hand !== "L");
      result = recovered;
    }
  }
  if (allowFallback && keptRh.length < 8) {
    const lh = result.filter((n) => n.hand === "L");
    const needed = Math.max(0, 8 - keptRh.length);
    const fallback = fallbackRhSubset(harder, maxSim, Math.max(needed, 8));
    if (fallback.length >= needed) {
      const seen = new Set(result.filter((n) => n.hand !== "L").map((n) => `${n.midi}@${n.start.toFixed(6)}`));
      const rh = [...keptRh];
      for (const n of fallback) {
        const key = `${n.midi}@${n.start.toFixed(6)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rh.push(n);
        if (rh.length >= 8) break;
      }
      if (rh.length >= 8) result = [...lh, ...rh].sort((a, b) => a.start - b.start || a.midi - b.midi);
    }
  }
  if (allowFallback && result.length < 8) result = fallbackPlayableSubset(harder, maxSim, 8, result);
  return capPlayableSounding(result, maxSim);
}

const KEY_PC: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

function rootOf(midi: number, key: string): number {
  const pc = KEY_PC[key.replace(/m$/, "")] ?? 0;
  const offset = ((midi - pc) % 12 + 12) % 12;
  let root = midi - offset;
  while (root < 21) root += 12; // keep the rooted bass on the piano
  return root;
}

/**
 * Generate 6 difficulty variants from a source arrangement.
 * Guarantee: each easier level is a strict simplification (subset or
 * equal notes) of the level above it.
 */
export function buildVariants(src: ParsedMidi, meta: SongMeta, opts: VariantOptions = {}): Variant[] {
  const grid = opts.grid ?? 0.25;
  const tempo = normalizeTempoBpm(meta.tempo ?? src.tempoBpm);
  // Every source type passes through the same conservative structural cleanup.
  // YouTube ingestion may additionally run cleanTranscription() beforehand;
  // this second pass is intentionally idempotent and protects direct callers.
  const imported = sanitizeImportedNotes(src.notes, { tempoBpm: tempo });
  const base = quantize(imported, { grid: 0.125, minDur: 0.125 });
  const normalized = opts.normalizeRange === false ? base : normalizePianoRange(base);
  const shifted = base.filter((n, i) => normalized[i]!.midi !== n.midi);
  const sourceWarnings = shifted.length
    ? [`${shifted.length} source notes were octave-normalized into the piano range 21-108`]
    : [];
  const splitSource = normalized;
  const pathologicalWall = isDenseContinuousWall(imported, src.trackNames);
  const split = pathologicalWall
    ? { rh: splitSource.map((n) => ({ ...n, hand: "R" as const })), lh: [] as Note[] }
    : splitHands(splitSource);
  const { rh, lh } = split;
  const key = meta.key ?? detectKey(imported).name;
  // Detect background pads before sustain capping; otherwise a long drone
  // shortened by the import sanitizer can stop looking like a pad and displace
  // the actual melody in the RH voice selector.
  const pads = padPitches(src.notes);
  const capLevel = (level: DifficultyLevel, notes: Note[]) => {
    const lim = PLAYABILITY_LIMITS[level]!;
    return capAttackDensity(notes, tempo, lim.maxDensity, lim.minMedianIoi);
  };

  // Use the hand-labeled split output, not the raw base, so the advanced
  // variant keeps L/R hand labels for two-staff rendering. Cap voices per
  // slice AND sounding span so full-band multitrack MIDIs stay a playable
  // piano texture; each easier level is then a reduction of the level above
  // so the ladder stays a true subset.
  const advanced = capLevel("advanced", quantize(
    [
      ...capSoundingSpan(topVoices(rh, 0.125, 4, pads), 12, "high"),
      ...capSoundingSpan(thinChord(lh, 4), 12, "low"),
    ],
    { grid: 0.125 },
  ));
  const advancedRh = advanced.filter((n) => n.hand !== "L");
  const advancedLh = advanced.filter((n) => n.hand === "L");
  const medium = capLevel("medium", quantize(
    reduceMediumRhythm([
      ...capSoundingSpan(topVoices(advancedRh, 0.125, 3, pads), 12, "high"),
      ...capSoundingSpan(thinChord(advancedLh, 3), 12, "low"),
    ]),
    { grid: 0.125 },
  ));
  const mediumRh = medium.filter((n) => n.hand !== "L");
  const mediumLh = medium.filter((n) => n.hand === "L");
  const easy = capLevel("easy", quantize(
    [
      ...capSoundingSpan(melodyOnly(mediumRh, 0.125, 0.5, pads), 12, "high"),
      ...capSoundingSpan(thinChord(mediumLh, 2).map((n) => ({ ...n, midi: rootOf(n.midi, key) })), 12, "low"),
    ],
    { grid: 0.125 },
  ));
  // Each easier level is a reduction of the level above it, so the ladder
  // is a true subset (same melody, same moments) instead of a re-selection
  // that drifts apart in fast passages.
  const easyRh = easy.filter((n) => n.hand !== "L");
  const easyLh = easy.filter((n) => n.hand === "L");
  const veryEasy = capLevel("very-easy", quantize(
    [...capSoundingSpan(melodyOnly(easyRh, 0.25, 0.5, pads), 12, "high"), ...easyLh],
    { grid: 0.25 },
  ));
  const beginner = capLevel("beginner", quantize(
    capSoundingSpan(melodyOnly(veryEasy.filter((n) => n.hand !== "L"), 0.25, 0.5, pads), 12, "high"),
    { grid: 0.25 },
  ));
  const veryBeginner = capLevel("very-beginner", quantize(capSoundingSpan(melodyOnly(beginner, 0.5, 1, pads), 12, "high"), { grid: 0.5 }));

  const rawSets: Record<DifficultyLevel, Note[]> = {
    "very-beginner": veryBeginner,
    beginner,
    "very-easy": veryEasy,
    easy,
    medium,
    advanced,
  };
  // The levels were density-capped top-down so every reduction sees the same
  // playable attack stream as its next harder neighbor. Intersect easier RH
  // material with that neighbor once more to canonicalize quantized starts.
  const sets: Record<DifficultyLevel, Note[]> = { ...rawSets };
  for (let i = LEVEL_ORDER.length - 2; i >= 0; i--) {
    const easier = LEVEL_ORDER[i]!;
    const harder = LEVEL_ORDER[i + 1]!;
    sets[easier] = preserveRhLadder(
      sets[easier]!,
      sets[harder]!,
      LADDER_TOL[easier] ?? 0.02,
      PLAYABILITY_LIMITS[easier]!.maxSim,
      pathologicalWall,
    );
  }
  const scores: Record<DifficultyLevel, number> = {
    "very-beginner": 1,
    beginner: 1.4,
    "very-easy": 2,
    easy: 2.6,
    medium: 3.4,
    advanced: 4.6,
  };
  const lhPattern = detectBassPattern(lh);
  return LEVEL_ORDER.map((level) => {
    const notes = sets[level]!.map((n) => ({ ...n }));
    return {
      level,
      difficultyScore: scores[level]!,
      notes,
      ...(sourceWarnings.length ? { warnings: sourceWarnings } : {}),
      chords: chordsAt(notes, grid),
      bassPattern: level === "advanced" || level === "medium" ? lhPattern : level === "very-easy" || level === "easy" ? "block" : "none",
      key,
      tempoBpm: tempo,
      timeSig: src.timeSig,
      measures: buildMeasures(notes, src.timeSig),
    };
  });
}

function buildMeasures(notes: Note[], timeSig: [number, number]): Variant["measures"] {
  const [num, den] = timeSig;
  const beatsPerMeasure = num * (4 / den);
  const dur = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 1);
  const count = Math.max(1, Math.ceil(dur / beatsPerMeasure));
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    startBeat: i * beatsPerMeasure,
    endBeat: (i + 1) * beatsPerMeasure,
  }));
}
