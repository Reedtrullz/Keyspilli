# Easy learner lineage and contour attribution — results

Date: 2026-09-02
Starting revision: `e3737cf6460906f28c49840708fc01e297d56ecd`
Implementation revision: `51f2995`
Profile: `learner`
Decision state: `EASY_PRESERVATION_PARTIAL`
Diagnostic choice: **E — NO_GENERIC_CHANGE_JUSTIFIED**

## Outcome

The optional trace now follows the actual Easy path from raw learner input to
the published ladder/final event. Stable ancestry supports one-to-zero,
one-to-one, one-to-many, and many-to-one relationships. Every traced event has
an operation and rejected/collapsed parents are emitted at the first observed
loss stage. The public note and IR shapes are unchanged.

This mission made no new musical behavior change. The only code changes after
the starting revision are lineage plumbing and deterministic collision
metadata handling. Advanced and Medium output digests are unchanged for every
trusted fixture.

## Corpus and safety

The corpus is limited to the trusted `classical`, `cover`, and `pop` symbolic
fixtures plus the existing project-owned `synthetic-full-band` shadow. Source
hashes, output digests, and machine-readable counts are frozen in
[`2026-09-02-easy-lineage-baseline.json`](./2026-09-02-easy-lineage-baseline.json).

No supplied/reference MIDI was read or copied. No audio, production replay,
catalog mutation, AMT, Basic Pitch, GAPS, separation, routing, OMR, benchmark,
or external-symbolic work was performed. `GENERATED` in the trace labels a
raw input seed event; it does not mean the arranger invented that note.

## 1. What happened to each Medium RH melody event?

The final RH funnel is:

| Fixture | Medium RH | Easy RH input | Easy voice selection | Final Easy RH |
|---|---:|---:|---:|---:|
| classical | 722 | 722 | 438 | 435 |
| cover | 932 | 932 | 786 | 786 |
| pop | 517 | 517 | 376 | 375 |

The trace carries direct parent references through the intermediate candidate,
selection, assembly, playable, ladder, final, and difficulty snapshots. A
published event can therefore be followed to one or more Medium/source events;
a missing event has a first rejected/collapsed stage rather than a fuzzy-only
post-hoc guess.

## 2. Where events were first lost

The measured first-loss counts are:

| Fixture | Medium candidates | Medium playable | Easy LH input | Easy voice selection | Easy assembly |
|---|---:|---:|---:|---:|---:|
| classical | 25 | 1 | 34 | 284 | 3 |
| cover | 2 | 27 | 0 | 146 | 0 |
| pop | 5 | 0 | 22 | 141 | 1 |

The combined one-voice selector is the dominant RH reduction. Conflict/WIS,
rate, range, and revoice are not independent selector stages in this
implementation; they remain represented as the actual combined stage rather
than being invented as separate causes.

## 3. Selector necessity and musical importance

All three trusted fixtures classify selector rejections as the structural
heuristic `INNER_VOICE_REMOVED`: an alternate in the same onset bucket was
discarded while one voice was retained. The trace records onset, pitch, role,
duration, velocity, metrical context, and parent IDs for these events.

This is evidence of intentional one-voice simplification, not proof that every
removed event is decorative. There is no trusted human label for “identity
bearing,” so a selector rewrite is not justified by the count alone.

## 4. Contour, anchors, and articulation

| Fixture | RH onset survival | Pitch-class survival | Direction agreement | Turn survival | Phrase starts | Phrase ends | Anchor survival |
|---|---:|---:|---:|---:|---:|---:|---:|
| classical | 0.993 | 0.906 | 0.928 | 0.996 | 33/33 | 32/33 | 171/174 |
| cover | 1.000 | 0.966 | 0.913 | 1.000 | 25/25 | 25/25 | 427/427 |
| pop | 0.997 | 0.955 | 0.977 | 0.990 | 18/18 | 18/18 | 192/193 |

The survival figures are paired Medium→Easy diagnostics. They show that the
events retained by Easy generally preserve contour direction and phrase
anchors; they do not show that the missing events were unimportant. Coverage
is reported alongside contour so direction agreement is not mistaken for
melody completeness.

Repeated-attack heuristic (same representative pitch on adjacent RH onset
groups) is `Medium / selector / final`: classical `35 / 27 / 27`, cover
`52 / 45 / 45`, pop `138 / 123 / 123`. Exact duplicate final `(midi,start)`
events are suppressed deterministically; this is duplicate cleanup, not a
claim about intentional human re-attacks.

## 5. Octave flips and range/revoice

No trusted fixture emitted `OCTAVE_SHIFTED` operations. Ping-pong count is zero,
and the counterfactual range oracle found no event requiring an alternative
octave assignment in this corpus. Consequently the previous octave-flip
concern is not attributed to the Easy selector here, but neither is it proven
fixed in songs that exercise range fitting. “Wrong leap” and unexplained-leap
rates are unavailable without trusted labels.

