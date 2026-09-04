import {
  LEVEL_ORDER,
  PUBLIC_DIFFICULTY_ORDER,
  validateVariants,
  type DifficultyLevel,
  type Note,
  type PublicDifficultyLevel,
  type Variant,
} from "@keyspilli/midi";

/** Report-only description of the existing physical/public ladder contracts. */
export const DIFFICULTY_CONTRACT_AUDIT_CONFIG = {
  onsetToleranceBeats: 0.08,
  physicalOrder: LEVEL_ORDER,
  publicOrder: PUBLIC_DIFFICULTY_ORDER,
} as const;

export interface DifficultyContractEdge {
  key: string;
  easier: DifficultyLevel;
  harder: DifficultyLevel;
  noteCount: { easier: number; harder: number; delta: number };
  onsetCount: { easier: number; harder: number; delta: number };
  rightHandCount: { easier: number; harder: number; delta: number };
  leftHandCount: { easier: number; harder: number; delta: number };
  difficultyScore: { easier: number; harder: number; delta: number };
  rhPreservation: { matched: number; total: number; ratio: number | null };
  errors: string[];
  pass: boolean;
}

export interface DifficultyContractResult {
  order: readonly DifficultyLevel[];
  available: DifficultyLevel[];
  missing: DifficultyLevel[];
  individualValidationErrors: Record<string, string[]>;
  edgeErrors: Record<string, string[]>;
  edges: DifficultyContractEdge[];
  errors: string[];
  pass: boolean;
}

export interface VeryEasyIndependentResult {
  present: boolean;
  validationErrors: string[];
  pass: boolean;
}

export interface DifficultyContractComparison {
  physical: DifficultyContractResult;
  public: DifficultyContractResult;
  veryEasyIndependent: VeryEasyIndependentResult;
}

export interface DifficultyContractAuditOptions {
  /** Human-authored source fixtures normally have no transcription tail ceiling. */
  maxDurBeats?: number | null;
}

function compareNotes(left: Note, right: Note): number {
  return left.start - right.start
    || left.midi - right.midi
    || left.dur - right.dur
    || right.vel - left.vel
    || compareText(left.hand ?? "", right.hand ?? "")
    || compareText(left.identitySource ?? "", right.identitySource ?? "");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function onsetCount(notes: readonly Note[]): number {
  let count = 0;
  let groupStart: number | null = null;
  for (const note of [...notes].sort(compareNotes)) {
    if (groupStart === null || note.start - groupStart > DIFFICULTY_CONTRACT_AUDIT_CONFIG.onsetToleranceBeats + 1e-9) {
      count += 1;
      groupStart = note.start;
    }
  }
  return count;
}

function rightHand(notes: readonly Note[]): Note[] {
  return notes.filter((note) => note.hand !== "L").sort(compareNotes);
}

function matchRightHand(easier: readonly Note[], harder: readonly Note[]): { matched: number; total: number } {
  const candidates = rightHand(harder);
  const used = new Set<number>();
  let matched = 0;
  for (const note of rightHand(easier)) {
    let best = -1;
    let distance = Infinity;
    for (let index = 0; index < candidates.length; index += 1) {
      if (used.has(index)) continue;
      const candidate = candidates[index]!;
      if (candidate.midi !== note.midi) continue;
      const next = Math.abs(candidate.start - note.start);
      if (next <= DIFFICULTY_CONTRACT_AUDIT_CONFIG.onsetToleranceBeats + 1e-9 && next < distance) {
        best = index;
        distance = next;
      }
    }
    if (best >= 0) {
      used.add(best);
      matched += 1;
    }
  }
  return { matched, total: rightHand(easier).length };
}

function edgeResult(easier: Variant, harder: Variant): DifficultyContractEdge {
  const easierOnsets = onsetCount(easier.notes);
  const harderOnsets = onsetCount(harder.notes);
  const matched = matchRightHand(easier.notes, harder.notes);
  const errors: string[] = [];
  if (easier.notes.length > harder.notes.length) {
    errors.push(`note count increased (${easier.notes.length} > ${harder.notes.length})`);
  }
  if (easier.difficultyScore > harder.difficultyScore) {
    errors.push(`difficulty score decreased (${easier.difficultyScore} > ${harder.difficultyScore})`);
  }
  if (matched.matched < matched.total) {
    const harderByMidi = rightHand(harder.notes);
    for (const note of rightHand(easier.notes)) {
      const retained = harderByMidi.some((candidate) => candidate.midi === note.midi
        && Math.abs(candidate.start - note.start) <= DIFFICULTY_CONTRACT_AUDIT_CONFIG.onsetToleranceBeats + 1e-9);
      if (!retained) errors.push(`RH note ${note.midi}@${note.start} missing from ${harder.level}`);
    }
  }
  const key = `${easier.level}->${harder.level}`;
  return {
    key,
    easier: easier.level,
    harder: harder.level,
    noteCount: { easier: easier.notes.length, harder: harder.notes.length, delta: harder.notes.length - easier.notes.length },
    onsetCount: { easier: easierOnsets, harder: harderOnsets, delta: harderOnsets - easierOnsets },
    rightHandCount: { easier: rightHand(easier.notes).length, harder: rightHand(harder.notes).length, delta: rightHand(harder.notes).length - rightHand(easier.notes).length },
    leftHandCount: { easier: easier.notes.filter((note) => note.hand === "L").length, harder: harder.notes.filter((note) => note.hand === "L").length, delta: harder.notes.filter((note) => note.hand === "L").length - easier.notes.filter((note) => note.hand === "L").length },
    difficultyScore: { easier: easier.difficultyScore, harder: harder.difficultyScore, delta: harder.difficultyScore - easier.difficultyScore },
    rhPreservation: { matched: matched.matched, total: matched.total, ratio: matched.total ? matched.matched / matched.total : null },
    errors: [...new Set(errors)],
    pass: errors.length === 0,
  };
}

function individualErrors(variants: readonly Variant[], options: DifficultyContractAuditOptions): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const variant of variants) {
    result[variant.level] = [...new Set(validateVariants([variant], options))];
  }
  return result;
}

