# Authoritative symbolic density normalization — 2026-09-04

## Scope and decision

This is a deterministic, report-only experiment on the frozen real Lane A
authoritative symbolic source. It does not change `PLAYABILITY_LIMITS`, the
0.08-second production IOI floor, retime events, create notes, alter alignment,
or write catalog/production data. Benchmark references were not used. Human
listening is `NOT_REQUESTED` / `NOT_REQUIRED_BY_DEFAULT`.

Primary decision:

```text
NO_GENERIC_DENSITY_TRANSFORM_JUSTIFIED
```

The diagnostics identify a deletion-only possibility, but no independent
policy clears the unchanged validator, anti-gaming rapid-region checks, and
the existing difficulty ladder simultaneously. Product behavior remains
unchanged.

## Git and reproducibility

| Item | Value |
|---|---|
| Starting revision | `5a5e25fd3b8b2727af8e3da3887ccfa3662f519c` |
| Diagnostic checkpoint | `a68fd1e0caa837ed4de868d4be31483c19b75c0c` |
| Branch | `codex/metal-inference-lane-lock` |
| Remote parity | exact at checkpoint |
| Report canonical SHA | `f1432f35a7ce5433c1f8cb0ea4905939811e44376bcba2bf5fee436fbc55c330` |
| Report bytes SHA | `bdf7ae7f4f108d424ea24e092edd84b8dce9fa0fd116488ff066ca64bdd7c94a` |
| Deterministic rerun | byte-identical |

The source remains private and is represented by its SHA, logical fixture id,
parser metadata, and aggregate metrics only.

## Frozen Lane A baseline

The source is a user-supplied private native MIDI performance with 7,266 notes,
5,180 attacks, 358.46875 beats, 120 BPM, and no hand labels. The existing
direct-piano arrangement produces 3,843 canonical notes / 2,653 attacks.

| Level | Notes | Attacks | Global median | RH median | LH median | Rapid fraction | Longest run | Attacks/s | MaxSim | Validator |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Very Beginner | 409 | 409 | 0.375 s | 0.375 s | — | 0 | 0 | 2.281928 | 1 | pass |
| Beginner | 807 | 775 | 0.1775 s | 0.2005 s | 2.0 s | 0.033592 | 2 | 4.323947 | 2 | pass |
| Very Easy | 2,560 | 1,553 | 0.125 s | 0.125 s | 0.125 s | 0.399485 | 11 | 8.664633 | 3 | pass |
| Easy | 2,843 | 1,666 | 0.0625 s | 0.125 s | 0.125 s | 0.516517 | 14 | 9.295092 | 3 | fail: median IOI only |
| Medium | 3,066 | 1,715 | 0.0625 s | 0.125 s | 0.125 s | 0.539090 | 14 | 9.568477 | 4 | fail: median IOI only |
| Advanced | 3,560 | 1,911 | 0.0625 s | 0.125 s | 0.125 s | 0.654450 | 21 | 10.662017 | 4 | fail: median IOI only |

Density and simultaneity pass at every failing level. The unresolved signal is
whole-instrument rapid coordination after the existing reductions.

## Easy → Very Easy attack differential

The exact validator attack grouping is three-decimal start grouping; chord
members remain one attack. Easy has 1,666 attacks and Very Easy has 1,553.
There are 346 Easy-only attack starts (536 notes), 233 Very-Easy-only starts
(342 notes), and 318 Easy-only removals directly bridge at least one sub-floor
gap. Every Easy-only attack is classified by hand, semantic priority, and the
existing structural flags in the machine report:

| Classification | Count |
|---|---:|
| LH-only | 339 |
| RH-only | 5 |
| Both hands | 2 |
| P0 melody/anchor | 7 |
| P1 structure | 38 |
| P2 support | 301 |
| harmonic-change flag | 38 |
| large-leap endpoint flag | 2 |
| repeated-articulation flag | 1 |

The lineaged classification covers all 346 Easy-only starts. It is a
diagnostic attribution, not a claim that the existing Very Easy selection is a
safe normalization oracle.

## Candidate comparison

Candidate A is a single generic local pass: preserve all RH principal-melody
and phrase-boundary attacks plus P1 contour/leap/rearticulation/harmonic
events; in a rapid pair remove only a P2 support attack, with deterministic
priority, note-count, velocity, start, and index tie-breaks. It is explicitly
not wired into `buildVariants`.

