# KS-09 supported staggered stack delivery

Bounded recovery continuation: [issue #278](https://github.com/Reedtrullz/Keyspilli/issues/278).
Base: Wave 3 `ecddf8a08d3540ba09898b0951ed22d1fd809bd6`. This is implementation
revision 3 of the optional `conservative-backing-v1` evaluation path. Historical
corpora, receipts and labels remain immutable; exposed examples are regressions.

## Contract

The inference policy correctly delays a supported label until its defining
source tones exist. The old delivery path then drops an entire attack cluster
whose first member precedes that label. The correction may sound one complete
source-supported voicing at a real member onset within a bounded attack group.
It never moves a future tone earlier or creates a new attack at a release.

Group eligible non-vocal, non-lyric source onsets using a fixed 0.08-beat window
anchored at the first onset, retaining individual source events. Do not change
the shared transitive detector. Consider real member onsets in each group:
the active generated harmony must have every defining pitch class present in
members already sounding at that onset, and its declared bass must match the
actual sounding non-vocal source bass. Take the latest valid complete candidate
within that group, at most once. An incomplete prefix may remain silent; do not
turn its silence into a smaller reference denominator. A later incompatible
member does not erase an earlier valid short candidate, which still ends before
the incompatible label or release.

End every strike at the earliest of its label end, the first unsupported
defining pitch-class release, the actual lowest source-bass release, the next
emitted attack and the existing maximum-strike limit. Only notes already sounding
at the strike can extend its support. Apply existing minimum spacing globally
between groups; do not borrow future members, overlap independent strikes or
consume one group twice across label boundaries. Widely spaced arpeggios and
release-only harmony changes remain outside this correction.

Carry explicit conservative delivery intent from the evaluator through the same
Player replay/bass-backing producer to the core resolver. Calls without that
option, authored material, reviewed backing, and ordinary Player defaults retain
their existing results. No catalog admission or active default-setting change.

## Verification and evidence

Before implementation, reproduce the known 0/3.96-beat delivery loss. Test pitch
orders, incomplete power-to-triad prefixes, defining-tone and octave-bass releases,
vocal exclusion, foreign bass, real rests/repeated groups, fixed-window handling
of a transitive chain, ordinary-default isolation, engine offsets and MIDI/XML
active exports. Compare exact wrong-harmony duration, supported duration, rest
intrusion and event classes/bass, using the maintained metric implementation.

Frozen Wave 2 corpora stay unchanged. Record before/after regression outputs with
exact input and source hashes. Separately authored validation controls are frozen
without candidate execution and opened only after the algorithm is frozen. They
are synthetic controls, not musical gold, real-song calibration or an estimate
of catalog prevalence. Do not retune a closed screen or claim human acceptance.

Root owns this implementation and GitHub; an independent agent reviews the diff
and runtime observations. The XML velocity work is isolated on a separate branch.
The combined gate will include both, with source/test changes committed before
the final suite. The older unexplained host failure remains unknown unless new
retained diagnostics establish a cause.
