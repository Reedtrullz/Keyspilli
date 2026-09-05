# Keyspilli ops

## Deploy (Ansible → RackNerd VPS)

Keyspilli follows the cross-project deploy pattern (see `/Users/reidar/Projectos/DEPLOYMENT.md`):
CI publishes immutable `ghcr.io/reedtrullz/keyspilli:sha-<12>` (web) and
`ghcr.io/reedtrullz/keyspilli-worker:sha-<12>` (worker) images; the deploy job
(or a manual run from this machine) applies `deploy/playbook.yml`, which
verifies the images/version, starts the compose stack on the VPS, checks
`/api/health` locally and publicly, manages the host Caddy block, and rolls
back to the previous images on failure. Production Caddy protects the entire
domain with operator Basic Auth; the application bearer token remains a
separate machine-mutation credential.

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
- Production edge credentials: export `KEYSPILLI_ACCESS_USERNAME` and
  `KEYSPILLI_ACCESS_PASSWORD` from the operator/CI secret store. The username
  must match the safe slug policy and the password must be at least 20
  characters; Ansible refuses to render the production block when either is
  missing. The password is hashed with bcrypt by the target Caddy binary and
  is never written to the repository or Ansible output.
- CI additionally needs the `production` GitHub environment and secrets
  `VPS_SSH_PRIVATE_KEY` + `VPS_SSH_HOST_KEY`, `KEYSPILLI_API_TOKEN`,
  `KEYSPILLI_ACCESS_USERNAME`, and `KEYSPILLI_ACCESS_PASSWORD` (see the
  Configure SSH key and deploy steps in `.github/workflows/ci.yml`).

## Optional seed catalog on a fresh volume

The bounded upload MVP bootstraps its schema on an empty `/data` volume; a
historic seed catalog is not required to upload, play, or export a symbolic
lesson. Build and copy `data/` only when the owner wants the curated catalog:

```bash
docker compose run --rm web node --import tsx packages/catalog/scripts/pipeline.ts
```

## Bounded symbolic uploads

The private `/uploads` flow accepts `.mid`, `.midi`, `.musicxml`, and `.mxl`
files up to 10 MB. The browser may submit same-origin bytes without exposing a
token after the production edge has authenticated the owner. Direct callers
inside the app network may send `Authorization: Bearer $KEYSPILLI_API_TOKEN`.
Through the production Caddy edge, send Basic Auth plus
`X-Keyspilli-Api-Token: Bearer $KEYSPILLI_API_TOKEN`: Caddy consumes and strips
the Basic `Authorization` header, while the application treats the custom
header as a transport alias for its unchanged bearer check.
The route derives a stable `upload-<sha256>` base id, so retrying identical
bytes replaces one six-level artifact set instead of creating duplicate rows.

The file is parsed and validated by the normal catalog ingest pipeline before
any artifact/SQLite publish. A native symbolic upload is a
`GENERATION_CANDIDATE` with `USER_SUPPLIED_PRIVATE` provenance and
`NATIVE_AUTHORITATIVE` timing: it is not an assertion that the score is
aligned to unrelated audio. Source bytes are retained under `data/uploads/`
and included in the existing bounded backup archive; malformed, unsupported,
empty, and oversized content fails closed without catalog rows.

### Optional generic source-search metadata

The source-lead button has one production provider: Brave Search API. It is
metadata discovery only; Keyspilli does not fetch result pages or third-party
music bytes. Each request sends four bounded queries (`MIDI`, `MusicXML`,
`Guitar Pro`, and `piano MIDI`), asks for at most 10 results per query, keeps at
most 40 sanitized unique URLs, and displays at most three ranker-approved
metadata cards. Results start with `UNKNOWN_RIGHTS` and `UNKNOWN_TIMING` and
remain user-mediated until the owner supplies and uploads an authorized file.

