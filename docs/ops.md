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

## Bounded symbolic uploads

The private `/uploads` flow accepts `.mid`, `.midi`, `.musicxml`, and `.mxl`
files up to 10 MB. The browser may submit same-origin bytes without exposing a
token; machine callers must send `Authorization: Bearer $KEYSPILLI_API_TOKEN`.
The route derives a stable `upload-<sha256>` base id, so retrying identical
bytes replaces one six-level artifact set instead of creating duplicate rows.

The file is parsed and validated by the normal catalog ingest pipeline before
any artifact/SQLite publish. A native symbolic upload is a
`GENERATION_CANDIDATE` with `USER_SUPPLIED_PRIVATE` provenance and
`NATIVE_AUTHORITATIVE` timing: it is not an assertion that the score is
aligned to unrelated audio. Source bytes are retained under `data/uploads/`
and included in the existing bounded backup archive; malformed, unsupported,
empty, and oversized content fails closed without catalog rows.

### Bounded MVP release-candidate scope and deployment gate

The bounded release candidate is a private, single-user symbolic product:
MIDI, MusicXML, and MXL are accepted with their own symbolic timeline as the
authoritative timing, six physical variants are persisted, and five public
levels are exposed. YouTube conversion and independent score↔audio alignment
remain separate experimental/partial capabilities; no recognizability or
musical-quality guarantee is implied.

The repository Caddy configuration currently has no basic auth, forward-auth,
IP allow-list, VPN restriction, or other perimeter boundary. Because the live
domain is internet-reachable and same-origin browser uploads intentionally do
not require the bearer token, this posture is `PUBLIC_WRITE_SURFACE_WITHOUT_PRIVATE_ACCESS_BOUNDARY`.
Do not mark a deployment ready until an owner-approved private boundary is in
place. Do not add application accounts as a workaround in this release.

Future explicitly authorized deployment checklist:

1. Verify a clean release SHA and matching immutable image tags.
2. Verify CI status for that exact SHA.
3. Build or pull the immutable web (and required worker) image.
4. Back up the current production volume and verify the archive.
5. Verify host free disk and Docker space.
6. Verify the private access boundary from an unauthorized network path.
7. Deploy the exact image with Ansible/Compose.
8. Check `/api/health` for `healthy` and the exact release SHA.
9. Run the bounded MIDI/MusicXML/MXL upload canary with the worker off.
10. Open the Easy player link and confirm the five public levels plus legacy Very Easy.
11. Verify MIDI, MusicXML, and PDF exports.
12. Check backup timer/state and the latest successful backup.
13. If health/version or the canary fails, stop and use the documented immutable-image rollback; preserve the data volume.

Local release-candidate evidence used Docker Engine/container smoke. Docker
Compose v2 was unavailable on the audit host, so local Compose smoke is
`COMPOSE_LOCAL_SMOKE_NOT_EXECUTED`, not a pass.

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

The deployment installs and enables `keyspilli-backup.timer`, scheduled around
03:00 host time with a randomized delay of up to 15 minutes. The one-shot service
executes `deploy/backup.sh` inside the running worker image, sharing the live
data volume and writing to `/backups` on the VPS:

```bash
systemctl status keyspilli-backup.timer
systemctl list-timers keyspilli-backup.timer
systemctl start keyspilli-backup.service  # manual verified run
journalctl -u keyspilli-backup.service --since today
```

Backups contain a consistent SQLite copy plus a validated tarball of
`artifacts/` and persisted source/provenance material (`seed-midi/`,
`transcribed/`, `uploads/`, `manifest.json`, and review metadata), retained 14
days. The script fails closed when the database, artifact tree, or source
material is missing and never publishes a dated partial backup. `/backups` is
currently local to the VPS; copy the dated files off-box if disaster recovery
outside that host is required.

Restore:

