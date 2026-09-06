# Difficulty-ladder calibration results

Date: 2026-09-02
Starting HEAD: `d41ac4178817e75a8c7217768b8ac7779613100c`
Decision: **E — `LADDER_HUMAN_AUDIT_REQUIRED`**
Behavior: **`NO_NEW_BEHAVIOR`**

## Executive result

The canonical order is correct and the ladder is internally monotone on the
trusted fixtures except for one small cover-only Easy→Very Easy attack-rate /
onset-count inversion. Medium→Easy usually makes a real complexity reduction
with high measurable identity survival. The lower tiers are much less uniform:
Very Beginner/Beginner lose substantial onset and contour coverage on the
classical and cover fixtures, while the synthetic shadow is too small to
adjudicate identity. Several adjacent pairs are effectively redundant on
these fixtures. These are evidence-backed diagnostics, not human labels for
which omitted notes carry the song.

Because the corpus cannot distinguish intentional simplification from identity
damage, no subjective selector rewrite is safe. The small symbolic review
packet is in [`2026-09-02-difficulty-ladder-audit-packet.md`](./2026-09-02-difficulty-ladder-audit-packet.md);
no audio was generated and no listening request is implied by this report.

## Inputs and reproducibility

The four inputs are tracked `classical`, `cover`, `pop`, and the inline
project-owned `synthetic-full-band` fixture. The JSON freeze contains source
hashes and one digest per level. It contains no absolute paths, external
URLs, reference MIDI, audio, raw private source arrays, timestamps, or
production identifiers.

The evaluator groups onsets within `0.08` beats, uses a `1.5`-beat phrase
break, and rounds reported numbers to three decimals. Variant note digests are
SHA-256 over sorted `[midi,start(6),dur(6),vel,hand,identitySource]` tuples. The
per-level freeze uses the same measure-end duration as the evaluator (falling
back to the last note end when measures are unavailable).
The report's simultaneity basis is explicitly `event-boundary`; p50/p90/p99
are not duration-weighted sounding quantiles.

## Canonical order and generation contract

Easy → hard:

`very-beginner` → `beginner` → `very-easy` → `easy` → `medium` → `advanced`.

Scores are 1.0, 1.4, 2.0, 2.6, 3.4, and 4.6 respectively. The order is
defined by `packages/midi/src/types.ts` and the score/build map in
`packages/midi/src/simplify.ts`; UI labels are in
`apps/web/src/components/level-labels.ts`. Artifact storage's reverse
hard-to-easy order is not the learner order.

## Full ladder metrics

`LH roots/restrikes/shapes` are structural LH pitch-class diagnostics, not
full source-chord retention. `Repeated` is the global adjacent equal-pitch
attack rate. A dash means the level has no LH evidence or no applicable
identity denominator.

### Classical

Source: 1,309 notes / 715 onsets, 60 BPM, 9/8; duration 322.5 beats.

| Level | Notes | RH/LH | Onsets | Attacks/s | MaxSim | RH span | P95 leap | Large rate | Repeated | LH roots/restrikes/shapes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| very-beginner | 368 | 368/0 | 368 | 1.136 | 2 | 41 | 12 | 0.185 | 0.065 | 0/0/0 |
| beginner | 435 | 435/0 | 435 | 1.343 | 2 | 41 | 12 | 0.217 | 0.060 | 0/0/0 |
| very-easy | 962 | 435/527 | 714 | 2.204 | 4 | 41 | 12 | 0.217 | 0.046 | 419/28/36 |
| easy | 962 | 435/527 | 714 | 2.204 | 4 | 41 | 12 | 0.217 | 0.046 | 419/28/36 |
| medium | 1,283 | 722/561 | 714 | 2.204 | 6 | 44 | 12 | 0.261 | 0.053 | 419/28/40 |
| advanced | 1,309 | 740/569 | 715 | 2.207 | 8 | 44 | 12 | 0.260 | 0.053 | 419/28/43 |

