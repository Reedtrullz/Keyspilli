import type { ParsedMidi } from "@keyspilli/midi";

/** The roles that the stem pipeline can present to the metal arranger. */
export type MetalRoutingRole = "vocals" | "bass" | "guitar" | "other" | "drums";

export interface MetalRoutingStem {
  role: MetalRoutingRole;
  midi: ParsedMidi;
}

export interface MetalRoutingThresholds {
  /** Minimum detected attacks in each non-identity band role. */
  minBassNotes: number;
  minDrumNotes: number;
  /** Minimum riff evidence before the residual stem can be the identity lane. */
  minGuitarNotes: number;
  minVocalNotes: number;
  /** Minimum guitar attacks per beat while the guitar stem is active. */
  minGuitarAttackDensity: number;
  /** Minimum share of the complete song covered by the active guitar span. */
  minGuitarSongCoverage: number;
  /** Fraction of guitar attacks that must be in the low/mid guitar register. */
  minGuitarLowRegisterRatio: number;
  /** MIDI notes at or below this pitch count as low-register guitar evidence. */
  guitarLowRegisterMaxMidi: number;
}

export const DEFAULT_METAL_ROUTING_THRESHOLDS: Readonly<MetalRoutingThresholds> = {
  minBassNotes: 8,
  minDrumNotes: 16,
  minGuitarNotes: 24,
  minVocalNotes: 8,
  minGuitarAttackDensity: 0.25,
  minGuitarSongCoverage: 0.1,
  minGuitarLowRegisterRatio: 0.25,
  guitarLowRegisterMaxMidi: 67,
};

export interface MetalRoutingFeatures {
  counts: Record<Exclude<MetalRoutingRole, "other">, number>;
  guitarAttackCount: number;
  /** Full-song density, retained for diagnostics and trend comparison. */
  guitarAttackDensity: number;
  guitarActiveDurationBeats: number;
  guitarActiveAttackDensity: number;
  guitarSongCoverage: number;
  guitarLowRegisterCount: number;
  guitarLowRegisterRatio: number;
  durationBeats: number;
}

export type MetalRoutingReason =
  | "eligible"
  | "forced"
  | "missing-band-counts"
  | "missing-guitar-signal"
  | "missing-identity";

export interface MetalRoutingAssessment {
  eligible: boolean;
  forced: boolean;
  reason: MetalRoutingReason;
  features: MetalRoutingFeatures;
  message: string;
}

interface ValidNote {
  midi: number;
  start: number;
  dur: number;
}

function validNotes(stem: MetalRoutingStem | undefined): ValidNote[] {
  if (!stem) return [];
  return stem.midi.notes
    .filter((note) =>
      Number.isFinite(note.midi)
      && Number.isFinite(note.start)
      && Number.isFinite(note.dur)
      && note.midi >= 0
      && note.midi <= 127
      && note.start >= 0
      && note.dur > 0,
    )
    .map((note) => ({ midi: note.midi, start: note.start, dur: note.dur }))
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
}

function durationBeats(stems: MetalRoutingStem[]): number {
  let duration = 1;
  for (const stem of stems) {
    const declared = stem.midi.durationBeats;
    if (Number.isFinite(declared) && declared > duration) duration = declared;
    for (const note of validNotes(stem)) {
      const end = note.start + note.dur;
      if (Number.isFinite(end) && end > duration) duration = end;
    }
  }
  return duration;
}

/**
 * Count distinct attacks rather than every simultaneous Basic Pitch partial.
 * This makes the classifier respond to a riff's rhythmic activity without
 * letting octave duplicates inflate the guitar signal.
 */
function attackCount(notes: ValidNote[]): number {
  let count = 0;
  let previousStart = Number.NEGATIVE_INFINITY;
  for (const note of notes) {
    if (note.start - previousStart > 0.08) {
      count += 1;
      previousStart = note.start;
    }
  }
  return count;
}

function thresholdsWithDefaults(overrides?: Partial<MetalRoutingThresholds>): MetalRoutingThresholds {
  return { ...DEFAULT_METAL_ROUTING_THRESHOLDS, ...overrides };
}

function countSummary(features: MetalRoutingFeatures): string {
  return `vocals=${features.counts.vocals}, bass=${features.counts.bass}, `
    + `guitar=${features.counts.guitar}, drums=${features.counts.drums}, `
    + `guitarLow=${features.guitarLowRegisterRatio.toFixed(2)}, `
    + `guitarAttacks=${features.guitarAttackDensity.toFixed(2)}/beat, `
    + `guitarActive=${features.guitarActiveAttackDensity.toFixed(2)}/beat `
    + `(${features.guitarSongCoverage.toFixed(2)} song)`;
}

/**
 * Decide whether an automatically separated recording contains enough band
 * evidence to justify the metal-specific piano reducer.
 *
 * This is intentionally a conservative suitability gate, not a genre
 * classifier. An explicit caller force can bypass it; the arranger's own
 * identity/size validation still remains responsible for rejecting unusable
 * forced output.
 */