| Candidate | Easy / Medium / Advanced local validator | Removed attacks (E/M/A) | Rapid fraction after (E/M/A) | Longest run after (E/M/A) | Ladder | Decision |
|---|---|---:|---:|---:|---|---|
| A protected-semantic local pass | pass / pass / pass | 471 / 480 / 421 | 0.161642 / 0.182334 / 0.394896 | 3 / 3 / 6 | fail: Very Easy has 2,560 notes but Easy 2,130 | not promoted |
| causal every-other | pass / pass / fail | 259 / 265 / 228 | 0.344239 / 0.362319 / 0.519620 | 6 / 12 / 12 | diagnostic only | not promoted |
| causal prefer-RH | pass / pass / pass | 511 / 517 / 468 | 0.124783 / 0.145363 / 0.354369 | 2 / 2 / 6 | role-destructive diagnostic | not promoted |
| causal prefer-LH | pass / pass / pass | 404 / 436 / 523 | 0.236320 / 0.246479 / 0.343187 | 4 / 4 / 7 | role-destructive diagnostic | not promoted |

The every-other baseline leaves Advanced failing. RH/LH preference passes by
discarding hundreds of attacks and is not a semantic policy. Candidate A does
preserve the measured P0/P1 set and improves bursts, but its one pass removes
too much support to retain the physical ladder.

## Bounded deletion oracle

The report also contains a deterministic greedy upper bound, not a production
algorithm. It removes only P2 attacks with the greatest rapid-neighbor count,
then stable semantic/start/index tie-breaks, and never drops below the
unchanged next-easier note count:

| Level | Lower-level note floor | Removed attacks | Result notes | Median | Rapid fraction | Final validator | Exhausted |
|---|---:|---:|---:|---:|---:|---|---|
| Easy | 2,560 | 21 | 2,822 | 0.09375 s | 0.500000 | pass | no |
| Medium | 2,843 | 48 | 3,018 | 0.125 s | 0.499400 | pass | no |
| Advanced | 3,066 | 204 | 3,245 | 0.09375 s | 0.500000 | pass | no |

This is the anti-gaming boundary: the median passes, but about half of all
gaps remain below 0.08 seconds and the longest rapid region remains 0.8125 s.
The oracle is therefore not evidence for promotion; it is a bounded lower
bound on how weak a median-only intervention could be.

## Synthetic controls and invariants

The protected pass is a no-op for already-valid slow chord attacks. It also
fails closed on a fast one-hand melody, dense arpeggio, fast melody with sparse
LH, sparse melody with a dense LH burst, and repeated articulation rather than
deleting their principal RH stream. It clears the alternating-hands control
only by removing removable support attacks. These behaviors are covered by
the focused tests and the machine report.

For every candidate path:

```text
retained events retimed: 0
new events created: 0
protected melody/anchor deletions: 0
trusted controls changed: 0
Very Easy / Beginner / Very Beginner changed: 0
```

The candidate artifact is not generated or published. The unchanged validator
and artifact path remain the authority; no production transform was promoted.

## Decisions and remaining boundary

```text
density normalization: NO_GENERIC_DENSITY_TRANSFORM_JUSTIFIED
timed-symbolic MVP: TIMED_SYMBOLIC_MVP_CONDITIONAL
real symbolic alignment: REAL_SYMBOLIC_ALIGNMENT_PARTIAL
real shadow path: REAL_SHADOW_BLOCKED_AT_DIFFICULTIES
musical quality: MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED
deployment: NOT_DEPLOYED
human listening: NOT_REQUESTED / NOT_REQUIRED_BY_DEFAULT
```

The source-density blocker remains separate from alignment and from the
already-promoted generic Beginner off-grid Candidate A. The next task is
`LEVEL_CONTRACT_REVIEW_FOR_AUTHORITATIVE_DENSITY`; it is not implemented here.

## Verification

| Gate | Result |
|---|---|
| Focused density/playability tests | pass (11 tests in `playability-audit.test.ts`) |
| Full MIDI tests | pass, 12 files / 347 tests |
| MIDI typecheck | pass |
| Catalog typecheck | pass |
| Deterministic report rerun | byte-identical |
| `git diff --check` | pass at checkpoint |
| Disk | ~89 GiB free at start; above 30 GiB floor |
| Deployment / production replay | not run |
| Human listening | not requested / not required by default |
