# Song section names

The player uses arrangement-authored labels first, then an exact retained source
or chart map, then musical-form estimates. Inferred labels always include `· estimated`.
The source label is what the symbolic-file author wrote; it is not an official
artist score or an independently reviewed musical verdict.

`packages/player-core/src/song-form.ts` compares note pitch-class distributions
and density in eight-bar phrases, groups recurring material, and estimates verse,
chorus, bridge and sparse bookends. Classical catalog entries use theme/return
names. Without contrasting recurrence it uses positional names rather than
inventing a chorus. Uniform material remains one main section. Phrase size grows
for long scores to cap analysis at 256 phrases. These broad estimates may miss
short transitions or confuse sections sharing similar harmony; source maps can
replace their boundaries as well as their names.

`apps/web/src/lib/song-sections.ts` resolves the maps. A timed-marker map in
`catalog/song-sections.json` pins the source bytes, Advanced `notes.json` bytes,
and playback BPM; a changed arrangement falls back to estimates. Source marker
positions were checked against the retained arrangement's note onsets in its
actual beat clock, including existing calibration overrides. No recording's
timestamps are applied to a different performance.

An entry may instead carry `evidence: "chart"` when its labels come from an
external chord chart rather than from the symbolic file itself. Such a map names
the chart in `provenance` and always pins the source bytes and playback BPM. Its
`advancedNotesSha256` is omitted only when the production notes bytes are not
locally available, which lets the map share across levels on the declared clock
instead of silently dying on a stale local hash. Chart boundaries are aligned to
the arrangement's own measure-level harmony, never copied from recording
timestamps. The distinct `chart` value exists so these spans are never mistaken
for timed source markers, and boundary accuracy still requires owner listening
review.

Queen Somebody To Love is the first chart map: its Ultimate Guitar labels are
aligned to the arrangement's eight-bar phrases, and its Bridge span is confirmed
independently by the chart's C-C7-F-Fm-A7-D harmony.

Difficulty levels on the same declared clock share Advanced's form, so a sparse
reduction does not get different role names merely because its density changes.
Ranges are clipped to the selected level's duration. Explicit level-authored
labels remain authoritative. Alternate-performance Chords projections use their
own clock and estimates, rather than borrowing a source map from Original.

New MIDI imports retain timed marker/cue labels. MusicXML imports retain form
labels from rehearsal/words directions, including cursor/offset and supported
unfolded-repeat positions. Arbitrary instrument/copyright/tempo text and
conflicting labels at one beat are ignored. Source spans survive the same tempo
integration as notes and are persisted in `notes.json` and the row metadata.
Existing catalog files do not need rebuilding or reimporting.

The 3 October 2026 read-only production snapshot contains 455 raw catalog bases
and 2,730 variants; none had stored section metadata. The retained seed inventory
contains five MIDI files with timed form-role markers matching catalog source
hashes: Afterlife, Oops!… I Did It Again, Lay All Your Love on Me, Just Give Me a
Reason, and Don't Stop Believin' (one solo marker only). Queen Somebody To Love
uses a chart map; all other songs use estimates. The private batch audit verifies
named spans cover every stored variant's bars; it does not verify every estimate
against lyrics or recordings.
