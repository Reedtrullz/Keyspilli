# Beginner sparse-LH promotion results

The Task 3 evaluation selected `BEGINNER_SPARSE_TWO_HAND_CONTRACT_PARTIAL`.
The exact `COLLISION_AWARE_SPARSE_LH` candidate passed the mechanical and
collision gates on the three frozen real generation fixtures and preserved RH
and all non-Beginner level digests. Cover recovered 11/11 erased active LH
windows; Pop recovered 28/28; Classical had no erased windows. Very Beginner
remained RH-only, and Candidate Beginner remained RH-dominant with sparse LH
support while Very Easy remained more LH-active.

Promotion is not authorized. The preregistered synthetic fixture failed its
source-hash freeze (`...dc8` expected, `...dc6` actual) and its four-note
candidate reports the normal Beginner note-count validation warning. This is
recorded as a hard corpus failure, not corrected after the run.

The corrected deterministic evaluator outputs are
`/private/tmp/keyspilli-lower-tier-eval-20260902-a1/fixed-1.json` and
`/private/tmp/keyspilli-lower-tier-eval-20260902-a1/fixed-2.json`; they are
byte-identical with canonical JSON SHA-256
`97fd0fef8f2b4cca289b683e15ca2c58d3e6e325c17c5efe2662f726498079ae`.

```text
NO_PRODUCTION_BEHAVIOR_CHANGE
```

The complete evidence, thresholds, provenance basis, physical metrics,
limitations, and follow-up boundary are in
`.superpowers/sdd/2026-09-02-lower-tier-pedagogical-contract-and-beginner-promotion/task-3-report.md`.