```bash
docker compose stop worker
LATEST_DB=$(ls -1t /backups/db-*.sqlite | head -1)
LATEST_ARCHIVE=$(ls -1t /backups/artifacts-*.tar.gz | head -1)
docker compose run --rm -v keyspilli_data:/data -v /backups:/backups web \
  sh -c "set -eu; test -f '$LATEST_DB'; test -f '$LATEST_ARCHIVE'; rm -f /data/db.sqlite-wal /data/db.sqlite-shm /data/manifest.json /data/learner-review.json; rm -rf /data/artifacts /data/seed-midi /data/transcribed /data/uploads; cp '$LATEST_DB' /data/db.sqlite; tar -xzf '$LATEST_ARCHIVE' -C /data; test -d /data/artifacts"
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

- The learner-facing `/youtube` page enqueues through `POST /api/youtube/import`.
  That endpoint deliberately accepts only `{ "url": "https://..." }`, checks
  same-origin browser metadata, limits active work and repeat requests, and
  rejects duplicate URLs. It exists so the no-login single-user page does not
  need the server-only `KEYSPILLI_API_TOKEN` in browser JavaScript.
- `POST /api/youtube` remains the bearer-protected maintainer endpoint for
  metadata overrides and re-transcription. Never expose `KEYSPILLI_API_TOKEN`
  through `NEXT_PUBLIC_*` variables or embed it in the page bundle.
- The worker accepts videos up to the configured `KEYSPILLI_MAX_VIDEO_DURATION_SEC`
  (600 seconds by default). CPU inference is slow; the UI recommends
  solo-piano covers under 5 minutes, while the metal route is designed for
  full-band recordings such as rock and metal.
- Backend: ONNX (no TensorFlow needed). On the Mac for fast local development,
  set `KEYSPILLI_BP_SERIALIZATION=coreml` (CoreML is ~10× faster than CPU).
- Worker logs via `docker compose logs -f worker`.
- Datacenter IPs are frequently bot-challenged by YouTube. The worker image
  includes yt-dlp's matching EJS challenge solver, but a blocked egress still
  needs an operator escape. For a production deploy, set
  `KEYSPILLI_YT_PROXY=http://host:port` to a trusted non-credential proxy endpoint and
  `KEYSPILLI_YT_COOKIES_PATH=/absolute/path/on/vps/cookies.txt`; Ansible mounts
  the cookie file read-only at the worker's secret path. Never put browser
  cookies or proxy credentials in the repository, a browser bundle, or a proxy
  URL. For a one-off container run, `KEYSPILLI_YT_COOKIES` may point directly
  at a read-only cookie file. Both settings are passed to every yt-dlp call.
  If YouTube still returns a bot challenge, do not keep retrying the same job:
  use a trusted egress or pre-seed a job manually: create the job row, then
  place `audio.mp3` plus a `meta.json` sidecar
  (`{"title": "...", "uploader": "...", "durationSec": 302}`) in
  `/data/transcribed/<jobId>/`. When both files exist and validate, the worker
  skips yt-dlp entirely, enforces the same duration cap, transcribes normally,
  and records `audioAcquisition: "pre-seeded"` in artifact provenance.
  A missing or malformed sidecar falls back to normal yt-dlp download.
- Per-song overrides live in `catalog/transcription-overrides.json` (keyed by
  base id or job id). In addition to the existing threshold keys, two newer
  knobs help dense material: `"denseBand": true` lowers Basic Pitch thresholds
  to onset 0.4 / frame 0.25, widens the onset match window to 0.35s, and skips
  the audio-onset filter entirely; `"skipOnsetFilter": true` only disables the
  filter. Use them when a legitimate transcription loses melody notes to the
  filter (symptom: very low note count and pitch distribution stuck in bass).

### Metal-friendly import route

The worker image defaults to `KEYSPILLI_IMPORT_MODE=auto`. The route is:

1. Demucs (`htdemucs_6s`) separates a dedicated `guitar` lane alongside
   `vocals`, `bass`, `drums`, and `other`; configured four-stem models remain
   compatible and use `other` as the guitar fallback.
2. Basic Pitch uses role-specific thresholds for vocals, bass, guitar, and the
   residual `other` lane; a lightweight onset detector supplies drum timing
   without turning drums into pitched piano notes.
3. The role-aware arranger compares dedicated guitar with residual upper
   evidence, moves stable low rhythm into the left hand, fuses trustworthy
   moving vocal phrases with lead guitar in vocal rests, and preserves short
   solo attacks through Medium. Easy keeps the melodic contour while thinning
   implausibly fast attacks. Sparse sections may receive a conservative
   upper-evidence top-line only when repeated stem evidence supports it; no
   pitch is invented for a low-only/rest section. The arranger keeps bass
   roots/fifths and section harmony in the left hand and emits explicit
   right-/left-hand tracks plus difficulty variants.

Use `KEYSPILLI_IMPORT_MODE=metal` for a strict operator run, or
`KEYSPILLI_IMPORT_MODE=legacy` to bypass separation. In `auto`, a missing
model, timeout, low-free-space condition, malformed stem output, or weak
identity result is recorded and the job uses the existing full-mix Basic
Pitch path. This keeps ordinary imports fail-closed while allowing a noisy
metal recording to remain importable. Set the mode in the worker container's
environment; the Docker image default is `auto`.
The compose file forwards `KEYSPILLI_IMPORT_MODE`, so a one-off strict canary
can be started with `KEYSPILLI_IMPORT_MODE=metal docker compose up worker`.

The shipped transcribe image includes CPU PyTorch, Demucs 4.0.1, the
`htdemucs_6s` weights, Basic Pitch, ffmpeg, and yt-dlp. Expect roughly a 3 GB
worker image with the CPU torch/Demucs stack and at least 6 GiB of free space
for the default temporary-stem guard; longer recordings may need more. The
shipped image is CPU-only, so
`KEYSPILLI_DEMUCS_DEVICE=cpu` is the deploy-safe setting. CUDA/MPS values are
configuration hooks for a separately built runtime and are not enabled by the
current image.

