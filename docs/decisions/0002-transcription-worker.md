# ADR 0002 — Transcription worker placement

Status: accepted (2026-08-09)

## Decision

YouTube → MIDI transcription uses Basic Pitch (ICASSP 2022 model). The worker
is a Node process that downloads audio with yt-dlp (with android/tv client
fallbacks for YouTube 403s) and shells out to Basic Pitch.

Serialization by platform:

- **Mac (dev):** CoreML (`KEYSPILLI_BP_SERIALIZATION=coreml`). Measured
  ~10 s wall time for a 4-minute piano cover on Apple Silicon.
- **VPS (Docker worker):** ONNX (`KEYSPILLI_BP_SERIALIZATION=onnx`, set in
  docker-compose). No TensorFlow needed, which also avoids TF's missing
  linux-arm64 wheels. CPU-only; expect several minutes per song.

## Pilot results (2026-08-09)

- "River Flows In You" cover (4:00): converted end-to-end; detected key A,
  1033 notes, 84 chords; done in ~10 s (CoreML).
- "Für Elise" (Lang Lang, 3:49 concert recording): converted; detected key
  A minor, 1143 notes.
- Bach "Prelude in C" (2:45): converted end-to-end by the containerized
  worker on ONNX.
- Note accuracy vs a reference MIDI was NOT measured; the feature is flagged
  experimental in the UI until a fixture-based accuracy study is run.

## Consequences

- Local worker command: `KEYSPILLI_BP_SERIALIZATION=coreml npm run worker -w @keyspilli/transcribe`.
- VPS: `docker compose up` runs the worker automatically.
- Known environmental pins (also in the Dockerfile): `setuptools<81`
  (pkg_resources), `scipy<1.13` (removed `signal.gaussian`), `numpy<2`.

## 2026-08-13 follow-up

- **120 BPM problem fixed:** Basic Pitch MIDIs carry no real tempo meta, so
  every YouTube row was stored at 120 BPM. `reingest-all-youtube.ts` now
  detects tempo from the audio (`services/transcribe/src/tempo.py`),
  rewrites the raw MIDI's tempo meta, then runs the onset filter + re-ingest
  with stable base ids. `KEYSPILLI_TEMPO_OVERRIDE` forces a tempo.
- **Raw unquantized evidence:** the pipeline stores Basic Pitch's raw,
  unquantized notes; quantization happens in `buildVariants` (0.125 grid for
  the advanced level, coarser for reductions).
- **Ladder fix:** variants are reductions of the hand-labeled advanced split,
  so each easier level is a true subset of the level above.
- **Worker reliability:** `conversion_jobs` gained an `attempts` counter;
  worker boot requeues orphaned `processing` jobs; failed jobs retry up to
  `KEYSPILLI_MAX_ATTEMPTS` (default 3) before staying `error`.
- **Accuracy study:** measurement harness added (`audit-transcriptions.ts`:
  per-song metrics plus reference-MIDI pitch-class overlap and median onset
  error). A fixture-based reference study is still pending.
