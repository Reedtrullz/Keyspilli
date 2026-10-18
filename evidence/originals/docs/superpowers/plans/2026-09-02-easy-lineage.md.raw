# Easy learner lineage and contour attribution

Date: 2026-09-02
Starting revision: `e3737cf6460906f28c49840708fc01e297d56ecd`
Implementation revision: `51f2995`
Decision: `EASY_PRESERVATION_PARTIAL`

## Purpose

This is a bounded diagnostics pass over the real learner pipeline. It traces
trusted symbolic input events through the existing Easy stages and measures
which simplifications affect melody identity, contour, harmony, and
playability. It does not introduce another musical selector or tune Easy
behavior from aggregate outcomes.

## Scope and invariants

- Corpus: the trusted `classical`, `cover`, and `pop` symbolic fixtures plus
  the existing project-owned `synthetic-full-band` shadow fixture.
- No external/reference MIDI, audio, AMT, Basic Pitch, GAPS, separation,
  routing, OMR, benchmark, catalog mutation, replay, or deployment work.
- Advanced and Medium are hard-frozen. Their deterministic output digests
  must equal the starting revision.
- The trace is optional development metadata. Public `Note`, IR, manifest, and
  API payload shapes remain unchanged; hidden ancestry references are stripped
  before publication.
- `GENERATED` on the raw trace is a seed marker for an input event, not a
  claim that the arranger invented a note.

## Actual traced stages

The trace follows the implementation rather than an abstract model:

`raw → cleaned → learner-arranged → advanced-candidates → advanced-playable →
medium-candidates → medium-playable → easy-rh-input/easy-lh-input →
onset-group/selector-input → easy-voice-selection → decision → easy-assembled
→ easy-playable → easy-ladder → final → difficulty`.

Each event has stable source ancestry and a deterministic operation. One-to-zero
losses emit a rejected/collapsed event at the first stage that drops the
parent. One-to-one changes classify pitch, octave, timing, duration, hand, or
role changes; many-to-one events classify merges. Selection fallback uses a
stable source key, never a locale-dependent or unordered object traversal.

## Frozen measurement definitions

- Onset groups use the metal pipeline's `0.08` beat tolerance.
- RH contour uses the highest MIDI note in each onset group.
- Phrase breaks are gaps greater than `1.5` beats.
- Phrase anchors are phrase starts/ends, beat multiples of four, velocity at
  least 100, or duration at least `0.75` beats.
- A large leap is an adjacent representative-pitch change of at least seven
  semitones. “Wrong leap” is unavailable without a trusted hand label.
- Repeated attacks are adjacent RH onset groups with the same representative
  MIDI pitch. This is a structural heuristic, not an assertion of human
  intent.
- All digests are SHA-256 over sorted tuples
  `[midi,start(6),dur(6),vel,hand,identitySource]`.

## Checkpoints

The paired machine-readable freeze and narrative results are kept next to this
plan:

- [`2026-09-02-easy-lineage-baseline.json`](./2026-09-02-easy-lineage-baseline.json)
- [`2026-09-02-easy-lineage-results.md`](./2026-09-02-easy-lineage-results.md)

The baseline file contains source hashes, all six level digests, stage/funnel
counts, contour and anchor metrics, the shadow result, and verification
metadata. It intentionally contains no binary MIDI, absolute path, source URL,
or raw event arrays.

## Release boundary

The evidence supports a complete lineage/attribution diagnostic, not a claim
that Easy is musically solved. The largest real-fixture loss remains the
one-voice selector. Because the trusted corpus does not establish that these
losses are identity-damaging rather than intentional simplification, no new
generic Easy behavior change is justified in this mission.
