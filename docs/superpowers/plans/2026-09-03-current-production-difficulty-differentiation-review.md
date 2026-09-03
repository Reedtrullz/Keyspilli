# Current production difficulty differentiation review

Date: 2026-09-03
Mission: `CURRENT_PRODUCTION_DIFFICULTY_DIFFERENTIATION_REVIEW`
Decision: **B — `FIVE_LEVEL_LADDER_CANDIDATE`**
Behavior: **`NO_MUSICAL_BEHAVIOR_CHANGE`**

## Evidence freeze

The review started from branch `codex/metal-inference-lane-lock` at
`1cc49b71538a8b73a5be2af724c2db2b3cdb318b`. `origin/codex/metal-inference-lane-lock`
resolved to the same SHA after a fresh fetch. The only pre-existing untracked
items were `.tmp-source-audit/` and `pnpm-lock.yaml`; neither was staged.

Fresh generation used the current learner builder on three project-owned
fixtures and one small synthetic control:

| Fixture | Source notes / onsets | Tempo / meter | Duration (beats) | Source SHA-256 |
| --- | ---: | --- | ---: | --- |
| Classical | 1,309 / 715 | 60 BPM, 9/8 | 322.5 | `e7e0fd260e049e338120cc4ee35c1a998ef616c01529a4c1a79837d6bb914039` |
| Cover | 1,400 / 938 | 144 BPM, 4/4 | 564.125 | `eb8a1cf8f0076a548acaa206b67d19123814e1167d654496afa24c0458dc6f9d` |
| Pop | 1,016 / 555 | 79 BPM, 4/4 | 387.125 | `87915f6b8dce035951af2ddc89c9c36ce105fde8e79ba6f936e31b7f80ef7fd6` |
| Synthetic full-band | 20 / 4 | 120 BPM, 4/4 | 8 | `fba496e372f8962967b5e08903fa4883d6f4be1bde046f0eb3a06e1a1dcc8dc6` |

The reproducible machine-readable freeze is
[`2026-09-03-current-production-difficulty-differentiation-review.json`](./2026-09-03-current-production-difficulty-differentiation-review.json).
The report uses `0.08`-beat onset groups, contains no absolute paths, and was
generated twice byte-identically (SHA-256
`0115da9269ff54693a40c1b8b4f1cb9e4b34a2d4ed6298c6502e900af3e6cc1d`). The
existing ladder evaluator supplies identity, phrase, harmonic, lineage, and
monotonicity metrics; the review script adds hand coordination, event overlap,
cross-fixture spread, and conceptual model diagnostics.

No external/reference MIDI, benchmark material, audio, network acquisition, or
production replay was used. The earlier calibration document is historical
context only; none of its rows substitute for this fresh run.

The promoted sparse-LH policy remains closed as
`BEGINNER_SPARSE_TWO_HAND_CURRENT_EVIDENCE_VALIDATED`:
finalized Beginner RH is preserved, only collision-safe structural LH anchors
from existing Very Easy evidence may be added, maximum sounding simultaneity is
two, and there is no RH displacement, retiming, filler, decorative, unsafe, or
drum-derived LH material.

## Current level contracts

The contracts below are derived from `packages/midi/src/types.ts`,
`packages/midi/src/simplify.ts`, and `packages/midi/src/validate.ts`; they are
learner-facing summaries, not new configuration.

