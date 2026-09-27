/**
 * Every number that shapes the Chords-mode backing, in one place.
 *
 * Edit a value, reload the Player to hear it, and re-run the checks:
 *   npx tsx apps/web/scripts/evaluate-all-song-chords.mts --gate   (catalogue)
 *   npx tsx packages/midi/scripts/chord-benchmark.mts <POP909-CL>  (reference chords)
 * docs/chords-tuning.md explains what each knob does musically.
 */
export const CHORDS_TUNING = {
  harmony: {
    /** Score lost per chord change; higher holds chords longer, lower follows passing harmony. */
    changePenalty: 0.3,
    /** Penalty per unit of sounding non-chord tones, relative to chord tones (1 = equal weight). */
    outsideWeight: 0.6,
    /** Bonus when the lowest sounding note is the chord root. */
    bassWeight: 0.4,
    /** Bonus for each chord tone actually present (favours complete chords). */
    presenceWeight: 0.15,
    /** Extra cost for a chord with tones outside the song's key. */
    nonDiatonicCost: 0.06,
    /**
     * Extra cost per chord quality; null switches a quality off. Plain triads
     * scored best against the reference chords and are the easiest to play.
     */
    qualityCost: { "": 0, m: 0, "7": null, m7: null, maj7: null, sus4: null, dim: null } as Record<string, number | null>,
    /** Where a chord may change: "bar", "half-bar" or "beat". */
    changeGrid: "beat" as "bar" | "half-bar" | "beat",
    /** Hold each note to the end of this window when naming chords, like a sustain pedal ("none" to switch off). */
    pedal: "half-bar" as "none" | "bar" | "half-bar" | "beat",
  },
  strikes: {
    /** Shortest time between two backing strikes a beginner is asked to play. */
    minSpacingBeats: 1,
    /** Longest the backing may stay silent, in bars, while a chord is held. */
    maxSilentBars: 1,
  },
  gate: {
    /** Catalogue checks a song's backing must pass (evaluate-all-song-chords --gate). */
    maxDeadAirOnsets: 4,
    minStrongBeatTuneChordToneShare: 0.6,
    maxTuneSemitoneClashShare: 0.25,
    /** Share of chords lasting a beat or less before the backing counts as flickering. */
    maxOneBeatChordShare: 0.4,
    /** Reference-chord accuracy the labeller must reach (chord-benchmark --gate). */
    minMajMinAccuracy: 0.85,
    minRootAccuracy: 0.85,
  },
};

export type ChordsTuning = typeof CHORDS_TUNING;
export type HarmonyTuning = ChordsTuning["harmony"];
export type StrikeTuning = ChordsTuning["strikes"];
