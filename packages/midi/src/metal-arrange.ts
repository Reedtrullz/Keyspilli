import type { ChordLabel, Note, ParsedMidi } from "./types.js";

export type MetalStemRole = "vocals" | "bass" | "guitar" | "other" | "drums";

export interface MetalStem {
  role: MetalStemRole;
  midi: ParsedMidi;
  /** Optional separator/transcriber confidence in [0, 1]. */
  confidence?: number;
}

export interface MetalArrangementInput {
  stems: MetalStem[];
  sectionBeats?: number;
  harmonyBeats?: number;
  title?: string;
}

export interface MetalIdentitySection {
  startBeat: number;
  endBeat: number;
  source: "vocals" | "guitar" | "other" | "mixed" | "rest";
  confidence: number;
}

export interface MetalArrangementIR {
  version: 1;
  tempoBpm: number;
  timeSig: [number, number];
  durationBeats: number;
  sections: MetalIdentitySection[];
  identity: Note[];
  harmony: ChordLabel[];
  rhythmicAccents: number[];
}

export interface MetalArrangementResult {
  parsed: ParsedMidi;
  chords: ChordLabel[];
  ir: MetalArrangementIR;
  stats: {
    identityNotes: number;
    leftHandNotes: number;
    chordEvents: number;
    sourceSections: Record<string, number>;
  };
  warnings: string[];
}

const EPS = 1e-6;
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function beatsPerMeasure(timeSig: [number, number]): number {
  const [numerator, denominator] = timeSig;
  const value = numerator * (4 / denominator);
  return Number.isFinite(value) && value > 0 ? value : 4;
}

function toRegister(midi: number, low: number, high: number): number {
  let pitch = Math.round(midi);
  while (pitch < low) pitch += 12;
  while (pitch > high) pitch -= 12;
  return clamp(pitch, low, high);
}

function validNotes(stem: MetalStem | undefined): Note[] {
  if (!stem) return [];
  return stem.midi.notes
    .filter((note) => Number.isFinite(note.start) && Number.isFinite(note.dur) && note.dur > 0 && note.midi >= 0 && note.midi <= 127)
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
}

interface MonophonicPathOptions {
  /** Prefer a plausible upper lead tone over lower rhythm/accompaniment bleed. */
  preferUpperLead?: boolean;
}

/**
 * Reduce polyphonic pitch evidence to one identity voice. The greedy salience
 * pass prefers confident/long attacks, resets continuity after a real rest,
 * and can favor an upper guitar lead over lower accompaniment in the same
 * onset cluster.
 */
function monophonicPath(
  notes: Note[],
  low: number,
  high: number,
  options: MonophonicPathOptions = {},
): Note[] {
  type CandidateNote = Note & { rawMidi: number };
  const groups: CandidateNote[][] = [];
  for (const note of notes) {
    const normalized: CandidateNote = { ...note, rawMidi: note.midi, midi: toRegister(note.midi, low, high) };
    const last = groups.at(-1);
    if (last && Math.abs(last[0]!.start - normalized.start) <= 0.08) last.push(normalized);
    else groups.push([normalized]);
  }

  let previous: Note | undefined;
  const selected: Note[] = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex]!;
    const candidates = group
      .filter((note) => !previous || note.start >= previous.start + Math.min(previous.dur, 0.08) - EPS)
      .map((note) => {
        if (!previous) return note;
        const elapsed = Math.max(0, note.start - previous.start);
        const rest = Math.max(0, note.start - (previous.start + previous.dur));
        const continuityPrevious = rest <= 1 ? previous : undefined;
        let pitch = note.midi;
        // A detector octave-flips guitar/vocal partials surprisingly often.
        // Within a short travel window, fold by octaves toward the previous
        // pitch; never ask the player to jump more than an octave in <=1.5
        // beats merely because the raw stem contained a distant partial.
        if (continuityPrevious && elapsed <= 1.5) {
          // An exact octave inside one beat is usually detector harmonic
          // switching, not useful piano articulation. Keep the attack and
          // pitch class but continue in the established register.
          if (elapsed <= 1 + EPS && Math.abs(pitch - continuityPrevious.midi) === 12) {
            pitch = continuityPrevious.midi;
          }
          while (Math.abs(pitch - continuityPrevious.midi) > 12 && pitch - continuityPrevious.midi > 0 && pitch - 12 >= low) pitch -= 12;
          while (Math.abs(pitch - continuityPrevious.midi) > 12 && pitch - continuityPrevious.midi < 0 && pitch + 12 <= high) pitch += 12;
        }
        return pitch === note.midi ? note : { ...note, midi: pitch };
      });
    if (!candidates.length) continue;
    const maxVelocity = candidates.reduce((value, note) => Math.max(value, note.vel), 0);
    const upperLeads = options.preferUpperLead
      ? candidates.filter((note) => note.rawMidi >= 60 && note.vel >= maxVelocity * 0.65)
      : [];
    const selectionPool = upperLeads.length
      ? [upperLeads.reduce((highest, note) => note.rawMidi > highest.rawMidi ? note : highest)]
      : candidates;
    const best = selectionPool.reduce((winner, note) => {
      const continuityPrevious = previous && note.start - (previous.start + previous.dur) <= 1 ? previous : undefined;
      const score = note.vel / 16
        + Math.min(note.dur, 2)
        - (continuityPrevious ? Math.abs(note.midi - continuityPrevious.midi) / 7 : 0);
      const winnerScore = winner.vel / 16
        + Math.min(winner.dur, 2)
        - (continuityPrevious ? Math.abs(winner.midi - continuityPrevious.midi) / 7 : 0);
      return score > winnerScore ? note : winner;
    });
    const nextStart = groups[groupIndex + 1]?.[0]?.start;
    const dur = Math.max(EPS, Math.min(best.dur, nextStart === undefined ? best.dur : nextStart - best.start));
    const { rawMidi: _rawMidi, ...selectedNote } = best;
    previous = { ...selectedNote, dur, hand: "R" };
    selected.push(previous);
  }
  return selected;
}

