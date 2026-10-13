# Exact source phrase protection pilot

Use this optional procedure when the chosen source has identified melody,
hook, bass or other events that ordinary reduction must preserve. Require
`apps/web/scripts/phrase-plan.mts` in the selected compatible checkout. Its
absence does not block ordinary preparation. This source-profile pilot protects
explicit Original note events; it does not certify the Chords reduction or
select musically correct roles automatically.

When the checkout advertises `prepare-song.mts --source-backed-chords`, pair
that opt-in with `--phrase-plan` targeting Advanced. The shared Chords backing
uses only lineages explicitly selected as bass, harmony or accompaniment in
the pinned plan, through the existing conservative harmony policy. Melody,
hook, unknown and unlisted lineages cannot supply missing chord tones. The
backing remains inferred and provisional; selection is not source validation.
Ordinary generated backing remains available without this opt-in.

## Inspect exact bytes and select evidence

From the selected checkout, use the absolute compatible Node returned by
`scripts/check_checkout.py`:

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/phrase-plan.mts inspect \
  /absolute/source.mid /absolute/NEW-phrase-plan.json \
  --composition-id 'EXPLICIT-COMPOSITION-ID' \
  --performance-id 'EXPLICIT-PERFORMANCE-ID'
```

MIDI, MusicXML and MXL are supported. The command writes a new file with the
actual input SHA-256, native tempo/meter/measure clock, source origin IDs and
existing role-selector proposals. Every proposal has unknown authority, null
confidence and `required: false`. A proposal alone cannot pass preparation.
Do not infer melody from the highest note, instrument, staff or physical hand.

Inspect the actual source and edit only the working plan. Confirm composition,
performance, occurrence, phrase bounds, roles and exact expected notes. Mark
the events to preserve `required: true` with `allowedTransformations: []`.
Select the intended difficulty `levels`; the inspector initially proposes
Advanced only. Keep at least one explicitly selected required event. Preserve
the original bytes and clock pins. A changed source requires new inspection.

Use `melody`, `hook`, `bass`, `harmony`, `accompaniment` or `unknown` for roles.
Priority is a declared 0–100 ordering value, not a learned confidence or a
permission to discard a required event. Evidence authority is separate from
selection. Retain `unknown` when unvalidated; a human-validation claim requires
its actual receipt pin, and the pin is not authenticated by this compiler.

For each optional listed event, allow only the necessary transformations from
`omit`, `octave-displacement`, `onset-change`, `release-change`,
`hand-reassignment` and `velocity-change`. Unlisted material remains governed
by the ordinary reducer. Required events are exact in this pilot. Unknown
source hands use the existing splitter and are disclosed as inferred.

## Prepare and inspect the actual outputs

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/prepare-song.mts \
  /absolute/source.mid output/song-prep/NEW-RUN 'TITLE' 'ARTIST' \
  --phrase-plan /absolute/NEW-phrase-plan.json
```

The plan is limited to 2 MiB, 200 phrase occurrences and 20,000 combined
events/rests. The raw and canonical plan hashes, source hash and exact plan
bytes are retained. The plan hash also participates in the arrangement config
fingerprint. Each variant sidecar contains the plan, selected-event outcome,
inferred hands and before/after changes alongside the existing preparation and
artifact-fidelity reports. An existing protected arrangement cannot be rebuilt
without an explicit policy. Historical preparation changes remain visible even
when a later protected event is restored.

Check protected source identities through actual MIDI/MusicXML and both Player
modes. `preserved` means the requested Original note events obeyed this plan,
not that the selected roles were correct or the arrangement was accepted.
Both `selectionAccuracy` and `musicalAcceptance` remain `not-established`.
The two-mode bundle and second local import remain provisional until their
separate full-output evidence is reviewed.

Required note attacks and key releases use the ordinary constant source beat
clock. A playback-tempo override changes playback speed for the whole output;
it does not move the protected voice relative to accompaniment. The sidecar
records both source-clock tempo and playback tempo. Preserve native source
clocks and output clocks separately when making listening evidence.
Catalog `preserveSourceBeats` map erasure is incompatible with this exact-source
policy and is refused; never rewrite the source-clock declaration to match it.

Protected rests may cover `all` or one explicitly declared role. They see that
role across all overlapping phrases, in either order, and include supported
channel-scoped sustain-pedal resonance. A melody rest permits unrelated
accompaniment. Source contradictions, stale or ambiguous origins, incompatible
merged lineages and mechanical/duration-limit conflicts are refusals. Do not
edit a source pin, erase another origin or drop a required note to bypass them.

When ordinary reduction extends an optional note into a selected rest, the
host may shorten its tail only with explicit `release-change` permission, or
remove it only with explicit `omit` permission for every represented lineage.
Required and unlisted events keep their refusal boundary. This correction
does not relax sounding, pedal, density or difficulty limits.

Compatible exact unisons retain every source occurrence. The pilot refuses
ambiguous physical collisions and unsupported source-pedal semantics. It does
not perform ergonomic optimization, transcription repair, new harmony
inference or independent musical review. Correct the supported evidence or
keep the candidate blocked when the bounded contract cannot represent it.
