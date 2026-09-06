# Collision-aware Beginner two-hand policy — Task 4 results

## Decision

`COLLISION_AWARE_TWO_HAND_BEGINNER_MECHANICALLY_VALID`

This is a provisional, mechanically valid policy option. It is not production-ready and is not musically validated.

`NO_PRODUCTION_BEHAVIOR_CHANGE`

## Baseline contract

The frozen generic Beginner contract is RH-only, with `maxSimultaneity: 2`, `maxDensityAttacksPerSecond: 6`, `minMedianIoiSeconds: 0.08`, a 0.25-beat grid, a 0.5-beat melody minimum, and ladder tolerance `0.02`. Very Beginner, Beginner, and Very Easy were retained as controls; the candidate changes only the scratch Beginner evaluator output.

## Exact candidate policy

The preregistered candidate is `COLLISION_AWARE_SPARSE_LH`. It retains the baseline Beginner RH event set byte-for-byte. For each source-measure window (4 beats in 4/4 and 4.5 beats in 9/8), it considers the lowest existing Very Easy LH structural/root/bass evidence at the first meaningful LH onset. An anchor is emitted only when sounding-duration overlap keeps simultaneous sounding notes at or below 2. If that onset collides, an existing later Very Easy LH onset in the same window is tried; otherwise the anchor is suppressed. There is no retiming, RH replacement, or Case-05 exception. Drum-derived, decorative, arpeggio, and repeated filler notes are excluded unless already selected as the existing sparse structural anchor.

## Per-fixture results

| Fixture | Baseline Beginner notes (RH/LH) | Candidate notes (RH/LH) | Onsets baseline → candidate | Attack/s baseline → candidate | Median IOI s baseline → candidate | Attack-boundary max/median simultaneity baseline → candidate |
|---|---:|---:|---:|---:|---:|---:|
| Classical | 435 (435/0) | 507 (435/72) | 435 → 489 | 1.351 → 1.516 | 0.500 → 0.500 | 2/1 → 2/2 |
| Cover | 381 (381/0) | 510 (381/129) | 381 → 469 | 1.631 → 2.003 | 0.417 → 0.313 | 2/1 → 2/1 |
| Pop | 375 (375/0) | 470 (375/95) | 375 → 423 | 1.291 → 1.438 | 0.380 → 0.380 | 2/1 → 2/1 |
| Synthetic full-band | 4 (4/0) | 6 (4/2) | 4 → 4 | 1.185 → 1.185 | 1.000 → 1.000 | 1/1 → 2/1.5 |

## RH parity

Candidate Beginner RH digests equal baseline exactly on Classical, Cover, Pop, and Synthetic. Candidate validation and monotonicity error arrays are empty for all real fixtures. The Cover Very Easy control has 779 RH notes and intentionally does not equal the Beginner RH digest; this is a control difference, not a candidate parity failure.

## Structural recovery and anchors

Active windows, fully erased windows baseline → candidate, and anchor outcomes (`emitted-deferred-suppressed`) are:

| Fixture | Active windows | Fully erased windows | Anchors |
|---|---:|---:|---:|
| Classical | 72 | 0 → 0 | 51-21-0 |
| Cover | 129 | 11 → 0 | 127-2-0 |
| Pop | 95 | 28 → 0 | 84-11-0 |
| Synthetic | 2 | 0 → 0 | 2-0-0 |

The candidate adds 72/129/95/2 LH notes respectively. Erasure is measured by whether any hand has an event in the fixed source-meter bucket; simultaneity is a sounding-duration metric, with attack-boundary diagnostics also reported by the evaluator.

## Playability and neighbor separation

Candidate maximum sounding simultaneity is 2 on every fixture, and the existing Beginner validation checks pass on real fixtures. Candidate attack rates remain below Very Easy on the three real fixtures (and equal on the tiny synthetic control), while staying above or near Very Beginner: the candidate is 1.516/2.003/1.438/1.185 attacks/s for Classical/Cover/Pop/Synthetic. This establishes mechanical neighbor separation on the observed dimensions, not a musical difficulty judgment.

| Fixture | Candidate LH attacks/min | RH+LH simultaneous attack rate | Onsets containing LH | Hand alternations/min |
|---|---:|---:|---:|---:|
| Classical | 13.395 | 0.037 | 14.724% | 19.907 |
| Cover | 33.053 | 0.087 | 27.505% | 37.665 |
| Pop | 19.380 | 0.111 | 22.459% | 7.956 |
| Synthetic full-band | 35.556 | 0.500 | 50.000% | 0.000 |

These are attack/onset proportions, not claims about continuous time coverage; the evaluator's root, bass, chroma, and pitched-drum fields remain unavailable for these fixtures.

The exact synthetic fixture still triggers the existing minimum-note floor: baseline reports 4 notes and candidate reports 6 notes. This is a fixture-size warning, not a collision-policy failure.

## Case-05 regression probe

Pop `[0,12)` remains a policy probe only. Baseline has 0 notes, 0 RH, and 0 LH events; candidate has 2 notes, 0 RH, and 2 LH anchors across two onsets, with no RH+LH simultaneous attacks and 18.057 LH attacks/minute. No special boundary or threshold was introduced.

## Decision rationale

The candidate preserves the Beginner RH teaching material exactly, recovers structural LH evidence, removes all observed Cover and Pop fully erased active windows, and stays within the two-sounding-note ceiling. That is sufficient for the provisional mechanical policy outcome. It does not establish that the result sounds good, teaches well, or should become a default.

## Boundaries and non-claims

No human audit, audio render, replay, production replay, deployment, reference MIDI upload, parameter sweep, or other musical acceptance work was performed. Root/bass/chroma survival and pitched-drum metrics are `null` because the fixture lineage lacks those role/provenance fields. `COVER_RH_IDENTITY_CLIFF` and `DIFFICULTY_DIFFERENTIATION_CONCERN` remain deferred. The result is scratch-evaluator evidence only.

## Provenance and determinism

- Frozen starting revision: `1998bd6`
- Preregistration commit: `3397e80`
- Preregistration: `docs/superpowers/plans/2026-09-02-collision-aware-beginner-two-hand-policy-preregistration.json`
- Corrected Task 3 report: `.superpowers/sdd/2026-09-02-collision-aware-beginner-two-hand-policy-experiment/task-3-report.md`
- Logical evaluator ID: `collision-aware-eval-20260902`
- Scratch evaluator output SHA-256: `784611c4bcf0907a51d1618f1b4f9526a5359e3a7a98d71dcfc7193d3c96afcd`

Frozen fixture SHA-256 values: Classical `e7e0fd260e049e338120cc4ee35c1a998ef616c01529a4c1a79837d6bb914039`; Cover `eb8a1cf8f0076a548acaa206b67d19123814e1167d654496afa24c0458dc6f9d`; Pop `87915f6b8dce035951af2ddc89c9c36ce105fde8e79ba6f936e31b7f80ef7fd6`; Synthetic full-band `fba496e372f8962967b5e08903fa4883d6f4be1bde046f0eb3a06e1a1dcc8dc8`.

The evaluator was run twice with identical output bytes; `cmp` and SHA-256 matched. No repository source, test, manifest, or default was changed.
