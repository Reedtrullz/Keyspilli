# Very Easy → Beginner role-budget experiment

Date: 2026-09-02
Branch: `codex/metal-inference-lane-lock`
Revision: `b983687fc938fd36e71afc3558b1fa61478da25b`

## Scope and decision

This is a deterministic, symbolic-only diagnostic. It does not regenerate the
human packet, collect another rating, or change MIDI behavior. The selected
state is:

**`BEGINNER_IDENTITY_CLIFF_CONFIRMED_BUT_CONSTRAINT_BOUND`**

Cover shows a real Very Easy → Beginner identity cliff in the available RH
proxy, but the equal-budget oracle recovers zero additional principal events
without changing the Beginner role policy or increasing its physical budget.
No behavior change was justified: **`NO_NEW_BEHAVIOR`**.

Human status remains formally **`HUMAN_AUDIT_INCONCLUSIVE` / `SINGLE_RATER_EVIDENCE`**.
The preregistered two-rater condition is preserved historically; the owner has
closed the audit and no second rater is planned. R1 is exploratory product
evidence only.

## Frozen controls

The tracked baseline, a fresh calibration, and an immediate repeat were
byte-identical (85,871 bytes):

`19500f7c4b7dc4cff3fa4d4ac3104176c8cc06241ec5b97608e5c33970a4a98b`

The four source controls were classical, cover, pop, and the inline
project-owned `synthetic-full-band` fixture. Per-level note digests were also
frozen; these are the regression controls for any later Beginner experiment.

| fixture | Very Beginner | Beginner | Very Easy | Easy | Medium | Advanced |
|---|---|---|---|---|---|---|
| classical | 368 / 368R+0L | 435 / 435R+0L | 962 / 435R+527L | 962 / 435R+527L | 1283 / 722R+561L | 1309 / 740R+569L |
| cover | 353 / 353R+0L | 381 / 381R+0L | 1213 / 779R+434L | 1225 / 786R+439L | 1371 / 932R+439L | 1400 / 954R+446L |
| pop | 327 / 327R+0L | 375 / 375R+0L | 847 / 375R+472L | 847 / 375R+472L | 1011 / 517R+494L | 1016 / 522R+494L |
| synthetic-full-band | 4 / 4R+0L | 4 / 4R+0L | 8 / 4R+4L | 8 / 4R+4L | 16 / 12R+4L | 18 / 14R+4L |

Source hashes are recorded in the frozen baseline; the fresh and repeated
reports match it exactly. No untracked scratch material was staged.

## Very Easy → Beginner funnel

The existing trace provides stable source ancestry, but it does not emit a
named `beginner-input` stage. The counts below reconstruct the current path:

`Very Easy → Beginner RH input → melody selection → cap/quantize/trim → final Beginner`.

| fixture | VE total | Beginner input | selection | simplification/final | first loss |
|---|---:|---:|---:|---:|---|
| classical | 962 | 435 | 435 | 435 | 527 LH notes at the RH-only input gate |
| cover | 1213 | 779 | 779 | 381 | 434 LH at input; 398 RH at ladder preservation |
| pop | 847 | 375 | 375 | 375 | 472 LH notes at the RH-only input gate |
| synthetic-full-band | 8 | 4 | 4 | 4 | 4 explicit guitar-LH notes at input |

The cover loss is therefore not a melody selector rejection: all 779 VE RH
notes reach the Beginner input and selection; 398 are lost later when the
coarsely timed Beginner stream is ladder-preserved.

### Role evidence

Classical, cover, and pop source notes carry hand labels but no trustworthy
principal/inner/harmony/ornament provenance. For those fixtures, the safe
proxy is **all RH = principal-RH proxy** and **all LH = lower-role aggregate**;
no pitch-only role claims are made. The synthetic fixture has explicit vocals
and guitar: one vocal RH principal survives, three guitar RH secondary events
survive, and four guitar LH events are removed.

Thus first-loss roles are:

