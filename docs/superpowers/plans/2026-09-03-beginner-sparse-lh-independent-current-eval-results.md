# Independent current-fixture Beginner sparse-LH evaluation results

## Decision

```text
BEGINNER_SPARSE_TWO_HAND_CURRENT_EVIDENCE_VALIDATED
PROMOTE_EXACT_FROZEN_POLICY
```

The freshly generated current-fixture evaluation passed every declared gate.
The exact policy is now implemented for generic learner `Beginner` only;
Very Beginner, Very Easy, Easy, Medium, Advanced, and the metal profile are
unchanged. The frozen candidate fingerprint remains
`73be10c67756be84694e2ea56b3fae763e997cebb0b38ba2cc83de8c83e18682`.

## Freeze and implementation

- Evaluation starting revision: `fab5fe43aba4bd0b811fa066acd559db900f12d1`.
- Preregistration correction checkpoint: `09b670a`.
- Initial promotion commit: `1298037` (`feat(midi): promote sparse LH anchors to learner Beginner`).
- Final evidence checkpoint: `376106d` (role-safe eligibility, meter/tie-break
  parity, production-mode report, and results note; code/evaluator checkpoint
  `599ca06` and the preceding docs checkpoint `06a472e` contain the evidence).
- Branch and origin match the final evidence checkpoint.
- Production policy: keep finalized Beginner RH byte-for-byte; add at most one
  existing structural LH onset per meter window from finalized Very Easy
  evidence; defer to a later legal onset on a sounding collision; reject
  vocals, residual/unsafe, filler/decorative, and drum-tagged evidence.
- No `bassPattern` metadata change; no metal-path change.

## Fresh evaluator evidence

The two pre-promotion evaluator runs were byte-identical:

- Report: `independent-current-20260903-015231-1/2.json`.
- SHA-256: `58d1dd9f629b713fe4742a97e5e93f496ee513b76e8d4e8594ebf3f3048c2fa4`.
- All ten declared gates: `PASS`.

Fresh real-fixture candidate deltas (Beginner RH is unchanged):

| Fixture | Beginner RH | Added LH | Candidate total |
| --- | ---: | ---: | ---: |
| Classical | 435 | 72 | 507 |
| Cover | 381 | 129 | 510 |
| Pop | 375 | 95 | 470 |
| V2 synthetic control | 8 | 6 | 14 |

The V2 control independently observed filler suppression, true-rest silence,
LH-only passages, one-RH allowance, collision defer/suppression, drum
provenance rejection, and harmonic change. Its post-promotion rerun was also
byte-identical across two runs (SHA-256
`223daf924900dbe64f787a0a87ddd8b628d6584540d0c4748cda3d3be5ff8bbb`), using
the evaluator's explicit `--production` mode, with
the production output and frozen test-local policy agreeing on the role-safe
synthetic Beginner event set.

## Verification

- Full workspace tests: **1,504 passed** (web 85, catalog 952, engrave 8,
  midi 325, player-core 92, transcribe 42).
- All workspace typechecks: passed.
- MIDI focused test: 105 passed; full MIDI package: 325 passed.
- `git diff --check`: passed.
- Local/remote promotion SHA parity: verified after push.
- Existing untracked `.tmp-source-audit/` and `pnpm-lock.yaml` were not staged.

## Boundaries and deferred work

This is a structural learner-policy promotion, not a recognizability claim.
No reference MIDI, reference audio, human listening, production replay, or
deployment was used. `COVER_RH_IDENTITY_CLIFF` and
`DIFFICULTY_DIFFERENTIATION_CONCERN` remain deferred for a separately
preregistered review.
