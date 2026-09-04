# Authoritative symbolic playability-gate audit — 2026-09-04

## Scope and boundary

This is a report-only audit of the first failing real product lane. It measures
the existing validator's exact attack semantics, adds hand-aware diagnostics,
and runs the same checks over non-benchmark controls. It does not change
`PLAYABILITY_LIMITS`, arrangement policy, difficulty selection, alignment, or
published data. Human listening is `NOT_REQUESTED` /
`NOT_REQUIRED_BY_DEFAULT`; musical quality remains
`MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`.

The private Lane A MIDI was read in place and is not copied into the
repository. The path-free machine report is
`authoritative-symbolic-playability-gate-audit-2026-09-04.json`.

## Git and reproducibility

| Item | Value |
|---|---|
| Starting revision | `bd94008dded51d87b640b322f7afeff69433bb2f` |
| Implementation checkpoint | `b96e05ce9f13ccb20eaac601af609e36be11d29a` |
| Branch | `codex/metal-inference-lane-lock` |
| Remote parity at checkpoint | exact |
| Report canonical SHA (excludes determinism field) | `6f476b233008f9491785d7520073fa29255b06e9191aa6bd02ed32da0992700c` |
| Report bytes SHA | `a1234db2c9e700fe9fbe44eb9eb4641972f692a2f321622f3e19e6fc3e686238` |
| Deterministic rerun | byte-identical; repeat bytes SHA `a1234db2c9e700fe9fbe44eb9eb4641972f692a2f321622f3e19e6fc3e686238` |

## Existing validator contract

The validator groups note starts to three decimal places, counts one chord
onset as one attack, computes the median gap between distinct starts, converts
beats to seconds using the variant tempo, and separately checks maximum
simultaneous/sounding notes and attacks per second. The historical sequence is:

| Revision | Established behavior |
|---|---|
| `f5a9551` (2026-08-11) | fail-closed playability gate and nested level ladder; flattened multitrack density was the motivating failure |
| `8fd3fad` (2026-08-11) | added seconds-based IOI floor and calibration drift check |
| `e183eba` (2026-08-14) | hardened import/artifact paths; calibrator later aligned to distinct starts and sorted median gaps |
| `b983687` (2026-09-02) | added reproducible learner-ladder calibration report/fixtures |

Current limits are:

| Level | Max simultaneous/sounding | Max attacks/s | Median IOI floor |
|---|---:|---:|---:|
| Very Beginner | 2 | 5 | 0.15 s |
| Beginner | 2 | 6 | 0.08 s |
| Very Easy | 5 | 12 | 0.08 s |
| Easy | 5 | 12 | 0.08 s |
| Medium | 12 | 16 | 0.08 s |
| Advanced | 13 | 18 | 0.08 s |

The intended meaning of `minMedianIoi` is a conservative whole-instrument
distinct-attack floor. Chord duplication is already excluded by onset grouping;
the audit therefore treats hand-specific and short-window measurements as
diagnostics, not as a silent replacement for the production gate.

## Lane A transformation funnel

Frozen source: `lane-a-native-performance`, `GENERATION_CANDIDATE`,
`USER_SUPPLIED_PRIVATE`, 7,266 notes, 358.46875 beats, 120 BPM, 4/4. The
source has no hand labels, so source/owned diagnostics classify all events as
right-hand for measurement and mark `handLabelsAvailable: false`. Canonical and
learner stages have the arrangement's explicit R/L labels.

| Stage | Notes | Unique attacks | Global median IOI | RH median | LH median | Avg attacks/s | MaxSim |
|---|---:|---:|---:|---:|---:|---:|---:|
| Source | 7,266 | 5,180 | 0.023 s | 0.023 s | — | 28.900706 | 6 |
| Owned | 7,266 | 5,180 | 0.023 s | 0.023 s | — | 28.900706 | 6 |
| Canonical | 3,843 | 2,653 | 0.0585 s | 0.104 s | 0.1045 s | 14.801848 | 3 |
| Advanced | 3,560 | 1,911 | 0.0625 s | 0.125 s | 0.125 s | 10.661088 | 4 |
| Medium | 3,066 | 1,715 | 0.0625 s | 0.125 s | 0.125 s | 9.567643 | 4 |
| Easy | 2,843 | 1,666 | 0.0625 s | 0.125 s | 0.125 s | 9.294282 | 3 |
| Very Easy | 2,560 | 1,553 | 0.125 s | 0.125 s | 0.125 s | 8.663877 | 3 |
| Beginner | 807 | 775 | 0.1775 s | 0.2005 s | 2.000 s | 4.323570 | 2 |
| Very Beginner | 409 | 409 | 0.375 s | 0.375 s | — | 2.281729 | 1 |

