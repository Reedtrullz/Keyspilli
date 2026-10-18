import type { Note } from "../types.js";
import type { GuitarHarmonicAttack, GuitarHarmonyDiagnostics, IdentityNote, GuitarHarmonicQuality } from "./types.js";
import { EPS, clamp, pitchClass, toRegister } from "./shared.js";

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

interface GuitarHarmonyInference {
  attacks: GuitarHarmonicAttack[];
  diagnostics: GuitarHarmonyDiagnostics;
}

const EMPTY_GUITAR_HARMONY_DIAGNOSTICS: GuitarHarmonyDiagnostics = {
  rawSourceNotes: 0,
  rawGuitarNotes: 0,
  leadNotes: 0,
  residualNotes: 0,
  onsetClusterCount: 0,
  semanticAttackCount: 0,
  collapsedUnisonOctaveFifth: 0,
  rejectedWeakThirds: 0,
  bassSupportedRoots: 0,
  stabilizedTransitions: 0,
  emittedLeftHandEvents: 0,
  fallbackWindows: 0,
  qualityCounts: { power: 0, major: 0, minor: 0, sus2: 0, sus4: 0, single: 0, unknown: 0 },
};

interface SemanticHarmonyCluster {
  start: number;
  notes: Note[];
  residual: Note[];
}

interface SemanticHarmonyCandidate {
  cluster: SemanticHarmonyCluster;
  pcs: number[];
  root: number;
  rootScore: number;
  rootMargin: number;
  bassSupport: number;
  bassPc?: number;
  rootMidi?: number;
}

export function freshGuitarHarmonyDiagnostics(
  rawCount = 0,
  leadCount = 0,
  source?: "guitar" | "other",
): GuitarHarmonyDiagnostics {
  return {
    ...EMPTY_GUITAR_HARMONY_DIAGNOSTICS,
    ...(source ? { source } : {}),
    rawSourceNotes: rawCount,
    // Keep the historical field accurate for a dedicated guitar analysis;
    // residual fallback is identified by `source`/`rawSourceNotes` instead of
    // misreporting its `other` notes as guitar material.
    rawGuitarNotes: source === "guitar" ? rawCount : 0,
    leadNotes: leadCount,
    qualityCounts: { ...EMPTY_GUITAR_HARMONY_DIAGNOSTICS.qualityCounts },
  };
}

