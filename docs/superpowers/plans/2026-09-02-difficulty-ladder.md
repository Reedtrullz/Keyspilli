# Learner difficulty-ladder calibration

Date: 2026-09-02
Starting revision: `d41ac4178817e75a8c7217768b8ac7779613100c`
Decision: `LADDER_HUMAN_AUDIT_REQUIRED` (E)
Behavioral change: `NO_NEW_BEHAVIOR`

## Scope

This is a read-only calibration of the complete learner ladder. It reuses the
existing arrangement evaluator and learner lineage trace; it does not alter
selection, harmony, playability limits, publication, or API payloads.

Inputs are the tracked project-owned `classical`, `cover`, and `pop` note
fixtures plus the existing inline `synthetic-full-band` regression shape. No
external/reference MIDI, audio, AMT, separator, source research, catalog
mutation, production replay, or deployment was used.

The reproducible machine report is
[`2026-09-02-difficulty-ladder-baseline.json`](./2026-09-02-difficulty-ladder-baseline.json).
The narrative results and review packet are
[`2026-09-02-difficulty-ladder-results.md`](./2026-09-02-difficulty-ladder-results.md)
and [`2026-09-02-difficulty-ladder-audit-packet.md`](./2026-09-02-difficulty-ladder-audit-packet.md).

## Canonical product order

The product order is easy → hard:

`very-beginner` → `beginner` → `very-easy` → `easy` → `medium` → `advanced`.

The order and scores come from `packages/midi/src/types.ts` and
`packages/midi/src/simplify.ts`; UI labels come from
`apps/web/src/components/level-labels.ts`. Published artifact storage uses a
reverse hard-to-easy filename order, which is a storage contract rather than
the learner order.

| Level | Score | Main constraints observed in code |
| --- | ---: | --- |
| Very Beginner | 1.0 | ~2 attacks/sec, 0.5-beat grid, minimum melody duration 1 beat, max simultaneity 2 |
| Beginner | 1.4 | ~2.5 attacks/sec, 0.25-beat grid, minimum duration 0.5 beat, max simultaneity 2 |
| Very Easy | 2.0 | ~3 attacks/sec, one-beat LH rhythm gap, max simultaneity 5 |
| Easy | 2.6 | ~4 attacks/sec, 0.75-beat LH rhythm gap, max simultaneity 5 |
| Medium | 3.4 | ~4 attacks/sec, 0.5-beat LH rhythm gap, max simultaneity 12 |
| Advanced | 4.6 | ~8 attacks/sec and richest retained source detail, max simultaneity 13 |

All level comparisons use the canonical order, `0.08`-beat onset grouping,
`1.5`-beat phrase breaks, and stable six-decimal note digests.

## Implementation

`evaluateDifficultyLadder()` is an additive export of the existing catalog
arrangement evaluator. It reports source-to-level identity and each adjacent
harder→easier edge. The output includes raw counts, RH/LH complexity, duration,
simultaneity, spans, leaps, repeated attacks, harmonic roots/restrikes/shapes,
phrase boundaries, source roles, lineage operations, and deterministic cliff
classification. `canonicalDifficultyLadderJson()` supplies the rerun hash.

The calibration CLI is:

```text
npm run calibrate:ladder -w @keyspilli/catalog -- --out <logical-output-path>
```

It reads only the four declared fixtures, emits logical IDs and hashes, and
contains no physical paths, timestamps, network access, or binary assets.

## Metric semantics

- Melody representatives are the highest RH MIDI note in each onset group.
- Coverage is one-to-one greedy onset pairing within `0.08` beats; pitch-class
  and representative coverage are reported beside it.
- Direction agreement compares signs between paired representative pitches.
- Turn/local-extrema survival requires the matched neighboring triple to retain
  the source directions; repeated-attack survival requires equal paired
  representatives; large-leap endpoint survival requires both endpoints and
  the source leap direction to survive.
- Phrase anchors are first/last groups, four-beat starts, velocity ≥100, or
  duration ≥0.75 beats. “Wrong” or “legitimate” large leaps are not inferred.
- LH root changes use the minimum MIDI pitch class in each LH onset. Bass,
  generated-note, and inferred-note attribution remain unavailable when the
  `Note` source contract does not carry those roles.
- Simultaneity uses the evaluator's event-boundary quantiles with an explicit
  `event-boundary` basis; it is not a duration-weighted sounding quantile.
- Trace operation counts are optional and development-only. Public notes/IR
  remain unchanged.

## Release boundary

The trusted corpus remains structurally monotone and preserves most onset,
pitch-class, direction, phrase, and harmonic structure through Easy. It also
shows meaningful lower-tier identity loss, redundant-looking edges, and one
cover-only Easy/Very-Easy attack-rate violation. Those signals are not enough
to label the removed events as musically unimportant without listening.

Decision E is therefore the safe outcome: freeze current behavior, retain the
diagnostic packet, and make no generic selector or lower-tier rewrite. Any
follow-up must be a separate human-audited product task.
