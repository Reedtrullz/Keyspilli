# Keyspilli

Personal browser-based piano-learning app (private, single-user). Color-coded
interactive player with 4 view modes, a ~167-song catalogue (444 difficulty
variants), symbolic source discovery, MIDI/MusicXML/MXL lesson creation, live
practice grading, and free PDF/MIDI/MusicXML export.

## Quick start

```bash
npm install
npm run pipeline   # build catalog artifacts + sqlite db from data/seed-midi + catalog/manifest.json
npm run dev        # http://localhost:3000
```

## Legacy audio worker (operator/research only)

The learner product does not create lessons directly from YouTube or other
audio. Its supported creation path is `/uploads`: optional metadata-only source
discovery followed by a user-supplied MIDI, MusicXML, or MXL file. The public
`POST /api/youtube/import` endpoint is disabled and does not enqueue work.

The worker below remains for historical catalog maintenance and explicit
operator research only. It is not a production source authority or automatic
fallback.

```bash
KEYSPILLI_IMPORT_MODE=auto KEYSPILLI_BP_SERIALIZATION=coreml \
  npm run worker -w @keyspilli/transcribe
```

The worker defaults to the metal-friendly `auto` route. It separates a full
band recording into Demucs' `vocals`, `bass`, `drums`, and `other` stems,
transcribes the pitched stems with Basic Pitch, extracts drum timing, and
reduces the result to a piano-shaped MIDI: vocal/riff identity in the right
hand, bass roots/fifths and power-chord harmony in the left hand, and drum
accents used as rhythm only. The arranger does not require the source to
contain piano. It writes small diagnostic stem MIDIs and an arranged MIDI
under the job directory, and records path-free separation/arrangement
provenance with the catalog artifact.

`KEYSPILLI_IMPORT_MODE` controls routing:

- `auto` (default) tries the stem arranger only when the separated material
  passes a conservative band/identity gate, then falls back to the established
  full-mix Basic Pitch importer when separation is unavailable or unsuitable.
- `metal` requires the stem arranger and fails the job if it cannot produce a
  recognizable arrangement; use this when a fallback would hide a pipeline
  problem.
- `legacy` bypasses separation and keeps the existing full-mix importer.

`docker-compose.yml` forwards this setting, so `KEYSPILLI_IMPORT_MODE=metal
docker compose up worker` enables the strict route for a canary run.

Useful worker knobs: `KEYSPILLI_DEMUCS_MODEL` (default `htdemucs_6s`, which
provides a dedicated guitar stem plus residual `other` evidence; four-stem
models fall back to `other`),
`KEYSPILLI_DEMUCS_DEVICE` (the shipped worker image is CPU-only),
`KEYSPILLI_STEM_MIN_FREE_GIB` (default `6`),
`KEYSPILLI_DEMUCS_TIMEOUT_MS` (default `2700000`),
`KEYSPILLI_TEMPO_OVERRIDE` (forces the MIDI tempo in BPM),
`KEYSPILLI_MAX_ATTEMPTS` (default `2`), and
`KEYSPILLI_BP_TIMEOUT_MS` (default `900000` per Basic Pitch run).
`KEYSPILLI_BP_SERIALIZATION=coreml` is useful for local macOS development;
the container uses ONNX by default when configured in Compose. The
`KEYSPILLI_ONSET`, `KEYSPILLI_FRAME`, and per-song `denseBand` override still
control Basic Pitch thresholds.

The Demucs model is baked into the transcribe image, so the image is larger
than the legacy worker and the first build downloads the model weights. CPU
separation is intentionally bounded to one worker job at a time; allow extra
time and disk for the temporary decoded stems. The worker refuses the stem
route when the data volume has less than the configured free-space floor.

Requires the Python venv (`services/transcribe/.venv`, created via the
transcribe Dockerfile or manually: python3.12 -m venv + pip install
"setuptools<81" "numpy<2" "scipy<1.13" basic-pitch yt-dlp).

## Docs

- Master plan: `docs/superpowers/plans/2026-08-09-keyspilli-mvp.md`
- Reference analysis: `supersimplepiano-analysis.md`
- Ops (deploy/backup): `docs/ops.md`
- Private-alpha feedback: `docs/private-alpha-feedback-guide.md`
