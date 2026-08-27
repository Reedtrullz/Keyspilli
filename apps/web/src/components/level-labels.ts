/** Human-facing difficulty labels shared by dense cards and the player. */
export const LEVEL_LABEL: Record<string, string> = {
  "very-beginner": "Very Beginner",
  beginner: "Beginner",
  "very-easy": "Very Easy",
  easy: "Easy",
  medium: "Medium",
  advanced: "Advanced",
};

export const LEVEL_SHORT: Record<string, string> = {
  "very-beginner": "VB",
  beginner: "B",
  "very-easy": "VE",
  easy: "E",
  medium: "M",
  advanced: "A",
};

export function levelLabel(value: string): string {
  return LEVEL_LABEL[value] ?? value;
}

export function levelShort(value: string): string {
  return LEVEL_SHORT[value] ?? value;
}
