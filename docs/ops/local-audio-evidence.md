# Local audio evidence

Use this optional command to inspect a captured piano excerpt before interpreting a musical review. It makes zero provider requests and has no upload or automatic repair mode. Existing pairwise review profiles, prompts, defaults and musical acceptance gates are unchanged.

```sh
/absolute/path/to/node22 --import tsx apps/web/scripts/report-local-audio-evidence.mts capabilities
/absolute/path/to/node22 --import tsx apps/web/scripts/report-local-audio-evidence.mts \
  /absolute/path/to/manifest.json /absolute/path/to/new-output-directory
```

The new output directory must have an existing parent and must not already exist. The command writes private `evidence.json` and `evidence.md`. Missing, corrupt, changed, oversized or mismatched inputs refuse before creating a report. There is no resume mode or live flag. Audio is read locally and remains at its original location.

## Manifest

Supply schema version 1 and kind `keyspilli-local-audio-evidence-manifest`, with between one and 300 clips. Every clip has a safe unique `id`, explicit `mode` (`original`, `chords`, or `control`) and a pinned audio excerpt:

```json
{
  "schemaVersion": 1,
  "kind": "keyspilli-local-audio-evidence-manifest",
  "clips": [{
    "id": "original-opening",
    "mode": "original",
    "audio": {
      "path": "/absolute/path/to/clip.wav",
      "sha256": "ACTUAL_LOWERCASE_SHA256",
      "bytes": 64044,
      "sampleRate": 32000,
      "channels": 1,
      "bitsPerSample": 16,
      "durationSeconds": 1,
      "assetStartSeconds": 10
    },
    "sourceEvents": {
      "path": "/absolute/path/to/render-events.json",
      "sha256": "ACTUAL_LOWERCASE_SHA256"
    },
    "antiObservation": {
      "path": "/absolute/path/to/saved-single-clip-listen-envelope.json",
      "sha256": "ACTUAL_LOWERCASE_SHA256"
    }
  }]
}
```

Replace placeholders with hashes of the actual files. `sourceEvents` and `antiObservation` are optional; omission is reported as unavailable rather than zero or successful. A WAV must be mono PCM16, 32 or 44.1 kHz, at most 2 MiB and 30 seconds. JSON evidence files are bounded to 1 MiB. The source event inventory is bounded to 20,000 rows.

## Authored render events and clocks

Export the selected resolved Player/render events with the actual playback settings and source provenance. The supported event file is:

```json
{
  "schemaVersion": 1,
  "kind": "keyspilli-render-events",
  "clock": "asset-seconds",
  "clipSha256": "ACTUAL_CLIP_SHA256",
  "assetStartSeconds": 10,
  "events": [
    { "midi": 64, "startSeconds": 10.1, "durationSeconds": 0.2 },
    { "midi": 64, "startSeconds": 10.5, "durationSeconds": 0.2 }
  ]
}
```

The event file binds to the exact captured clip hash and excerpt start. Its note positions use full asset seconds; the report also gives clip seconds. Onsets are counted in the half-open excerpt interval using measured PCM duration, so an event starting exactly at the excerpt end belongs to the next excerpt. The pin's duration may differ by at most 2 ms for existing rounded manifests, but that rounding cannot extend or shorten the measured event window. A note held from before the excerpt remains in the overlapping event list without becoming a new note-on. Simultaneous chord notes contribute several note-ons but one distinct start time. Near-simultaneous timestamps are not merged by a fitted tolerance.

These are pinned authored intentions. They do not establish that the renderer emitted the intended acoustic notes, that the chosen source is correct, or that a transcription is complete. Unverified source information must not be presented as independently heard audio.

## Saved advisory observations

The optional saved observation supports the existing single-clip recognition contract: a complete Anti `listen` envelope containing a neutral A observation (`content`, `words`, `pitchDirection`, and nullable `attacks`). Bare JSON or exactly one complete lowercase `json` fence is accepted inside `output_text`. The outer result must identify the same requested/actual helper model, no fallback, complete quality, and a single attempted audio descriptor with the exact clip SHA/byte count. Listening must remain unverified. Pairwise musical reviews use a different schema and cannot be relabeled as single-clip recognition.

Contradictory partial, incomplete, failed, truncated or interrupted status markers, fallback attempts and unexpected model chains refuse even when the result also claims complete quality.

The command loads an existing response only. It does not invoke Anti, resume a stopped study, regrade a frozen result or authorize a new request. A received-model claim with unknown/null evidence stays unknown. A model claim that attachments were missing is retained as disagreement with the locally captured bytes; it does not prove where internal provider delivery failed.

## Reading the report

Authored start groups, estimated energy crossings and model attack claims describe different things. The report shows their counts and any mismatch, with full PCM metrics and hashed analysis configuration. Differences request inspection and are not automatic musical defects or proposed repairs. Matching counts do not establish correct pitch, complete source melody, piano recognition or song quality. Acoustic pitch remains unavailable in this command; no MIDI pitch is substituted for it.

Digital silence remains measurable input. Silence with authored note starts is an input disagreement; an empty authored event list is not automatically a musical fault. Quiet nonzero music stays supported. Backing-only Chords is evaluated as its own mode; an absent melody is not automatically an accompaniment defect.

`musicalAcceptance` remains `not-established`, `calibrated` remains false and all saved model claims remain advisory. Keep independent source, playability and musical acceptance checks separate. Do not put the report into the existing repair queue or count it as qualified listening coverage.
