# Exact source phrase protection pilot

Use this optional procedure when the chosen source has identified melody,
hook, bass or other events that ordinary reduction must preserve. Require
`apps/web/scripts/phrase-plan.mts` in the selected compatible checkout. Its
absence does not block ordinary preparation. This source-profile pilot protects
explicit Original note events; it does not certify the Chords reduction or
select musically correct roles automatically.

When the checkout advertises `prepare-song.mts --source-backed-chords`, pair
that opt-in with `--phrase-plan` targeting Advanced. The shared Chords backing
uses keys with a contributor explicitly selected as bass, harmony or accompaniment
in the pinned plan. It plays those retained Advanced notes directly, including
monophonic or broken accompaniment without a complete chord stack. Conservative
harmony supplies inferred labels; it cannot erase declared backing attacks or
invent missing tones. Standalone melody/hook events and keys with unknown or
unlisted lineages are excluded. Shared keys with only backing contributors keep
all lineage and permissions. A shared melody/hook contributor makes the raw
source-backed preview unavailable for the whole arrangement. Do not delete its
lineage or drop backing notes to bypass this conflict. Prepare the ordinary
chordal backing from the same input in a new run, without
`--source-backed-chords`, and keep the rejected run. If the plan declares
`chordsBridges`, make a fresh working plan copy with only those bridge
declarations removed, retaining all other source pins and protections; use that
copy for ordinary backing. Preserve the rejected plan too. Older checkouts may lack
this check; flag discovery alone does not qualify direct doubled-lead playback.
The backing remains inferred and provisional; selection is not source validation.
Ordinary generated backing remains available without this opt-in.

## Short source-gap bridges

Chords should remain chord-led while carrying useful source-written linking
figures between backing entrances. Preserve existing bass, harmony and broken
accompaniment first, even under an unresolved `N.C.` label. Do not force a chord
into a passage merely to eliminate silence. If Original continues through a
short internal backing gap, inspect its exact notes and select one sparse
instrumental linking voice. Keep genuine whole-source rests, pickups, endings
and singing space; do not copy the continuous Advanced lead. A physical hand,
track number or highest/lowest pitch alone cannot establish a musical role.

Order of work, every time Chords goes silent while Original continues:

1. **Run the capability check first**, before reading any gap report or choosing notes. Execute the exact command `"$KEYSPILLI_NODE" --import tsx apps/web/scripts/phrase-plan.mts capabilities` in a shell (use `node` if the variable is unset), from the checkout if there is one and from the current directory if not. Searching or reading source files with `rg`, `cat` or `ls` does not count. A non-zero exit or "file not found" is the evidence; quote it in your "Bridge support unavailable: <reason>." sentence.
2. If it succeeds with `source-gap-bridges-v1`, continue. If the command is missing, errors, there is no checkout, or the value differs, stop bridging: keep the existing backing and write the exact sentence "Bridge support unavailable: <reason>." in your answer. Declare no `chordsBridges`, invent no chord and double no lead.
3. Run `find_chords_gaps.py` on the matching exports. Its windows are in seconds, while plan events and `chordsBridges` are in source quarter beats. Convert before comparing: beats = seconds x BPM / 60 (at 120 BPM, double the seconds; take BPM from the MIDI tempo). Compare events with windows only in beats.
4. Choose melody events inside a `bridgeableWindows` entry and write `chordsBridges` (worked example below).

