# Pairwise audio listening triage

Use the Keyspilli adapter only for bounded, advisory comparison of a pinned reference excerpt with one resolved replay: Original or backing-only Chords. It is not a transcription, exact-note audit, playability test, or musical acceptance gate. Synthetic controls and an empty finding list do not establish song quality.

## Preflight and offline dry run

Use a checkout that reports `audio_review.status: compatible` from `scripts/check_checkout.py`. The capability check inspects only the local adapter contract. It does not contact a gateway or establish that any model accepts or listens to audio.

Create manifest schemaVersion 2 with:

- One source arrangement pin and a reference recording identity/evidence pin.
- Resolved Original and Chords replay pins: selected difficulty and variant, replay snapshot, note events, tempo map, sustain state, playback settings, actual renderer and sampled bank, plus separate symbolic exact-note and playability evidence states.
- One pairwise job per `{mode, phrase}` with a reference clip and the corresponding candidate clip, each hash-pinned mono PCM16 WAV (32 or 44.1 kHz), at most 2 MiB and 30 seconds. A pair is at most 4 MiB.
- A pinned alignment receipt and strictly increasing asset-time/source-beat anchors that cover each complete clip. Mark fixture or unverified correspondence as `unverified`; only independently checked source alignment may be `verified`.

Validate that every referenced file matches its hash before review. The runner retains private hash-named clip copies, prompts and complete Anti responses in the selected output directory. Keep that directory private because it contains the actual audio and source evidence.

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/review-song-audio.mts capabilities
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/review-song-audio.mts \
  /absolute/path/to/manifest.json /absolute/path/to/new-output \
  --dry-run --max-requests 0 \
  --anti-python /absolute/path/to/python3 \
  --anti-script /absolute/path/to/anti.py \
  --base-url http://127.0.0.1:PORT/v1 --model EXPLICIT_MODEL_ID
```

Dry run validates local pins, runtime flags and Anti's listen request plan. It makes no HTTP request and must report zero gateway attempts. Use a new output directory. It is a software preflight only, not audio-processing or listening evidence.

## Opt-in evidence-v2 profile

The runner defaults to `legacy`; `buildReviewPrompt(job)` keeps its established bytes and response schema. To select the stricter response contract, pass `--review-profile evidence-v2` explicitly:

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/review-song-audio.mts \
  /absolute/path/to/manifest.json /absolute/path/to/new-output \
  --send-audio --review-profile evidence-v2 --max-requests TOTAL_JOB_CAP \
  --anti-python /absolute/path/to/python3 \
  --anti-script /absolute/path/to/anti.py \
  --base-url http://127.0.0.1:PORT/v1 --model EXPLICIT_MODEL_ID
```

The evidence-v2 prompt is standalone and audio-neutral: inspect content actually present, do not assume an attachment is audible or contains music or piano, and apply the mode-specific musical focus only after both inputs are observed as music. Missing, silent, speech, unavailable, uncertain or otherwise insufficient content calls for abstention.

## Local captured-byte waveform preflight

Before runtime or route preflight, the adapter reads each pinned clip's actual bytes, verifies its SHA-256, byte count, PCM16 mono WAV framing, sample rate and pinned duration, then measures those same bytes. The output reports the clip hash, normalized RMS (`sqrt(mean(sample²))/32768`), normalized peak (`max(abs(sample))/32768`), exact digital-zero state, near-silence state, PCM rail-sample count, bounded energy-onset estimates, low-level spans, and the analysis configuration and evidence hashes.

The declared analysis configuration uses near-silence only as a descriptive flag when RMS ≤ 0.001 and peak ≤ 0.003. It counts the exact signed PCM16 rail values −32768 and 32767. Onset estimates use rectangular 20 ms RMS frames at a 10 ms hop; the crossing threshold is `max(0.0001, 0.2 × maximum frame RMS)`. An estimate is the center of the actual frame, including a partial final frame; the first-frame attack is timestamped at zero. Estimates are at least 80 ms apart and capped at 256 per clip. Low-level spans use the same 20 ms frames, 10 ms hop, and RMS < 0.001, with at most 64 spans. These are bounded signal heuristics; they do not classify music, notes, or rests.