## 6. Harmony and LH restrikes

Current Easy preserves the observed Medium LH root-change set in the three
trusted fixtures: classical `419/419`, cover `218/218`, and pop `298/298`.
Same-harmony restrikes are classical `20→17`, cover `135→135`, and pop
`18→18`; unique LH pitch-class shapes are classical `40→36`, cover `12→12`,
and pop `15→15`. These are current-vs-Medium diagnostics, not a causal A/B
measurement of the earlier LH fix.

## 7. Playability and difficulty

`verifyMonotonicity` returns no failures for the trusted fixtures. Easy remains
simpler than Medium in total notes and RH/LH complexity:

| Fixture | Easy total vs Medium | Easy RH vs Medium | Easy LH vs Medium | Easy max simultaneity |
|---|---:|---:|---:|---:|
| classical | 962 vs 1283 | 435 vs 722 | 527 vs 561 | 3 |
| cover | 1225 vs 1371 | 786 vs 932 | 439 vs 439 | 3 |
| pop | 847 vs 1011 | 375 vs 517 | 472 vs 494 | 3 |

Existing validation warnings concern long sustained notes under the explicit
`maxDurBeats: null` harness option; they are nonfatal and unchanged. No Easy
metric was improved by relaxing the difficulty constraints.

## 8. Shadow generalization

The project-owned `synthetic-full-band` shadow contains 28 source notes, 12
onsets, four vocals, 12 guitar, four bass, and eight drums. The output has 12
notes, four onsets, peak simultaneity three, four semantic roots/four LH roots,
eight collapsed stacks, two same-harmony restrike reductions, and zero pitched
drum notes. Advanced/Medium/Easy each produce 12 valid notes and monotonicity
passes. Deterministic output digest:
`bcb0e053aca20c4147a1d337eaa3e921b9fe65650a7b456ad9c93b751e0b03f9`.

## 9. Answers to the 16 review questions

1. **Medium→Easy fate:** direct stable ancestry now explains every traced
   candidate and each published Easy event; the RH funnel is 722→435,
   932→786, and 517→375.
2. **First-loss owner:** the largest first-loss bucket is Easy voice selection;
   smaller losses occur in Medium candidate/playable filtering, Easy LH input,
   and final assembly.
3. **Conflict/WIS:** the implementation combines these decisions with voice
   selection; the trace reports that reality and does not fabricate a WIS-only
   loss count.
4. **Rate reduction:** no independent RH rate-loss bucket was observed after
   the current candidate path; the remaining large drop is selector-owned.
5. **Range fitting:** no trusted event changed octave or required an alternate
   playable octave, so range/revoice is not the demonstrated cause here.
6. **Contour:** retained direction agreement is 0.913–0.977 and onset survival
   is 0.993–1.000, but coverage remains the required companion metric.
7. **Phrase identity:** phrase starts survive 100%; phrase ends survive 32/33,
   25/25, and 18/18; anchor survival is 171/174, 427/427, and 192/193.
8. **Repeated notes:** the structural re-attack heuristic loses 8, 7, and 15
   events before final Easy respectively; exact duplicate suppression remains
   complete and deterministic.
9. **Legitimate large leaps:** large-leap counts are reported, but “wrong” or
   “legitimate” cannot be determined without a trusted label; no claim is made.
10. **Octave ping-pong:** zero in the trusted corpus; this is a measured absence,
    not a universal guarantee for unseen range-heavy inputs.
11. **Contour oracle:** no alternative-octave cases occurred, so the bounded
    oracle has no demonstrated gain ceiling on these fixtures.
12. **Harmony:** root-change survival is 100% in the current-vs-Medium
    diagnostic; same-harmony restrikes are measured separately above.
13. **Playability:** Easy stays below Medium, max simultaneity is three, and
    monotonicity passes; existing long-note validation warnings are nonfatal.
14. **Advanced/Medium freeze:** all six-level digests match the starting
    revision on classical, cover, and pop; Advanced and Medium are byte-stable.
15. **Selector decision:** the dominant loss is structurally explainable as
    one-voice simplification, but the corpus cannot prove identity safety for
    every rejected event. No new behavior is preregistered or shipped.
16. **Release decision:** diagnostic choice **E — NO_GENERIC_CHANGE_JUSTIFIED**;
    project status remains `EASY_PRESERVATION_PARTIAL`. A richer contour
    selector would require a separate, human-audited mission.

## Verification boundary

Fresh closeout verification passed: workspace tests `1485/1485` (web 85,
catalog 934, engrave 8, MIDI 324, player-core 92, transcribe 42), focused
MIDI lineage tests `226/226`, all six workspace typechecks, `git diff --check`,
and deterministic fixture reruns with Advanced/Medium/Easy digest parity.
The disk check reported 59 GiB available. No human listening or
recognizability claim is made by this report.