Check the maintained inspector before adding bridge declarations:

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/phrase-plan.mts capabilities
```

Require `sourceGapBridges: "source-gap-bridges-v1"`. An older checkout that
rejects this command or omits the capability must retain its existing backing
and report bridge support unavailable. Do not pass a bridge plan to it, relabel
melody as harmony to bypass exclusion, or invent another command/flag.

Locate candidate gaps with the packaged helper instead of reading them off a waveform or guessing:

```sh
python3 scripts/find_chords_gaps.py ORIGINAL.mid CHORDS.mid --output gap-report.json
```

Run it on the delivery's matching Original and Chords exports, which must share a clock. A tempo-map warning means its seconds are on separate clocks, so do not bridge until they are reconciled. For each place where the backing stops and resumes between two entrances, the report lists:

- `bridgeableWindows`: spans where Original sounds with no backing, with the exact candidate notes (start, duration, MIDI pitch) that lie wholly inside the gap.
- `genuineRestSeconds`: spans where Original is also silent for at least 0.05 seconds. Silences of half a second or more split windows. Keep these as rests.
- `withinBridgeBounds`, `gapSeconds` and `gapQuarterBeats`: the six-second and eight-quarter-beat limits below. Gaps beyond them are refused.
- `originalNotesCrossingBoundary`: Original notes that run into the backing. They are not bridge candidates.

The helper reports seconds and pitches only. It does not know roles and it does not choose notes. Map a chosen candidate to an exact retained melody event ID with the maintained inspector, name only those IDs in `chordsBridges`, and keep to one voice. Rerun it on the rebuilt exports. The gap should close, the genuine rest should remain, and the lead-leak check in the [musical gate](musical-quality-gate.md#keep-chords-chord-led-across-the-whole-timeline) must still pass. Intro and outro gaps are not reported because they are refused.

In a new working copy of the source-pinned plan, add optional `chordsBridges`:

```json
{
  "chordsBridges": [{
    "id": "transition-link",
    "startBeat": 24,
    "endBeat": 27,
    "basis": "Source-linked instrumental connecting voice; arrangement selection, not validated harmony",
    "events": [{ "eventId": "EXACT-INSPECTED-EVENT-ID" }]
  }]
}
```

This fragment augments a complete plan; its coordinates are source quarter
beats. Name actual retained melody event IDs from that plan, preserving their
roles, evidence authority and source origins. The compiler does not choose
musically suitable bridges automatically. At most sixteen selected events may
occupy one internal backing gap, with one voice and no overlap. Both the
selection window and the entire backing gap are bounded by eight source quarter
beats; the gap must also fit six native seconds. Bridge windows cannot cross a
declared whole-source rest. They stop before backing returns. Intro/outro gaps,
hooks, unknown/shared lineages and missing or retimed notes are refused.

### Worked example: events map to chordsBridges

Suppose the gap report shows a `bridgeableWindows` entry from 20.0 s to 23.0 s at 120 BPM, which is quarter beats 40 to 46 (20.0 x 120 / 60 = 40; 23.0 x 120 / 60 = 46), and an `events.json` (or plan event list) like this. Each key is the exact event ID; `startBeat` and `durationBeats` are source quarter beats:

```json
{
  "n1": { "role": "melody", "startBeat": 40, "durationBeats": 1 },
  "n2": { "role": "melody", "startBeat": 42, "durationBeats": 1 },
  "n3": { "role": "hook", "startBeat": 42.4, "durationBeats": 0.5 },
  "n4": { "role": "melody", "startBeat": 44, "durationBeats": 1.2 },
  "n5": { "role": "unknown", "startBeat": 60, "durationBeats": 0.4 }
}
```

Keep only `role: "melody"` events that start and end inside the window and do not overlap each other: `n1`, `n2` and `n4`. Drop `n3` (hook) and `n5` (unknown role, outside the window). Set `startBeat` to the first kept event's `startBeat`. Set `endBeat` to the last kept event's `startBeat + durationBeats`, computed explicitly: `n4` is 44 + 1.2 = 45.2. Do not use the window end, the last event's start, or a rounded guess. Here the bridge is 40 to 45.2:

```json
{
  "chordsBridges": [{
    "id": "gap-1-link",
    "startBeat": 40,
    "endBeat": 45.2,
    "basis": "Source-linked instrumental connecting voice; arrangement selection, not validated harmony",
    "events": [{ "eventId": "n1" }, { "eventId": "n2" }, { "eventId": "n4" }]
  }]
}
```

When the map lists beats and roles keyed by name, the keys are the event IDs; name them as they appear. Leave any gap beyond six seconds or eight beats, and any genuine rest, unbridged.

Use exact source attacks, releases, pitches, velocity and hands. An individual
selection may specify `octaveShift` of -24, -12, 12 or 24 only when that optional
event explicitly allows `octave-displacement`; zero/omitted means unchanged.
Keep a compact source-derived register rather than importing a high lead stack.
Original is unchanged. Playback records each addition as `source-gap-bridge`
with its original melody role and before/after notes. This is an arrangement
exception, not evidence that melody was authenticated as source harmony.

Prepare with the existing `--phrase-plan FILE --source-backed-chords` route in
a fresh run. Keep the previous candidate and baselines. Verify actual Player
replay, MIDI/XML and preview through each bridge, the neighboring backing
entrances, genuine breaths and full ending. Check that no bridge plays outside
its selected windows; compare Original notes/clocks and unaffected Chords
against their retained versions. Label the result provisional until its actual
musical evidence supports more. Owner feedback, software checks and independent
musical/keyboard acceptance remain separate.

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