export function inferSemanticGuitarHarmony(
  raw: Note[],
  lead: IdentityNote[],
  bass: Note[],
  source: "guitar" | "other",
  stemConfidence = 1,
): GuitarHarmonyInference {
  const diagnostics = freshGuitarHarmonyDiagnostics(raw.length, lead.length, source);
  if (!raw.length) return { attacks: [], diagnostics };

  // Consume one raw event for each selected lead event. Matching by raw pitch,
  // onset, and deterministic tie-breaks preserves duplicate same-pitch events
  // instead of removing an entire source cluster from harmonic evidence.
  const orderedRaw = raw
    .map((note, index) => ({ note, index }))
    .sort((a, b) => a.note.start - b.note.start || a.note.midi - b.note.midi || b.note.vel - a.note.vel || b.note.dur - a.note.dur || a.index - b.index);
  const usedRaw = new Set<number>();
  for (const candidate of [...lead].sort((a, b) => a.start - b.start || (a.rawMidi ?? a.midi) - (b.rawMidi ?? b.midi) || b.vel - a.vel || b.dur - a.dur)) {
    const rawMidi = candidate.rawMidi ?? candidate.midi;
    const match = orderedRaw
      .filter(({ index, note }) => !usedRaw.has(index) && note.midi === rawMidi && Math.abs(note.start - candidate.start) <= 0.08 + EPS)
      .sort((a, b) => Math.abs(a.note.start - candidate.start) - Math.abs(b.note.start - candidate.start)
        || Math.abs(a.note.vel - candidate.vel) - Math.abs(b.note.vel - candidate.vel)
        || Math.abs(a.note.dur - candidate.dur) - Math.abs(b.note.dur - candidate.dur)
        || a.index - b.index)[0];
    if (match) usedRaw.add(match.index);
  }

  const allClusters: SemanticHarmonyCluster[] = [];
  for (const entry of orderedRaw) {
    const cluster = allClusters.at(-1);
    if (!cluster || entry.note.start - cluster.notes.at(-1)!.start > 0.08 + EPS) {
      allClusters.push({ start: entry.note.start, notes: [entry.note], residual: usedRaw.has(entry.index) ? [] : [entry.note] });
    } else {
      cluster.notes.push(entry.note);
      if (!usedRaw.has(entry.index)) cluster.residual.push(entry.note);
    }
  }
  diagnostics.residualNotes = orderedRaw.filter(({ index }) => !usedRaw.has(index)).length;
  diagnostics.onsetClusterCount = allClusters.length;
  const clusters = allClusters.filter((cluster) => cluster.residual.length > 0);
  if (!clusters.length) return { attacks: [], diagnostics };

  const bassSupportAt = (start: number): Map<number, number> => {
    const support = new Map<number, number>();
    for (const note of bass) {
      const distance = Math.abs(note.start - start);
      const overlaps = note.start <= start + 0.35 + EPS && note.start + note.dur > start + EPS;
      if (distance > 1.5 + EPS && !overlaps) continue;
      const proximity = distance <= 0.35 + EPS ? 1 : overlaps ? 0.65 : 0.25;
      const strength = proximity * clamp(note.vel / 127, 0.25, 1) * clamp(note.dur / 1.5, 0.25, 1);
      const pc = pitchClass(note.midi);
      support.set(pc, (support.get(pc) ?? 0) + strength);
    }
    return support;
  };

  const preliminary: SemanticHarmonyCandidate[] = clusters.map((cluster) => {
    const pcs = [...new Set(cluster.notes.map((note) => pitchClass(note.midi)))].sort((a, b) => a - b);
    const counts = new Map<number, number>();
    for (const note of cluster.notes) counts.set(pitchClass(note.midi), (counts.get(pitchClass(note.midi)) ?? 0) + 1);
    const bassSupport = bassSupportAt(cluster.start);
    const bassEntries = [...bassSupport.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const candidatePcs = new Set(pcs);
    for (const [bassPc] of bassEntries.slice(0, 2)) {
      // Bass can fill a missing root only when guitar evidence supplies a
      // compatible fifth/third. A bass note on its own is never a chord.
      if (pcs.some((pc) => (pc - bassPc + 12) % 12 === 7 || (pc - bassPc + 12) % 12 === 3 || (pc - bassPc + 12) % 12 === 4)) candidatePcs.add(bassPc);
    }
    const scored = [...candidatePcs].map((root) => {
      const fifth = pcs.some((pc) => (pc - root + 12) % 12 === 7) ? 1 : 0;
      const rootCount = Math.min(2, counts.get(root) ?? 0);
      const lowRoot = cluster.notes.some((note) => pitchClass(note.midi) === root && note.midi <= 60) ? 1 : 0;
      const third = pcs.some((pc) => (pc - root + 12) % 12 === 3 || (pc - root + 12) % 12 === 4) ? 1 : 0;
      const suspension = pcs.some((pc) => (pc - root + 12) % 12 === 2 || (pc - root + 12) % 12 === 5) ? 0.25 : 0;
      const bass = bassSupport.get(root) ?? 0;
      // A compatible bass can supply a missing guitar root, but it is not an
      // unconditional override. Give a missing root a stronger lift than an
      // already-present root, while short passing bass notes remain too weak
      // to displace repeated guitar evidence.
      const bassWeight = pcs.includes(root) ? 0.9 : 2.15;
      const repeatedRootSupport = clusters.filter((candidate) =>
        Math.abs(candidate.start - cluster.start) <= 1.5 + EPS
        && candidate.notes.some((note) => pitchClass(note.midi) === root),
      ).length;
      const continuity = Math.min(1, Math.max(0, repeatedRootSupport - 1) * 0.25);
      return { root, score: rootCount * 1.6 + fifth * 1.8 + lowRoot * 1.4 + third * 0.45 + suspension + bass * bassWeight + continuity };
    }).sort((a, b) => b.score - a.score || a.root - b.root);
    const winner = scored[0]!;
    const rootNote = cluster.notes.filter((note) => pitchClass(note.midi) === winner.root)
      .sort((a, b) => a.midi - b.midi || b.vel - a.vel || b.dur - a.dur)[0];
    return {
      cluster,
      pcs,
      root: winner.root,
      rootScore: winner.score,
      rootMargin: winner.score - (scored[1]?.score ?? 0),
      bassSupport: bassSupport.get(winner.root) ?? 0,
      bassPc: bassEntries[0]?.[0],
      rootMidi: rootNote?.midi ?? (bassEntries[0]?.[0] === winner.root ? bass.find((note) => pitchClass(note.midi) === winner.root)?.midi : undefined),
    };
  });

  const phraseFor = (index: number): SemanticHarmonyCandidate[] => {
    const phrase: SemanticHarmonyCandidate[] = [preliminary[index]!];
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (phrase[0]!.cluster.start - preliminary[cursor]!.cluster.start > 1.5 + EPS) break;
      phrase.unshift(preliminary[cursor]!);
    }
    for (let cursor = index + 1; cursor < preliminary.length; cursor += 1) {
      if (preliminary[cursor]!.cluster.start - phrase.at(-1)!.cluster.start > 1.5 + EPS) break;
      phrase.push(preliminary[cursor]!);
    }
    return phrase;
  };

  const credibleThird = (item: SemanticHarmonyCandidate, root: number, interval: number): boolean => item.cluster.notes.some((note) => pitchClass(note.midi) === (root + interval) % 12 && (note.vel >= 72 || note.dur >= 0.35));
  // Stabilize roots before classifying quality so a confirmed change can
  // retroactively claim its first attack. This gives a repeated G power
  // phrase `[C, G, G]` the musically useful `[C, G, G]` result while a lone
  // passing G in `[C, G, C]` remains C throughout. A long rest resets the
  // state, so unrelated phrases do not inherit an earlier root.
  const stabilizedRoots: number[] = [];
  let previousRoot: number | undefined;
  let pendingRoot: number | undefined;
  let pendingCount = 0;
  let pendingStartIndex: number | undefined;
  let previousStart: number | undefined;
  for (let index = 0; index < preliminary.length; index += 1) {
    const item = preliminary[index]!;
    if (previousStart !== undefined && item.cluster.start - previousStart > 1.5 + EPS) {
      previousRoot = undefined;
      pendingRoot = undefined;
      pendingCount = 0;
      pendingStartIndex = undefined;
    }
    let root = item.root;
    const freshBass = item.bassPc === item.root && item.bassSupport >= 0.8;
    if (previousRoot !== undefined && root !== previousRoot) {
      if (pendingRoot === root) pendingCount += 1;
      else {
        pendingRoot = root;
        pendingCount = 1;
        pendingStartIndex = index;
      }
      if (item.rootMargin >= 1.75 && freshBass || pendingCount >= 2) {
        previousRoot = root;
        if (pendingCount >= 2 && pendingStartIndex !== undefined) {
          // The first attack was held only because confirmation had not yet
          // arrived. Once the second attack agrees, move that held attack to
          // the confirmed root as well.
          stabilizedRoots[pendingStartIndex] = root;
        }
        pendingRoot = undefined;
        pendingCount = 0;
        pendingStartIndex = undefined;
      } else {
        root = previousRoot;
        diagnostics.stabilizedTransitions += 1;
      }
    } else {
      previousRoot = root;
      pendingRoot = undefined;
      pendingCount = 0;
      pendingStartIndex = undefined;
    }
    previousStart = item.cluster.start;
    stabilizedRoots[index] = root;
  }

  const attacks: GuitarHarmonicAttack[] = [];
  for (let index = 0; index < preliminary.length; index += 1) {
    const item = preliminary[index]!;
    const root = stabilizedRoots[index] ?? item.root;
    const hasFifth = item.pcs.includes((root + 7) % 12);
    const hasMinorThird = item.pcs.includes((root + 3) % 12);
    const hasMajorThird = item.pcs.includes((root + 4) % 12);
    const phrase = phraseFor(index);
    const repeatedMinor = phrase.filter((entry) => credibleThird(entry, root, 3)).length >= 2;
    const repeatedMajor = phrase.filter((entry) => credibleThird(entry, root, 4)).length >= 2;
    const strongMinor = credibleThird(item, root, 3);
    const strongMajor = credibleThird(item, root, 4);
    let quality: GuitarHarmonicQuality;
    if (hasMinorThird && hasMajorThird) {
      // A stack containing both third spellings is ambiguous (often a
      // detector collision). Keep it power-safe/unknown even if a fifth is
      // present rather than inventing a major/minor label.
      diagnostics.rejectedWeakThirds += 1;
      quality = "unknown";
    } else if (item.pcs.length === 1) quality = "single";
    else if (hasMinorThird && !hasMajorThird && (repeatedMinor || strongMinor)) quality = "minor";
    else if (hasMajorThird && !hasMinorThird && (repeatedMajor || strongMajor)) quality = "major";
    else if (hasMinorThird || hasMajorThird) {
      if (!((hasMinorThird && (repeatedMinor || strongMinor)) || (hasMajorThird && (repeatedMajor || strongMajor)))) diagnostics.rejectedWeakThirds += 1;
      quality = hasFifth ? "power" : "unknown";
    } else if (item.pcs.includes((root + 2) % 12) && !item.pcs.includes((root + 5) % 12)) quality = "sus2";
    else if (item.pcs.includes((root + 5) % 12) && !item.pcs.includes((root + 2) % 12)) quality = "sus4";
    else if (hasFifth) quality = "power";
    else quality = "unknown";

    // A pending root change may intentionally hold the prior root for one
    // attack. Do not reinterpret the new cluster's intervals (for example
    // G-D as C-sus2) against a root that is absent from that cluster.
    if (root !== item.root && !item.pcs.includes(root)) quality = hasFifth ? "power" : "unknown";

    // Only a residual member plus a harmonic relationship creates a semantic
    // rhythm attack. A lead-only event, and an unrelated singleton residual,
    // stay in the RH/legacy fallback path without an invented LH root. If a
    // cluster has multiple residual members, retain it for an explicit
    // unknown-quality event so ambiguous stacks remain diagnosable.
    const pairIntervals = item.pcs.flatMap((left, leftIndex) => item.pcs
      .slice(leftIndex + 1)
      .flatMap((right) => [(right - left + 12) % 12, (left - right + 12) % 12]));
    // A zero interval is meaningful only when it comes from two distinct raw
    // members (a unison/octave duplicate). Do not let the self-pairs of a
    // pitch-class set make an unrelated singleton, such as a tritone, look
    // like a harmonic stack.
    const hasRawUnisonOrOctave = item.cluster.notes.some((left, leftIndex) => item.cluster.notes
      .slice(leftIndex + 1)
      .some((right) => pitchClass(left.midi) === pitchClass(right.midi)));
    const hasHarmonicRelationship = item.cluster.residual.length >= 2
      || hasRawUnisonOrOctave
      || pairIntervals.some((interval) => [2, 3, 4, 5, 7, 8, 9, 10].includes(interval));
    if (item.cluster.notes.length < 2 || !hasHarmonicRelationship) continue;
    const rootMidi = item.cluster.notes.filter((note) => pitchClass(note.midi) === root)
      .sort((a, b) => a.midi - b.midi || b.vel - a.vel)[0]?.midi
      ?? (item.bassPc === root ? bass.find((note) => pitchClass(note.midi) === root)?.midi : undefined)
      ?? toRegister(36 + root, 36, 60);
    const duplicateCount = item.cluster.notes.filter((note) => {
      const interval = (pitchClass(note.midi) - pitchClass(rootMidi) + 12) % 12;
      // Interval 0 is a unison/octave duplicate. A +7 member is detector
      // collapse only for a power-style hypothesis; in major/minor/sus
      // stacks it is the legitimate chord fifth, not a duplicate.
      return Math.abs(note.midi - rootMidi) > 0 && (interval === 0 || (interval === 7 && quality === "power"));
    }).length;
    const bassSupported = item.bassSupport >= 0.3 && item.bassPc === root;
    const meanVelocity = item.cluster.notes.reduce((sum, note) => sum + clamp(note.vel / 127, 0, 1), 0) / item.cluster.notes.length;
    const meanDuration = item.cluster.notes.reduce((sum, note) => sum + clamp(note.dur / 1.5, 0, 1), 0) / item.cluster.notes.length;
    const localSupport = clamp(item.cluster.notes.length / 4, 0, 1);
    const confidence = clamp((0.18
      + meanVelocity * 0.2
      + meanDuration * 0.15
      + localSupport * 0.12
      + (hasFifth ? 0.16 : 0)
      + (bassSupported ? 0.18 : 0)
      + ((strongMinor || strongMajor || repeatedMinor || repeatedMajor) ? 0.1 : 0)
      + clamp(item.rootMargin / 8, 0, 0.1)) * clamp(stemConfidence, 0, 1), 0, 1);
    const traceRefs = [...new Set(item.cluster.notes.flatMap((note) => (note as IdentityNote).traceRefs ?? []))].sort();
    attacks.push({
      start: item.cluster.start,
      dur: Math.max(0.25, Math.min(1.5, Math.max(...item.cluster.notes.map((note) => note.dur)))),
      rootPc: root,
      rootMidi,
      quality,
      confidence,
      source,
      evidence: item.pcs,
      bassSupported,
      memberCount: item.cluster.notes.length,
      lowMemberCount: item.cluster.notes.filter((note) => note.midi <= 60).length,
      ...(traceRefs.length ? { traceRefs } : {}),
    });
    diagnostics.qualityCounts[quality] += 1;
    if (bassSupported) diagnostics.bassSupportedRoots += 1;
    diagnostics.collapsedUnisonOctaveFifth += duplicateCount;
  }

  // A detector can expose a single false third (or suspension) for one
  // attack while the surrounding guitar phrase keeps the same harmony.  Do
  // not let that isolated classification churn the chord label.  A quality
  // change must persist for two connected semantic attacks, mirroring the
  // root stabilizer above; once confirmed, move the first pending attack to
  // the new quality as well.  Phrase breaks reset the state so a genuine
  // change after a rest still comes through immediately.
  let previousQuality: GuitarHarmonicQuality | undefined;
  let pendingQuality: GuitarHarmonicQuality | undefined;
  let pendingQualityCount = 0;
  let pendingQualityStart: number | undefined;
  let previousAttackStart: number | undefined;
  for (let index = 0; index < attacks.length; index += 1) {
    const attack = attacks[index]!;
    if (previousAttackStart !== undefined && attack.start - previousAttackStart > 1.5 + EPS) {
      previousQuality = undefined;
      pendingQuality = undefined;
      pendingQualityCount = 0;
      pendingQualityStart = undefined;
    }
    const candidateQuality = attack.quality;
    if (previousQuality !== undefined && candidateQuality !== previousQuality) {
      if (pendingQuality === candidateQuality) pendingQualityCount += 1;
      else {
        pendingQuality = candidateQuality;
        pendingQualityCount = 1;
        pendingQualityStart = index;
      }
      if (pendingQualityCount >= 2) {
        previousQuality = candidateQuality;
        if (pendingQualityStart !== undefined) {
          const retroactive = attacks[pendingQualityStart]!;
          if (retroactive.quality !== candidateQuality) {
            diagnostics.qualityCounts[retroactive.quality] -= 1;
            diagnostics.qualityCounts[candidateQuality] += 1;
            retroactive.quality = candidateQuality;
          }
        }
        pendingQuality = undefined;
        pendingQualityCount = 0;
        pendingQualityStart = undefined;
      } else {
        diagnostics.qualityCounts[candidateQuality] -= 1;
        diagnostics.qualityCounts[previousQuality] += 1;
        attack.quality = previousQuality;
        diagnostics.stabilizedTransitions += 1;
      }
    } else {
      previousQuality = candidateQuality;
      pendingQuality = undefined;
      pendingQualityCount = 0;
      pendingQualityStart = undefined;
    }
    previousAttackStart = attack.start;
  }
  diagnostics.semanticAttackCount = attacks.length;
  return { attacks, diagnostics };
}