| Level | Onset / PC / representative | Direction / turns / extrema | Phrase start / end / anchors | Harmonic-change | Source notes matched |
| --- | --- | --- | --- | ---: | ---: |
| very-beginner | 0.838 / 0.838 / 0.729 | 0.904 / 0.469 / 0.469 | 0.97 / 0.97 / 0.958 | 0 | 368 |
| beginner | 0.991 / 0.991 / 0.882 | 0.928 / 0.865 / 0.865 | 1 / 0.97 / 0.984 | 0 | 435 |
| very-easy | 0.991 / 0.991 / 0.882 | 0.928 / 0.865 / 0.865 | 1 / 0.97 / 0.984 | 1 | 962 |
| easy | 0.991 / 0.991 / 0.882 | 0.928 / 0.865 / 0.865 | 1 / 0.97 / 0.984 | 1 | 962 |
| medium | 0.998 / 0.998 / 0.998 | 1 / 0.992 / 0.992 | 1 / 1 / 1 | 1 | 1,283 |
| advanced | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 1 | 1,309 |

### Cover

Source: 1,400 notes / 938 onsets, 144 BPM, 4/4; duration 564.125 beats.

| Level | Notes | RH/LH | Onsets | Attacks/s | MaxSim | RH span | P95 leap | Large rate | Repeated | LH roots/restrikes/shapes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| very-beginner | 353 | 353/0 | 353 | 1.492 | 2 | 32 | 12 | 0.313 | 0.045 | 0/0/0 |
| beginner | 381 | 381/0 | 381 | 1.610 | 2 | 32 | 12 | 0.292 | 0.053 | 0/0/0 |
| very-easy | 1,213 | 779/434 | 1,022 | 4.318 | 4 | 32 | 12 | 0.292 | 0.057 | 220/163/12 |
| easy | 1,225 | 786/439 | 921 | 3.892 | 4 | 32 | 12 | 0.290 | 0.083 | 218/165/12 |
| medium | 1,371 | 932/439 | 921 | 3.892 | 6 | 32 | 12 | 0.310 | 0.095 | 218/165/12 |
| advanced | 1,400 | 954/446 | 938 | 3.963 | 6 | 32 | 12 | 0.309 | 0.091 | 222/168/12 |

| Level | Onset / PC / representative | Direction / turns / extrema | Phrase start / end / anchors | Harmonic-change | Source notes matched |
| --- | --- | --- | --- | ---: | ---: |
| very-beginner | 0.439 / 0.439 / 0.414 | 0.92 / 0.128 / 0.128 | 0.52 / 0.56 / 0.444 | 0 | 353 |
| beginner | 0.474 / 0.474 / 0.445 | 0.927 / 0.137 / 0.137 | 0.52 / 0.56 / 0.473 | 0 | 381 |
| very-easy | 0.969 / 0.969 / 0.903 | 0.91 / 0.772 / 0.772 | 0.96 / 1 / 0.976 | 0.482 | 997 |
| easy | 0.978 / 0.978 / 0.909 | 0.907 / 0.795 / 0.795 | 1 / 1 / 0.987 | 0.973 | 1,225 |
| medium | 0.978 / 0.978 / 0.978 | 1 / 0.948 / 0.948 | 1 / 1 / 0.987 | 0.973 | 1,371 |
| advanced | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 1 | 1,400 |

### Pop

Source: 1,016 notes / 555 onsets, 79 BPM, 4/4; duration 387.125 beats.

| Level | Notes | RH/LH | Onsets | Attacks/s | MaxSim | RH span | P95 leap | Large rate | Repeated | LH roots/restrikes/shapes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| very-beginner | 327 | 327/0 | 327 | 1.110 | 2 | 26 | 8 | 0.120 | 0.169 | 0/0/0 |
| beginner | 375 | 375/0 | 375 | 1.273 | 2 | 26 | 8 | 0.115 | 0.182 | 0/0/0 |
| very-easy | 847 | 375/472 | 555 | 1.883 | 4 | 26 | 8 | 0.115 | 0.139 | 298/34/15 |
| easy | 847 | 375/472 | 555 | 1.883 | 4 | 26 | 8 | 0.115 | 0.139 | 298/34/15 |
| medium | 1,011 | 517/494 | 555 | 1.883 | 6 | 26 | 9.3 | 0.125 | 0.168 | 298/34/15 |
| advanced | 1,016 | 522/494 | 555 | 1.883 | 6 | 26 | 9.3 | 0.125 | 0.168 | 298/34/15 |