| Level | ID / score | Current hand and voice contract | Timing / complexity envelope | Learner purpose |
| --- | --- | --- | --- | --- |
| Very Beginner | `very-beginner` / 1.0 | RH principal melody; no generic LH | 0.5-beat melody grid; max simultaneity 2; roughly 5 attacks/s cap; 12-semitone hand span | Learn the principal tune with one hand. |
| Beginner | `beginner` / 1.4 | RH melody plus occasional collision-safe structural LH anchors; metal may use sparse half-measure anchors | 0.25-beat grid; max simultaneity 2; roughly 6 attacks/s cap; no decorative/filler LH | Add a small amount of two-hand coordination without moving the melody. |
| Very Easy | `very-easy` / 2.0 | RH melody with existing LH; two-voice harmonic texture | 0.25-beat melody grid; roughly 3 metal RH attacks/s; max simultaneity 5 | Play a continuous but simplified two-hand arrangement. |
| Easy | `easy` / 2.6 | One selected RH melody with two-note LH chord texture | 0.125-beat grid; roughly 4 metal RH attacks/s; max simultaneity 5 | Coordinate a fuller melody with stable two-note harmony. |
| Medium | `medium` / 3.4 | Up to three RH voices and up to three-note LH texture | 0.125-beat grid; denser passing texture; max simultaneity 12 | Control denser voicing and more simultaneous material. |
| Advanced | `advanced` / 4.6 | Up to four RH voices; imported LH retained without chord thinning | 0.125-beat grid; fullest retained texture; max-density gate 18 attacks/s; max simultaneity 13 validator limit | Play the closest complete learner arrangement with inner voices intact. |

All six levels share normalized piano range 21–108, top-down lineage checks,
and the same source roles (`vocals`, `guitar`, `other`). The explicit skill
steps are strongest at Very Beginner→Beginner, Beginner→Very Easy, and
Easy→Medium. Very Easy→Easy has materially different code paths but repeatedly
produces the same events on the current fixtures.

## Fresh current metrics

The JSON freeze contains the full global, RH, LH, coordination, movement,
identity, harmony, phrase, and source-integrity fields. The compact tables below
show the decision-driving fields. `LH%` is LH-active onset ratio; `Both%` is the
percentage of onset groups containing both hands; `Alt/min` counts changes in
onset-group hand state per minute. Ranges are MIDI semitones.

### Classical

| Level | Notes | RH/LH | Onsets | Attacks/s | Max / p50 / p90 sim | LH% / Both% / Alt/min | RH span / LH span | RH median / P95 leap |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| Very Beginner | 368 | 368/0 | 368 | 1.136 | 2 / 1 / 2 | 0 / 0 / 0 | 41 / — | 3 / 12 |
| Beginner | 507 | 435/72 | 489 | 1.509 | 2 / 1 / 2 | .147 / .037 / 25.926 | 41 / 43 | 3 / 12 |
| Very Easy | 962 | 435/527 | 714 | 2.204 | 4 / 2 / 3 | .627 / .237 / 73.704 | 41 / 58 | 3 / 12 |
| Easy | 962 | 435/527 | 714 | 2.204 | 4 / 2 / 3 | .627 / .237 / 73.704 | 41 / 58 | 3 / 12 |
| Medium | 1,283 | 722/561 | 714 | 2.204 | 6 / 3 / 4 | .627 / .241 / 74.259 | 44 / 58 | 4 / 12 |
| Advanced | 1,309 | 740/569 | 715 | 2.207 | 8 / 3 / 4 | .627 / .241 / 74.630 | 44 / 58 | 4 / 12 |

### Cover

| Level | Notes | RH/LH | Onsets | Attacks/s | Max / p50 / p90 sim | LH% / Both% / Alt/min | RH span / LH span | RH median / P95 leap |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| Very Beginner | 353 | 353/0 | 353 | 1.492 | 2 / 1 / 2 | 0 / 0 / 0 | 32 / — | 3 / 12 |
| Beginner | 510 | 381/129 | 469 | 1.982 | 2 / 1 / 2 | .275 / .087 / 56.789 | 32 / 26 | 2 / 12 |
| Very Easy | 1,213 | 779/434 | 1,022 | 4.318 | 4 / 1 / 3 | .376 / .138 / 160.479 | 32 / 26 | 2 / 12 |
| Easy | 1,225 | 786/439 | 921 | 3.892 | 4 / 1 / 3 | .417 / .270 / 136.648 | 32 / 26 | 2 / 12 |
| Medium | 1,371 | 932/439 | 921 | 3.892 | 6 / 2 / 3 | .417 / .270 / 136.648 | 32 / 26 | 2 / 12 |
| Advanced | 1,400 | 954/446 | 938 | 3.963 | 6 / 2 / 3 | .417 / .274 / 138.930 | 32 / 26 | 2 / 12 |

