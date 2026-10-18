# Cover RH identity-cliff attribution

Revision under test: `b4cf1ce1690b6a7455bd8fd488cf77734abc47d8` on
`codex/metal-inference-lane-lock`. This is a symbolic, diagnostic-only run.
No generation rule, public ladder, sparse-LH policy, media input, reference
MIDI, audio render, or production state was changed.

## Decision

`COVER_RH_IDENTITY_CLIFF_CONSTRAINT_BOUND`

The Cover RH loss is real at the attack/contour level, but the current
Beginner physical envelope has no safe additional RH onset capacity. The
evidence does not meet the generic-selector-defect implementation gate, so the
behavior decision is `NO_MUSICAL_BEHAVIOR_CHANGE`.

## Fresh reproduction

The same learner builder was run for the three current project-owned symbolic
fixtures. RH means `hand !== "L"`; onset groups use the learner's `0.08` beat
tolerance.

| Fixture | Very Easy RH | Beginner RH | VE→B event survival | VE→B onset survival | Decision |
|---|---:|---:|---:|---:|---|
| Classical | 435 | 435 | 1.000 | 1.000 | metric cliff not musical |
| Cover | 779 | 381 | 0.489 | 0.489 | identity cliff, constraint-bound |
| Pop | 375 | 375 | 1.000 | 1.000 | metric cliff not musical |

Source hashes (the fixture bytes, not personal paths): Classical
`e7e0fd260e049e338120cc4ee35c1a998ef616c01529a4c1a79837d6bb914039`, Cover
`eb8a1cf8f0076a548acaa206b67d19123814e1167d654496afa24c0458dc6f9d`, Pop
`87915f6b8dce035951af2ddc89c9c36ce105fde8e79ba6f936e31b7f80ef7fd6`.

## Exact RH funnel

The trace reuses the existing learner ancestry keys and records the following
actual stages (RH counts are shown where a stage also contains LH material):

| Stage | Classical | Cover | Pop |
|---|---:|---:|---:|
| `very-easy-rh-input` | 435 | 786 | 375 |
| `very-easy-playable` RH selected | 435 | 779 | 375 |
| `beginner-rh-input` | 435 | 779 | 375 |
| `beginner-rh-selected` | 435 | 779 | 375 |
| `beginner-playable` | 435 | 779 | 375 |
| `beginner-ladder` selected | 435 | 381 | 375 |
| `beginner-ladder` rejected | 0 | 398 | 0 |
| `beginner-final` RH selected | 435 | 381 | 375 |

All 398 Cover losses have first loss at
`beginner-ladder`, with selection reason
`beginner-ladder-preservation-rejected`. The prior RH input, principal
selection, and playability stages retain all 779 Cover RH events. The strict
Beginner ladder tolerance is the binding responsibility, not voice selection,
onset grouping, or a duration cleanup pass.

Per-event Cover fate is: 367 `RETAINED_1_TO_1`, 14 `DURATION_CHANGED`, and 398
`REJECTED`; no current VE RH event was classified as merged, pitch-changed, or
timing-changed. The full per-event trace is emitted only by the opt-in CLI and
is not part of public MIDI/IR.

## Cover structure entering the binding edge

| Metric | Advanced RH source | Very Easy RH | Beginner RH |
|---|---:|---:|---:|
| events / onset groups | 954 / 804 | 779 / 779 | 381 / 381 |
| multi-event onset rate | 0.163 | 0 | 0 |
| same-pitch reattack rate | 0.055 | 0.093 | 0.118 |
| median IOI (beats) | 0.5 | 0.5 | 1.0 |
| p90 IOI (beats) | 1.125 | 1.125 | 3.25 |
| quarter-grid alignment | 0.475 | 0.489 | 1.000 |
| phrase count | 25 | 27 | 100 |
| contour turns | 439 | 382 | 173 |