/**
 * Basic Pitch can leak sparse guitar/reverb events into the vocal stem. Only
 * let vocals displace an active guitar lead when they form a compact moving
 * phrase. Isolated vocal events are used only when there is no usable
 * instrumental identity in the window.
 */
function trustworthyVocalNotes(notes: Note[]): Note[] {
  const phrases: Note[][] = [];
  for (const note of notes) {
    const phrase = phrases.at(-1);
    const previous = phrase?.at(-1);
    if (!phrase || !previous || note.start - (previous.start + previous.dur) > 4) {
      phrases.push([note]);
    } else {
      phrase.push(note);
    }
  }
  return phrases.flatMap((phrase) => {
    if (phrase.length < 2) return [];
    const peakVelocity = phrase.reduce((value, note) => Math.max(value, note.vel), 0);
    // Apply confidence locally so a quiet reverb/bleed tail cannot become
    // trusted merely by landing 0.1 beat inside the phrase-gap boundary.
    const credible = phrase.filter((note) => note.vel >= peakVelocity * 0.55);
    if (credible.length < 2) return [];
    const distinct = new Set(credible.map((note) => note.midi));
    const first = credible[0]!;
    const last = credible.at(-1)!;
    const span = Math.max(0.5, last.start + Math.min(last.dur, 1) - first.start);
    const density = credible.length / span;
    const minimumDensity = credible.length >= 3 ? 0.35 : 0.5;
    return distinct.size >= 2 && density >= minimumDensity ? credible : [];
  });
}

function notesIn(notes: Note[], start: number, end: number): Note[] {
  return notes.filter((note) => note.start >= start - EPS && note.start < end - EPS);
}

function sourceConfidence(notes: Note[], start: number, end: number, stemConfidence = 1): number {
  const attacks = notesIn(notes, start, end).length;
  const expected = Math.max(1, (end - start) / 2);
  return clamp((attacks / expected) * stemConfidence, 0, 1);
}

/**
 * A transcription can produce a dense, single-pitch vocal drone from bleed
 * or reverb. It should not displace a moving riff that carries the song's
 * identity. Penalize only the degenerate vocal case; chants and deliberately
 * narrow melodies with at least two pitches retain their normal priority.
 */
function vocalSourceConfidence(notes: Note[], start: number, end: number, stemConfidence = 1): number {
  const confidence = sourceConfidence(notes, start, end, stemConfidence);
  const evidence = notesIn(notes, start, end);
  if (evidence.length < 4) return confidence;
  const distinct = new Set(evidence.map((note) => note.midi));
  if (distinct.size > 1) return confidence;
  return confidence * 0.5;
}

