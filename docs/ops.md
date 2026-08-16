# Keyspilli ops

## Deploy (Ansible → RackNerd VPS)

Keyspilli follows the cross-project deploy pattern (see `/Users/reidar/Projectos/DEPLOYMENT.md`):
CI publishes immutable `ghcr.io/reedtrullz/keyspilli:sha-<12>` (web) and
`ghcr.io/reedtrullz/keyspilli-worker:sha-<12>` (worker) images; the deploy job
(or a manual run from this machine) applies `deploy/playbook.yml`, which
verifies the images/version, starts the compose stack on the VPS, checks
`/api/health` locally and publicly, manages the host Caddy block, and rolls
back to the previous images on failure.

Manual deploy (equivalent to the CI job):

```bash
APP_VERSION=$(git rev-parse HEAD) ansible-playbook \
  -i deploy/inventory/hosts.yml deploy/playbook.yml \
  -e "docker_image=ghcr.io/reedtrullz/keyspilli:$(git rev-parse --short=12 HEAD)" \
  -e "worker_image=ghcr.io/reedtrullz/keyspilli-worker:$(git rev-parse --short=12 HEAD)"
```

Preconditions (matching the other projects):

- Control node: `brew install ansible` + `ansible-galaxy collection install -r deploy/requirements.yml`.
- SSH key at `~/.ssh/id_rsa_racknerd`; inventory points at `198.23.137.16`, user `deploy`.
- VPS: Docker, Docker Compose v2, Caddy; GHCR pull access (`docker login ghcr.io` if the images are private).
- Domain: the inventory defaults to `keys.reidar.tech` — add a Caddy
  block for any other domain to `deploy/playbook.yml` vars or the inventory.
- CI additionally needs the `production` GitHub environment and secrets
  `VPS_SSH_PRIVATE_KEY` + `VPS_SSH_HOST_KEY` (see the Configure SSH key step in
  `.github/workflows/ci.yml`).

## First run on a fresh volume (catalog)

The catalog must be built before the app is useful. Build it locally and copy
`data/` contents into the VPS volume, or run inside the container:

```bash
docker compose run --rm web node --import tsx packages/catalog/scripts/pipeline.ts
```

## Adding songs from the Ultimate Guitar list