| Level | Onset / PC / representative | Direction / turns / extrema | Phrase start / end / anchors | Harmonic-change | Source notes matched |
| --- | --- | --- | --- | ---: | ---: |
| very-beginner | 0.87 / 0.87 / 0.814 | 0.929 / 0.49 / 0.49 | 1 / 1 / 0.873 | 0 | 327 |
| beginner | 0.997 / 0.997 / 0.936 | 0.938 / 0.927 / 0.927 | 1 / 1 / 0.995 | 0 | 375 |
| very-easy | 0.997 / 0.997 / 0.936 | 0.938 / 0.927 / 0.927 | 1 / 1 / 0.995 | 1 | 847 |
| easy | 0.997 / 0.997 / 0.936 | 0.938 / 0.927 / 0.927 | 1 / 1 / 0.995 | 1 | 847 |
| medium | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 1 | 1,011 |
| advanced | 1 / 1 / 1 | 1 / 1 / 1 | 1 / 1 / 1 | 1 | 1,016 |

### Synthetic full-band shadow

Source: 20 notes / 4 onsets, 120 BPM, 4/4; duration 8 beats. This is a
small regression shape, not a production identity corpus.

| Level | Notes | RH/LH | Onsets | Attacks/s | MaxSim | RH span | P95 leap | Large rate | Repeated | LH roots/restrikes/shapes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| very-beginner | 4 | 4/0 | 4 | 1.000 | 1 | 8 | 7.8 | 0.333 | 0.000 | 0/0/0 |
| beginner | 4 | 4/0 | 4 | 1.000 | 1 | 8 | 7.8 | 0.333 | 0.000 | 0/0/0 |
| very-easy | 8 | 4/4 | 4 | 1.000 | 2 | 8 | 7.8 | 0.333 | 0.000 | 3/0/3 |
| easy | 8 | 4/4 | 4 | 1.000 | 2 | 8 | 7.8 | 0.333 | 0.000 | 3/0/3 |
| medium | 16 | 12/4 | 4 | 1.000 | 4 | 17 | 3.7 | 0.000 | 0.000 | 3/0/3 |
| advanced | 18 | 14/4 | 4 | 1.000 | 5 | 17 | 2.9 | 0.000 | 0.000 | 3/0/3 |

The shadow has full RH onset/PC coverage at every level, but only 4 onsets;
its contour direction metric is 0.333 for the reduced tiers. That is useful
for regression coverage, not enough for a human identity conclusion.

## Adjacent transitions and cliff classification

The tables below report harder → easier transitions. `Reduction` is
note-reduction / onset-reduction; attack Δ is harder attacks/sec minus easier
attacks/sec; a positive `Sim Δ` means the easier level has lower maximum
simultaneity. `NON_MONOTONIC` is a measured structural inversion, not an
automatic product bug. Classification also considers the relative attack-rate
reduction and normalized maximum-simultaneity reduction, stored in each
transition's `attackRateReductionRatio` and
`maxSimultaneityReductionRatio`; the table shows absolute deltas for
readability.

### Classical

| Harder → easier | Reduction | Attack Δ | Sim Δ | Classification | Violations |
| --- | ---: | ---: | ---: | --- | --- |
| advanced → medium | 0.020 / 0.001 | 0.003 | 2 | HEALTHY_SIMPLIFICATION | — |
| medium → easy | 0.250 / 0.000 | 0.000 | 2 | HEALTHY_SIMPLIFICATION | — |
| easy → very-easy | 0.000 / 0.000 | 0.000 | 0 | REDUNDANT_LEVEL | — |
| very-easy → beginner | 0.548 / 0.391 | 0.861 | 2 | INCONCLUSIVE | — |
| beginner → very-beginner | 0.154 / 0.154 | 0.207 | 0 | IDENTITY_CLIFF | — |

### Cover

| Harder → easier | Reduction | Attack Δ | Sim Δ | Classification | Violations |
| --- | ---: | ---: | ---: | --- | --- |
| advanced → medium | 0.021 / 0.018 | 0.071 | 0 | HEALTHY_SIMPLIFICATION | — |
| medium → easy | 0.106 / 0.000 | 0.000 | 2 | HEALTHY_SIMPLIFICATION | — |
| easy → very-easy | 0.010 / -0.110 | -0.426 | 0 | NON_MONOTONIC | onset count increased; attack rate increased |
| very-easy → beginner | 0.686 / 0.627 | 2.708 | 2 | INCONCLUSIVE | — |
| beginner → very-beginner | 0.073 / 0.073 | 0.118 | 0 | IDENTITY_CLIFF | — |