function bassAt(notes: Note[], start: number, end: number): Note | undefined {
  // A fresh bass attack is stronger harmonic evidence than an older low
  // sustain. Otherwise a held C2 can mask a D2 chord change two beats later.
  const attacked = notes.filter((note) => note.start >= start - EPS && note.start < end - EPS);
  if (attacked.length) {
    return attacked.sort((a, b) => Math.abs(a.start - start) - Math.abs(b.start - start) || a.midi - b.midi || b.vel - a.vel)[0];
  }
  const candidates = notes.filter((note) => note.start < end && note.start + note.dur > start);
  return candidates.sort((a, b) => a.midi - b.midi || b.vel - a.vel)[0];
}

function pitchClassesAt(notes: Note[], start: number, end: number): Set<number> {
  return new Set(notes.filter((note) => note.start < end && note.start + note.dur > start).map((note) => ((note.midi % 12) + 12) % 12));
}

function identityForWindow(
  primary: Note[],
  alternates: Note[][],
  start: number,
  end: number,
  minAlternateRest = 0,
): { notes: Note[]; primaryNotes: Note[]; primaryCount: number; alternateCount: number } {
  const primaryNotes = notesIn(primary, start, end).map((note) => ({ ...note }));
  const selected = [...primaryNotes];
  let alternateCount = 0;
  // Preserve a guitar/other motif during vocal rests instead of throwing the
  // whole instrumental lane away just because the section has a vocal lead.
  for (const lane of alternates) {
    for (const note of notesIn(lane, start, end)) {
      const occupied = selected.some((existing) =>
        Math.abs(existing.start - note.start) <= 0.08
        || (existing.start <= note.start && existing.start + existing.dur > note.start),
      );
      if (occupied) continue;
      if (minAlternateRest > 0 && primaryNotes.length) {
        const nextStart = primaryNotes
          .filter((primaryNote) => primaryNote.start >= note.start - EPS)
          .reduce((value, primaryNote) => Math.min(value, primaryNote.start), end);
        const nextPrimary = primaryNotes
          .filter((primaryNote) => primaryNote.start >= note.start - EPS)
          .sort((a, b) => a.start - b.start)[0];
        const previousPrimary = primaryNotes
          .filter((primaryNote) => primaryNote.start + primaryNote.dur <= note.start + EPS)
          .sort((a, b) => b.start - a.start)[0];
        const restBefore = previousPrimary
          ? note.start - (previousPrimary.start + previousPrimary.dur)
          : Number.POSITIVE_INFINITY;
        const restAfter = nextStart - (note.start + note.dur);
        // A low instrumental attack directly before a far-away vocal
        // entrance is usually rhythm bleed, not a lead phrase. Keep close
        // stepwise fills (which can be useful melody connectors), but reject
        // a large register jump when the alternate has no real landing room.
        if (
          nextPrimary
          && restAfter <= 0.25 + EPS
          && note.midi <= 60
          && note.vel < 64
          && Math.abs(note.midi - nextPrimary.midi) >= 12
        ) continue;
        // Apply the same guard after a vocal ending; a quiet low attack with
        // no melodic landing is just as likely to be the rhythm stem leaking
        // into the right-hand identity lane.
        if (
          previousPrimary
          && restBefore <= 0.75 + EPS
          && note.midi <= 60
          && note.vel < 64
          && Math.abs(note.midi - previousPrimary.midi) >= 12
        ) continue;
      }
      selected.push({ ...note });
      alternateCount += 1;
    }
  }
  const sorted = selected
    .sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi)
    .map((note, index, all) => ({
      ...note,
      dur: Math.max(EPS, Math.min(note.dur, end - note.start, all[index + 1] ? all[index + 1]!.start - note.start : note.dur)),
    }));
  return { notes: sorted, primaryNotes, primaryCount: primaryNotes.length, alternateCount };
}

/**
 * Trace the fused vocal/guitar phrase through octave-equivalent registers.
 * Trusted vocal pitches and phrase starts are anchors; surrounding guitar
 * partials may move by octaves when that avoids physically implausible rapid
 * travel. A real rest starts a fresh path, preserving deliberate register
 * changes between phrases.
 */
