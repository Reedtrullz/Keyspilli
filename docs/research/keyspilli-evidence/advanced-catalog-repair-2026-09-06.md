# Advanced catalog repair — 2026-09-06

## Scope

Evidence-gated repair of the live Advanced audit queue. Production was read-only. Commercial benchmark references were not used for generation or tuning. Human listening was not requested or required.

## Implemented

- Audio-derived transcriptions now merge close same-pitch continuation fragments only when the successor has no independent audio onset within 60 ms. Human-authored MIDI and distinct source lanes are unchanged.
- The transcription filter contract is now `audio-onset-filter-v2`.
- Catalog duration metadata is derived from each generated artifact rather than a discarded source tail.
- The learner audit reports articulation/retrigger evidence and has a path/time-independent canonical mode.
- Confirmed broken artifacts without a recoverable source are hidden through the existing learner-review gate. The Last Stand is also hidden because its source-backed rebuild still fails the frozen articulation gate.

## Source-backed scratch rebuilds

| Fixture | Advanced before | Advanced after v2 | Decision |
|---|---|---|---|
| Dear God | 2,323 notes; retrigger 26.9%; median 0.400 s | 2,264 notes; retrigger 24.8%; median 0.400 s | clears retrigger gate; keep |
| The Emptiness Machine | 1,107 notes; retrigger 34.6%; median 0.245 s | 950 notes; retrigger 22.9%; median 0.326 s | clears fragmentation gates; rebuild eligible |
| The Last Stand | 1,420 notes; retrigger 36.4%; median 0.218 s | 1,273 notes; retrigger 27.4%; median 0.218 s | still fails; keep hidden |

The rebuild used the existing retained audio/transcription pairs and production onset detector in scratch storage. Reconstructed sustains are capped at 1.5 beats so the repair cannot bypass learner-duration validation. No production rows or artifacts changed.

## Missing-source fail-closed set

- Red Sun in the Sky
- Livgardet / The Royal Guard (Organ)
- Nine Defence of Moscow experiment bases recorded in `catalog/learner-review.json`

These items are not guessed or reprocessed from derived artifacts. They remain hidden until their original source is legitimately reacquired.

## Authored ambiguity trace

The largest reported RH gaps in Somebody to Love, bury a friend, Deuxième Arabesque, Beethoven Sonata No. 5 (first movement), and Oops I Did It Again contain surviving source events assigned to LH. Pitch/onset survival inside those windows was 73.2%, 81.7%, 100%, 92.9%, and 60.5% respectively. The source files carry no explicit hand labels, so this is evidence of inferred ownership, not proof of missing music. Their musical events were left unchanged.

## Determinism and non-claims

Two canonical learner-audit runs were byte-identical with SHA-256 `02188e1f9ef9efeb5181d2dfc5c85c5063686e98dc409153f5d594fa19d32439`.

`MUSICAL_QUALITY_NOT_OBJECTIVELY_ESTABLISHED`. This patch repairs a demonstrated transcription artifact, fixes metadata truth, and prevents known-broken artifacts from being presented as learner-ready. It does not prove that every remaining catalog arrangement is musically good.
