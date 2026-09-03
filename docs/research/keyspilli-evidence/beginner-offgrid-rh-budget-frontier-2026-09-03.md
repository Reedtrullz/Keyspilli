# Beginner off-grid RH budget frontier — 2026-09-03

## Result

- Decision: `BEGINNER_SPARSE_OFFGRID_RH_BUDGET_VALIDATED`.
- Behavior: `NO_MUSICAL_BEHAVIOR_CHANGE`. Candidate A/B were evaluator-only counterfactuals; no arranger, learner ladder, public API, reference, audio, or deployment change was made.
- Frozen generation revision: `76cfead64091c409cba4fd9772c2748903ebddda`.
- Evaluator implementation checkpoint: `07e4c0a` (`diag: harden off-grid RH frontier evaluator`).
- Candidate A recovered 110/188 of Candidate B's eligible Cover events (58.5%), exceeded the preregistered 50% gate, stayed below Easy, and preserved the exact Beginner LH set and frozen playability controls. Candidate B remains diagnostic-only.

## Frozen method

The run used the project-owned Classical, Cover, and Pop symbolic fixtures and physical six-level learner output. Eligibility was fixed before measurement: an existing `beginner-ladder` rejection, source onset off the 0.25-beat grid by more than 0.01 beat, one-to-one ancestry, and at least one generic structural signal (phrase boundary, contour extremum, repeated articulation, high velocity, long duration, or large-leap endpoint). Meter windows were 4 beats in 4/4 and 4.5 beats in 9/8. Candidate A allowed one event/window; B allowed two. Original source onsets and all baseline LH events were retained; blocked additions were classified rather than retimed or substituted.

## Fixture/timing evidence

| Fixture | Bytes / SHA-256 | Source off-grid attacks | Fraction | Minimum subdivision | Max consecutive | Rejected pool |
|---|---:|---:|---:|---:|---:|---:|
| Classical — Clair de lune | 85,364 / `e7e0fd260e049e338120cc4ee35c1a998ef616c01529a4c1a79837d6bb914039` | 1 | 0.002 | 0.125 beat | 1 | 0 |
| Cover — River Flows in You | 94,160 / `eb8a1cf8f0076a548acaa206b67d19123814e1167d654496afa24c0458dc6f9d` | 422 | 0.525 | 0.125 beat | 13 | 398 (all 0.125 beat; one run of 398) |
| Pop — Hello | 68,384 / `87915f6b8dce035951af2ddc89c9c36ce105fde8e79ba6f936e31b7f80ef7fd6` | 0 | 0 | — | 0 | 0 |

Cover's source off-grid pool was structurally rich (contour 439, high-velocity 249, large-leap endpoint 376, long-duration 309, phrase-anchor 41, repeated articulation 82). The 398 first-loss events were all off-grid; 320 were the previously established structurally significant cliff and none were recoverable inside the current budget/envelope.

## Candidate metrics

`RH`/`LH` are note counts; `APS` is attacks/second. These are deterministic diagnostics, not recognizability claims.

| Fixture / envelope | RH | total / onsets | APS | median IOI (beats) | max simultaneity | RH span | off-grid RH | recovered / discarded |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Classical baseline = A = B | 435 | 507 / 489 | 1.516 | 0.500 | 2 | 41 | 0 | 0 / 0 |
| Classical Easy | 435 | 962 / 714 | 2.214 | 0.500 | 4 | 41 | 0 | — |
| Cover baseline | 381 | 510 / 469 | 1.995 | 1.000 | 2 | 32 | 0 | 0 / 0 |
| Cover Candidate A | 491 | 620 / 579 | 2.463 | 0.875 | 2 | 32 | 110 (28.191/min) | 110 / 191 |
| Cover Candidate B | 569 | 698 / 657 | 2.795 | 0.875 | 2 | 32 | 188 (48.011/min) | 188 / 94 |
| Cover Easy | 786 | 1,225 / 921 | 3.918 | 0.500 | 4 | 32 | 404 (103.172/min) | — |
| Pop baseline = A = B | 375 | 470 / 423 | 1.438 | 0.500 | 2 | 26 | 0 | 0 / 0 |
| Pop Easy | 375 | 847 / 555 | 1.888 | 0.500 | 4 | 26 | 0 | — |

Cover Candidate A blockers were 191 window-budget, 16 current-LH, 2 max-simultaneity, and 9 span/jump; density, IOI, and other constraints blocked none. Candidate B blockers were 94 window-budget, 28 current-LH, 3 max-simultaneity, and 15 span/jump. The report records these as first blockers per event.

## Gate and interpretation

All frozen controls passed: exact Beginner LH, no retiming, maxSim/density/IOI/span-jump preservation, unchanged non-Beginner levels, no Classical/Pop material densification, no Classical/Pop identity regression, and the legacy Cover 320 attribution. Candidate A was clearly below Easy; B was not promoted. The selected decision therefore means the generic A envelope is validated as a bounded diagnostic frontier, not that it should be silently enabled in production.

The machine report was generated twice with the same fixtures/options and was byte-identical: `eadb2fe2cf48f31c3a18975f14fed4fb665b9538fafa739b04f3dcb44b62815a`. It contains logical fixture IDs and hashes only; absolute paths and the supplied reference MIDI are excluded. The external JSON reports remain in a bounded local scratch directory for inspection and are not committed.

## Follow-up

One separately approved production experiment remains: implement the exact preregistered Candidate-A Beginner RH budget, then run human listening. Do not promote Candidate B. This closeout deliberately does not claim musical improvement or alter generated arrangements.
