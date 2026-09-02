# Task 2 — expanded isolated evaluator

The evaluator is outside the repository at `<scratch>/evaluator.ts` (fresh bounded directory: `/private/tmp/keyspilli-lower-tier-eval-20260902-a1`) and writes only deterministic JSON there. It reuses the exact `COLLISION_AWARE_SPARSE_LH` rule: first eligible lowest LH onset per source-meter window, existing later onset on collision, otherwise suppression; no retiming or RH mutation.

Commands:

```text
node_modules/.bin/tsx <scratch>/evaluator.ts --out <scratch>/run-1.json
node_modules/.bin/tsx <scratch>/evaluator.ts --out <scratch>/run-2.json
cmp -s <scratch>/run-1.json <scratch>/run-2.json
```

Both runs were byte-identical. The output is `<scratch>/run-1.json`; its canonical JSON SHA-256 is `253ca3b66923c47b1977e3e39bc47500a013cdd0cf8d2711f8a089450b02ee01`. It records the preregistration SHA, source SHA, all six frozen level digests, baseline/candidate Beginner RH parity, all six level metrics, validation/density/IOI/grid/duration/span/voice checks, non-Beginner parity, provenance, active windows, anchor decisions, physical two-hand metrics, and synthetic regressions.

| Fixture | Source SHA matches prereg | Six level digests | RH parity | Active windows: baseline erased → candidate erased / recovered | Anchors: emitted / deferred / suppressed | Candidate max sounding sim |
| --- | --- | --- | --- | --- | --- | --- |
| classical | yes | 6/6 | yes | 0 → 0 / 0 | 51 / 21 / 0 | 2 |
| cover | yes | 6/6 | yes | 11 → 0 / 11 | 127 / 2 / 0 | 2 |
| pop | yes | 6/6 | yes | 28 → 0 / 28 | 84 / 11 / 0 | 2 |
| synthetic-full-band | **no — failed freeze** | 6/6 | yes | 0 → 0 / 0 | 0 / 0 / 2 | 2 |

Candidate Beginner physical metrics (`notes / onsets`, attacks/sec, median IOI sec, max/median attack-boundary simultaneity, LH attacks/min, LH-active onset %, simultaneous RH+LH onsets, hand alternations/min):

```text
classical:          507/489, 1.516, 0.500, 2/2,   13.395, 14.724%, 18, 19.907
cover:              510/469, 2.003, 0.313, 2/1,   33.053, 27.505%, 41, 37.665
pop:                470/423, 1.438, 0.380, 2/1,   19.380, 22.459%, 47,  7.956
synthetic-full-band:  6/4, 1.185, 1.000, 2/1.5, 35.556, 50.000%,  2,  0.000
```

Very Beginner is RH-only in all four rows (`LH-active onset % = 0`). Candidate Beginner is RH-dominant with sparse LH (14.724%, 27.505%, 22.459%, and 50% respectively); Very Easy is materially denser and more LH-active (62.745%, 37.573%, 60%, and 100%). The JSON preserves the prior comparison metadata unchanged: `beginner-budget-revision/report.json`, SHA `f125b9b496cbf1856dcc915cd526d7419c635780e2758106dea04b6cc9d9cd87`.

Synthetic checks cover true full rest (0 emitted), RH rest with meaningful LH (1 emitted), LH-filler-only/unknown provenance (0 emitted and fail-closed), harmonic change during RH rest, sustained LH crossing a window, one-RH collision allowance, two-RH collision suppression, and defer-to-existing-later-onset (chosen start `2`). The synthetic preregistration source hash mismatches the generated inline fixture (`...c8` expected vs `...c6` actual), so this is a failed freeze and is not silently corrected; strict provenance suppresses its anchors. All emitted real-fixture anchors have trusted existing Very Easy LH evidence; root/bass/chroma lineage is `UNAVAILABLE`, never fabricated.

Limitations: this is the four-fixture preregistered symbolic corpus only. It does not read EVAL_ONLY or excluded material, render audio, use network/source research, replay production, or decide the A/B/C/D outcome. `COVER_RH_IDENTITY_CLIFF` and `DIFFICULTY_DIFFERENTIATION_CONCERN` remain deferred. The tiny synthetic fixture retains the existing validator’s note-count warning because it is a regression shadow, not a publishable song. No production source or tests were changed.
