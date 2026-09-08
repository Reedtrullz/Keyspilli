import type { Note } from "./types.js";

/** Tutorial palette labels carry lane identity, never an authoritative hand. */
export function tutorialSourceLane(name: string): string | undefined {
  const label = name.trim().toLowerCase();
  return /^(?:blue|green|yellow|purple|red) keys$/.test(label) ? label : undefined;
}

/**
 * Opt-in source-lane inference. Preserve whole lanes when their central pitch
 * ranges are clearly separated; abstain instead of guessing cross-hand or
 * sparse material. No pitches, onsets or durations change here.
 */
export function inferSourceHandLanes(notes: Note[]): {
  notes: Note[];
  applied: boolean;
  reason: "inferred" | "explicit-hands" | "missing-lanes" | "ambiguous-lanes";
} {
  const abstain = (reason: "explicit-hands" | "missing-lanes" | "ambiguous-lanes") => ({ notes, applied: false, reason });
  if (notes.some(note => note.hand !== undefined)) return abstain("explicit-hands");
  if (!notes.length || notes.some(note => typeof note.sourceLane !== "string" || !tutorialSourceLane(note.sourceLane))) return abstain("missing-lanes");
  const lanes = [...new Set(notes.map(note => note.sourceLane!))].map(name => {
    const pitches = notes.filter(note => note.sourceLane === name).map(note => note.midi).sort((a, b) => a - b);
    const at = (fraction: number) => pitches[Math.floor((pitches.length - 1) * fraction)]!;
    return { name, pitches, q25: at(.25), median: at(.5), q75: at(.75) };
  }).sort((a, b) => a.median - b.median);
  // ponytail: octave-separated medians and disjoint middle halves are a conservative
  // heuristic; a reviewed lane map is required for sparse or crossing sources.
  if (lanes.length !== 2 || lanes.some(lane => lane.pitches.length < 8 || lane.pitches.some(pitch => !Number.isInteger(pitch) || pitch < 0 || pitch > 127))
    || lanes[1]!.median - lanes[0]!.median < 12 || lanes[0]!.q75 >= lanes[1]!.q25) {
    return abstain("ambiguous-lanes");
  }
  return {
    notes: notes.map(note => ({ ...note, hand: note.sourceLane === lanes[0]!.name ? "L" : "R" })),
    applied: true,
    reason: "inferred",
  };
}
