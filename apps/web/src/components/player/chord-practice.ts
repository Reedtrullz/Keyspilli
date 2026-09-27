import { transposeChordSymbol, type ChordLabel } from "@keyspilli/midi";

export {
  buildChordPracticeTargets,
  compactPracticeVoicing,
  selectPracticeChords,
} from "@keyspilli/player-core";

type RealizedChordVoicing = Pick<ChordLabel, "beat" | "notes">;

export function displayChordName(name: string, transpose: number): string {
  if (!transpose) return name;
  try {
    return transposeChordSymbol(name, transpose);
  } catch {
    return name;
  }
}

export function projectActionableChordShapes(
  labels: readonly ChordLabel[],
  realized: readonly RealizedChordVoicing[],
  transpose = 0,
): ChordLabel[] {
  const realizedByBeat = new Map(realized.map((chord) => [chord.beat, chord]));
  return labels.map((label) => ({
    ...label,
    name: displayChordName(label.name, transpose),
    notes: (realizedByBeat.get(label.beat)?.notes ?? []).map((midi) => midi + transpose),
  }));
}
