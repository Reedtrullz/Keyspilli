/** Pitch-class → hex color mapping (ADR 0003). */
export const PITCH_COLORS: Record<number, string> = {
  0: "#e5484d",
  1: "#ea7326",
  2: "#f5a524",
  3: "#d1b426",
  4: "#46a758",
  5: "#12a594",
  6: "#0091ff",
  7: "#3e63dd",
  8: "#6e56cf",
  9: "#ab4aba",
  10: "#d6409f",
  11: "#e93d82",
};

export function pitchColor(midi: number): string {
  return PITCH_COLORS[((midi % 12) + 12) % 12]!;
}