### Pop

| Harder → easier | Reduction | Attack Δ | Sim Δ | Classification | Violations |
| --- | ---: | ---: | ---: | --- | --- |
| advanced → medium | 0.005 / 0.000 | 0.000 | 0 | REDUNDANT_LEVEL | — |
| medium → easy | 0.162 / 0.000 | 0.000 | 2 | HEALTHY_SIMPLIFICATION | — |
| easy → very-easy | 0.000 / 0.000 | 0.000 | 0 | REDUNDANT_LEVEL | — |
| very-easy → beginner | 0.557 / 0.324 | 0.610 | 2 | INCONCLUSIVE | — |
| beginner → very-beginner | 0.128 / 0.128 | 0.163 | 0 | IDENTITY_CLIFF | — |

### Synthetic full-band shadow

| Harder → easier | Reduction | Attack Δ | Sim Δ | Classification | Violations |
| --- | ---: | ---: | ---: | --- | --- |
| advanced → medium | 0.111 / 0.000 | 0.000 | 1 | HEALTHY_SIMPLIFICATION | — |
| medium → easy | 0.500 / 0.000 | 0.000 | 2 | INCONCLUSIVE | — |
| easy → very-easy | 0.000 / 0.000 | 0.000 | 0 | IDENTITY_CLIFF | — |
| very-easy → beginner | 0.500 / 0.000 | 0.000 | 1 | INCONCLUSIVE | — |
| beginner → very-beginner | 0.000 / 0.000 | 0.000 | 0 | IDENTITY_CLIFF | — |

## Frontiers and cross-fixture consistency

The raw frontier is the pair `(identity coverage, complexity)` rather than a
single opaque score.

- **Advanced → Medium:** generally consistent: roughly 0.978–1.000 RH onset
  survival, with little note reduction on classical/pop and ~2–3% on cover.
  Complexity falls mainly through simultaneity and inner texture.
- **Medium → Easy:** consistently a genuine simplification on the three real
  fixtures: 10.6–25.0% fewer notes, maximum simultaneity drops by two, and
  onset coverage stays 0.978–0.998. The synthetic edge is intentionally more
  aggressive and inconclusive.
- **Easy ↔ Very Easy:** classical and pop are byte-level redundant here;
  cover changes only ~1% notes but is non-monotonic in grouped onset rate.
  This is a `LEVEL_REDUNDANCY_CANDIDATE`, not a removal decision.
- **Very Easy → Beginner:** large complexity reductions are accompanied by
  variable identity coverage: 0.474–0.991 across real fixtures and 1.0 on
  the tiny shadow. This is the widest identity/complexity ambiguity.
- **Beginner → Very Beginner:** the largest repeatable lower-tier identity
  concern: onset/PC coverage is 0.838 classical, 0.439 cover, and 0.870 pop;
  turn/extrema survival is especially low on cover (0.128) and classical
  (0.469). Phrase anchors remain high, so anchor preservation alone would
  conceal missing interior melody.

Role budgets show a consistent design choice: Very Beginner and Beginner are
RH-only on these fixtures, so their physical simplicity comes partly from
removing all LH harmonic activity. Very Easy and above restore LH roots and
shapes; root-change survival is 1.0 for the real Easy-vs-harder comparisons
where LH exists, but zero for RH-only lower levels because there is no LH
denominator. This is why “same composition” cannot be decided from a single
note-count or anchor metric.

## Repeated attacks and octave/range progression

Repeated attack rates (very-beginner → beginner → very-easy → easy → medium →
advanced):

- Classical: `0.065 → 0.060 → 0.046 → 0.046 → 0.053 → 0.053`
- Cover: `0.045 → 0.053 → 0.057 → 0.083 → 0.095 → 0.091`
- Pop: `0.169 → 0.182 → 0.139 → 0.139 → 0.168 → 0.168`
- Shadow: `0 → 0 → 0 → 0 → 0 → 0`

These are structural repeated-pitch rates, not exact duplicate counts and not
a judgment that repeated attacks are undesirable. They are variable rather
than monotonically decreasing, especially on the cover.

No trusted fixture emitted an `OCTAVE_SHIFTED` trace operation. No ping-pong,
range-required, or optional octave operation was observed. This rules out
octave fitting as the demonstrated cause in this corpus; it does not prove
that unseen range-heavy input is safe.