### Pop

| Level | Notes | RH/LH | Onsets | Attacks/s | Max / p50 / p90 sim | LH% / Both% / Alt/min | RH span / LH span | RH median / P95 leap |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| Very Beginner | 327 | 327/0 | 327 | 1.110 | 2 / 1 / 2 | 0 / 0 / 0 | 26 / — | 2 / 8 |
| Beginner | 470 | 375/95 | 423 | 1.435 | 2 / 1 / 2 | .225 / .111 / 26.876 | 26 / 31 | 2 / 8 |
| Very Easy | 847 | 375/472 | 555 | 1.883 | 4 / 1 / 2 | .600 / .276 / 60.064 | 26 / 35 | 2 / 8 |
| Easy | 847 | 375/472 | 555 | 1.883 | 4 / 1 / 2 | .600 / .276 / 60.064 | 26 / 35 | 2 / 8 |
| Medium | 1,011 | 517/494 | 555 | 1.883 | 6 / 1 / 3 | .600 / .277 / 59.861 | 26 / 35 | 2 / 9.3 |
| Advanced | 1,016 | 522/494 | 555 | 1.883 | 6 / 1 / 3 | .600 / .277 / 59.861 | 26 / 35 | 2 / 9.3 |

### Synthetic control

The four-onset synthetic control is a regression shape, not an identity or
human-difficulty corpus: VB `4/0` notes, Beginner `4/2`, Very Easy/Easy `4/4`,
Medium `12/4`, and Advanced `14/4` RH/LH notes. It verifies the intended
one-hand → sparse-two-hand → full-texture progression and max simultaneities
1, 2, 2, 2, 4, and 5.

Identity and harmony diagnostics are deliberately separate from note counts.
Across the three real fixtures, RH onset coverage is high for Beginner on
Classical/Pop (`.991/.997`) but low on Cover (`.474`); Very Easy/Easy are
`.991/.969/.997` and `.991/.978/.997` respectively; Medium is
`.998/.978/1.000`; Advanced is `1.000` on all three. LH root-change/restrike/
shape counts are present in the JSON and are not fabricated for RH-only levels.

## Adjacent transitions

Transitions below are written easier→harder. The evaluator’s structural label
is retained alongside a product interpretation. Event overlap is deterministic
one-to-one matching on hand, MIDI pitch, and start within `0.08` beats; it is
not a musical correctness score.

| Transition | Fresh structural delta across Classical / Cover / Pop | Event overlap (harder coverage) | Coordination / identity signal | Product classification | Added benefit |
| --- | --- | --- | --- | --- | --- |
| Very Beginner → Beginner | +139/+157/+143 notes; +121/+116/+96 onsets; LH-active `.147/.275/.225`; maxSim unchanged | `.726/.692/.696` | Identity cliffs on all three; RH overlap remains `.846/.927/.872` | `OVERLAPPING_BUT_DIFFERENT_PURPOSE` | `NEW_LEARNER_SKILL` — sparse structural LH, with fixture-dependent RH refinement |
| Beginner → Very Easy | +455/+703/+377 notes; +225/+553/+132 onsets; maxSim +2; LH-active rises by `.480/.101/.375` | `.527/.420/.555` | Large coordination jump; identity distance `.170/.643/.146` | `DISTINCT` | `NEW_LEARNER_SKILL` — continuous two-hand harmonic texture |
| Very Easy → Easy | 0/+12/0 notes; 0/−101/0 onsets; maxSim unchanged | `1.000/.814/1.000` | Coordination distance `0/.107/0`; exact duplicates on Classical/Pop | `REDUNDANT_CANDIDATE` | `MINIMAL_DIFFERENCE`; Cover is the non-monotonic outlier |
| Easy → Medium | +321/+146/+164 notes; onset count unchanged; maxSim +2 on all three | `.750/.894/.838` | Coordination distance `0/.000/.001`; identity distance `.072/.112/.065` | `DISTINCT` | `NEW_LEARNER_SKILL` — denser RH/polyphony and fuller LH texture |
| Medium → Advanced | +26/+29/+5 notes; +1/+17/0 onsets; maxSim +2/0/0 | `.980/.979/.995` | Identity distance `.002/.030/0`; Pop is structurally redundant | `WEAKLY_DISTINCT` | `MIXED` — mostly inner-voice/musical richness |

