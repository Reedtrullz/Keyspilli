# Collision-aware Beginner two-hand policy experiment

This is a scratch-policy study. It must not change production Beginner or any
other difficulty level.

## Task 1 — Freeze and preregister

Record the current revision, six-level digests, disk headroom, and exactly one
candidate: `COLLISION_AWARE_SPARSE_LH`. Reuse the previous role-budget report
for Candidate A/B/C results; do not rerun them.

## Task 2 — Isolated candidate evaluator

Build the candidate from the current `buildVariants()` output and the existing
`sparseLeftHandAnchors` semantics. In each deterministic source-measure window
(4 beats for 4/4), consider at most the lowest trusted Very Easy LH anchor at
the first meaningful LH onset. Keep it only when the resulting sounding-note
count is at most 2. If that anchor collides, try an existing later LH onset in
the same window without retiming; otherwise suppress it. Never remove or alter
RH notes. Do not add chord expansion, ordinary accompaniment, or special-case
Case 05. Keep all implementation scratch-only.

## Task 3 — Evaluation

Evaluate Classical, Cover, Pop, and Synthetic against baseline Beginner and
Very Beginner/Very Easy controls. Report RH digest equality, LH structural
anchors, erased active windows, root/bass/chroma survival where represented,
notes/onsets/attack rate, max simultaneity, overlap rate, LH attacks/minute,
and validation errors. Treat Pop [0,12) as a regression probe only.

## Task 4 — Decision

Choose exactly one outcome: `COLLISION_AWARE_TWO_HAND_BEGINNER_MECHANICALLY_VALID`,
`TWO_HAND_BEGINNER_REQUIRES_COMPLEXITY_RELAXATION`,
`SPARSE_LH_GAIN_TOO_SMALL`, or
`TWO_HAND_BEGINNER_COLLAPSES_LEVEL_DIFFERENTIATION`. Even Case A is only a
policy option; production remains unchanged. Keep `COVER_RH_IDENTITY_CLIFF`
and `DIFFICULTY_DIFFERENTIATION_CONCERN` deferred.

## Task 5 — Verification and closeout

Repeat the evaluator deterministically, run focused MIDI tests, full workspace
tests, all workspace typechecks, and `git diff --check`. Commit/push only the
preregistration and deterministic results report. Log the evidence to the
Keyspilli Obsidian project note. Do not deploy, replay, render audio, upload
the reference MIDI, or run another human audit.
