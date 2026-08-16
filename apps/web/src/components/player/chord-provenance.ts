import type { ChordLabel } from "@keyspilli/midi";

export type ChordProvenanceKind = "authored" | "generated" | "inferred" | "unknown";

export interface ChordProvenancePresentation {
  kind: ChordProvenanceKind;
  label: string;
  dotted: boolean;
  textClass: string;
  backgroundClass: string;
  borderClass: string;
  fill: string;
  stroke: string;
}
/**
 * Classify a chord for learner-facing surfaces.
 *
 * Missing provenance is deliberately treated as unknown rather than authored:
 * legacy events must not look authoritative merely because an old artifact did
 * not carry the field. An inference flag/type also wins over a contradictory
 * source label because it is the most useful warning for a learner.
 */
export function chordProvenance(chord: Pick<ChordLabel, "sourceKind" | "inferred" | "inferenceType">): ChordProvenancePresentation {
  const inferenceDetail = typeof chord.inferenceType === "string" && chord.inferenceType.trim()
    ? ` (${chord.inferenceType.replaceAll("-", " ")})`
    : "";
  if (chord.inferred === true || chord.sourceKind === "inferred" || chord.inferenceType !== undefined) {
    return {
      kind: "inferred",
      label: `Inferred chord${inferenceDetail}`,
      dotted: true,
      textClass: "text-amber-800",
      backgroundClass: "bg-amber-50",
      borderClass: "border-amber-400",
      fill: "#fff7ed",
      stroke: "#d97706",
    };
  }
  if (chord.sourceKind === "unknown" || chord.sourceKind === undefined) {
    return {
      kind: "unknown",
      label: "Chord provenance unknown",
      dotted: true,
      textClass: "text-zinc-500",
      backgroundClass: "bg-zinc-50",
      borderClass: "border-zinc-400",
      fill: "#f4f4f5",
      stroke: "#71717a",
    };
  }
  if (chord.sourceKind === "authored") {
    return {
      kind: "authored",
      label: "Authored chord",
      dotted: false,
      textClass: "text-zinc-800",
      backgroundClass: "bg-white",
      borderClass: "border-zinc-300",
      fill: "#ffffff",
      stroke: "#27272a",
    };
  }
  return {
    kind: "generated",
    label: "Generated chord",
    dotted: false,
    textClass: "text-zinc-700",
    backgroundClass: "bg-white",
    borderClass: "border-zinc-300",
    fill: "#ffffff",
    stroke: "#27272a",
  };
}
