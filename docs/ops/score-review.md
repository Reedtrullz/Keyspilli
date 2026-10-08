# Automatic Score Review

Run from an explicitly preflighted Keyspilli checkout using its selected Node 22.
This workflow assigns no listening, voice-labeling, chord quiz or pianist task.
It makes no catalog changes. An output is a diagnosis, never an overall approval.

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/review-score.mts capabilities
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/review-score.mts \
  /absolute/input.json /absolute/new-output --offline
```

No mode flag also defaults offline. Anti is optional and is not imported or
contacted offline. Output includes pinned input, retained symbolic files,
normalized inventories, independent symbolic/structural receipts, HTML/Markdown
results and a located repair queue. Existing output directories refuse overwrite.
Exit 0 means a valid completed diagnosis, including found defects. Exit 2 means
invalid input or a pre-dispatch prerequisite block. Exit 3 means a reserved
provider attempt failed/rejected; local results and raw adapter evidence remain.

## Input Contract

The input is `keyspilli-score-review-input`, schemaVersion 1, as defined in
[the completion design](../superpowers/specs/2026-10-08-anti-score-review-completion-design.md).
Every file pin uses an absolute local path and SHA-256 of actual bytes, with a
16 MiB file and 20,000-event bound. `manifest` pins a v2 audio-review manifest.
Each selected mode must have one phrase job, matching difficulty and explicit
occurrence/coverage. Delivered score formats are MIDI, MusicXML or MXL. Replay is
MIDI or versioned resolved Player events. A MIDI file is not a Player capture.

Clock/role/hand sidecars bind source, delivery and replay hashes, mode and
occurrence. MIDI tempo changes are integrated natively. SourceStartSeconds must
equal native time at sourceStartBeat; MIDI replay origin is candidateStartSeconds.
MIDI clocks are pre-speed, expected delivery pitch receives transpose once, replay
pitch is already performed pitch. Resolved Player events are already scaled and
transposed. The pinned Player input must reproduce the current resolver output.
The `keyspilli-resolved-events` file binds source/delivery/mode/occurrence and
settings but omits `replaySha256`: its actual byte hash is the external manifest
pin, not a self-referential field. The resolver input is validated with Player's
existing payload validator before events are recomputed. Parser-default tempo is
not verified timing. MXL inventory support does not certify unfolded playback.
Unknown clocks or unsupported XML/MXL repeat/tempo controls produce not-run checks,
with parsed inventories/range measurements retained. Track/highest pitch is not
melody authority. Missing hands are never silently assigned to the right hand.

Literal conformance compares all selected pitches, attacks, multiplicities and
key releases at a fixed 5 ms software tolerance. It is not an acoustic threshold.
Crossing notes remain context; censored releases/partial/empty scope cannot pass
a complete check. Code identity is an owned-source inventory plus lockfile digest,
not merely Git HEAD. Legacy `symbolicChecks: passed` declarations are not admitted.

Source fidelity requires independent authoritative anchors, known timing and,
for human-validated inputs, the actual hash-verified scoped reviewer receipt.
Candidate-derived references never gain authority by roundtripping. The existing
Chords policy allows scoped melody omission; unresolved alternate voicing does
not pass. Structural screening uses native elapsed times with existing difficulty
limits; it does not assess fingering, hand size or expert keyboard acceptance.

## Optional Audio

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/review-score.mts \
  /absolute/input.json /absolute/new-output --offline \
  --anti-result /absolute/retained-audio-run/report.json
```

Saved observations must match manifest/profile/jobs/media and their raw response
hashes; they remain read-only advisory evidence. To upload explicitly:

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/review-score.mts \
  /absolute/input.json /absolute/new-output --send-audio --max-requests 1 \
  --anti-python /absolute/python --anti-script /absolute/anti.py \
  --base-url http://127.0.0.1:PORT/v1 --model gemini-3.1-pro \
  --account-binding-json /absolute/private/binding.json
```

One job only, two bounded PCM16 WAVs, one reserved/provider attempt, 90 seconds,
4096 output tokens, no refresh/retry/resume/fallback/rotation. Local media checks
precede route reads. The response schema and exact private binding digest/instance
are pinned; malformed output is retained and rejected without another request.
Use an already explicitly authorized current account. Process-local opaque account
references cannot be transferred across gateway restarts by assuming a row index.
Unknown account correspondence is a pre-dispatch block, not permission to substitute.
Inspect gateway startup first: the ordinary source gateway starts a refresh-ahead
owner. Do not start it under a no-refresh authorization. Use an already safely
running, source-verified instance or retain the pre-dispatch block.

Provider listening remains unverified, calibration unqualified, musical acceptance
not-established, productionAdmission false. No new qualification study is required.

## Repairs and Adoption

Confirmed scheduling faults produce software reproducers. Only supported,
independent-source wrong-pitch findings produce bounded previews through the
existing repair module. The adapter verifies target pitch/time/occurrence and
exact finding/evidence bindings, preserves neighboring phrases and allows no
catalog writes. Fresh MIDI, resolver and optional paired sampled-Player captures
are separate rechecks. Expert limits are informational, never owner homework.

Packages are candidate-only. Merge, installed adoption, release and deployment
need separate exact-artifact authorization and refreshed repository gates.
