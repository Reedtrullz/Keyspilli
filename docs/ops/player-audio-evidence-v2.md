# Opt-in Player audio review profile: evidence-v2

`review-song-audio.mts` defaults to the byte-stable legacy prompt and review shape. Select the separate evidence contract explicitly with `--review-profile evidence-v2`; changing profiles does not resume or retry an earlier submission.

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/review-song-audio.mts \
  /absolute/path/to/manifest.json /absolute/path/to/new-output \
  --send-audio --review-profile evidence-v2 --max-requests TOTAL_JOB_CAP \
  --anti-python /absolute/path/to/python3 \
  --anti-script /absolute/path/to/anti.py \
  --base-url http://127.0.0.1:PORT/v1 --model EXPLICIT_MODEL_ID \
  --account-binding-json /absolute/private/binding.json
```

The profile uses an audio-neutral prompt. It asks the reviewer to inspect the content actually present before applying the selected Original or Chords musical focus. It does not presume piano or music, and directs abstention when the input is missing, silent, speech, uncertain, unavailable, or otherwise insufficient. The default legacy prompt remains unchanged.

Each job may carry an optional `scoreContext` string of at most 4,000 characters. It is supplied to the evidence-v2 prompt as explicitly non-audio context for phrase/scope interpretation only. It never substitutes for the attached audio, source-byte pins, symbolic checks, human source authority or listening evidence.

Live evidence-v2 requires a private four-field instance-scoped account binding.
The canonical binding digest and gateway instance are checked against Anti's
pre-generation verification receipt. Stale/busy bindings fail closed. The
Keyspilli-owned response schema is passed as JSON text, retained and fingerprinted;
dry-run validates the exact canonical schema appendix. Legacy prompt bytes remain
unchanged, but the current shared transport ceiling is 4096 tokens. New fingerprints
include that ceiling and cannot resume an old argument-budget configuration.

## Local captured-byte waveform preflight

Before runtime or route preflight, the adapter reads each pinned clip's actual bytes, verifies its SHA-256, byte count, PCM16 mono WAV framing, sample rate and pinned duration, then measures those same bytes. The output reports the clip hash, normalized RMS (`sqrt(mean(sample²))/32768`), normalized peak (`max(abs(sample))/32768`), exact digital-zero state, near-silence state, PCM rail-sample count, bounded energy-onset estimates, low-level spans, and the analysis configuration and evidence hashes.

The declared analysis configuration uses near-silence only as a descriptive flag when RMS ≤ 0.001 and peak ≤ 0.003. It counts the exact signed PCM16 rail values −32768 and 32767. Onset estimates use rectangular 20 ms RMS frames at a 10 ms hop; the crossing threshold is `max(0.0001, 0.2 × maximum frame RMS)`. An estimate is the center of the actual frame, including a partial final frame; the first-frame attack is timestamped at zero. Estimates are at least 80 ms apart and capped at 256 per clip. Low-level spans use the same 20 ms frames, 10 ms hop, and RMS < 0.001, with at most 64 spans. These are bounded signal heuristics; they do not classify music, notes, or rests.

An all-digital-zero clip, missing input, corrupt WAV, or changed bytes produces a local `not-reviewed` / `render-input` report with zero Anti invocations and without querying the gateway route. It is not a provider abstention or a musical fault. Near-silence by itself does not block a quiet nonzero recording. Internal low-level spans are retained as measurements and are not presumed to be defects; compare silence with the pinned score/source expectations before making a musical judgment. The retained hash-named copies are made read-only and rechecked against the measured-byte receipt before dispatch. Resume checks the waveform evidence hash as well as manifest pins, so changed audio bytes or analysis configuration invalidate the receipt.

## Response shape

The domain JSON inside the Anti envelope must use `schemaVersion: 2` and include:

- `comparisonStatus`: `compared` or `abstained`.
- `attachments.reference` and `attachments.candidate`, each with `content` (`music`, `speech`, `silence`, `unavailable`, or `uncertain`) and concise, nonempty `evidence` describing the reported observation.
- Nonempty `summary`, `uncertainty` (`low`, `medium`, or `high`), `limitations` as an array of nonempty strings, and `findings` using the existing bounded finding schema.

`compared` is accepted only when both attachment content states are `music`. Both attachment evidence fields and at least one limitation are required. `abstained` requires `uncertainty: high`, nonempty limitations, and an empty findings array. Findings remain clip-local and must include the existing evidence and proposed check/repair fields.

The adapter validates the ordered two-audio media receipt, clip hashes and byte counts before accepting either profile's domain JSON. Evidence-v2 rejects a legacy response, including a confident empty-findings response. No automatic output repairs, retries, or fallbacks are added.

## Report and recovery semantics

The JSON and Markdown reports record `reviewProfile` and `reviewSchemaVersion`. Per-job completion means a schema-valid response was retained; it does not by itself mean a comparison occurred. Reports list reserved attempts separately from validated completed responses, compared results, abstentions, and ambiguous jobs. A reserved attempt does not prove the provider received a request. Abstained phrases remain in the unreviewed gap list and do not count as compared coverage.

The run fingerprint includes the profile and schema version. `--resume` requires the same profile/schema and fingerprint and keeps the original request cap. A profile change is refused before any job is resumed. Ordered media provenance remains mandatory on resume and report materialization.

`listeningAttestation` and `providerListeningAttestation` remain `unverified`; valid syntax and provider self-report are not proof that the audio was grounded or heard. `listeningCalibration` stays `unqualified`, and musical acceptance remains `not-established`. Use this profile as an evidence-format safeguard, not as a listening qualification or musical approval gate.

The distinct frozen study stop and its failed missing-audio gate remain documented in [the stop record](player-audio-qualification-study-stop.md). This opt-in profile does not authorize resuming that study or altering its frozen inputs.
