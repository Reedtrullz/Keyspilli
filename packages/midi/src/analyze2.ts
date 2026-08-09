// Re-export helper used by simplify (avoids circular import).
import { Note } from "./types.js";

export function analyze(notes: Note[]) {
  return { splitHands, detectBassPattern, detectKey: keyOf };
}

import { splitHands, detectBassPattern, detectKey } from "./analyze.js";

function keyOf(notes: Note[]) {
  return detectKey(notes);
}
