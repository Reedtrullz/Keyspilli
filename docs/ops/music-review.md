# Local music review

Music support is optional and diagnostic. Keyspilli owns acoustic measurement,
local/non-Google models, source/learner comparison, listening packs and isolated
repairs. Anti separately owns a standalone connected-Google Gemini advisory
profile. Neither product requires the other for its ordinary path.

Use an explicit compatible Node executable from plugin preflight. From the host:

```sh
node --import tsx apps/web/scripts/report-music-review.mts capabilities
node --import tsx apps/web/scripts/report-music-review.mts --manifest INPUT.json --output NEW_DIR
```

The input has `clips`: ID, canonical PCM16 WAV `audio` pin (absolute path, SHA-256,
sample rate, channels, frames, duration, nullable derivative hash), nullable
`eventsSha256`/`analyzerSha256`, separate `replaySha256` for source correspondence, and optional acoustic/renderer/playback/source
receipts. See `MusicReviewInput` in `apps/web/src/lib/music-review.ts`. Hashes bind
bytes and exact event/model identities. The CLI rechecks WAV bytes/clocks and
writes JSON, Markdown and escaped HTML with local media, waveforms and interval
jump buttons. It never invokes inference, uploads, edits the catalog or writes a
human attestation. Missing/failed channels stay visible; contradictions survive.

Raw acoustic notes use seconds, integer MIDI, explicit unknown key/sounding
endpoints and uncalibrated confidence. Tempo/key/meter stay unknown unless their
origin is declared. Legacy beat-based piano transcription remains compatible;
its container defaults are not acoustic measurements. Checkpoint, worker code,
frontend, config, runtime/device/precision and audio derivative enter identities.

Optional local experiment environment:

```sh
uv venv --python /absolute/python3.11 .venv-audio
uv pip install --python .venv-audio/bin/python -r services/transcribe/requirements-music-review.txt
```

Acquire public assets separately after checking artifact terms/size; never during
inference. Basic Pitch 0.4.0 uses explicit ONNX and thresholds. Transkun 2.0.1 uses
explicit CPU decoding and its pinned model config/checkpoint. The worker denies
network, rejects changed code/frontend/config/weights and has a 120 second
process bound. Only one neural worker runs at once. New-run footprint is bounded
by available disk minus the reserve; stop heavy work below 30 GiB. hFT is not an
implicit fallback: reference/conversion parity is required. No weights ship here.

```sh
node --import tsx apps/web/scripts/build-music-review-corpus.mts --output NEW_CORPUS --seed 67
KEYSPILLI_MUSIC_REVIEW_RUN=/absolute/NEW_CORPUS npm exec -w @keyspilli/web -- playwright test --config=playwright.music-review.config.ts
node --import tsx apps/web/scripts/benchmark-music-review.mts --manifest NEW_CORPUS/manifest.json --candidate basic-pitch --split development --identity PINNED_ANALYZER.json --python /absolute/.venv-audio/bin/python --execute --output NEW_DEVELOPMENT
```

The corpus has 24 development/96 held-out cases, private evaluator answers and
neutral analyzer IDs. Actual Player schedule is resolved before capture. The
final graph is recorded through an AudioWorklet with sample-frame origin; an
independent muted impulse test checks that clock. Scheduled times remain
transport evidence, not independent acoustic truth. Capture a new directory,
check the loopback port and preserve earlier studies. Missing input/silence are
explicit controls; only playable fixtures use the Player. Second-bank and real
recording domains remain uncovered until supplied and measured.

Freeze worker/config and thresholds after development. `--resume` requires the
same experiment fingerprint. `--receipt-dir` grades existing pinned receipts
without inference. Report 50/100 ms tolerances separately, one-to-one notes,
nontransitive 20 ms attack groups, octave errors, null denominators, failures,
clean false alarms and resource counts. Provisional admission requires 0.95
precision/0.90 recall at 50 ms, no critical failures, p95 <=60 seconds and RSS
<8 GiB. Failure leaves diagnostic-only support; do not silently select a model.
Renderer templates search all registered pitches/residuals and preserve a
separate bank-bound channel. They cannot establish independent source fidelity.

Source comparison uses explicit phrase/occurrence/role anchors, authority and
permitted reductions. Original requires trusted defining landmarks. Backing-only
Chords may omit melody; approved octave reduction is distinguished from defects.
Unknown or auto-estimated anchors remain uncertain. Use existing learner audits
for playability and existing human-only musical receipts for acceptance.

```sh
node --import tsx apps/web/scripts/preview-music-repair.mts --snapshot SNAPSHOT.json --proposal PROPOSAL.json --output NEW_PREVIEW
node --import tsx apps/web/scripts/prepare-music-model-experiments.mts --manifest TWO_CLIP_INPUT.json --output NEW_EXPERIMENTS
```

Repair previews allow at most eight explicit edits in one phrase, pin source and
evidence, preserve neighbors, and require fresh captures/rechecks. Playback
faults produce software reproducers; never compensate by corrupting authored
notes. No catalog writes occur. Optional MOSS-HF/native, MuScriptor and Qwen are
Keyspilli-owned: larger resources, conversion parity, gated terms and separate
account/billing are explicit gates. Qwen dispatch is preparation-only. The bridge
copies Anti's generic schema by digest and exports no project paths. Use Anti
`review-music --dry-run` first; a fresh bounded upload arm needs authorization.
Human listening, source judgment and keyboard acceptance remain pending even
when all software checks pass.

Qwen preparation emits one clip per request for all four conditions, with no API
client or credentials. Context-only controls have no audio; blind requests have
no supplied context/task. Model and region/workspace endpoint remain explicit
owner pins. The payload uses streaming text output and Base64 WAV input from the
[official Model Studio API](https://www.alibabacloud.com/help/en/model-studio/qwen-omni);
no external request has been executed or pricing implicitly accepted.

Phrase-clip p95 describes the measured phrase lengths only. It does not certify
30-second throughput. Provisional admission also needs a separate measured
30-second profile (at least 20 successful clips, p95 <=60 seconds); short corpus
clips leave that profile unqualified even when their latency is low.