The Cover source has more inner/onset texture than the generated RH, but the
Cover-specific loss is not harmless stack collapse: onset positions and
representative pitch classes survive at only 0.489, turn/extrema survival is
0.236, and repeated-attack survival is 0.625. Phrase boundary anchors remain
fully represented (1.000), so the loss is concentrated in interior/off-grid
attacks rather than all phrase starts/ends.

Controls show the same one-voice generated representation (zero generated
multi-event onset groups), but do not lose their VE RH onset positions at the
Beginner edge. This is why the result is a Cover encoding/contract outlier,
not evidence that the generic selector is universally broken.

## Playability binding and oracle

The structural-significance classifier marks 320 of the 398 rejected Cover
events as phrase-boundary, contour-extremum, repeated, high-velocity, or
long-duration candidates. A current-budget RH oracle attempted only equal/lower
complexity replacements; it may not add LH, increase simultaneity, increase
attack density, change the grid, or change the current hand span.

| Fixture | Beginner baseline RH | Oracle upper-bound RH | Recoverable events | Constraint-bound events |
|---|---:|---:|---:|---:|
| Classical | 435 | 435 | 0 | 0 |
| Cover | 381 | 381 | 0 | 320 |
| Pop | 375 | 375 | 0 | 0 |

Cover is already at the Beginner two-sounding-note ceiling. The oracle's
complexity delta is zero for notes, onsets, attack rate, maximum simultaneity,
and RH span, but it cannot recover a missing VE onset without violating the
current quarter-grid/ladder envelope. This rules out CASE A: there is no
meaningful within-contract RH onset recovery for a generic correction.

## One causal counterfactual

The only bypass tested was the diagnosed stage: use the selected Beginner RH
set immediately before `beginner-ladder` while retaining current Beginner LH.
For Cover this produces 779 RH notes instead of 381 (+398 notes, +398 onsets,
+1.465 attacks/sec) and reaches max simultaneity 3. It fails the Beginner
max-simultaneity 2 and RH budget constraints (399 validator messages, including
the expected missing-ladder memberships). Classical and Pop have no extra RH
events at this stage, so the bypass changes neither control.

This is a diagnostic counterfactual only; it is not a production option.

## Public Beginner → Easy separation

Cover Easy is 786 RH / 439 LH (1,225 total) versus Beginner 381 RH / 129 LH
(510 total). The current delta is +715 notes, +452 onsets, +1.915 attacks/sec,
and +2 maximum simultaneity. The public ladder remains materially separated;
Very Easy remains a six-level physical implementation detail and is not
reopened as a public level.

## Reproduction and verification

The durable evaluator is
`packages/catalog/src/cover-rh-cliff.ts`; its path-free CLI is
`packages/catalog/scripts/evaluate-cover-rh-cliff.ts`:

```text
npm run evaluate:cover-rh-cliff -- --revision=b4cf1ce1690b6a7455bd8fd488cf77734abc47d8 --out=<ignored-output>.json
```

The fresh full JSON report was rerun byte-identically. Its SHA-256 is
`c12a7e782dfdfb1a9e9332995ebb017ba3a0adc1dacab7142c28e01d263628df`.
The compact checked-in headline snapshot is
`2026-09-03-cover-rh-identity-cliff-attribution-report.json`.

Trace instrumentation was verified not to change the six physical variant
event digests. Focused diagnostic tests passed (catalog 2, MIDI 327); the full
workspace passed 1,517 tests (web 89, catalog 959, engrave 8, MIDI 327,
player-core 92, transcribe 42), all six workspace typechecks passed, and
`git diff --check` passed. The starting local and remote topic SHA were both
`b4cf1ce1690b6a7455bd8fd488cf77734abc47d8`; the implementation commit is
recorded in the final Git closeout outside this report.

## Follow-up

The next product decision is whether Beginner should intentionally permit a
generic off-grid interior RH attack budget for this class of broken-figure
source, or keep the current simpler principal-melody contract. That decision
should be made before any selector or ladder change; no implementation is
included here.
