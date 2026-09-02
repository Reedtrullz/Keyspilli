# Task 3 — Corpus evaluation and promotion decision

Status: complete. The exact outcome is `BEGINNER_SPARSE_TWO_HAND_CONTRACT_PARTIAL`.
Task 3 made no production-source, metadata, or learner-behavior changes; Task 2
intentionally added the isolated evaluator support/tests.

## Decision

The already-validated `COLLISION_AWARE_SPARSE_LH` mechanic is mechanically
sound on the three frozen real generation fixtures, but the preregistered
corpus does not satisfy the all-eligible-fixtures promotion rule. The inline
synthetic fixture has a source-hash freeze mismatch and its tiny four-note
candidate remains below the repository validator's normal note-count floor.
Those are recorded failures, not amended after the run. Therefore:

```text
Outcome: BEGINNER_SPARSE_TWO_HAND_CONTRACT_PARTIAL
Production: NO_PRODUCTION_BEHAVIOR_CHANGE
```

This is not `BEGINNER_SPARSE_TWO_HAND_CONTRACT_VALIDATED`; no production
promotion is authorized by the preregistration. It is also not
`BEGINNER_SPARSE_TWO_HAND_COLLAPSES_LADDER`: Very Beginner remained RH-only,
the candidate Beginner remained RH-dominant and sparse, and Very Easy remained
materially denser and more LH-active. It is not
`BEGINNER_SPARSE_TWO_HAND_NOT_GENERAL`: Cover and Pop recovered all of their
previously erased active windows, while Classical passed the mechanical gates.

## Evaluation provenance and reproducibility

- Candidate: `COLLISION_AWARE_SPARSE_LH`.
- Preregistered starting revision: `008ac14fb546557da7593c55cf27b225da138e27`.
- Preregistration SHA-256: `931f1ef2510a0de2b5280c1a3b59999b245c868abb29760305cffe5b6af86b7f`.
- Evaluator: `/private/tmp/keyspilli-lower-tier-eval-20260902-a1/evaluator.ts`.
- Deterministic outputs: `/private/tmp/keyspilli-lower-tier-eval-20260902-a1/fixed-1.json` and `/private/tmp/keyspilli-lower-tier-eval-20260902-a1/fixed-2.json` were byte-identical.
- Run canonical JSON SHA-256: `97fd0fef8f2b4cca289b683e15ca2c58d3e6e325c17c5efe2662f726498079ae`.
- The evaluator used the exact preregistered rule: one lowest eligible LH
  onset per source-meter window, defer to an existing later onset on a
  collision, otherwise suppress; no RH mutation or retiming.
- The four source hashes and all six frozen level digests were checked. The
  three real fixtures matched their source hashes; `synthetic-full-band` did
  not. Expected source suffix `...dc8`; actual source suffix `...dc6`.
- The tracked seed MIDIs remain `EVAL_ONLY`, not calibration fixtures:
  `data/seed-midi/dadebrayant-avenged-sevenfold-dear-god-piano-cover-msm014zo.mid`
  and `data/seed-midi/the-theorist-elton-john-your-song-piano-cover-jz6ugvghbt8.mid`.

## Frozen contracts

| Level | Current behavior | Proposed contract | Assessment |
| --- | --- | --- | --- |
| Very Beginner | Generic RH-only learner; metal may retain sparse LH | `ONE_HAND_MELODY` | `ALREADY_ALIGNED` |
| Beginner | Generic RH-only; metal candidate adds sparse structural LH | `PRIMARY_MELODY_PLUS_SPARSE_STRUCTURAL_LH` | `NOT_ALIGNED` in generic code; candidate mechanic is partial evidence |
| Very Easy | Retained simplified RH/LH learner texture | `SIMPLIFIED_TWO_HAND_ARRANGEMENT` | `PARTIALLY_ALIGNED` |

The frozen mechanical limits were unchanged: Beginner max sounding
simultaneity 2, attack-density limit 6/s, median-IOI floor 0.08 s, 0.25-beat
grid, 12-semitone per-hand sounding-span cap, two-voice cap, and positive
finite durations. The calibration duration maximum is intentionally waived
(`maxDurBeats: null`); duration validity remains checked. RH exact parity and
non-Beginner parity are hard requirements.

## Per-fixture result

