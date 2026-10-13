# Source history and playable reductions

Original uploaded MIDI/MusicXML bytes and their source hash remain the exact
reference. Sanitization and the six playable variants are derived material.
Neither source locations nor transformation records establish that a file is
the requested performance or that an arrangement has been musically approved.

## Bounded import behavior

`sanitizeImportedNotes(notes, { maxDurBeats: null })` preserves valid timing,
quiet dynamics, grace notes, tuplets and rests unless the sounding-note ceiling
requires a reduction. The input array, notes and source locations are never
mutated or shared with the returned source-location objects.

The ceiling remains 12 simultaneous notes by default. When a louder note
arrives at capacity, an earlier note may end at that new attack. Its valid
prefix remains. For example, a quiet note spanning beats 0–8 is retained over
0–7 if twelve louder notes arrive at 7. It is not silently deleted from the
earlier seven beats or restarted after the conflict. Same-onset overflow can be
dropped because it has no earlier positive interval to retain. This is a
declared playability reduction, not exact preservation of the original release.

An explicit duration ceiling remains supported; omission retains the legacy
direct-call ceiling. Audio-transcription cleanup retains its separate noise
filtering policy. Note-count, measure, duration and grid-work guards are intact.

Direct import callers can inspect every rejection or duration change through
`onTransformation`. Each event records the reason and independent before/after
snapshots, retaining the original `sourceOrigins`. It grants no repair authority.

## Source-preparation records

`buildVariants` and ingested `notes.json` include `sourcePreparation` when the
preparation pass changes musical events. The version-1 record contains:

- `timebase: "variant-beats"`: the scalar playback clock after source tempo
  integration, before difficulty selection. Reopen the source bytes and their
  tempo map to inspect native score coordinates.
- `changes`: ordered before/after event groups for invalid-event rejection,
  duration policy, sounding limit, quantization, small-note deletion, unison
  merge and octave normalization.

An empty `after` array is an intentional deletion. A merge contains both
inputs and the resulting event, with their source locations. Warnings direct
the reviewer to this record. The record is diagnostic data, not a human review
receipt and not permission to update accepted assets.

The existing source profile still uses the 0.125-beat preparation grid. A
one-third-beat attack can become 0.375 beats, and a very short grace note can
be omitted from a playable variant. These operations are now visible in the
record; they never replace the original uploaded source. A completely exact
Source profile is a separate follow-up.

## Difficulty and fidelity limits

All six levels retain their current difficulty policies. Lower tiers may thin
notes, move attacks to a coarser grid, alter durations or change octaves. The
source-preparation record stops before those tier-specific operations; it must
not be described as a full-output transformation ledger. Existing opt-in
arrangement trace diagnostics can inspect tier changes, but approximate trace
correspondence is not source-validation authority. A common exact role/phrase
contract and a complete per-tier ledger remain follow-up work.

This correction does not restore a note's truncated tail, promise identical
rhythm at every level, or certify piano ergonomics from a 12-note ceiling.
MIDI/MusicXML roundtrips check the delivered symbolic events. Listening,
source qualification and musical/publication approval remain separate gates.

The ingest normalizer identity advances to
`midi-normalizer-v3-preserve-source-prefix`. Existing catalog assets and
accepted reference hashes are not rebuilt or repinned automatically.