interface ResidualHarmonyPhraseWindow {
  start: number;
  end: number;
}

export function strictResidualHarmonyPhraseWindows(notes: IdentityNote[]): ResidualHarmonyPhraseWindow[] {
  const upper = notes.filter((note) => (note.rawMidi ?? note.midi) >= 61).sort((a, b) => a.start - b.start || b.vel - a.vel);
  const windows: ResidualHarmonyPhraseWindow[] = [];
  let phrase: IdentityNote[] = [];
  const flush = (): void => {
    if (phrase.length < 3) return;
    const distinct = new Set(phrase.map((note) => note.midi));
    const gaps = phrase.slice(1).map((note, index) => note.start - phrase[index]!.start).filter((gap) => gap > EPS).sort((a, b) => a - b);
    const intervals = phrase.slice(1).map((note, index) => Math.abs(note.midi - phrase[index]!.midi));
    const largeLeapRatio = intervals.length ? intervals.filter((interval) => interval >= 7).length / intervals.length : 1;
    const repeatedRatio = Math.max(...[...distinct].map((pitch) => phrase.filter((note) => note.midi === pitch).length)) / phrase.length;
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : Number.POSITIVE_INFINITY;
    const p90Gap = gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.9))]! : Number.POSITIVE_INFINITY;
    if (distinct.size >= 3 && medianGap >= 0.25 - EPS && medianGap <= 1.5 + EPS && p90Gap <= 2 + EPS && largeLeapRatio < 0.45 && repeatedRatio < 0.8) {
      windows.push({ start: phrase[0]!.start, end: phrase.at(-1)!.start });
    }
  };
  for (const note of upper) {
    const previous = phrase.at(-1);
    if (previous && (note.start - previous.start > 1.5 + EPS || note.start - phrase[0]!.start > 32 + EPS)) {
      flush();
      phrase = [];
    }
    phrase.push(note);
  }
  flush();
  return windows;
}

