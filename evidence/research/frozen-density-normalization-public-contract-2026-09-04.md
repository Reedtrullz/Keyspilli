# Frozen Candidate A under the public five-level contract — 2026-09-04

## Decision

`FROZEN_DENSITY_NORMALIZATION_VALIDATED`

The exact frozen Candidate A pass now clears the production five-level learner
contract and all six individual physical validators. It is wired once, after
the existing learner ladder, for Easy, Medium, and Advanced only. Very Easy,
Beginner, and Very Beginner remain unchanged. The old Very Easy → Easy count
failure is retained as a diagnostic physical edge, but it is not a normative
edge in the public contract.

This is symbolic/structural evidence only:
`MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`.

## Reproduction and scope

| Item | Value |
|---|---|
| Starting revision | `ab654e12c14c9d6eb67e04862b30f6a16c539dbb` |
| Production checkpoint | `eb23129` |
| Frozen candidate revision | `a68fd1e0caa837ed4de868d4be31483c19b75c0c` |
| Function | `selectProtectedSemanticLocalThinning` |
| Frozen implementation SHA | `1f3fe6c33c77384c7bd1f8876a3c32e3400f5e2ea6c05f992fc51620571eef9f` |
| Candidate scope | learner profile; E/M/A after final ladder |
| Policy changes | none; validator, limits, scores, and public order unchanged |
| Report canonical SHA | `9a95a6e67827de2ee2c6472161451dd45f9aca3fd3f696fe2ab9de6a642bea0f` |
| Report bytes SHA | `f1c83004bf51d53054fbbe8a140423dfe1a6c0b634e24e282e886b350cf35060` |

Lane A is a private, user-supplied native MIDI performance: 58,204 bytes,
SHA-256 `ec5010896c00a0541b34b0843a20f455707ac647ae4a222aee71e2ad43e8017e`,
7,266 source notes, 358.46875 beats, 120 BPM, 4/4. The path and source bytes
remain local and are not committed.

## Lane A baseline versus Candidate A

Metrics use the existing production playability measurement and 0.08-second
rapid-IOI definition. Event hashes are sorted canonical
`[midi,start,duration,velocity,hand,identitySource]` hashes.

| Level | Baseline notes / attacks | Candidate notes / attacks | Removed attacks / notes | Median IOI (s) before → after | Rapid fraction before → after | Longest rapid run before → after | Validator |
|---|---:|---:|---:|---:|---:|---:|---|
| Very Beginner | 409 / 409 | 409 / 409 | 0 / 0 | .375 → .375 | 0 → 0 | 0 → 0 | pass |
| Beginner | 807 / 773 | 807 / 773 | 0 / 0 | .178 → .178 | .033592 → .033592 | 2 → 2 | pass |
| Very Easy | 2,560 / 1,553 | 2,560 / 1,553 | 0 / 0 | .125 → .125 | .399485 → .399485 | 11 → 11 | pass |
| Easy | 2,843 / 1,666 | 2,130 / 1,195 | 471 / 713 | .063 → .125 | .516517 → .161642 | 14 → 3 | pass |
| Medium | 3,066 / 1,715 | 2,269 / 1,235 | 480 / 797 | .063 → .125 | .539090 → .182334 | 14 → 3 | pass |
| Advanced | 3,560 / 1,911 | 2,846 / 1,490 | 421 / 714 | .063 → .125 | .654450 → .394896 | 21 → 6 | pass |

Candidate output hashes match the frozen historical Candidate A output exactly
for E/M/A. The unchanged physical hashes are exact for VB/B/VE. Candidate A
retimes zero retained events and creates zero events; it only removes P2
support attacks in rapid local pairs. The measured protected-event result is:

```text
P0 melody/anchors deleted: 0
P1 structural events deleted: 0
phrase anchors, contour extrema, leap endpoints, harmonic changes: 100% survival
withheld events resurrected: 0
```

## Public contract

The production public order is `Very Beginner → Beginner → Easy → Medium →
Advanced`. All individual validation and monotonicity errors are empty.

| Edge | Note counts | Difficulty scores | RH ancestry | Tolerance | Result |
|---|---:|---:|---:|---:|---|
| Very Beginner → Beginner | 409 → 807 | 1.0 → 1.4 | 1.000 | .26 beats | pass |
| Beginner → Easy | 807 → 2,130 | 1.4 → 2.6 | 1.000 | .02 beats | pass |
| Easy → Medium | 2,130 → 2,269 | 2.6 → 3.4 | 1.000 | .02 beats | pass |
| Medium → Advanced | 2,269 → 2,846 | 3.4 → 4.6 | 1.000 | .02 beats | pass |

Very Easy remains present, independently valid, artifact-compatible, and
legacy-accessible. Its 2,560-note → 2,130-note comparison with Easy is a
non-normative physical diagnostic only.

## Generalization controls

The trusted Classical (`Clair de lune`), Cover (`River Flows in You`), and Pop
(`Hello`) fixtures are exact no-ops at all six levels: before/after event hashes
are equal and changed-level lists are empty. The seven frozen causal controls
retain their prior behavior: slow chord-heavy is a no-op; fast one-hand melody
fails closed; alternating hands removes only eligible support; dense arpeggio,
fast melody with sparse LH, and repeated articulation retain protected
structure; sparse melody with dense LH removes eligible support only.

## Artifact and lane rehearsal

The current product path was exercised in scratch/in-memory as:

```text
private native MIDI → existing canonical arrangement → six physical variants
→ frozen Candidate A → production validation → MIDI/MusicXML roundtrip
→ five-level public projection
```

All six MIDI and MusicXML roundtrips returned zero errors. Repeated lane runs
and repeated artifact renders were byte-identical. No catalog rows, production
artifacts, benchmark inputs, or deployment state were changed. Player entry
links were not exercised because that requires a persisted catalog item.

## Explicit boundaries

- The old report-only `.08 beat` matching tolerance was not used for production
  ancestry; the production tolerances above were used.
- Candidate B/C, validator limits, public contract, arrangement policy, and
  benchmark references were not changed.
- Independent score/audio alignment remains `REAL_SYMBOLIC_ALIGNMENT_PARTIAL`.
- Human listening is `NOT_REQUESTED` / `NOT_REQUIRED_BY_DEFAULT`; no
  recognizability or playability claim is made.

## Verification

| Gate | Result |
|---|---|
| Focused Candidate A production regression | 12/12 |
| Full MIDI package | 13 files / 354 tests |
| Full catalog package | 110 files / 1,037 tests |
| Full workspace | 1,622 tests |
| Workspace typechecks | 6/6 |
| Deterministic Lane A and artifact reruns | byte-identical |
| `git diff --check` | pass |
| Disk at close | 87 GiB free; above 30 GiB floor |
| Deployment / production replay / catalog persistence | not run |

## Product state and next task

The timed-symbolic MVP is `TIMED_SYMBOLIC_MVP_READY` for native authoritative
timed symbolic input whose variants pass the unchanged production gates. The
strongest shadow state is `NATIVE_TIMED_SYMBOLIC_REAL_SHADOW_VALIDATED`; this
does not upgrade independent audio↔symbolic alignment, which remains partial.

Exactly one next task: `BOUNDED_MVP_PRODUCTIZATION_READINESS`.