| fixture | principal RH proxy | secondary RH | LH harmonic/texture split |
|---|---:|---:|---|
| classical | 0 proven; 435 RH proxy retained | unavailable | 527 LH aggregate removed; split unavailable |
| cover | 398 RH proxy events lost after input | unavailable | 434 LH aggregate removed; split unavailable |
| pop | 0 proven; 375 RH proxy retained | unavailable | 472 LH aggregate removed; split unavailable |
| synthetic-full-band | 0 lost (1 explicit vocal retained) | 3 retained | 4 explicit guitar-LH events lost; harmonic vs texture unresolved |

## Equal-budget oracle

The counterfactual held the current Beginner envelope fixed: 0.25-beat grid,
0.5-beat learner spacing/duration floor, `maxSim=2`, `maxDensity=6`
attacks/sec, current RH span/jump ceilings, and equal note/onset/attack
budgets. It only permits a lost identity event to replace an existing
lower-value slot; it cannot add density.

| fixture | VE principal proxy | B retained | proxy lost | VE lower-value texture | B texture slots | max equal-budget gain |
|---|---:|---:|---:|---:|---:|---:|
| classical | 435 | 435 | 0 | 527 | 0 | 0 |
| cover | 779 | 381 | 398 | 434 | 0 | 0 |
| pop | 375 | 375 | 0 | 472 | 0 | 0 |
| synthetic-full-band | 1 explicit vocal | 1 | 0 | 7 | 3 | 0 |

The cover’s 381 Beginner events already occupy the available RH proxy slots;
there is no lower-role Beginner texture to trade away. Promoting omitted LH
material would require an RH/LH policy change, not a generic role-budget swap.
The oracle therefore does **not** demonstrate `BEGINNER_ROLE_BUDGET_DEFECT`.

## Case 05

Case 05 (`pop-ve-b`) is true arrangement silence, not renderer failure. In the
source window `[0,12)` there are 10 notes at five onsets, all LH; the first
source RH onset is 79.5 beats. Very Easy retains 9 LH notes at five onsets;
Beginner has zero notes and zero onsets in the window because its RH-only
construction has no candidate. No selection, simplification, or ladder stage
rejects a meaningful RH event. Retaining one event would require allowing LH,
which is outside the current Beginner envelope. This is therefore
`SOURCE_LH_ONLY_UNDER_BEGINNER_POLICY`, not `SIMPLIFICATION_ERASED_ACTIVE_PASSAGE`.

## Neighbor separation and product concern

Real fixtures remain structurally ordered by output size: Beginner is above
Very Beginner (classical +67, cover +28, pop +48 notes) and below Very Easy.
The four-onset synthetic shadow is too small to establish product separation;
its B and VB counts are already equal in the frozen control. R1 nevertheless
reported no clear adjacent-level usefulness: **YES 0/10, MAYBE 5/10, NO 5/10**.
Record this separately as **`DIFFICULTY_DIFFERENTIATION_CONCERN`**; it is not
addressed by this experiment.

## Exactly one follow-up

`CONTROLLED_BEGINNER_ROLE_BUDGET_REVISION`: define a future product/engineering
experiment with explicitly role-labelled principal melody and LH harmonic
identity fixtures, then test a fixed Beginner envelope for a one-for-one
principal-versus-texture swap. Do not change the current ladder until that
controlled oracle shows a gain without a complexity increase.

## Verification

- Full workspace tests: **1,491 passed** (web 85, catalog 940, engrave 8,
  midi 324, player-core 92, transcribe 42).
- All six workspace typechecks passed.
- `git diff --check` passed.
- Current/repeat/tracked calibration reports are byte-identical.
- Branch and remote topic ref were both `b983687fc938fd36e71afc3558b1fa61478da25b`.
- Disk free: **57 GiB** on `/System/Volumes/Data`.
- No packet regeneration, second-rater collection, reference MIDI use,
  production replay, deploy, or behavior change occurred.

Scratch evidence: `/private/tmp/keyspilli-freeze.NhYeCy/`,
`/private/tmp/keyspilli-ve-b-lineage-report.md`, and
`/private/tmp/keyspilli-role-budget-experiment.json`.
