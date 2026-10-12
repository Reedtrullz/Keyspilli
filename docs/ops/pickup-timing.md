# Ordinary pickups, terminal rests and exported timing

Issue [#253](https://github.com/Reedtrullz/Keyspilli/issues/253) preserves an
ordinary imported MusicXML measure map through the six physical difficulty
levels: Very Beginner, Beginner, Very Easy, Easy, Medium and Advanced. The
public ladder remains Beginner, Easy, Medium and Advanced. Exact authored short
studies also retain their supplied measure map when they pass the existing
study gates. This change does not extend the bounded repeat-import subset.

## Preserved coordinates

The parser includes the end of the final notated measure in the source
duration, including an empty last measure. Source-part selection retains that
source clock. The variant builders copy a complete explicit map instead of
reconstructing every bar from a zero-based meter grid. A multipart import uses
a shared explicit map only when every part has the same boundaries; otherwise
it retains the arithmetic fallback. Notes that extend beyond a supplied map
also require that fallback.

For example, a one-beat pickup followed by two 4/4 bars and a final rest bar
keeps `[0,1]`, `[1,5]`, `[5,9]`, `[9,13]`. The simple-meter, compound 6/8 and
4/4-to-6/8 regression controls check all six variants, persisted catalog
artifacts, and reparsed MIDI and MusicXML. Native symbolic catalog duration
includes the last measure and retains the existing whole-second rounding.
Derived YouTube/audio inputs keep their existing duration policy based on
generated note ends, so a discarded transcription tail does not extend a
catalog card's duration.

The map does not prevent a lower difficulty level from reducing notes or
quantizing rhythm. It carries measure coordinates, not an assertion that the
arrangement preserves every original source event or has received musical
approval.

## MIDI and pedal extent

Standard MIDI End Of Track events retain the terminal rest even when a reader
ignores Keyspilli metadata. An optional sequencer-specific
`keyspilli-notation-measures-v1` payload carries ordinary pickup boundaries as
contiguous `[startBeat,endBeat]` pairs. It is limited to 2,048 measures, 4,096
beats and 256 KiB. Duplicate, misplaced, discontinuous, negative and
out-of-range maps are refused. These declared coordinates do not create repeat
occurrences, authorship, publication approval or verified source phase.

The notation endpoint and the source pedal endpoint are separate. A source
pedal-down with no observed pedal-up remains capped at its original source
extent, even if a final notated rest extends the exported file. MIDI carries a
small `keyspilli-source-pedal-end-v1` declaration, rounded to its tick
resolution, alongside the actual CC64 events and channel-bound notes. Import
requires real CC64 events, one declaration at tick zero, and a finite positive
cap that includes all key and controller events and does not exceed the file
end. Key releases remain physical key releases; the exporter adds no synthetic
pedal-up event. Other MIDI players may ignore the cap declaration and use their
own pedal/end-of-file policy. Existing MusicXML pedal metadata keeps the same
independent cap; other notation players may ignore that metadata too.

## Playback clocks and the remaining boundary

Native MIDI tempo events already convert symbolic source beats into elapsed
seconds before creating the current scalar-tempo playback arrangement. When a
source supplies explicit measure boundaries, this conversion now transforms
their endpoints with the notes, source sections and pedal events, exactly once.
A two-tempo control at 120 BPM through source beat 4 and 60 BPM thereafter has
source beat 12 at 10 seconds. Its normalized playback endpoint is beat 20 at
120 BPM. Supplied source boundaries `[0,4]`, `[4,8]`, `[8,12]` therefore become
`[0,4]`, `[4,12]`, `[12,20]` in that playback coordinate system.

This is a bounded coordinate repair. It does not add a shared variable-tempo
clock to notation and Player. Without an explicit source map, the existing
scalar arrangement still creates arithmetic bars; converting the endpoints
does not reproduce the source's original written note values under every tempo
change. Arbitrary tempo-changing MusicXML remains outside the current importer
subset.

Player duration already considers the final measure as well as note ends.
Player can use the preserved pickup map through its existing verified score
navigation path: the current source fingerprint, publication revision, note
events and exported measure boundaries must agree. That path currently applies
to Original piano playback with zero transposition. Other navigation uses the
existing source-phase validation or arithmetic fallback. An ordinary imported
map alone does not grant timing authority, so this change does not claim that
all Chords, transposed, practice or generic navigation modes now follow pickup
bars.

The regression suite exercises actual exported bytes, catalog ingest and the
Player's verified score/navigation functions at several playback speeds.
Those are software checks, not listening, physical-device or native renderer
acceptance.
