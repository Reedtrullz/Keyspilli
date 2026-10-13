# KS-08: source-bound phrase protection pilot

## Intent and authorization

The owner requested implementation of the next work from **Recovery Report
Completed**, following the 12 October audit. Wave 2 comprises KS-08, KS-17,
the tooling portion of KS-10, and a bounded KS-09 pilot. This document scopes
KS-08. The verified prerequisite tree is
`ce26eb0351f291c716a5fe37681c3c03714a9b2b` (first-wave integration).
This authorizes implementation and reviewable branches, not merging,
deployment, publication, plugin installation, provider calls or acceptance pins.

## Design

Extend the existing neutral `sourceOrigins`, phrase occurrence and source
authority vocabulary. An opt-in `PhrasePlanV1` names the exact input SHA-256,
composition/performance, source clock, phrase bounds, event origin IDs, expected
source notes, roles, priorities, declared evidence and legal transformations.
Roles are `melody`, `hook`, `bass`, `harmony`, `accompaniment`, and `unknown`.
Hand and instrument are not role evidence. Confidence is a nullable assertion;
it does not authenticate authority. A human-validation claim without its
receipt pin is invalid, and a receipt pin alone never establishes acceptance.

The bounded first consumer is the ordinary source-profile reducer. Existing
default behavior stays the default. After ordinary reduction, required events
are restored by **exact source origin and expected event**, in the explicitly
requested tiers. Restore the source attack, key release, pitch and known hand;
do not interpolate or repair a transcription. When an unknown source hand
needs assignment, reuse the existing hand splitter and disclose inference.
Unlisted source events remain governed by the existing reduction policy.
Each listed optional event is checked against its allowed transformations.

Reject stale bytes/clock, missing or ambiguous origins, incompatible duplicate
requirements, invalid finite bounds, invalid policy, collisions or a resulting
mechanical-envelope violation. Never delete a required event to make the
validator green. Exact unison duplicates may share one physical piano event
only when pitch, onset, release and hand agree; retain every origin.

Protected rests can cover all notes or one explicitly labelled role. A role
rest does not silence accompaniment. Validate the rest against the source's
declared role inventory, then check the actual resulting events. Generated
descendants of listed events retain source lineage, so release extension into
a breath is detected. No claim of complete role annotation is made for unlisted
source material.

Attach the plan and a per-tier transformation/protection report to the existing
variant sidecar. A successful report means preservation of selected events;
source-role selection accuracy and musical acceptance remain `not-established`.
Keep KS-03 source-preparation changes as historical operations even when this
explicit later policy restores an event. Preserve KS-04 clocks/measure extents
and KS-07 artifact-fidelity metadata.

The source SHA is checked against actual bytes by catalog intake. The MIDI
library additionally checks every selected source event and the full declared
clock against its parsed input; a direct library caller must provide the
independently computed input SHA. The plan is not an approval receipt.

## Reachable workflow

The maintained `prepare-song.mts` gains an optional `--phrase-plan FILE`.
It loads the plan, passes it to ordinary ingestion, and retains exact source,
plan and output identities. Existing four-argument usage remains compatible.
An offline source-inspection command exposes real origin IDs and suggests roles
using the existing piano selector, explicitly as uncertain proposals. It never
turns the selector's top line into verified melody or changes accepted data.

## Verification

Use a finite authored corpus, separate development and held-out composition
IDs, with low melody under high accompaniment, hand-crossing melody, an
instrumental hook, a breath/rest, doubled riff and changing-tempo pickup.
Freeze intended event identities before implementation. Test actual six-tier
generation and MIDI/MusicXML reparsing; compare pitch/onset/release/hand and
protected silence, not aggregate note counts. MIDI tick precision is measured
separately from source exactness. Evaluate the existing role selector separately
from protection; deterministic retention never certifies correct role choice.

Negative controls include changed hashes/clock/events, duplicated origins,
out-of-range notes, impossible protected density, source contradictions,
unpermitted omission or octave movement, unrelated source notes and missing
evidence. Default calls must remain identical to the prerequisite tree.

## Boundaries

This is a bounded source-supported pilot, not KS-11 ergonomic optimization,
automatic transcription repair, arbitrary metal transcription or a qualified
musical judge. Unsupported protection conflicts return actionable refusal.
KS-09 separately evaluates conservative backing. KS-17/10 separately bind
the actual two-mode outputs and prepare independent acceptance evidence.