export function assessMetalRouting(
  stems: readonly MetalRoutingStem[],
  options: { force?: boolean; thresholds?: Partial<MetalRoutingThresholds> } = {},
): MetalRoutingAssessment {
  const thresholds = thresholdsWithDefaults(options.thresholds);
  const byRole = new Map<MetalRoutingRole, MetalRoutingStem>();
  for (const stem of stems) {
    // The stem pipeline is expected to be unique by role. Keeping the first
    // one here makes diagnostics deterministic; the arranger validates role
    // duplication separately when it is actually invoked.
    if (!byRole.has(stem.role)) byRole.set(stem.role, stem);
  }
  const roleNotes = {
    vocals: validNotes(byRole.get("vocals")),
    bass: validNotes(byRole.get("bass")),
    guitar: validNotes(byRole.get("guitar")),
    drums: validNotes(byRole.get("drums")),
  } satisfies Record<Exclude<MetalRoutingRole, "other">, ValidNote[]>;
  const duration = durationBeats([...byRole.values()]);
  const guitarAttacks = attackCount(roleNotes.guitar);
  const firstGuitar = roleNotes.guitar[0];
  const lastGuitar = roleNotes.guitar.at(-1);
  // Full-song density is useful in diagnostics, but it penalizes long
  // intros/outros and vocal-only sections. Measure the local density over the
  // span in which the guitar actually has evidence, then require that span to
  // cover a meaningful part of the recording so a short noise burst cannot
  // qualify an otherwise non-band source.
  const guitarActiveDuration = firstGuitar && lastGuitar
    ? Math.max(1, lastGuitar.start + lastGuitar.dur - firstGuitar.start)
    : 0;
  const guitarActiveAttackDensity = guitarActiveDuration ? guitarAttacks / guitarActiveDuration : 0;
  const guitarSongCoverage = guitarActiveDuration ? Math.min(1, guitarActiveDuration / duration) : 0;
  const guitarLowRegisterCount = roleNotes.guitar.filter((note) => note.midi <= thresholds.guitarLowRegisterMaxMidi).length;
  const counts = {
    vocals: roleNotes.vocals.length,
    bass: roleNotes.bass.length,
    guitar: roleNotes.guitar.length,
    drums: roleNotes.drums.length,
  } satisfies Record<Exclude<MetalRoutingRole, "other">, number>;
  const features: MetalRoutingFeatures = {
    counts,
    guitarAttackCount: guitarAttacks,
    guitarAttackDensity: guitarAttacks / duration,
    guitarActiveDurationBeats: guitarActiveDuration,
    guitarActiveAttackDensity,
    guitarSongCoverage,
    guitarLowRegisterCount,
    guitarLowRegisterRatio: roleNotes.guitar.length ? guitarLowRegisterCount / roleNotes.guitar.length : 0,
    durationBeats: duration,
  };

  if (options.force === true) {
    return {
      eligible: true,
      forced: true,
      reason: "forced",
      features,
      message: `forced metal routing (${countSummary(features)})`,
    };
  }

  const bandCountsPass = counts.bass >= thresholds.minBassNotes
    && counts.drums >= thresholds.minDrumNotes;
  if (!bandCountsPass) {
    return {
      eligible: false,
      forced: false,
      reason: "missing-band-counts",
      features,
      message: `source did not meet metal band-count gate (${countSummary(features)})`,
    };
  }

  // Auto metal routing is deliberately guitar-led. A vocal-only stem can be
  // a perfectly valid source for a melody cover, but it is not enough
  // evidence that the residual contains a metal/rock arrangement; allowing
  // it through here would make the later guitar gate an impossible-to-read
  // dead branch. Keep the vocal threshold as a diagnostic distinction so the
  // fallback explains whether identity or guitar evidence is missing.
  const guitarCountPass = counts.guitar >= thresholds.minGuitarNotes;
  const vocalEvidencePass = counts.vocals >= thresholds.minVocalNotes;
  if (!guitarCountPass && !vocalEvidencePass) {
    return {
      eligible: false,
      forced: false,
      reason: "missing-identity",
      features,
      message: `source did not meet metal identity gate (${countSummary(features)})`,
    };
  }

  const guitarSignalPass = features.guitarActiveAttackDensity >= thresholds.minGuitarAttackDensity
    && features.guitarSongCoverage >= thresholds.minGuitarSongCoverage
    && features.guitarLowRegisterRatio >= thresholds.minGuitarLowRegisterRatio;
  if (!guitarCountPass || !guitarSignalPass) {
    return {
      eligible: false,
      forced: false,
      reason: "missing-guitar-signal",
      features,
      message: `source did not meet metal guitar-signal gate (${countSummary(features)})`,
    };
  }

  return {
    eligible: true,
    forced: false,
    reason: "eligible",
    features,
    message: `metal routing eligible (${countSummary(features)})`,
  };
}
