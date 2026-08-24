# Keyspilli

Personal browser-based piano-learning app (private, single-user). Color-coded
interactive player with 4 view modes, a ~167-song catalogue (444 difficulty
variants), MIDI uploads, YouTube conversion, live practice grading, and free
PDF/MIDI/MusicXML export.

## Quick start

```bash
npm install
npm run pipeline   # build catalog artifacts + sqlite db from data/seed-midi + catalog/manifest.json
npm run dev        # http://localhost:3000
```

## YouTube conversion (optional worker)

```bash
KEYSPILLI_BP_SERIALIZATION=coreml npm run worker -w @keyspilli/transcribe
```

Worker env knobs: `KEYSPILLI_TEMPO_OVERRIDE` forces the MIDI tempo (BPM),
`KEYSPILLI_MAX_ATTEMPTS` (default 2) retries a failed job before marking it
error, and `KEYSPILLI_BP_TIMEOUT_MS` (default 900000) bounds each Basic Pitch
run.

Requires the Python venv (`services/transcribe/.venv`, created via the
transcribe Dockerfile or manually: python3.12 -m venv + pip install
"setuptools<81" "numpy<2" "scipy<1.13" basic-pitch yt-dlp).

## Docs

- Master plan: `docs/superpowers/plans/2026-08-09-keyspilli-mvp.md`
- Reference analysis: `supersimplepiano-analysis.md`
- Ops (deploy/backup): `docs/ops.md`