The source-to-canonical reduction is real (7,266 to 3,843 notes and 5,180 to
2,653 attacks), but the learner stages retain a 0.0625-second global median at
Advanced/Medium/Easy. All three failing stages pass their density and
simultaneous/sounding limits. Their RH and LH medians are both 0.125 seconds,
above the 0.08-second floor. This separates a whole-instrument coordination
signal from a single-hand refractory failure; it does not prove that global
coordination is physically harmless.

The exact failures are:

```text
advanced: median inter-onset 0.063s below floor 0.08s
medium: median inter-onset 0.063s below floor 0.08s
easy: median inter-onset 0.063s below floor 0.08s
```

## Rapid-region attribution

At the failing levels, the fraction of global IOI gaps below 0.08 seconds is
Advanced `0.654450`, Medium `0.539090`, and Easy `0.516517`. The longest rapid
runs are 21, 14, and 14 gaps respectively, with longest localized regions of
1.3125, 0.875, and 0.875 seconds. The worst reported Advanced region is
40.625–43.25 beats (16 RH / 12 LH attacks); the worst Medium/Easy region is
33.75–35.5 beats (6 RH / 9 LH attacks).

The source MIDI has no role or hand labels, so no trustworthy source-role
attribution exists before arrangement. After canonical arrangement, the rapid
events are distributed across both hands rather than being a hidden chord-size
artifact. The first responsible transform is therefore the retained canonical
attack stream; learner WIS/rate reduction lowers average density and
simultaneity but does not normalize the remaining rapid attack pattern.

## Trusted controls

These are existing non-benchmark symbolic fixtures, measured through the same
learner builder. Every reported physical level passes the current validator.

| Control | Level | Notes | Global median | RH median | LH median | Avg attacks/s | MaxSim |
|---|---|---:|---:|---:|---:|---:|---:|
| Clair de Lune | Easy | 962 | 0.25 s | 0.50 s | 0.25 s | 2.213953 | 3 |
| Clair de Lune | Medium | 1,283 | 0.25 s | 0.50 s | 0.25 s | 2.213953 | 6 |
| Clair de Lune | Advanced | 1,309 | 0.25 s | 0.50 s | 0.25 s | 2.217054 | 8 |
| River Flows in You | Easy | 1,225 | 0.208333 s | 0.208333 s | 0.416667 s | 3.918281 | 3 |
| River Flows in You | Medium | 1,371 | 0.208333 s | 0.208333 s | 0.416667 s | 3.918281 | 5 |
| River Flows in You | Advanced | 1,400 | 0.208333 s | 0.208333 s | 0.416667 s | 3.990605 | 5 |
| Hello | Easy | 847 | 0.379747 s | 0.379747 s | 0.759494 s | 1.887633 | 3 |
| Hello | Medium | 1,011 | 0.379747 s | 0.379747 s | 0.759494 s | 1.887633 | 5 |
| Hello | Advanced | 1,016 | 0.379747 s | 0.379747 s | 0.759494 s | 1.887633 | 6 |
| Synthetic full-band | Easy | 8 | 1.0 s | 1.0 s | 1.0 s | 1 | 2 |
| Synthetic full-band | Medium | 16 | 1.0 s | 1.0 s | 1.0 s | 1 | 4 |
| Synthetic full-band | Advanced | 18 | 1.0 s | 1.0 s | 1.0 s | 1 | 5 |

This is a calibration/control result, not a recognizability claim.

## Seven synthetic causal controls

All controls are evaluated at 120 BPM. They deliberately isolate the
mechanisms the global gate can and cannot distinguish.

| Control | Mechanism | Global/RH/LH median | Avg attacks/s | Easy result | Diagnostic interpretation |
|---|---|---|---:|---|---|
| A chord-heavy | slow attacks with four-note chords | 0.5 / 0.5 / — s | 2.56 | pass | chord grouping works |
| B rapid monophonic | one-hand rapid line | 0.0625 / 0.0625 / — s | 16 | fail | genuine same-hand rapid stream |
| C alternating hands | RH/LH alternating every 0.125 beat | 0.0625 / 0.125 / 0.125 s | 16 | fail | global alternation is faster than either hand |
| D dense arpeggio | one-hand rapid moving arpeggio | 0.0625 / 0.0625 / — s | 15.705521 | fail | genuine one-hand density |
| E fast melody + sparse LH | fast RH with sparse bass | 0.0625 / 0.0625 / 2.0 s | 2.814815 | fail | RH remains the limiting effector |
| F sparse melody + dense LH | sparse RH with localized LH burst | 0.0625 / 4.0 / 0.0625 s | 0.848485 | fail | localized LH burst is visible despite low average density |
| G repeated articulation | same-pitch rapid rearticulation | 0.0625 / 0.0625 / — s | 16.368286 | fail | repeated attacks are not hidden by pitch repetition |