All values below are from the deterministic JSON report. `LH share` is the
candidate's LH-active onset share; `maxSim` is sounding simultaneity.

| Fixture | Source freeze | RH parity | Baseline Beginner | Candidate Beginner | LH anchors | Active windows erased: baseline → candidate | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Classical | pass | pass | 435 notes / 435 onsets | 507 / 489; 1.516 attacks/s; median IOI .500 s; maxSim 2 | 51 emitted, 21 deferred | 0 → 0 | `IMPROVED`, gate pass |
| Cover | pass | pass | 381 / 381 | 510 / 469; 2.003/s; .313 s; maxSim 2 | 127 emitted, 2 deferred | 11 → 0; 11 recovered | `IMPROVED`, gate pass |
| Pop | pass | pass | 375 / 375 | 470 / 423; 1.438/s; .380 s; maxSim 2 | 84 emitted, 11 deferred | 28 → 0; 28 recovered | `IMPROVED`, gate pass |
| Synthetic full-band | **fail** (`...dc8` → `...dc6`) | pass | 4 / 4 | 4 / 4; 1.185/s; 1.000 s; maxSim 1 | 0 emitted, 2 suppressed by strict provenance | 0 → 0 | `UNCHANGED`, gate **regressed** |

Candidate physical LH-active onset shares were 14.724% (Classical), 27.505%
(Cover), 22.459% (Pop), and 50% (Synthetic). The synthetic percentage is not
treated as product evidence because the source freeze failed and the fixture is
only a regression shadow. Real fixtures had no candidate validation or
monotonicity errors; candidate durations were positive finite, grid-valid,
within span/voice limits, and max sounding simultaneity stayed at 2.

## Hard and regression gates

Passed for Classical, Cover, and Pop:

- Beginner RH digest exactly matched the frozen baseline RH digest.
- No RH replacement, removal, retiming, or pitch change occurred.
- Candidate Beginner validation, grid, density, median IOI, duration, span,
  voice, and max-simultaneity checks passed.
- No drum-derived or unknown-provenance LH anchor was emitted.
- Cover and Pop active LH windows were fully recovered; genuine source-rest
  windows remained silent.
- Collision fixtures behaved as preregistered: one RH allows one LH anchor,
  two RH suppress it, and a colliding anchor defers to an existing later onset.

The full-corpus promotion gate fails because the synthetic source hash does not
match the frozen preregistration and its candidate validator check reports
`beginner: only 4 notes`. This is a hard evidence failure even though RH parity,
maxSim, and the collision regressions pass.

Non-Beginner level digests were equal to their frozen baselines for all four
rows: Very Beginner, Very Easy, Easy, Medium, and Advanced. Very Beginner had
zero LH-active onsets in every row. Candidate Beginner was RH-dominant on all
three real fixtures, while Very Easy was more LH-active (62.745%, 37.573%,
60%, and 100% respectively in the report's four rows), preserving the intended
neighbor distinction rather than collapsing the ladder.

## Provenance, complexity, and limitations

All real emitted anchors were classified as existing Very Easy LH evidence
(72/129/95 anchors for Classical/Cover/Pop); unsafe unknown provenance was
zero. Root, bass, and chroma lineage were `UNAVAILABLE`, not fabricated. The
candidate adds only sparse existing-source anchors and never adds decorative
arpeggios, repeated filler, or full harmonic stacks. The report measures
physical complexity, not recognizability: hand alternations/minute were
19.907/37.665/7.956 for Classical/Cover/Pop, and simultaneous RH+LH onsets
were 18/41/47. These are descriptive, not new acceptance thresholds.

This evaluation covers only the four preregistered generation-side fixtures.
It did not read EVAL_ONLY material, use the supplied reference MIDI, download
anything, render audio, replay production, or deploy. It cannot establish
recognizability, musical taste, root correctness, or human playability. The
deferred concerns remain `COVER_RH_IDENTITY_CLIFF` and
`DIFFICULTY_DIFFERENTIATION_CONCERN`.

## Required next task (not implemented here)

If promotion is revisited, first create a new explicitly approved freeze for a
corrected project-owned synthetic fixture (or remove it from eligibility), then
rerun the same isolated evaluator and review the generic Beginner contract
separately. Do not change production behavior or silently amend this run's
preregistration as part of that follow-up.