Normalized diagnostic distances (median across all four fixtures) are:

| Transition | Density | Polyphony | Coordination | Movement | Identity |
| --- | ---: | ---: | ---: | ---: | ---: |
| Very Beginner → Beginner | .237 | 0 | .450 | 0 | .408 |
| Beginner → Very Easy | .276 | .500 | .403 | 0 | .280 |
| Very Easy → Easy | 0 | 0 | 0 | 0 | .125 |
| Easy → Medium | 0 | .333 | .001 | .054 | .092 |
| Medium → Advanced | .001 | .100 | .001 | 0 | .001 |

The strongest consistent skill transitions are sparse LH, continuous LH/full
harmony, and Medium’s extra RH polyphony. Easy→Very Easy does not supply a
reliable cross-fixture skill step.

## Cross-fixture consistency

Consistency is reported over Classical, Cover, and Pop; the synthetic control
is kept separate. `relativeSpread` is `(max−min)/|median|` when the median is
non-zero; a zero-median mixed set is reported as highly variable rather than
given an infinite ratio.

| Level | Attacks/s | MaxSim | LH-active onset | Both-hands onset | RH P95 leap | Overall reading |
| --- | --- | --- | --- | --- | --- | --- |
| Very Beginner | 1.110–1.492, moderate | 2, consistent | 0, consistent | 0, consistent | 8–12, moderate | Consistent one-hand envelope; melody demand varies. |
| Beginner | 1.435–1.982, moderate | 2, consistent | .147–.275, high | .037–.111, high | 8–12, moderate | Sparse-LH contract is real but amount of coordination varies. |
| Very Easy | 1.883–4.318, high | 4, consistent | .376–.627, moderate | .138–.276, high | 8–12, moderate | Full-LH density is composition-dependent. |
| Easy | 1.883–3.892, high | 4, consistent | .417–.627, moderate | .237–.276, consistent | 8–12, moderate | Same envelope as Very Easy on two fixtures. |
| Medium | 1.883–3.892, high | 6, consistent | .417–.627, moderate | .241–.277, consistent | 9.3–12, consistent | Polyphony step is consistent; attack density is source-driven. |
| Advanced | 1.883–3.963, high | 6–8, moderate | .417–.627, moderate | .241–.277, consistent | 9.3–12, consistent | Inner texture is the main addition; Pop is near-identical to Medium. |

Transition consistency is also uneven: Very Beginner→Beginner is an identity
cliff on all three real fixtures; Beginner→Very Easy is inconclusive on all
three; Easy→Medium is healthy on all three; Medium→Advanced is healthy on
Classical/Cover but redundant on Pop; Very Easy→Easy is redundant on
Classical/Pop and non-monotonic on Cover.

## Beginner promotion effect

The current sparse-LH promotion creates a real intermediate coordination step:

| Fixture | Beginner RH/LH | Very Easy RH/LH | Beginner LH-active | Beginner both-hands onset | Fresh RH identity |
| --- | ---: | ---: | ---: | ---: | ---: |
| Classical | 435/72 | 435/527 | .147 | .037 | .991 |
| Cover | 381/129 | 779/434 | .275 | .087 | .474 |
| Pop | 375/95 | 375/472 | .225 | .111 | .997 |
| Synthetic | 4/2 | 4/4 | .500 | .500 | 1.000 |