For each successful separation, the worker keeps only compact diagnostics in
`/data/transcribed/<jobId>/stem-midi/` (`vocals.mid`, `bass.mid`, `guitar.mid`,
`other.mid`, `drums.mid`, and `report.json`) plus the piano-shaped
`arranged/arrangement.mid`; decoded WAV stems remain in a bounded temporary
directory and are removed. If `auto` falls back, these diagnostic directories
are removed so stale stems cannot be mistaken for the published source. The
catalog stores model/version, note counts, arrangement strategy, identity
source, and warnings as path-free provenance. Inspect the worker log and the
job's `notes.json`/manifest provenance when diagnosing a result.

The arranger is a practical reduction, not a claim of a note-for-note guitar
transcription: it preserves recognizable melody/riff material and harmonic
motion while deliberately discarding unplayable distortion layers and using
drums as rhythmic evidence only. Validate a new band or recording manually in
the player before treating it as a curated catalogue entry.

## YouTube conversion maintenance

Audit transcription quality first: per-song playability metrics over stored
artifacts (tempo, note counts per level, max duration, % notes over 2/8
beats, max simultaneity, % starts on the 1/16 grid), plus pitch-class overlap
and median onset error vs a seed reference MIDI when one exists for the same
piece (else `n/a`):

```bash
npx tsx packages/catalog/scripts/audit-transcriptions.ts
```

For the controlled piano fixture comparison, use the explicit read-only
mapping (it reports candidate/audio hashes, embedded tempo evidence, and
artifact provenance):

```bash
npx tsx packages/catalog/scripts/compare-piano-fixtures.ts
```

Its onset metrics are timing diagnostics only; they are not pitch accuracy or
learner-quality scores.

Discover alternate YouTube recordings before choosing a re-transcription
source. Discovery is read-only against YouTube and the catalog DB, does not
download media, and merges ranked review candidates into an untracked local
manifest:

- All YouTube imports: `npx tsx packages/catalog/scripts/discover-youtube-sources.ts`
- Selected songs: `npx tsx packages/catalog/scripts/discover-youtube-sources.ts <baseId...>`
- Candidates per song: add `--limit 8` before base IDs.

Ranking favors piano/performance signals and song-title coverage, penalizes
tutorial/reaction-style uploads and live or unusable durations, and excludes
the currently imported video. Treat the manifest as a review aid; importing a
candidate remains a separate operator decision.

`quality-report.ts` uses the same validated YouTube source resolver when
classifying whether a persisted transcription source is available.

Tempo + re-ingest: detected tempo from the audio
(`services/transcribe/src/tempo.py`) is written into the raw Basic Pitch
MIDI's tempo meta, which is then onset-filtered and re-ingested with stable
base ids. Dry-run first, then the real pass:

```bash
npx tsx packages/catalog/scripts/reingest-all-youtube.ts --source=root --dry-run
npx tsx packages/catalog/scripts/reingest-all-youtube.ts --source=root
```

- Source selection is explicit: `--source=root` (the production rebuild
  default), `--source=strict` (only a validated `re/` candidate; fail closed if
  it is absent), or `--source=auto` (use strict when present, otherwise root).
  CI/VPS rebuilds and the full-catalog `reingest-catalog.ts` pass use
  `--source=root` deliberately; strict is opt-in after an A/B review. The
  restore and single-pass re-ingest helpers retain their legacy `auto` default
  for compatibility, but production/operator runs should pass `--source=root`
  or `--source=strict` explicitly. They pair a `re/` MIDI with the job's root
  audio when the strict run does not carry a second audio file, and strict
  source failures now return a non-zero exit status.
- `retranscribe-youtube.ts` is the mutation-producing strict Basic Pitch job:
  it writes `re/` candidates from root audio and immediately ingests them.
  Treat it as an operator-reviewed experiment; it has no dry-run mode.
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
- For a targeted run, keep the source choice explicit as well:
  `npx tsx .../reingest-all-youtube.ts --source=root <baseId> ...`.
- The helper scripts have read-only preflight modes:
  `npx tsx .../reingest-youtube.ts --dry-run --source=root` and
  `npx tsx .../restore-youtube.ts --dry-run --source=root <baseId> ...`.
  `reingest-catalog.ts --dry-run` also leaves disabled rows untouched and only
  reports the removal it would perform.
- Positional base ids restrict the run: `npx tsx ... reingest-all-youtube.ts <baseId>...`
- VPS: trigger the "Rebuild YouTube catalog on VPS" job via GitHub Actions
  workflow dispatch (runs inside the worker container with `--keep-existing-tempo`).