Obtain a Search API key from the [Brave API dashboard](https://brave.com/search/api/)
and install it only in the server/deployment secret store:

```bash
export KEYSPILLI_SOURCE_SEARCH_PROVIDER=brave
export KEYSPILLI_SOURCE_SEARCH_API_KEY='(operator secret; never print or commit)'
```

The application reads the key only on the server. Do not use a `NEXT_PUBLIC_`
variable, browser request, shell-history literal, report, or repository file.
To disable discovery, omit either variable; direct MIDI, MusicXML, and MXL
upload remains fully available. Provider failures, quota responses, and
timeouts return a bounded error state rather than blocking upload. The adapter
uses a five-second timeout and one retry for 429/5xx/network failures. It does
not persist a search cache because the [Brave API terms](https://api-dashboard.search.brave.com/documentation/resources/terms-of-service)
allow only transient Search Result storage; no zero-retention claim is made.

On production deploy, Ansible writes these two settings to the root-owned
`/etc/keyspilli/source-search.env` (`0700` directory, `0600` file) and mounts
that file into the web service. The rendered Compose manifest contains only
the path, never the credential. A deploy with no provider settings writes an
empty file and leaves discovery disabled.

The published Search price is $5/1,000 requests, so the frozen four-query
policy costs about $0.02 per song request before a retry (up to $0.04 in the
worst retry case). Brave's [rate-limit guidance](https://api-dashboard.search.brave.com/documentation/guides/rate-limiting)
and response headers remain authoritative. Search metadata has no implied
license; the owner must inspect the source and provide a permitted file.

At the implementation checkpoint no provider credential was available, so live
coverage and the 20-song replay were not run. The subsequent local credential
canary found the designated Keychain item, but its single Brave probe returned
non-transient HTTP 422; the frozen replay was withheld and no retry/tuning was
performed. See the fail-closed report
`docs/research/keyspilli-evidence/production-search-provider-credential-canary-2026-09-05.json`.
The provider comparison and implementation evidence are recorded in
`docs/research/keyspilli-evidence/production-generic-source-search-provider-2026-09-05.json`.

A later operator credential update was accepted by the same Brave endpoint:
the probe returned HTTP 200 with 10 results, and the frozen 20-song metadata
replay returned candidates for 20/20 targets. It used 82 provider requests
(80 successful responses and two 429 responses recovered by the existing
one-retry policy). No result pages or source bytes were fetched. This validates
the local provider canary only; the credential remains out of production, and
all remote metadata remains user-mediated. See
`docs/research/keyspilli-evidence/production-search-provider-credential-canary-rerun-2026-09-05.json`.

The closeout replay was required because the earlier successful canary retained
aggregate counts but not per-result metadata. One unchanged-policy replay
normalized 565 Brave candidates for the same 20-song corpus (10–35 per song),
with 80 HTTP 200 responses and one recoverable HTTP 429. Ranker-classified
strong structured coverage was 20/20 (MIDI 20/20, MusicXML 20/20, MXL 0/20,
Guitar Pro 20/20, piano-symbolic 0/20); these are metadata/query-hint classes,
not proof that a file exists or is licensed. All 20 had a
`USER_MEDIATED_CANDIDATE`; automatic acquisition remained 0/20. One real Brave
candidate reached the existing server-owned handoff contract in
`AWAITING_USER_FILE` state with `UNKNOWN_RIGHTS` and `UNKNOWN_TIMING`. No
candidate page or byte was fetched. The closeout report is
`docs/research/keyspilli-evidence/production-search-provider-canary-closeout-2026-09-05.json`.

### Bounded MVP release-candidate scope and deployment gate

The bounded release candidate is a private, single-user symbolic product:
MIDI, MusicXML, and MXL are accepted with their own symbolic timeline as the
authoritative timing, six physical variants are persisted, and five public
levels are exposed. YouTube conversion and independent score↔audio alignment
remain separate experimental/partial capabilities; no recognizability or
musical-quality guarantee is implied.

The production Ansible playbook installs a Caddy `basicauth` block for the
entire `app_domain`. The bcrypt hash is generated in memory from
`KEYSPILLI_ACCESS_PASSWORD`; no plaintext password is rendered or logged. The
local root `docker-compose.yml`/`deploy/Caddyfile` remain developer-only and
are intentionally not the production perimeter. This is a single-user edge
boundary, not an application account system: there is no signup, OAuth, or
multi-user authorization.

The deploy verifier requires anonymous public health to return HTTP 401, then
checks authenticated health/version and both authenticated PDF signatures.
The local `deploy/test/access-boundary.sh` canary also proves that Basic Auth
is stripped before the app and that a machine bearer can cross the edge via
`X-Keyspilli-Api-Token`. A missing edge credential fails the Ansible run before
any Caddy or Compose mutation. Rotate the edge password by updating the secret
store and running a normal immutable-image deploy; Ansible regenerates the
bcrypt hash and reloads Caddy. Do not copy the hash into Git or hand-edit the
live Caddyfile.

The boundary checkpoint was local-only before owner authorization. On
2026-09-04 the authenticated Ansible run applied the Caddy block and the
anonymous-401/authenticated-version verifier passed; the current live posture
is documented below. Preserve the historical pre-deployment evidence as
historical, and do not describe same-origin checks alone as a private boundary.

### Bounded MVP deployment canary — 2026-09-04

The owner-authorized canary deployed the exact web release
`03d19473aea27b8a7dbe494826a27f0b4870d900` as
`ghcr.io/reedtrullz/keyspilli:03d19473aea2` (manifest digest
`sha256:9de9d7904b9ecea2502576e310140b72327b5eef43344561885ce9e7d87ca6a9`).
The worker remained on its existing image
`ghcr.io/reedtrullz/keyspilli-worker:17f997600b9f`. Caddy Basic Auth protects
the full `keys.reidar.tech` HTTPS edge; anonymous health is HTTP 401 and
authenticated health reports the exact release SHA. The edge credential is
held in the operator secret store, not in this repository.

The first deploy attempt rolled back when the Ansible PDF verifier decoded a
binary response as UTF-8. Checkpoint `3b5bac58c7fd989e5f7d8595019f61875c2cd6b6`
made the verifier stream the PDF signature instead; the retry completed with
`ok=32 changed=7 failed=0`. The separate disposable worker-off canary proved
the bounded path does not depend on the ML worker; the live deployment kept the
existing worker image unchanged and running. The live canary then passed a
deterministic MIDI upload; the disposable RC canary covered MusicXML and MXL as
well, plus six physical rows, five public levels, player routes, exports,
retry idempotency, restart durability, cleanup, and manual backup validation.
The remote Compose topology passed; local Compose was not run because the
local plugin is unavailable. No generated musical bytes or policy changed.

For a future deploy, use the release manifest
`docs/research/keyspilli-evidence/bounded-mvp-deployment-canary-2026-09-04.json`
and the evidence entry in
`docs/research/keyspilli-evidence/KEYSPILLI_PRODUCT_PIPELINE_STATUS_2026_09.md`.

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
`COMPOSE_LOCAL_SMOKE_NOT_EXECUTED`, not a pass. The private-edge canary runs a
disposable Caddy 2.6.2 container and does not change the live VPS.

### Post-deploy operations audit — 2026-09-04

The live bounded MVP is the immutable web image
`ghcr.io/reedtrullz/keyspilli:03d19473aea2` at release revision
`03d19473aea27b8a7dbe494826a27f0b4870d900`. For a read-only operator check,
recover the edge password directly into a process environment and do not print
it:

```bash
export KEYSPILLI_ACCESS_PASSWORD="$(security find-generic-password -a keyspilli-owner -s keyspilli-production-basic-auth -w)"
curl --fail --silent --user "reidar:$KEYSPILLI_ACCESS_PASSWORD" https://keys.reidar.tech/api/health
unset KEYSPILLI_ACCESS_PASSWORD
```

The expected response is `healthy` with the exact release revision and image.
Anonymous HTTPS health must be HTTP 401; HTTP is only a 308 redirect. The web
container should remain healthy with zero restarts, and the worker image should
remain unchanged unless a separately authorized deployment says otherwise.
The app is loopback-bound on the VPS (`127.0.0.1:3008`); Caddy is the HTTPS
Basic Auth boundary. Do not treat same-origin checks as the private boundary.

Read-only host checks:

```bash
docker ps --filter name=keyspilli
docker system df
df -h /
systemctl status keyspilli-backup.timer
systemctl list-timers keyspilli-backup.timer
journalctl -u keyspilli-backup.service --since today
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

The 2026-09-04 audit found a coherent SQLite/artifact set, valid rollback image
tags, and successful automatic/manual backup validation. The host had 33.3 GiB
free (above the 30 GiB hard floor, below the 34 GiB preferred floor) and nearly
full swap. Do not prune or restart during an audit; record the exact reclaimable
Docker cache/image candidates and obtain separate authorization before cleanup.
The host has no retained Caddy access log or external uptime/disk/backup/cert/
container alerting, so proactive monitoring and exact HTTP 5xx totals are not
available; container health, journal scans, timer state, and direct probes are
the current evidence boundary.

The path-free audit record is
`docs/research/keyspilli-evidence/bounded-mvp-post-deploy-operations-2026-09-04.json`.

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

### Discovery-assisted private alpha deployment canary — 2026-09-05

The owner-authorized canary now runs the immutable web release
`67827050a695e54609f6cf3f064e4fdaaabbb65b` as
`ghcr.io/reedtrullz/keyspilli:67827050a695` (manifest digest
`sha256:9520812e80f70d7ede4faa8ab0f34f9060371a80748e9a7957da9cecafedc094`).
The worker remains on `ghcr.io/reedtrullz/keyspilli-worker:17f997600b9f`.
Ansible used the VPS Docker Compose 5.1.3 topology; the local workstation
still has no Compose plugin, so local Compose smoke is
`COMPOSE_LOCAL_SMOKE_NOT_EXECUTED`.

The Brave Search credential is installed only in the root-owned
`/etc/keyspilli/source-search.env` (`0600`) and is injected server-side. It is
not in Git, the rendered Compose file, browser assets, or recent logs. Caddy
Basic Auth protects the complete HTTPS edge; anonymous health is 401 and
authenticated health reports the exact release revision. The source-search
route is user-mediated metadata discovery: a positive probe returned three
candidates, while a valid Brave no-result response returns an empty set. No
result pages or source bytes are fetched.

The adapter honors the Brave free-plan request window with a 1.1-second retry
delay and accepts the provider's valid `mixed`-only empty response while still
rejecting malformed result arrays. After restart, `/uploads`, player, MIDI,
MusicXML, and both PDF exports returned 200 with valid content. Under Node
22.22.3/npm 10.9.8, focused provider tests (9/9), the workspace suite (1,672
tests), six typechecks, and `git diff --check` passed. This canary changes no
musical behavior or source-generation policy; independent alignment remains
partial and musical quality is not objectively established.