export function chordFor(rootPc: number, pcs: Set<number>, semanticQuality?: GuitarHarmonicQuality): { name: string; notes: number[] } {
  const hasMinor = pcs.has((rootPc + 3) % 12);
  const hasMajor = pcs.has((rootPc + 4) % 12);
  const quality = semanticQuality === "minor" ? "m"
    : semanticQuality === "major" ? ""
      : semanticQuality === "sus2" ? "sus2"
        : semanticQuality === "sus4" ? "sus4"
          : semanticQuality === "single" ? "single"
            : semanticQuality === "power" || semanticQuality === "unknown" ? "5"
              : hasMinor === hasMajor ? "5" : hasMinor ? "m" : "";
  const root = 36 + rootPc;
  const bassRoot = root > 47 ? root - 12 : root;
  // Keep the semantic quality visible in the existing chord-label contract.
  // `single` is represented by the root name and a root-only voicing; an
  // `unknown` attack remains the conservative power-safe `5` shape.
  const displayQuality = quality === "single" ? "" : quality;
  const intervals = quality === "m" ? [0, 3, 7]
    : quality === "" ? [0, 4, 7]
      : quality === "sus2" ? [0, 2, 7]
        : quality === "sus4" ? [0, 5, 7]
          : quality === "single" ? [0] : [0, 7];
  return {
    name: `${SHARP_NAMES[rootPc]}${displayQuality}`,
    notes: intervals.map((interval) => bassRoot + interval),
  };
}
