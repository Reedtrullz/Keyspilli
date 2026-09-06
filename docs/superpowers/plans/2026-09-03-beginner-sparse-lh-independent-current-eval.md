# Independent current-fixture Beginner sparse-LH evaluation

## Goal

Run one final evidence-only evaluation of the frozen `COLLISION_AWARE_SPARSE_LH`
candidate from current production generation. Do not change musical policy or
promote it unless every freshly measured gate passes.

## Tasks

1. Freeze current revision, candidate semantics, and fixture bytes/hashes.
2. Repair the one project-owned synthetic control only if needed to exercise
   genuine LH filler; never mutate V1 silently.
3. Add a small independent evaluator that generates current six-level outputs,
   applies the frozen candidate, compares actual event sets, validates the full
   ladder, and emits a complete declared-gate table.
4. Freeze a new preregistration before aggregate evaluation; run the evaluator
   twice and obtain an independent review.
5. Select exactly A/B/C, promote only under A, otherwise close with no
   production behavior change; preserve the deferred RH cliff and level
   differentiation concerns.

## Boundaries

No legacy metric rows as current evidence, no EVAL_ONLY/reference MIDI, no
audio, human audit, replay, deploy, RH/Beginner-budget/level/policy changes, or
new evidence-repair cycle after CASE C.