An all-digital-zero clip, missing input, corrupt WAV, or changed bytes produces a local `not-reviewed` / `render-input` report with zero Anti invocations and without querying the gateway route. It is not a provider abstention or a musical fault. Near-silence by itself does not block a quiet nonzero recording. Internal low-level spans are retained as measurements and are not presumed to be defects; compare silence with the pinned score/source expectations before making a musical judgment. The retained hash-named copies are made read-only and rechecked against the measured-byte receipt before dispatch. Resume checks the waveform evidence hash as well as manifest pins, so changed audio bytes or analysis configuration invalidate the receipt.

## Optional local-only evidence report

Before interpreting saved model claims or inferring a repair from timing evidence, an agent may create an offline report over already captured, hash-pinned clips. It recomputes PCM measurements and can compare them with authored Player/render events and a saved single-clip Anti `listen` envelope. It has no provider-request or upload mode and does not change the existing pairwise profile or defaults. See `docs/ops/local-audio-evidence.md` in the selected checkout for the manifest and report fields.

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/report-local-audio-evidence.mts capabilities
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/report-local-audio-evidence.mts \
  /absolute/path/to/pinned-local-manifest.json /absolute/path/to/new-output-directory
```

Read authored note events as local intent, not proof that the renderer emitted them. Energy-onset estimates are signal measurements, not true note-on labels; simultaneous chord notes can share an onset, and a held note crossing an excerpt boundary is not a new note-on. Saved Anti claims are advisory and are compared only against the local evidence; they do not establish independent hearing or acoustic pitch. Leave acoustic pitch unavailable and missing facts unknown. A discrepancy requests inspection; it is not an automatic defect, repair, listening qualification or musical acceptance. Do not put this report into the pairwise repair queue.

The domain JSON must use `schemaVersion: 2` and include `comparisonStatus: compared|abstained`; `attachments.reference` and `attachments.candidate`, each with `content: music|speech|silence|unavailable|uncertain` and concise nonempty observed `evidence`; plus nonempty `summary`, `uncertainty`, `limitations`, and the existing `findings` array. A `compared` result requires both contents to be `music`. An `abstained` result requires high uncertainty, nonempty limitations, and no findings. Missing ordered media provenance fails before either schema is accepted. Legacy confident empty-findings JSON is refused by evidence-v2.

Reports identify the profile and schema and list reserved attempts separately from validated complete responses, compared results, abstentions and ambiguous jobs. A reserved attempt does not prove that the provider received a request. Abstained phrases remain in the unreviewed gap list and do not count as compared coverage. The run fingerprint preserves the legacy fingerprint contract and includes profile/schema for evidence-v2; resume refuses a profile change. Listening attestation remains `unverified`, calibration remains `unqualified`, and musical acceptance remains unestablished. The stricter schema and self-report do not prove audio grounding or provider hearing.

For `--send-audio` only, the runner first makes a bounded read-only `GET /models`. It stores the raw catalog response SHA-256 as provenance and fingerprints a stable projection of the full inventory's model IDs, canonical/backend IDs, aliases, audio-input contract and routing identity. Volatile fields such as catalog timestamps do not change the resume fingerprint; changes to route contracts do. After each local Anti dry run, the resolved model must belong to the selected catalog row's explicit IDs/aliases and that row must declare the two-clip limits and single-backend-attempt contract. The report exposes both `gatewayCatalogSha256` and `gatewayRouteContractSha256`.

## Bounded submission and recovery

Submit only when the user's authorization covers the selected endpoint, model and exact job set, and the gateway owner has confirmed a listener contract enforcing `backend_attempt_limit: 1`. The adapter requires that gateway contract and invokes Anti's explicit `listen` profile with two audio attachments, one call per job, zero retries, no fallback, no pre-read, at most 2,048 output tokens, a 90-second timeout, and `--save-output never`. The total `--max-requests` must be explicit and at least the number of planned jobs. The adapter does not select a default model or endpoint.

```sh
"$KEYSPILLI_NODE" --import tsx apps/web/scripts/review-song-audio.mts \
  /absolute/path/to/manifest.json /absolute/path/to/new-output \
  --send-audio --max-requests TOTAL_JOB_CAP \
  --anti-python /absolute/path/to/python3 \
  --anti-script /absolute/path/to/anti.py \
  --base-url http://127.0.0.1:PORT/v1 --model EXPLICIT_MODEL_ID