Controls C and F demonstrate why hand-aware values are useful diagnostics. They
do not, by themselves, invalidate a conservative global coordination gate.

## Metric interaction and tempo sensitivity

For Lane A failing Advanced/Medium/Easy levels, `maxDensity` passes and
`medianIoi` fails; maximum simultaneity also passes. The failure is therefore
not a duplicate-chord count or average attack-density failure. A legal
0.125-beat pattern has a 0.125-second gap at 60 BPM, 0.083333 seconds at 90 BPM,
and 0.0625 seconds at 120 BPM. The frozen rapid control consequently passes at
60/90 BPM and fails the IOI floor at 120/150/180 BPM; its average density also
fails at 120 BPM and above.

| Tempo | Median IOI | Attacks/s | Easy | Medium |
|---:|---:|---:|---|---|
| 60 | 0.125 s | 8 | pass | pass |
| 90 | 0.083333 s | 12 | pass | pass |
| 120 | 0.0625 s | 16 | fail (density + IOI) | fail (IOI) |
| 150 | 0.05 s | 20 | fail (density + IOI) | fail (density + IOI) |
| 180 | 0.041667 s | 24 | fail (density + IOI) | fail (density + IOI) |

## Primary diagnosis

`AUTHORITATIVE_SOURCE_DENSITY_REQUIRES_TRANSFORM`

The validator's whole-instrument attack stream is a deliberate, calibrated
metric and already handles simultaneous chord members correctly. Hand-aware
diagnostics show that Lane A's failures are mostly alternating/coordination
density, not a single hand attacking every 63 ms. That is useful evidence for a
future scope review, but not a demonstrated validator defect: the global gate
is allowed to be conservative for a two-hand learner arrangement.

The stronger causal fact is that the authoritative source and canonical
arrangement still carry rapid attacks after the existing generic reductions.
The current learner transform lowers counts, average attacks/sec, and
simultaneity, but leaves the median global IOI at 0.0625 seconds. Existing
trusted controls remain comfortably inside the gate. This is a source-density
normalization gap, not permission to lower the 0.08-second floor.

## Implementation and Lane A rerun

The only behavior change is a reusable report-only diagnostic surface:

- `packages/midi/src/playability-audit.ts` measures exact validator-compatible
  attack groups plus RH/LH IOI, rapid regions, short-window attack rate,
  simultaneous/sounding counts, repeated-pitch attacks, hand alternation, and
  source-edge attribution when provenance exists.
- `packages/catalog/scripts/audit-playability.ts` runs the frozen Lane A,
  existing trusted controls, seven synthetic controls, and the five-tempo
  sensitivity matrix. It writes a stable path-free JSON report and resolves
  relative output paths from the repository root.

Lane-A-specific logic: `NONE`.

No new learner simplification was introduced, so the Lane A output is unchanged:

| Level | Validator result |
|---|---|
| Advanced | fail: median IOI 0.063 s |
| Medium | fail: median IOI 0.063 s |
| Easy | fail: median IOI 0.063 s |
| Very Easy | pass |
| Beginner | pass |
| Very Beginner | pass |

Artifacts and the five-level in-memory projection remain the prior rehearsal's
validated outputs; this audit did not persist or publish them.

## Musical parity and product decisions

Because the implementation is diagnostic-only:

```text
pitch additions: 0
pitch deletions: 0
timing changes: 0
role changes: 0
```

Timed-symbolic MVP: `TIMED_SYMBOLIC_MVP_CONDITIONAL`. Native authoritative
timed symbolic input is serviceable only when all generated variants pass the
existing playability gate. The Lane A source is not inside that envelope until
a generic density-normalization task exists. `REAL_SYMBOLIC_ALIGNMENT_PARTIAL`
remains unchanged; this audit did not conduct alignment research. The original
arbitrary-YouTube vision remains outside this capability envelope.

## Verification

| Gate | Result |
|---|---|
| Focused playability-audit tests | 6/6 |
| Full MIDI tests | 12 files / 342 tests |
| Full catalog tests | 109 files / 1,032 tests |
| Workspace tests | 1,605 tests (web89/catalog1,032/engrave8/midi342/player-core92/transcribe42) |
| Workspace typechecks | all six required packages pass |
| `git diff --check` | pass for final evidence commit |
| Deterministic audit rerun | byte-identical |
| Disk | 88 GiB free at audit start; above 30 GiB floor |
| Deployment / production replay | `NOT_DEPLOYED` / not run |
| Human listening | `NOT_REQUESTED` / `NOT_REQUIRED_BY_DEFAULT` |

## Exactly one next task

`AUTHORITATIVE_SYMBOLIC_DENSITY_NORMALIZATION`

This is the next task because the measured first blocker is retained rapid
source density after the existing generic learner transform. It must be a
separate, source-agnostic experiment with frozen controls; do not lower the
validator floor or tune against Lane A alone.
