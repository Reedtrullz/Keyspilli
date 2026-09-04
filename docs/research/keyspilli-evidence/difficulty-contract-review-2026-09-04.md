# Difficulty contract review — 2026-09-04

This is a report-only audit at `4d30f85e7212265604cefefef0d0d844c4a59e16`.
It does not change generation, playability limits, density policy, artifacts,
catalog rows, deployment, or human-listening status.

## Finding

The current product has two intentional surfaces:

- physical artifacts: `Very Beginner → Beginner → Very Easy → Easy → Medium → Advanced`;
- normal public ladder: `Very Beginner → Beginner → Easy → Medium → Advanced`.

Repository history shows that the six-level physical order was retained when
the public surface rolled up to five levels. It does not show that hidden
Very Easy remains a required learner-facing ordering edge. Legacy access needs
the physical `very-easy` identity and individually valid artifacts, not a new
Easy artifact that is larger than it.

The earlier calibration already found that VE→Easy was redundant for
Classical and Pop, and non-monotonic for Cover: Cover Easy had more notes but
fewer attacks (and therefore a faster easier-direction attack rate).

## Contract result

The report-only diagnostic in
`packages/catalog/src/difficulty-contract-audit.ts` reuses the existing
variant validator for individual validity and checks public edges for note
count, RH ancestry, and difficulty-score ordering. It intentionally does not
add an onset-count gate.

| Evidence | Six physical | Public five + independent VE |
| --- | ---: | ---: |
| Clair de lune | pass | pass |
| River Flows in You | pass | pass |
| Hello | pass | pass |
| Lane A baseline | fail (Easy/Medium/Advanced IOI) | fail (same individual IOI) |
| Frozen Candidate A | fail (VE→Easy note count) | pass |

The small synthetic full-band fixture is diagnostic-only and remains below
the validator’s eight-note minimum for Very Beginner/Beginner; it is not used
to overturn the contract result.

Candidate A remains diagnostic-only. Its unchanged output is 2,130/2,269/2,846
notes for Easy/Medium/Advanced versus 2,560 for Very Easy; it preserves the
public RH edges and independent VE validity, but is not promoted here.

## Decision

`PUBLIC_FIVE_LEVEL_CONTRACT_VALIDATED`

This is a contract decision, not a production validator change. The timed
symbolic consequence is
`TIMED_SYMBOLIC_MVP_READY_FOR_NORMALIZATION_REEVALUATION`. The real shadow
path remains `REAL_SHADOW_BLOCKED_AT_DIFFICULTIES`; real alignment remains
`REAL_SYMBOLIC_ALIGNMENT_PARTIAL`.

No benchmark references, audio, alignment tuning, or listening were used.
Human listening is `NOT_REQUESTED` / `NOT_REQUIRED_BY_DEFAULT` and deployment
is `NOT_DEPLOYED`.

Machine report: [difficulty-contract-review-2026-09-04.json](./difficulty-contract-review-2026-09-04.json)

Canonical report SHA256: `3e18f4c8369e8ad9e91f5bc741ced07baf38eff7fd9743a25df4310b71be2f70`.

Next single task: `IMPLEMENT_PUBLIC_FIVE_LEVEL_DIFFICULTY_CONTRACT`.