```

The complete raw Anti envelope is retained. Audio token usage is reported as unknown; do not infer it from text token fields, media byte counts or attachment metadata. A command failure after the one request was reserved is ambiguous. Resume only with the same manifest, Anti helper hash, endpoint, model, prompts and original request cap. The runner refuses to resubmit an ambiguous job; resolve the outcome outside the adapter first.

## Interpret the report

The report keeps Original and Chords coverage separate and lists each phrase gap. Submitted jobs are counted separately from evidence-v2 compared and abstained jobs. Findings use clip-local seconds; they map to source beats only for verified anchors. Unverified and fixture anchors receive no source-location credit. Defect and uncertain findings enter a repair queue that requires a separate symbolic check. Verify each proposed change against source events, rerender with new pins, then create a fresh targeted review including the adjacent passage. The outer live stdout must still be exactly one JSON envelope; inside `output_text`, the adapter accepts bare JSON or exactly one complete `json` code fence, with no surrounding text or extra block. Incomplete envelopes and partial result quality remain refused.

`listeningCalibration` remains `unqualified`. Audio submission proves bytes were handed to the Anti listener interface; it does not prove the provider processed or heard them. Empty findings mean no defect was retained in the covered excerpts, not approval. Exact notes, learner playability, complete-song quality and production acceptance remain separate.

## Observed synthetic study (2026-10-03)

An explicitly requested `gemini-3.8-flash-low` alias completed two integration jobs with complete envelopes, ordered-media/model checks and one backend attempt per job. This established the bounded adapter flow for that run; it did not qualify the route. Across eight synthetic controls, 5/8 narrow criteria passed, 4/8 answers were fully grounded, and 4/4 mandatory negative gates passed. c01, c03 and c04 failed; c02's contour direction was correct but its exact pitch and timing claim was unsupported. There were zero qualified real-song cases. Keep this route unqualified and advisory: verify every material claim against the pinned audio and source notes before proposing a repair. Do not generalize this single run to other aliases, prompts or routes.

### Subsequent frozen study stopped at missing audio (2026-10-03)

A separate frozen Player-pair study stopped at its first mandatory `g-missing-audio` gate. One provider POST returned a confident melody/harmony/rhythm/articulation/timbre comparison and “no audible defects” despite zero audio attachments. The native grade failed the gate and marked these audible claims unsupported. The remaining 31 planned requests were not sent. This route is unqualified for this study: do not retry or resume it, report a paired-comparison outcome, change the default prompt, or infer that empty findings mean approval. Only a fresh, separately authorized bounded calibration can reconsider the route. The prior synthetic adapter result above does not override this distinct failed gate. The selected Keyspilli checkout's `docs/ops/player-audio-qualification-study-stop.md` contains the raw response, grade, request ledger, protocol, and stop receipts. The local [offline actual-Player package](/Users/reidar/Projectos/anti-keyspilli-player-study-20261003/README.md) supports human playback; its preview can reveal the construction key, and its browser proof covers media playback only, not musical acceptance.

The local demonstration generator is `apps/web/scripts/create-audio-review-demo.mts`. It writes a fixture manifest plus blind ascending/descending, repeated-attack, major/minor, silence and reversed-order controls under the ignored `output/song-prep/audio-review-demo-20261003/` path. The evaluator answer key is in a separate `controls/evaluator-only/` directory. These fixtures are synthetic software controls and receive no real-song calibration credit.

For the frozen local pack and a paste-ready no-upload command, see the Keyspilli checkout's `docs/audio-review-demo.md`. Do not expose the evaluator-only answer key to a reviewer.

For the optional raw-acoustic/model comparison workflow and isolated repair
previews, see [music review support](music-review-workflow.md). Its reports remain
diagnostic; the existing human-only source, listening and keyboard gates apply.
