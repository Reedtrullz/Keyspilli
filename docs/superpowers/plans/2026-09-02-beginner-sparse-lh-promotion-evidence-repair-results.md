# Beginner sparse-LH promotion evidence-repair results

## Decision

```text
BEGINNER_SPARSE_TWO_HAND_EVIDENCE_STILL_INSUFFICIENT
NO_PRODUCTION_BEHAVIOR_CHANGE
```

The frozen candidate is not promoted. Task 4 produced a provisional
`BEGINNER_SPARSE_TWO_HAND_PROMOTION_EVIDENCE_CLEAN`, but the required broad
review found that its trusted-fixture and candidate-level gates were not
independently evidenced. This closeout supersedes that provisional outcome;
the preregistration and the historical partial experiment remain unchanged.

## Git and freezes

- Starting HEAD: `29906dff7f454fb6120928a4f57906ee5c05ea02`.
- Control checkpoint: `2faadbf57afe79e8a617a056edad5f66d81a664d`.
- Fresh-preregistration checkpoint: `641c7fe50b9902a9e2606b72bd55ace242ddef67`.
- Remote `origin/codex/metal-inference-lane-lock` matched `641c7fe` before
  closeout; this results checkpoint is the only subsequent intended commit.
- Old preregistration SHA-256: `26af25998344d3c1c1740a46765d5af9669528c233c7a8f89affadc12b8133a`.
- Fresh preregistration SHA-256: `bb27ae45e6e042e934616d296dfbc259e6b7d4ccb0b5d91b9ec53382e6f465b9`.
- Frozen control SHA-256: `63f08d3dfce74ab9c8172572e99b1b8ae5a48785c7bec12bbe97aea202fd27d7`
  (3,153 bytes; two fresh reads equal).

No production-policy, validator, difficulty-level, reference, audio, replay,
deployment, or runtime files were changed.

## Historical synthetic failure

The prior experiment expected
`fba496e372f8962967b5e08903fa4883d6f4be1bde046f0eb3a06e1a1dcc8dc8`, while
two fresh serializations of the unchanged tracked source produced
`fba496e372f8962967b5e08903fa4883d6f4be1bde046f0eb3a06e1a1dcc8dc6` (1,636
bytes each). Git history identifies the first divergence at commit
`3397e80de6ebdd0a67f34c2df867538aaff14b41`, in the old preregistration at
line 52. The cause is `SYNTHETIC_HASH_TRANSCRIPTION_ERROR`; the old
preregistration remains byte-identical and was not corrected.

The exact two old validator errors were:

| Error | Observed | Required | Classification |
| --- | ---: | ---: | --- |
| `beginner: only 4 notes` | 4 | >= 8 | minimum musical content / corpus inadequacy |
| `very-beginner: only 4 notes` | 4 | >= 8 | minimum musical content / corpus inadequacy |

These were not mechanical safety, difficulty-monotonicity, or max-similarity
failures. They made the old control unsuitable; validator thresholds were not
weakened.

## Replacement control and preregistration

Task 1 found no existing project-owned fixture that both passed ordinary
validation and covered the required rest, LH-only, collision, filler, and drum
provenance cases. The single authorized replacement is
`BEGINNER_SPARSE_LH_PROMOTION_CONTROL_V1` at
`packages/catalog/test/fixtures/beginner-sparse-lh-promotion-control.json`:

- 20 source notes, 13 onsets, 32 beats, 100 BPM, 4/4.
- 12 RH / 8 LH source notes; eight melody, eight structural-LH, four filler;
  eight sidecar drum timing events.
- Sections A–G include harmonic changes, a true rest, LH-only activity,
  one-RH collision allowance, two-RH blocking/defer behavior, and unknown
  provenance suppression.
- The focused control test and normal validator passed at the time of the
  freeze; the test-local candidate has eight RH and six emitted LH notes.

The fresh preregistration is
`docs/superpowers/plans/2026-09-02-beginner-sparse-lh-promotion-evidence-repair-preregistration.json`
with the hash above. It freezes `COLLISION_AWARE_SPARSE_LH`, all trusted
fixture hashes, exact gates, exclusions, and deferred concerns.

## Why CASE A is rejected

The review of `.superpowers/sdd/2026-09-02-beginner-sparse-lh-promotion-evidence-repair/task-4-evaluate.ts`
identified five load-bearing gaps:

1. Classical/Cover/Pop candidate rows were copied from `legacy-eval.json` and
   a calibration artifact whose recorded starting revision was not `641c7fe`,
   rather than being freshly evaluated from current `buildVariants` output.
2. The reported RH-parity and non-Beginner-parity gates only compared frozen
   digest rows; they did not independently compare the current candidate's RH
   output and complete ladder against those baselines.
3. The control's four filler notes are all RH, and the candidate is built from
   melody plus structural-LH notes. Its filler-suppression assertion is
   therefore tautological and does not exercise repeated LH filler.
4. Candidate validation was run on the unmodified learner ladder, while
   monotonicity was called with a one-level array. Those checks do not prove
   candidate-level validation or adjacent-level monotonicity.
5. The preregistration's all-tested-variant max-similarity gate is false for
   the control (Medium and Advanced are 3), but the evaluator omitted that
   failed diagnostic from the outcome predicate.

The deterministic Task 4 artifact is retained as an audit record at
`.superpowers/sdd/2026-09-02-beginner-sparse-lh-promotion-evidence-repair/final-evaluation.json`
(SHA-256 `d8f0804c2f60e6800ea7c69a8315f907179f056bd0fad00920913b6813b7b690`).
Its provisional CASE A is not a release decision after the review. The review
is recorded at
`.superpowers/sdd/2026-09-02-beginner-sparse-lh-promotion-evidence-repair/task-5-review.md`.

## Real fixtures and controls

The three trusted source hashes were present and the inherited report showed
candidate mechanical gates, RH parity, active-window recovery, and exact
non-Beginner digest rows for Classical, Cover, and Pop. Those values are
useful historical diagnostics, but are not accepted as fresh promotion
evidence because of the wiring gaps above. No real-fixture regression is
claimed, and no audio or recognizability claim is made.

The old candidate evidence reported Classical/Cover/Pop active-window
recovery of `0/0`, `11/0` (11 recovered), and `28/0` (28 recovered), with
candidate Beginner max sounding simultaneity 2 and exact RH digests. These
remain unpromoted diagnostic values only.

## Verification

- Full workspace tests under Node `v22.22.3`: **1,498 passed** — web 85,
  catalog 947, engrave 8, midi 324, player-core 92, transcribe 42.
- All six workspace typechecks: passed.
- `git diff --check`: passed before this results-only edit.
- The focused control test passed at freeze; current MIDI package suite:
  324 tests passed.
- Control byte/hash repeatability: passed.
- Old preregistration immutability, fresh preregistration hash, control hash,
  and local/remote SHA parity: passed at the frozen checkpoint.
- Disk free space: 54 GiB, above the 30 GiB floor.

The first Node 20 workspace run was invalidated by the local native
`better-sqlite3` ABI; the authoritative workspace run used the installed
Node 22 runtime matching that addon.

## Deferred concerns and next task

`COVER_RH_IDENTITY_CLIFF` and `DIFFICULTY_DIFFERENTIATION_CONCERN` remain
deferred. Human recognizability, pedagogy, audio quality, and production
behavior remain unverified.

The one follow-up task is: **run a newly preregistered, current-fixture
promotion evaluation whose candidate/ladder validation is independent, whose
control genuinely contains LH filler, and whose max-similarity gates match the
declared scope; then request a fresh promotion decision.** No part of that
follow-up is implemented here.