function duplicateErrors(variants: readonly Variant[]): string[] {
  const counts = new Map<string, number>();
  for (const variant of variants) counts.set(variant.level, (counts.get(variant.level) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort(([left], [right]) => compareText(left, right))
    .map(([level]) => `${level}: duplicate difficulty level`);
}

function evaluateOrder(
  variants: readonly Variant[],
  order: readonly DifficultyLevel[],
  options: DifficultyContractAuditOptions,
): DifficultyContractResult {
  const byLevel = new Map<DifficultyLevel, Variant>();
  for (const variant of variants) if (!byLevel.has(variant.level)) byLevel.set(variant.level, variant);
  const individual = individualErrors(variants, options);
  const available = order.filter((level) => byLevel.has(level));
  const missing = order.filter((level) => !byLevel.has(level));
  const edges: DifficultyContractEdge[] = [];
  for (let index = 1; index < order.length; index += 1) {
    const easier = byLevel.get(order[index - 1]!);
    const harder = byLevel.get(order[index]!);
    if (easier && harder) edges.push(edgeResult(easier, harder));
  }
  const edgeErrors = Object.fromEntries(edges.map((edge) => [edge.key, edge.errors])) as Record<string, string[]>;
  const errors = [
    ...missing.map((level) => `missing required level ${level}`),
    ...duplicateErrors(variants),
    ...order.flatMap((level) => individual[level] ?? []),
    ...edges.flatMap((edge) => edge.errors),
  ];
  return {
    order,
    available,
    missing,
    individualValidationErrors: individual,
    edgeErrors,
    edges,
    errors: [...new Set(errors)],
    pass: errors.length === 0,
  };
}

/**
 * Compare the unchanged six-level physical contract with the report-only
 * five-level public contract. Very Easy is checked independently for legacy
 * compatibility and is never used as a public ordering edge.
 */
export function evaluateDifficultyContract(
  variants: readonly Variant[],
  options: DifficultyContractAuditOptions = { maxDurBeats: null },
): DifficultyContractComparison {
  // Both reports use the same individual validator, while the physical report
  // deliberately computes its six-level edges locally so it remains a
  // truthful historical diagnostic after production adopts public adjacency.
  const physical = evaluateOrder(variants, LEVEL_ORDER, options);
  const publicContract = evaluateOrder(variants, PUBLIC_DIFFICULTY_ORDER as readonly PublicDifficultyLevel[], options);
  const veryEasy = variants.find((variant) => variant.level === "very-easy");
  const validationErrors = veryEasy ? [...new Set(validateVariants([veryEasy], options))] : ["missing required level very-easy"];
  return {
    physical,
    public: publicContract,
    veryEasyIndependent: {
      present: Boolean(veryEasy),
      validationErrors,
      pass: Boolean(veryEasy) && validationErrors.length === 0,
    },
  };
}
