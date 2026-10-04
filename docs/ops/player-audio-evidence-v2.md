# Opt-in Player audio review profile: evidence-v2

`review-song-audio.mts` defaults to the byte-stable legacy prompt and review shape. Select the separate evidence contract explicitly with `--review-profile evidence-v2`; changing profiles does not resume or retry an earlier submission.

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/review-song-audio.mts \
  /absolute/path/to/manifest.json /absolute/path/to/new-output \
  --send-audio --review-profile evidence-v2 --max-requests TOTAL_JOB_CAP \
  --anti-python /absolute/path/to/python3 \
  --anti-script /absolute/path/to/anti.py \
  --base-url http://127.0.0.1:PORT/v1 --model EXPLICIT_MODEL_ID
```

The profile uses an audio-neutral prompt. It asks the reviewer to inspect the content actually present before applying the selected Original or Chords musical focus. It does not presume piano or music, and directs abstention when the input is missing, silent, speech, uncertain, unavailable, or otherwise insufficient. The default legacy prompt remains unchanged.

## Response shape

The domain JSON inside the Anti envelope must use `schemaVersion: 2` and include:

- `comparisonStatus`: `compared` or `abstained`.
- `attachments.reference` and `attachments.candidate`, each with `content` (`music`, `speech`, `silence`, `unavailable`, or `uncertain`) and concise, nonempty `evidence` describing the reported observation.
- Nonempty `summary`, `uncertainty` (`low`, `medium`, or `high`), nonempty `limitations`, and `findings` using the existing bounded finding schema.

`compared` is accepted only when both attachment content states are `music`. Both attachment evidence fields and at least one limitation are required. `abstained` requires `uncertainty: high`, nonempty limitations, and an empty findings array. Findings remain clip-local and must include the existing evidence and proposed check/repair fields.

The adapter validates the ordered two-audio media receipt, clip hashes and byte counts before accepting either profile's domain JSON. Evidence-v2 rejects a legacy response, including a confident empty-findings response. No automatic output repairs, retries, or fallbacks are added.

## Report and recovery semantics

The JSON and Markdown reports record `reviewProfile` and `reviewSchemaVersion`. Per-job completion means a schema-valid response was retained; it does not by itself mean a comparison occurred. Reports list reserved attempts separately from validated completed responses, compared results, abstentions, and ambiguous jobs. A reserved attempt does not prove the provider received a request. Abstained phrases remain in the unreviewed gap list and do not count as compared coverage.

The run fingerprint includes the profile and schema version. `--resume` requires the same profile/schema and fingerprint and keeps the original request cap. A profile change is refused before any job is resumed. Ordered media provenance remains mandatory on resume and report materialization.

`listeningAttestation` and `providerListeningAttestation` remain `unverified`; valid syntax and provider self-report are not proof that the audio was grounded or heard. `listeningCalibration` stays `unqualified`, and musical acceptance remains `not-established`. Use this profile as an evidence-format safeguard, not as a listening qualification or musical approval gate.

The distinct frozen study stop and its failed missing-audio gate remain documented in [the stop record](player-audio-qualification-study-stop.md). This opt-in profile does not authorize resuming that study or altering its frozen inputs.