function stabilizeIdentityRegister(
  notes: Note[],
  tempoBpm: number,
  registerAnchors: ReadonlySet<string>,
  low = 55,
  high = 84,
): Note[] {
  if (notes.length < 2) return notes.map((note) => ({ ...note }));
  const sorted = [...notes].sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
  const phrases: Note[][] = [];
  for (const note of sorted) {
    const phrase = phrases.at(-1);
    const previous = phrase?.at(-1);
    const soundingRest = previous ? note.start - (previous.start + previous.dur) : Number.POSITIVE_INFINITY;
    if (!phrase || !previous || soundingRest > 1) phrases.push([note]);
    else phrase.push(note);
  }

  const secondsPerBeat = 60 / (Number.isFinite(tempoBpm) && tempoBpm > 0 ? tempoBpm : 120);
  const candidatesFor = (note: Note): number[] => {
    const pitches: number[] = [];
    for (let pitch = note.midi; pitch >= low; pitch -= 12) pitches.push(pitch);
    for (let pitch = note.midi + 12; pitch <= high; pitch += 12) pitches.push(pitch);
    return [...new Set(pitches)].sort((a, b) => a - b);
  };
  const transitionCost = (from: number, to: number, elapsedBeats: number): number => {
    const interval = Math.abs(to - from);
    const elapsedSec = Math.max(0.001, elapsedBeats * secondsPerBeat);
    let cost = interval * 0.03;
    // At song tempos a two-octave jump can fit inside roughly half a second,
    // but it is not a practical single-hand piano motion. Treat one octave
    // as the comfortable ceiling until the phrase has had enough time to
    // move; this also lets octave-equivalent candidates beat raw detector
    // register outliers at vocal/guitar handoffs.
    const comfortable = elapsedSec < 0.12 ? 5 : elapsedSec < 0.2 ? 7 : elapsedSec < 0.35 ? 11 : elapsedSec < 0.65 ? 12 : 19;
    if (interval > comfortable) cost += (interval - comfortable) * 0.8;
    return cost;
  };

  const output: Note[] = [];
  for (const phrase of phrases) {
    const states = phrase.map(candidatesFor);
    const costs: number[][] = [];
    const parents: number[][] = [];
    for (let index = 0; index < phrase.length; index++) {
      costs[index] = [];
      parents[index] = [];
      for (let candidateIndex = 0; candidateIndex < states[index]!.length; candidateIndex++) {
        const pitch = states[index]![candidateIndex]!;
        const anchorKey = `${phrase[index]!.start.toFixed(6)}:${phrase[index]!.midi}`;
        const anchored = index === 0 || registerAnchors.has(anchorKey);
        // For non-anchored detector notes, a two-octave register correction is
        // worse than a one-octave correction, not merely twice as costly. A
        // quadratic emission makes the DP choose the nearest practical piano
        // register at mixed vocal/guitar handoffs while vocal anchors remain
        // effectively immutable.
        const registerDistance = Math.abs(pitch - phrase[index]!.midi) / 12;
        const emission = (anchored ? registerDistance : registerDistance ** 2) * (anchored ? 100 : 1);
        if (index === 0) {
          costs[index]![candidateIndex] = emission;
          parents[index]![candidateIndex] = -1;
          continue;
        }
        let bestCost = Number.POSITIVE_INFINITY;
        let bestParent = 0;
        const elapsed = phrase[index]!.start - phrase[index - 1]!.start;
        for (let previousIndex = 0; previousIndex < states[index - 1]!.length; previousIndex++) {
          const candidateCost = costs[index - 1]![previousIndex]!
            + emission
            + transitionCost(states[index - 1]![previousIndex]!, pitch, elapsed);
          if (candidateCost < bestCost - EPS) {
            bestCost = candidateCost;
            bestParent = previousIndex;
          }
        }
        costs[index]![candidateIndex] = bestCost;
        parents[index]![candidateIndex] = bestParent;
      }
    }
    const finalCosts = costs.at(-1)!;
    let state = finalCosts.reduce((best, cost, index) => cost < finalCosts[best]! - EPS ? index : best, 0);
    const path = new Array<number>(phrase.length);
    for (let index = phrase.length - 1; index >= 0; index--) {
      path[index] = states[index]![state]!;
      state = parents[index]![state]!;
    }
    output.push(...phrase.map((note, index) => ({ ...note, midi: path[index]! })));
  }
  return output.sort((a, b) => a.start - b.start || b.vel - a.vel || b.midi - a.midi);
}

function chordFor(rootPc: number, pcs: Set<number>): { name: string; notes: number[] } {
  const hasMinor = pcs.has((rootPc + 3) % 12);
  const hasMajor = pcs.has((rootPc + 4) % 12);
  const quality = hasMinor === hasMajor ? "5" : hasMinor ? "m" : "";
  const root = 36 + rootPc;
  const bassRoot = root > 47 ? root - 12 : root;
  const intervals = quality === "m" ? [0, 3, 7] : quality === "" ? [0, 4, 7] : [0, 7];
  return {
    name: `${SHARP_NAMES[rootPc]}${quality}`,
    notes: intervals.map((interval) => bassRoot + interval),
  };
}