Answers to the two required checks:

- **Very Beginner→Beginner distinct?** Yes as a product purpose: Beginner adds
  sparse structural LH without changing the principal RH contract. The size
  and identity of the bridge are not uniform, and Cover retains the deferred
  `COVER_RH_IDENTITY_CLIFF`.
- **Beginner→Very Easy distinct?** Yes: LH-active onset rises to `.376–.627`
  on real fixtures and maxSim rises from 2 to 4. Very Easy is a continuous
  two-hand texture, not merely the sparse Beginner anchors.

No historical pre-promotion row was used to make either conclusion.

## Cover outlier

Cover is **`MIXED` / fixture-specific outlier**, not a reason to redefine every
level. It is the only real fixture where the easier Very Easy output has more
onsets than Easy (1,022 vs 921; 4.318 vs 3.892 attacks/s), and its Beginner RH
identity coverage is `.474` versus `.991/.997` on Classical/Pop. Keep
`COVER_RH_IDENTITY_CLIFF` as the separate follow-up; do not fix it in this
ladder review.

## Conceptual product models

### Model 6 — current

`Very Beginner → Beginner → Very Easy → Easy → Medium → Advanced` preserves
all physical IDs and exposes the clearest code contracts, but publishes a
repeated Very Easy/Easy experience on two of three real fixtures and a
Cover-only inversion.

### Model 5 — evidence-derived candidate

`Very Beginner → Beginner → Easy → Medium → Advanced`, with current Very Easy
retained as a physical legacy alias of Easy. This is the strongest candidate:
it removes the only repeated transition while preserving the sparse Beginner
bridge and Medium’s polyphony step. Easy is the safer canonical public name
because the worker, grouping, and UI already treat Easy as the stable
representative. This is a **candidate only**; no IDs, rows, or labels were
changed here.

### Model 4 — aggressive candidate, not selected

`Very Beginner → Beginner → Easy → Advanced`, with Very Easy aliased to Easy
and Medium absorbed into Advanced. The second merge is weak: Classical and
Cover still add inner texture/attacks at Advanced, while Pop is near-identical.
The resulting Medium→Advanced learner jump would be hard to explain and would
erase a useful polyphony step. Keep this as a future hypothesis only.

| Model | Minimum adjacent skill distance | Cross-fixture consistency | Weak transitions | Assessment |
| --- | --- | --- | --- | --- |
| 6 | 0 at Very Easy→Easy | Uneven at lower/full-texture tiers | Very Easy→Easy; Pop Medium→Advanced | Valid physical ladder, but contracts need retuning. |
| 5 | 0 only if Easy/Very Easy remain aliases | Better public story; physical artifacts can remain six | Medium→Advanced remains weak | **Preferred follow-up candidate.** |
| 4 | Large Beginner→Easy/Advanced jumps after merges | Low confidence | Second merge is not cross-fixture stable | Defer; high product risk. |

### Pedagogical descriptions

| Model | Tier purposes |
| --- | --- |
| 6 | VB: tune only; B: tune plus sparse LH; VE: continuous simple two-hand; E: fuller two-note harmony; M: denser multi-voice texture; A: complete retained texture. |
| 5 | VB: tune only; B: tune plus sparse LH; E: continuous simplified two-hand; M: dense multi-voice; A: complete retained texture. |
| 4 | VB: tune only; B: sparse two-hand; E: continuous/full simplified two-hand; A: complete retained texture. |

## Product-surface and consolidation cost

The six-level contract is coupled across more than a MIDI enum:

| Surface | Current coupling | Future consolidation impact |
| --- | --- | --- |
| MIDI types/config | `LEVEL_ORDER`, six scores, per-level builders, validation and adjacent monotonicity | New public alias/canonical map; do not delete physical builders first. |
| Catalog/storage | `vb`, `b`, `ve`, `e`, `m`, `a`; complete-set replacement and 457 directories per level (2,742 total) | Five-level destructive migration would remove/merge 457 records; aliasing avoids data loss. |
| Evaluators/scripts | Ladder evaluators assume six levels and five edges; quality, learner, chord, repair, migration, and verification scripts are six-aware | Update expected order/transitions or add a public-rollup layer; preserve six-level structural diagnostics. |
| API/UI | Labels, filters, grouped API, player variant links, upload copy, metadata update all enumerate six levels | Add alias display semantics and URL/backward compatibility before any deletion. |
| Worker/publication | Easy suffix is a stable artifact selection; publication/migration require complete six-level sets | Keeping Easy canonical minimizes worker change; Very Easy can remain a legacy alias. |
| Tests/docs | Six-level fixtures, docs, integrity checks, and deterministic ladder reports | Re-baseline fixtures and migration checks; no behavior change in this review. |

Cost classification:

- **Five-level candidate: MEDIUM-HIGH.** A public roll-up retaining six physical
  records is roughly a small compatibility slice; destructive consolidation
  requires code/tests, API/UI semantics, 457-record migration, revalidation,
  and human acceptance.
- **Four-level candidate: HIGH.** It additionally collapses the Medium/Advanced
  texture contract and the evaluator’s adjacent evidence; expect a larger
  migration and re-acceptance surface.

The simplicity win is therefore primarily a future public alias/roll-up, not
deleting six-level code or artifacts immediately.

## R1 exploratory context

The supplied packet `difficulty-ladder-human-audit-ratings.json` is one frozen
rater with 10 cases and no rater IDs, reliability, tags, or notes. It records:

- identity: 8 YES / 2 NO;
- melody: 8 YES / 2 NO;
- difficulty: 6 ABOUT THE SAME, 2 A, 2 B;
- difference: 6 NEGLIGIBLE, 1 SMALL, 2 MODERATE, 1 LARGE;
- separate-level usefulness: 0 YES, 5 MAYBE, 5 NO.

This is secondary descriptive context only. It is not a release gate, does not
validate a six-level product, and is not used to claim recognizability or
statistical human preference.

## Decision and boundaries

**Decision: `FIVE_LEVEL_LADDER_CANDIDATE`.** Current symbolic evidence is strong
enough to warrant a dedicated five-level product follow-up centered on merging
the Very Easy/Easy public experience, but not to perform that migration in this
mission. The four-level model is too aggressive, and the R1 packet cannot settle
musical usefulness by itself.

Behavior remains exactly:

`NO_MUSICAL_BEHAVIOR_CHANGE`

No difficulty configs, labels, order, arranger logic, Beginner sparse-LH policy,
catalog rows, API payloads, or production artifacts were changed.

Deferred separately: `COVER_RH_IDENTITY_CLIFF`.

One follow-up task: **design a non-destructive five-level public roll-up
experiment (Very Easy→Easy alias), with direct non-adjacent evaluator checks and
human acceptance before any physical artifact migration.**

## Verification

- Current ladder review command: `npm run review:ladder -w @keyspilli/catalog -- --revision=1cc49b71538a8b73a5be2af724c2db2b3cdb318b --out=<path>`.
- Determinism: two fresh runs were byte-identical; report hash is recorded above.
- Catalog typecheck: passed.
- Focused catalog tests: 2 files, 52 tests passed.
- Full workspace tests: web 85, catalog 952, engrave 8, midi 325,
  player-core 92, transcribe 42 — 1,504 tests passed.
- Full workspace typechecks: all six packages passed.
- `git diff --check`: passed; the musical-generation paths under `packages/midi`,
  `apps/web`, and `services/transcribe` have no diff from the starting commit.
- Production output parity: no replay/deploy was run by design. The parity guard
  is the unchanged generation-path diff above; production artifacts were not
  mutated.
- Disk free at freeze: 54 GiB on `/System/Volumes/Data`.