`catalog/ug-tabs.json` is the source list (82 songs from "My tabs @
Ultimate-Guitar.Com"). `packages/catalog/scripts/fetch-ug-midis.ts` downloads
verified MIDI files from BitMidi (personal use; the MIDI files themselves stay
out of git) and appends them to `catalog/manifest.json`. Then run
`npm run pipeline` and transfer `data/` to the VPS volume (see below).

## Syncing catalog data to the VPS

The deploy pipeline does not rebuild the catalog on the VPS — the
`keyspilli_keyspilli_data` volume holds it. After adding songs locally:

Run the playability gate first; it exits non-zero if any song fails:

```bash
npm run verify-catalog
npm run calibrate   # fails if catalog P99 drifts past configured limits
```

```bash
# 1. Checkpoint SQLite FIRST — the main db file excludes un-checkpointed WAL
#    writes, and copying it alone silently ships a stale catalog.
node -e "const D=require('better-sqlite3')('data/db.sqlite'); D.pragma('wal_checkpoint(TRUNCATE)'); D.close()"

# 2. Ship the data and swap it into the volume
tar czf - -C data db.sqlite artifacts transcribed seed-midi \
  | ssh deploy@198.23.137.16 'mkdir -p /tmp/keyspilli-seed && tar xzf - -C /tmp/keyspilli-seed'
ssh deploy@198.23.137.16 'docker stop keyspilli keyspilli-worker && \
  docker run --rm -v keyspilli_keyspilli_data:/data -v /tmp/keyspilli-seed:/src:ro \
    ghcr.io/reedtrullz/keyspilli:latest \
    sh -c "rm -f /data/db.sqlite-wal /data/db.sqlite-shm && cp -a /src/. /data/" && \
  docker start keyspilli keyspilli-worker'
```

Verify after the swap: `https://keys.reidar.tech/api/songs?group=1&limit=1` should
report the expected song count.

## Health / version contract

`/api/health` returns `{status: "healthy", version, commit, image}`. The
playbook refuses to deploy unless the container reports the exact git SHA.

## Backups

Nightly cron on the VPS:

```cron
0 3 * * * /path/to/repo/deploy/backup.sh >> /var/log/keyspilli-backup.log 2>&1
```

Backups land in `/backups` (mount or copy off-box): a consistent SQLite copy
plus a tarball of `artifacts/` and any persisted source/provenance material
(`seed-midi/`, `transcribed/`, `uploads/`, `manifest.json`, and review metadata),
retained 14 days. The backup script fails closed when the database or artifact
tree is missing; it does not publish a dated partial backup.

Restore:

```bash
docker compose stop worker
docker compose run --rm -v keyspilli_data:/data -v /backups:/backups web \
  sh -c "set -eu; test -f /backups/db-LATEST.sqlite; test -f /backups/artifacts-LATEST.tar.gz; rm -f /data/db.sqlite-wal /data/db.sqlite-shm /data/manifest.json /data/learner-review.json; rm -rf /data/artifacts /data/seed-midi /data/transcribed /data/uploads; cp /backups/db-LATEST.sqlite /data/db.sqlite; tar -xzf /backups/artifacts-LATEST.tar.gz -C /data; test -d /data/artifacts"
docker compose start worker
```

## Adding songs to the catalog

1. Put MIDI/XML in `data/seed-midi/`.
2. Add an entry to `catalog/manifest.json` (id, title, artist, sourceFile…).
3. Run `npm run pipeline`.
4. Commit `catalog/manifest.json`.

## Ultimate Guitar chord mode

The player supports an optional chart-backed chord timeline alongside the
generated MIDI chords. Source mappings live in `catalog/chord-sources.json`,
and normalized, payload-free timelines live under `catalog/chord-timelines/`.
Validate them before a build:

```bash
npm run verify-chord-sources
```

CI runs the same verifier with `--require-catalog`; after the pipeline it
resolves every database-linked base through either a checked-in chart or the
generated MIDI fallback. An empty chord timeline is reported for diagnosis
and deliberately leaves the player on its normal piano background.

The player can prefer UG chords, generated chords, or automatically choose UG
when available. A missing or partial chart falls back to generated chords and
is labelled in the player. Do not check in copied lyrics, raw tab text, or
provider page bodies; retain only normalized chord events and provenance.

## YouTube conversion notes

- The worker uses `yt-dlp` + Basic Pitch (CPU). Long videos are slow; the UI
  recommends solo-piano covers under 5 minutes.
- Backend: ONNX (no TensorFlow needed). On the Mac for fast local development,
  set `KEYSPILLI_BP_SERIALIZATION=coreml` (CoreML is ~10× faster than CPU).
- Worker logs via `docker compose logs -f worker`.

## YouTube conversion maintenance

Audit transcription quality first: per-song playability metrics over stored
artifacts (tempo, note counts per level, max duration, % notes over 2/8
beats, max simultaneity, % starts on the 1/16 grid), plus pitch-class overlap
and median onset error vs a seed reference MIDI when one exists for the same
piece (else `n/a`):

```bash
npx tsx packages/catalog/scripts/audit-transcriptions.ts
```

Tempo + re-ingest: detected tempo from the audio
(`services/transcribe/src/tempo.py`) is written into the raw Basic Pitch
MIDI's tempo meta, which is then onset-filtered and re-ingested with stable
base ids. Dry-run first, then the real pass:

```bash
npx tsx packages/catalog/scripts/reingest-all-youtube.ts --dry-run
npx tsx packages/catalog/scripts/reingest-all-youtube.ts
```

- `KEYSPILLI_TEMPO_OVERRIDE=<bpm>` forces a tempo instead of running tempo.py.
- If `tempo.py` is not present yet, re-ingest keeps the MIDI's tempo (120).
- Worker boot requeues orphaned `processing` jobs; failed jobs retry up to
  `KEYSPILLI_MAX_ATTEMPTS` (default 2) before staying `error`.
- `fetch-seed.ts` preserves existing manifest entries whose source files are
  present locally, so a clean CI fetch cannot drop tracked curated seeds.
- Every generated `notes.json` records a non-secret `provenance` object
  (`kind`, `acquiredVia`, `sourceRef`, and optional YouTube URL); re-ingest and
  curated restore scripts carry this metadata forward.

## Useful commands

```bash
docker compose logs -f web
docker compose logs -f worker
docker compose run --rm web node --import tsx packages/catalog/scripts/pipeline.ts
```

### Rebuild notes (2026-08-13)

- The re-ingest rescales the raw MIDI's beats to the new tempo, so playback
  speed stays identical to the original recording and the onset filter stays
  aligned. Do not re-ingest with the old (meta-only) script.
- `--keep-existing-tempo` preserves non-120 DB tempos (manual corrections such
  as Dear God's 75 BPM) and only detects for rows still at the old 120 default.
- Positional base ids restrict the run: `npx tsx ... reingest-all-youtube.ts <baseId>...`
- VPS: trigger the "Rebuild YouTube catalog on VPS" job via GitHub Actions
  workflow dispatch (runs inside the worker container with `--keep-existing-tempo`).