function uniqueSorted(notes: Note[]): Note[] {
  const seen = new Set<string>();
  return notes
    .sort((a, b) => a.start - b.start || a.midi - b.midi || b.dur - a.dur)
    .filter((note) => {
      const key = `${note.hand}:${note.midi}:${note.start.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Turn separated band evidence into a deliberately piano-shaped canonical
 * arrangement. Drums contribute timing accents only; they are never emitted
 * as pitched notes.
 */
export function buildMetalArrangement(input: MetalArrangementInput): MetalArrangementResult {
  if (!input.stems.length) throw new Error("Metal arrangement requires at least one stem");
  const reference = input.stems.find((stem) => stem.role !== "drums")?.midi ?? input.stems[0]!.midi;
  const tempoBpm = reference.tempoBpm;
  const timeSig = reference.timeSig;
  const durationBeats = input.stems.reduce((duration, stem) => {
    let result = Number.isFinite(stem.midi.durationBeats) ? Math.max(duration, stem.midi.durationBeats) : duration;
    for (const note of validNotes(stem)) {
      const end = note.start + note.dur;
      if (Number.isFinite(end) && end > result) result = end;
    }
    return result;
  }, 1);
  const meterBeats = beatsPerMeasure(timeSig);
  const sectionBeats = Math.max(2, input.sectionBeats ?? meterBeats * 2);
  const harmonyBeats = Math.max(1, input.harmonyBeats ?? meterBeats / 2);
  const roles: MetalStemRole[] = ["vocals", "bass", "guitar", "other", "drums"];
  for (const role of roles) {
    if (input.stems.filter((stem) => stem.role === role).length > 1) {
      throw new Error(`metal arrangement received duplicate ${role} stems`);
    }
  }
  const vocalsStem = input.stems.find((stem) => stem.role === "vocals");
  const guitarStem = input.stems.find((stem) => stem.role === "guitar") ?? input.stems.find((stem) => stem.role === "other");
  const otherStem = input.stems.find((stem) => stem.role === "other" && stem !== guitarStem);
  const bassStem = input.stems.find((stem) => stem.role === "bass");
  const drumsStem = input.stems.find((stem) => stem.role === "drums");
  const vocals = monophonicPath(validNotes(vocalsStem), 60, 84)
    .map((note) => ({ ...note, identitySource: "vocals" as const }));
  const trustedVocals = trustworthyVocalNotes(vocals);
  const guitar = monophonicPath(validNotes(guitarStem), 55, 84, { preferUpperLead: true })
    .map((note) => ({ ...note, identitySource: "guitar" as const }));
  const other = monophonicPath(validNotes(otherStem), 55, 84, { preferUpperLead: true })
    .map((note) => ({ ...note, identitySource: "other" as const }));
  const bass = validNotes(bassStem);
  const harmonicEvidence = [...validNotes(guitarStem), ...validNotes(otherStem)];
  const sections: MetalIdentitySection[] = [];
  const identity: Note[] = [];
  const vocalRegisterAnchors = new Set<string>();

  for (let start = 0; start < durationBeats - EPS; start += sectionBeats) {
    const end = Math.min(durationBeats, start + sectionBeats);
    const rawVocalConfidence = vocalSourceConfidence(vocals, start, end, vocalsStem?.confidence);
    const trustedVocalEvidence = notesIn(trustedVocals, start, end);
    const vocalConfidence = trustedVocalEvidence.length
      ? vocalSourceConfidence(trustedVocals, start, end, vocalsStem?.confidence)
      : rawVocalConfidence;
    const instrumentalChoices = [
      { source: "guitar" as const, notes: guitar, confidence: sourceConfidence(guitar, start, end, guitarStem?.confidence) * 0.92 },
      { source: "other" as const, notes: other, confidence: sourceConfidence(other, start, end, otherStem?.confidence) * 0.85 },
    ].sort((a, b) => b.confidence - a.confidence);
    const instrumentalWinner = instrumentalChoices[0]!;
    const useVocalLead = trustedVocalEvidence.length > 0
      || (vocalConfidence >= 0.15 && instrumentalWinner.confidence < 0.15);
    const winner = useVocalLead
      ? {
        source: "vocals" as const,
        notes: trustedVocalEvidence.length ? trustedVocals : vocals,
        confidence: vocalConfidence,
      }
      : instrumentalWinner;
    let source: MetalIdentitySection["source"] = winner.confidence >= 0.15 ? winner.source : "rest";
    let sectionConfidence = winner.confidence;
    if (source !== "rest") {
      const alternates = useVocalLead
        ? instrumentalChoices.map((choice) => choice.notes)
        : instrumentalChoices.slice(1).map((choice) => choice.notes);
      const fused = identityForWindow(winner.notes, alternates, start, end, useVocalLead ? 0.5 : 0);
      if (useVocalLead) {
        for (const note of fused.primaryNotes) vocalRegisterAnchors.add(`${note.start.toFixed(6)}:${note.midi}`);
      }
      if (useVocalLead && fused.alternateCount > 0) {
        source = "mixed";
        const total = fused.primaryCount + fused.alternateCount;
        sectionConfidence = total > 0
          ? (vocalConfidence * fused.primaryCount + instrumentalWinner.confidence * fused.alternateCount) / total
          : vocalConfidence;
      }
      for (const note of fused.notes) {
        identity.push(note);
      }
    }
    sections.push({ startBeat: start, endBeat: end, source, confidence: sectionConfidence });
  }

  const stabilizedIdentity = stabilizeIdentityRegister(identity, tempoBpm, vocalRegisterAnchors);
  const chords: ChordLabel[] = [];
  const leftHand: Note[] = [];
  let previousRoot: number | undefined;
  for (let beat = 0; beat < durationBeats - EPS; beat += harmonyBeats) {
    const end = Math.min(durationBeats, beat + harmonyBeats);
    const bassNote = bassAt(bass, beat, end);
    const evidence = pitchClassesAt(harmonicEvidence, beat, end);
    let rootPc = bassNote ? ((bassNote.midi % 12) + 12) % 12 : previousRoot;
    if (rootPc === undefined && evidence.size) rootPc = [...evidence][0];
    if (rootPc === undefined) continue;
    previousRoot = rootPc;
    const chord = chordFor(rootPc, evidence);
    const duration = Math.max(0.25, end - beat);
    chords.push({
      beat,
      name: chord.name,
      notes: chord.notes,
      sourceKind: "inferred",
      inferred: true,
      inferenceType: "voicing",
      durationBeats: duration,
    });
    const root = chord.notes[0]!;
    leftHand.push({ midi: root, start: beat, dur: Math.min(duration, 1.5), vel: 68, hand: "L" });
    if (chord.notes.length > 1) {
      const fifth = chord.notes.find((note) => note % 12 === (rootPc! + 7) % 12);
      if (fifth !== undefined) leftHand.push({ midi: fifth, start: beat, dur: Math.min(duration, 1.5), vel: 62, hand: "L" });
    }
  }

  const rhythmicAccents = validNotes(drumsStem).map((note) => note.start).filter((beat, index, all) => index === 0 || beat - all[index - 1]! >= 0.125);
  const notes = uniqueSorted([...stabilizedIdentity.map((note) => ({ ...note, hand: "R" as const })), ...leftHand]);
  const warnings: string[] = [];
  const mismatchedTempo = input.stems.filter((stem) => Math.abs(stem.midi.tempoBpm - tempoBpm) > 0.5);
  if (mismatchedTempo.length) warnings.push(`${mismatchedTempo.length} stems had mismatched tempo metadata; beat positions were used unchanged`);
  if (!stabilizedIdentity.length) warnings.push("no reliable vocal, guitar, or other identity line was found");
  if (!bass.length) warnings.push("no bass stem was available; harmony roots may be less reliable");
  const sourceSections: Record<string, number> = {};
  for (const section of sections) {
    sourceSections[section.source] = (sourceSections[section.source] ?? 0) + 1;
  }
  const parsed: ParsedMidi = {
    format: 1,
    division: reference.division || 480,
    tempoBpm,
    tempoMetaPresent: true,
    keySig: reference.keySig,
    keyMode: reference.keyMode,
    timeSig,
    notes,
    trackNames: ["Metal Piano RH", "Metal Piano LH"],
    durationBeats,
    ...(input.title ? { title: input.title } : {}),
  };
  const ir: MetalArrangementIR = { version: 1, tempoBpm, timeSig, durationBeats, sections, identity: stabilizedIdentity.map((note) => ({ ...note })), harmony: chords, rhythmicAccents };
  return {
    parsed,
    chords,
    ir,
    stats: { identityNotes: stabilizedIdentity.length, leftHandNotes: leftHand.length, chordEvents: chords.length, sourceSections },
    warnings,
  };
}