## Lineage and source-role diagnostics

The optional trace is available for the generated learner runs. Each level
reports matched/unmatched source notes and operation counts for its
`difficulty` events; adjacent transitions report retained, rejected,
collapsed/merged, and transformed counts. The trace is development-only and
does not change serialized notes or IR. The report intentionally leaves bass,
generated, and inferred source counts unavailable when `Note.identitySource`
cannot carry them.

The highest-loss owner is not a universal “WIS” bucket: the current pipeline's
combined selection/assembly stages are represented as the stages actually
observed. This prevents an invented causal split between rate, range, and
voice selection.

## Answers to the 16 review questions

1. **Actual order:** Very Beginner → Beginner → Very Easy → Easy → Medium →
   Advanced.
2. **Does every step become easier?** No. Most edges reduce notes or
   simultaneity, but cover Easy→Very Easy increases grouped onsets and attack
   rate by the measured gate definition.
3. **Does every step preserve identity proportionately?** No universal claim.
   Medium→Easy is strong on the real fixtures; lower tiers vary widely.
4. **Largest identity cliff:** Beginner→Very Beginner on the cover (0.439
   onset/PC coverage and 0.128 turn/extrema survival); the classical edge is
   also materially weak at 0.838 coverage.
5. **Largest playability improvement:** Very Easy→Beginner on cover (68.6%
   note reduction, 62.7% onset reduction) and classical (54.8% note reduction),
   but both are identity-ambiguous rather than automatically healthy.
6. **Redundancy:** Pop Advanced→Medium and Easy↔Very Easy are redundant
   candidates on some fixtures; no level is removed.
7. **Non-monotonic edge:** Cover Easy→Very Easy only, with a 1% onset increase
   and 0.426 attacks/sec increase; it is isolated, so no automatic behavior
   fix is justified.
8. **Melody onset survival:** source-to-level coverage is 1.0 at Advanced,
   about 0.969–0.991 at Very Easy/Easy, about 0.474–0.997 at Beginner, and
   0.439–0.870 at Very Beginner across real fixtures.
9. **Phrase anchors:** phrase starts/ends and anchor survival remain high in
   the real fixtures (lower-tier starts/ends are 0.52–1.0; anchor survival is
   0.444–1.0), but anchors do not measure interior melody completeness.
10. **Harmonic changes:** Easy and above retain 0.973–1.0 root-change
    survival on real fixtures; RH-only lower tiers have no LH evidence, so the
    metric is correctly zero/unavailable rather than guessed.
11. **Repeated attacks:** rates vary by source and level; there is no universal
    monotone degradation.
12. **Octave/range:** no octave operations appeared below Easy or anywhere in
    the trusted corpus.
13. **Cross-fixture consistency:** Advanced→Medium and Medium→Easy are mostly
    consistent; lower tiers are variable, with cover/classical identity loss
    much greater than pop.
14. **Do easiest tiers still look like the same composition?** Phrase anchors
    often do, but the available symbolic evidence says “uncertain” for the
    interior melody and harmonic texture, especially Cover Beginner/Very
    Beginner.
15. **Human audit required?** Yes for the ambiguous identity cases, but only a
    small symbolic packet was prepared; no audio is requested or claimed.
16. **Supported A–F decision:** **E — `LADDER_HUMAN_AUDIT_REQUIRED`**.

## Follow-up boundary

Do not implement item 17 in this mission. The next product task, if chosen,
is a human-audited review of the packet followed by a narrowly scoped decision
about lower-tier role budgets or the isolated cover inversion. A selector or
melody rewrite requires that evidence first.

## Verification and safety

- Focused calibration test: 6/6 passed.
- Full workspace tests: **1,491 passed** (web 85, catalog 940, engrave 8,
  MIDI 324, player-core 92, transcribe 42).
- All six workspace typechecks passed (web, catalog, engrave, MIDI,
  player-core, transcribe).
- The calibration script was run twice; the two JSON files were byte-identical
  and the tracked baseline matched the rerun. `git diff --check` passed.
- Disk check: 58 GiB free on `/System/Volumes/Data`.
- No behavior change, production replay, deployment, catalog mutation, AMT,
  separator, external source research, supplied reference MIDI, or audio was
  used.
- Untracked `.tmp-source-audit/` and `pnpm-lock.yaml` are pre-existing and are
  excluded from the commit.
