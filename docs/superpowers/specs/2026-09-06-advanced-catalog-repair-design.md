# Advanced catalog repair design

## Scope

Repair only Advanced artifacts with objective, source-backed evidence of pipeline damage. Do not tune from benchmark references, alter authored MIDI conservatively, deploy, or request human listening.

## Decisions

- Reuse the existing learner metrics and learner-review visibility gate.
- Add one transcription-only continuation repair after audio-onset filtering. Consecutive same-pitch fragments may merge only when the successor lacks an independent nearby audio onset. This path never runs for uploaded/authored MIDI.
- Rebuild only source families whose original audio and transcription inputs are recoverable. Missing-source artifacts that are already proven broken are blocked from learner visibility until their source is reacquired.
- Treat long rests, dense authored chords, and other ambiguous authored structures as trace-only. Change them only if source-to-artifact lineage proves the pipeline removed or distorted source events.
- Fix metadata discrepancies from the artifact/source of truth without changing musical events.
- Keep the broad warning set diagnostic-only. It is not a repair queue.

## Objective gates

A rebuilt transcription must preserve independently supported attacks while reducing unsupported same-pitch retriggers. Existing playability, variant validation, public-level projection, and determinism gates remain mandatory. Missing source material fails closed instead of being guessed.

## Product boundary

This work changes catalog repair tooling and transcription cleanup only. It does not mutate production, expand alignment research, or establish subjective musical quality.
