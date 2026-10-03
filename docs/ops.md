# Keyspilli ops

## Deploy (Ansible → RackNerd VPS)

The [CI workflow](../.github/workflows/ci.yml) publishes immutable
`ghcr.io/reedtrullz/keyspilli:<12-character-commit>` (web) and
`ghcr.io/reedtrullz/keyspilli-worker:<12-character-commit>` (worker) images; the deploy job
(or a manual run from this machine) applies `deploy/playbook.yml`, which
verifies the images/version, starts the compose stack on the VPS, checks
`/api/health` locally and publicly, manages the host Caddy block, and rolls
back to the previous images on failure. Production Caddy protects the entire
domain with operator Basic Auth; the application bearer token remains a
separate machine-mutation credential.

Pushes to `main` run checks, build both images, and deploy automatically. Manual
workflow dispatch defaults to `deploy_only`. Choose `rebuild_target` with a
validated base ID, or `rebuild_all` with the exact confirmation
`REBUILD_ALL_CATALOG`, to opt into catalog mutation. Both retain the production
environment gate. A deployment retry leaves catalog sources and data untouched. CI builds the tutorial worker from
`services/transcribe/Dockerfile.tutorial --target worker`; the root Compose
file is a separate development topology with the legacy audio worker.

Manual deploy (equivalent to the CI deploy job, after images exist):

```bash
APP_VERSION=$(git rev-parse HEAD) ansible-playbook \
  -i deploy/inventory/hosts.yml deploy/playbook.yml \
  -e "docker_image=ghcr.io/reedtrullz/keyspilli:$(git rev-parse --short=12 HEAD)" \
  -e "worker_image=ghcr.io/reedtrullz/keyspilli-worker:$(git rev-parse --short=12 HEAD)"
```

Preconditions (matching the other projects):

- Control node: `brew install ansible` + `ansible-galaxy collection install -r deploy/requirements.yml`.
- The inventory defaults to `~/.ssh/id_rsa_racknerd` for CI, host `198.23.137.16`, user `deploy`. Local operators should use their configured deploy key; override `ansible_ssh_private_key_file` when needed. The local `Racknerd-Deploy` SSH alias uses a different key. Never copy private key material into the repository.
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
The route derives a stable `upload-<sha256>` base ID. Identical accepted bytes
return the current accepted publication. Deliberate replacement requires its
current revision; a stale replay cannot replace newer metadata. Normal song
intake and explicit short studies expose only the levels that pass their own gates.

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

The September 2026 implementation estimate used $5/1,000 requests: about
$0.02 per four-query request before retry, or $0.04 with all queries retried.
Check the provider dashboard for current pricing before budgeting. Brave's [rate-limit guidance](https://api-dashboard.search.brave.com/documentation/guides/rate-limiting)
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
The host has no external monitoring service or retained Caddy access log, so
exact HTTP 5xx totals and off-host alerts are not available. The Keyspilli-owned
operations checker below makes local failures visible through systemd and the
journal without adding another credential or service.

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

`/api/health` reports `status`, `version`, `commit`, `image`, capabilities and
the visible arrangement-row count in `songs`. A database failure returns
HTTP 503 with `status: "degraded"`. The playbook requires a healthy response
with the exact Git SHA and expected tutorial capability.

Every release that changes a browser mutation must also run real Chromium
through the reverse proxy and exact production image, then perform an actual
same-origin mutation. A curl request with forged `Sec-Fetch-Site` metadata is
not sufficient evidence for this gate.

## Operations monitoring

The deployment installs `/usr/local/sbin/keyspilli-ops-check`. Its compact JSON
report covers live revision/image consistency, web health, worker state,
`directAudioAmt=false`, source-discovery configuration, private-edge HTTP 401,
disk, backup state/age, TLS expiry, Caddy validity, container restart counts,
and recent source-provider outcome counts. It never calls Brave or prints a
credential.

```bash
sudo /usr/local/sbin/keyspilli-ops-check --mode light
sudo /usr/local/sbin/keyspilli-ops-check --mode deep
systemctl list-timers 'keyspilli-ops-check*'
journalctl -u keyspilli-ops-check.service -u keyspilli-ops-check-deep.service
```

The light timer runs every 30 minutes. The daily deep timer additionally checks
the live and latest-backup SQLite databases plus basic archive readability.
Disk is healthy at 34 GiB or more, warning from 30–34 GiB, and failed below
30 GiB. Backups warn after 30 hours and fail after 48 hours. TLS warns below
21 days and fails below 7 days. Warnings exit zero; failures leave the one-shot
systemd unit failed and visible in the journal. The checker never prunes Docker
or deletes user data.

The checker is additive and carries no application state. To roll back only
the monitoring installation, stop and disable
`keyspilli-ops-check.timer` and `keyspilli-ops-check-deep.timer`, remove their
two timer units, two one-shot service units, and
`/usr/local/sbin/keyspilli-ops-check`, then run `systemctl daemon-reload`.
This does not stop or recreate the web, worker, Caddy, backup timer, or data
volume. Re-running the current deployment monitoring tasks restores the exact
committed units and checker.

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

### Data retention and backup cost

The 14-day rule in `deploy/backup.sh` applies only to complete, hash-verified
backup cohorts. The script can delete those old cohorts; this is distinct from
retaining live catalog and tutorial data. Confirm the deployed script, timer,
latest coherent pair, restore drill, duration, and actual free space on the host
before relying on this rule. None of the checks below activates live-data
deletion.

Retention preserves malformed, incomplete, hash-mismatched, symlinked and
recently changed cohorts. All three files must have aged past the cutoff; the
completion manifest must declare schema 1, literal `complete: true`, exact
filenames, byte counts and matching hashes. Invalid retention settings fail
before creating a backup. No live tutorial/source directory is deleted.
Each successful script run emits a `backupRetention` JSON line to stderr with
elapsed seconds, bytes checked, pruned cohorts/bytes and ambiguous cohorts kept.
Payload deletion failures keep the remaining completion marker and fail the run;
the report counts them separately rather than claiming the cohort was preserved.
Elapsed time covers the data-only script, including archive and retention work;
it excludes Docker startup and host pause/unpause. Measure the complete host
service separately using `ExecMainStartTimestampMonotonic` and
`ExecMainExitTimestampMonotonic`.

| Class | Owner and references | Retention decision |
| --- | --- | --- |
| Active or retryable jobs | SQLite job state, lease, and `transcribed/<job id>` | Keep source and attempt bytes through completion, retry, or cancellation reconciliation. |
| Accepted artifacts and sources | Catalog rows, six-level artifact tree, prepared chord timeline, source provenance, uploads and seed/transcribed inputs | Keep with the song and backup. A metadata edit or re-ingest does not authorize deletion. |
| Review-needed or failed attempts | Job error, source-handoff/reconciliation records, candidate media and symbolic outputs | Keep until the owner resolves the review and a verified backup/restore path exists. |
| Tutorial snapshot index | `transcribed/.tutorial-cache` entry pointing to an attempt directory | The 24-hour reuse limit controls lookup only; expiry does not authorize deleting the index or its referenced assets. |
| Unreferenced intermediates | A specific staging/old directory or temporary file with no job, catalog, handoff, cache, journal, or backup reference | Inventory only. Retain on ambiguous ownership; deletion requires a separate reviewed list, recovery evidence, and authorization. |

For a dry-run inventory, read SQLite jobs and catalog rows first, then list
`artifacts/`, `transcribed/` (including hidden files), `uploads/`,
`seed-midi/`, and backup manifests with sizes and modification times. Compare
exact IDs and paths with jobs, source references, prepared timelines, cache
indexes, and reconciliation journals. A missing current catalog row alone is
insufficient evidence that a file is disposable. Existing read-only `find`,
`du`, SQLite queries, and the ops check can report these classes; no janitor or
new inventory command is warranted until a real dry run exposes a gap.

A bounded **synthetic** cost probe on 27 September 2026 used 9,449,472 input
bytes (4 MiB artifact, 4 MiB tutorial video, 1 MiB seed, small SQLite DB).
On this Mac, `tar -czf` took 0.1968 s and produced 9,441,962 bytes; archive
readback took 0.0087 s; initial SHA-256 hashing took 0.0055 s; checking one
manifest and both hashes for a retention decision took 0.0052 s. No files
were deleted. The method used a temporary fixture, timed `tar`, `tar -tzf`,
streaming SHA-256, then verified manifest hashes. These numbers do not predict
the host's pause length, production media volume, backup freshness, or retention
activation; measure those on the live host before broadening tutorial imports.

On 3 October 2026 the existing production backup service completed successfully
(exit 0) from 03:03:40 to 03:05:06 UTC. Its monotonic timestamps show **85.596 s**
for the host runner, including pause, archive/checks and unpause. The committed
pair contains a 1,409,024-byte database and a 489,959,394-byte archive. The host
has 27 GiB available. These are observed costs at the current media volume,
not a forecast for broader imports. The fourteen current backup cohorts are
younger than fourteen days; no naturally expired production cohort was removed.
The isolated backup-script tests exercise actual whole-cohort deletion and
preservation of incomplete/corrupt/recent members, orphans and live sources.
The policy and current-cost requirement can be assessed without forcing expiry
of a live backup. Re-measure after any material increase in retained media.

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

## Canonical lesson-creation path

The current learner product is `EXTERNAL_SYMBOLIC_FIRST`:

1. Enter artist and title on `/uploads`.
2. Optionally request metadata-only source leads from Brave Search.
3. Open a candidate independently and, if useful, select it as a metadata lead.
4. Affirm the song identity and authorization.
5. Upload the authorized MIDI, MusicXML, or MXL bytes.
6. Keyspilli validates those bytes and creates the lesson, player, and exports.

Discovery never fetches a candidate page or symbolic file. It is optional, and
direct symbolic upload remains available when Brave is absent or unavailable.
If the bounded search has no eligible result, the product reports that no usable
source lead was found; it does not start audio transcription.

### Private piano-tutorial beta

With `KEYSPILLI_TUTORIAL_BETA=1`, a nonempty `KEYSPILLI_DATA_DIR`, and
`NODE_ENV=production` or `development`, `/uploads` and `/youtube` expose the
piano-tutorial flow. The development-only `KEYSPILLI_TUTORIAL_PREVIEW=1` is
also supported. `POST /api/youtube/import` validates the URL and mutation
authorization before queuing a tutorial job; the compatible worker must share
the data directory. This extracts supported visible piano keys, not arbitrary
recording-to-piano audio transcription. The production playbook currently
defaults `keyspilli_tutorial_beta` to `true`.

Without the opt-in, the import endpoint returns HTTP 410 with
`DIRECT_AUDIO_AMT_DISABLED`, and `/youtube` shows a link to symbolic upload.
See [development import options](development.md#import-options) for the worker
image and local setup.

`GET /api/health` reports release identity, DB status and `songs` (the count of
visible arrangement rows, not unique titles), plus `symbolicUpload`,
`tutorialImportsEnabled`, `sourceDiscoveryConfigured`, and `directAudioAmt`.
The latter remains `false` even when tutorials are enabled. Health does not
contact the discovery provider or establish musical quality.
Check local disk separately with `df -h /System/Volumes/Data`; 30 GiB is the hard
engineering floor and 34 GiB the preferred floor.

## Legacy operator-only YouTube conversion notes

- `POST /api/youtube/import` is only the opt-in tutorial path described above,
  not an endpoint for legacy full-mix/stem maintenance.
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
  workflow dispatch with `rebuild_target` and an explicit base ID, or `rebuild_all`
  with `REBUILD_ALL_CATALOG` (runs inside the worker container with
  `--keep-existing-tempo`). The default `deploy_only` skips this job.

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

### User-mediated source handoff live canary — 2026-09-05

The owner-authorized live canary exercised metadata-only discovery, explicit
owner affirmation, and the existing symbolic upload/generation path on the
`67827050a695e54609f6cf3f064e4fdaaabbb65b` web release. Brave returned three
metadata candidates and one MIDI lead was selected. The uploaded file was a
320-byte project-owned synthetic MIDI; no discovered page or third-party
symbolic bytes were fetched or uploaded.

Normal ingest generated six physical variants and five public levels. The Easy
player and sheet routes plus MIDI, MusicXML, and simplify-PDF exports returned
valid responses. A web-container restart preserved the item and exports.
Cleanup then removed the exact temporary base, source upload, artifacts,
transcription data, and handoff row; all temporary API rows and the grouped
projection are absent afterward. Path-free evidence is recorded in
`user-mediated-source-handoff-live-canary-2026-09-05.json`.

This is a lineage/operations canary only. Discovery remains metadata-only and
user-mediated; independent alignment remains partial and musical quality is
not objectively established.

### Audio AMT product boundary — 2026-09-05

The production strategy is `EXTERNAL_SYMBOLIC_FIRST`. Direct dense-metal AMT
is `AUDIO_AMT_BRANCH_CLOSED_FOR_CURRENT_PRODUCT_ARCHITECTURE` and must not be
used as source authority or a silent fallback. When discovery and owner upload
cannot provide trustworthy symbolic bytes, return
`NO_TRUSTWORTHY_SYMBOLIC_SOURCE_AVAILABLE`.

Do not install MuScriptor weights in production: the frozen weights are
non-commercial research-only, and the preregistered dense-metal robustness gate
failed. Historical small audio-derived diagnostics are unaffected. Reopening
full-song AMT requires a material trigger recorded in
`audio-amt-branch-closeout-2026-09-05.json`, not a new model listing, leaderboard
change, recommendation, or minor version bump.

### Hardened private-alpha deployment canary — failed and rolled back — 2026-09-05

The owner-authorized `4f87c05d25e175446ce05ceac6031fadab3f8892`
candidate was built natively as `linux/amd64`, passed exact-version container
health, and was temporarily installed by recreating only the web service in the
existing remote Compose topology. Ansible was not run because its required
local application/provider secret inputs were unavailable; replaying it would
have risked overwriting the validated server-side secret configuration. Caddy,
the worker, persistent data, and all existing credentials remained unchanged.

Discovery, metadata-only handoff, direct-AMT disablement, a project-owned
worker-off symbolic upload, all six physical and five public levels, player and
exports, retry idempotency, restart persistence, malformed-input atomicity, and
scoped cleanup passed. No discovered page or third-party source bytes were
fetched.

A real browser request from the authenticated `/uploads` page failed at the
mutation boundary with HTTP 403. The origin helper reconstructed the forwarded
HTTPS origin while retaining the internal container port, producing an origin
that cannot equal the browser's public origin. A curl request carrying only
`Sec-Fetch-Site: same-origin` did not expose this defect and is not an adequate
browser-upload canary. The browser failure also reproduced after restoring the
previous release, proving the bug is pre-existing.

The candidate was rolled back. Live health again reports revision
`67827050a695e54609f6cf3f064e4fdaaabbb65b`; database integrity, existing
content, worker identity, Caddy, secrets, and complete canary cleanup were
verified. Decision: `HARDENING_DEPLOYMENT_CANARY_FAILED_ROLLED_BACK`. Do not
retry deployment until `FIX_LIVE_SAME_ORIGIN_BROWSER_MUTATION_PORT_RECONSTRUCTION`
is implemented and covered by a reverse-proxy browser regression.

### Live same-origin browser mutation port fix — locally validated — 2026-09-05

The mutation guard must derive an effective public origin from a complete
`X-Forwarded-Proto` and `X-Forwarded-Host` pair by constructing a fresh URL.
Do not mutate the internal request URL's protocol and host independently: when
the forwarded host has no port, the URL host setter retains the internal
explicit port. Use the first trimmed forwarded values, accept only HTTP(S),
canonicalize default ports, preserve explicit public non-default ports, and fail
closed on a partial or malformed pair. Direct requests use their URL protocol
with the Host header. Bearer authorization remains the machine-mutation path.

The contract passed a real Chromium upload through a local reverse proxy into
the exact production image for revision
`c3a7e50ca621ac2b0ea943a474a8c6af572e19b7`. Cross-origin and same-site other
origins remained rejected, while six physical variants, five public levels,
player/export routes, and malformed-input atomicity passed in disposable state.
This is local release evidence only: production was not accessed or changed and
remains on the prior rollback revision according to existing evidence.

### Private-alpha deployment retry and monitoring — 2026-09-05

The same-origin fix is live as immutable web image
`ghcr.io/reedtrullz/keyspilli:e9dd13a672e9` (registry digest
`sha256:8f29dee0bd2c28d27128eeaedb2118447024a4bd2779b787e0f2489a5adcfcdc`).
Only the web service was recreated. The worker stayed on
`ghcr.io/reedtrullz/keyspilli-worker:17f997600b9f`; Caddy, secrets, data, and
the volume were unchanged.

A real Chromium browser completed metadata discovery, affirmed handoff, and a
project-owned MIDI upload through the authenticated live domain. Six physical
variants, five public levels, Easy and legacy Very Easy routes, MIDI/MusicXML
and both PDF exports, identical retry, restart persistence, malformed-input
atomicity, and complete scoped cleanup passed. Anonymous access remains 401,
cross-origin mutation 403, metadata-free mutation 401, and direct audio AMT
410. No third-party page or symbolic bytes were fetched.

The light and deep operations timers are deployed as documented above. At the
deployment closeout, disk was above the 30 GiB hard floor but below the
preferred 34 GiB threshold,
so the checker reports a warning while exiting successfully. The immutable
`67827050a695` image and pre-retry Compose file remain available for rollback.
The latest SQLite backup restored into scratch with integrity `ok`; production
was not restored or otherwise modified.

### Private-alpha owner usage

Normal owner use is the next product stage. It is not a QA script or listening
exercise. Report blocking, confusing, failed, or unexpectedly slow product
interactions using `docs/private-alpha-feedback-guide.md`; do not include
credentials, private paths, or source bytes by default. The objective local
usage matrix and short read-only live baseline are recorded in
`docs/research/keyspilli-evidence/private-alpha-usage-feedback-phase-2026-09-05.json`.


## Live catalog verification (F07)

CI and operator runs use `deploy/keyspilli-live-verifier.py`, which uses only
the Python standard library. It verifies anonymous `/api/health` returns 401,
authenticated health is healthy and exposes the expected deployment SHA, and
the flat `/api/songs?limit=200&offset=...` response has the advertised
`{songs,total}` shape. Pagination is bounded and fails closed on malformed,
short, repeated, oversized, or changing-total pages. A targeted rebuild checks
the requested `baseId` and a positive numeric tempo; it does not infer success
from titles or require tempo 120.

The workflow passes credentials, URL, SHA, and rebuild inputs through step
environment variables. It does not interpolate secrets or workflow inputs into
the verifier shell command.

Run locally:

    KEYSPILLI_DEPLOY_URL=https://keys.reidar.tech \
    KEYSPILLI_ACCESS_USERNAME=... KEYSPILLI_ACCESS_PASSWORD=... \
    KEYSPILLI_EXPECTED_SHA=$(git rev-parse HEAD) \
    KEYSPILLI_VERIFY_BASE_ID=dear-god \
    python3 deploy/keyspilli-live-verifier.py

Fixture check:

    python3 deploy/test/test-live-verifier.py

## Backup and restore (F08)

The systemd timer invokes the host-side
`/usr/local/sbin/keyspilli-backup-runner`. The runner takes a host
`flock`, inspects `keyspilli` and `keyspilli-worker`, and fails closed if
either is missing or not running/unpaused. It pauses both before starting a
separate backup container, and its exit trap unpauses only containers paused by
that run. The runner bounds the backup container to 300 seconds, sends TERM,
then KILL after 30 seconds, and explicitly removes the named container from
its exit path. The backup container receives the data volume and `/backups`,
but never a Docker socket. A timeout or failed unpause is a failed backup.

`deploy/backup.sh` is data-only. It creates a consistent SQLite snapshot,
validates the database and tar archive, and publishes the database and archive
before publishing `backup-manifest-STAMP.json` last. The manifest names the
paired files and records both SHA-256 checksums, SQLite `user_version` as
`catalogSchemaEpoch`, and the inspected immutable web/worker image IDs with
OCI revision labels. Missing labels remain null; a dated tag is not proof of
the restored revision. The archive includes
`artifacts/` recursively, so hidden `.BASE.reconciliation.json` and
`.BASE.old` recovery state is retained with ordinary artifacts. It also
includes the persisted source and provenance directories when present.

Retention removes only an old manifest whose complete database/archive pair
exists and whose recorded hashes still match. Orphaned or mismatched files
remain for operator inspection; independent glob cleanup is never used. The
ops monitor selects the newest coherent manifest pair and uses that same pair
for ages, checksum validation, SQLite integrity, and archive checks.

Run fixture checks:

    python3 deploy/test/test-backup.py
    bash deploy/test/ops-check.sh

### Non-destructive restore drill

Use a new, absent destination. The command verifies the committed pair and
checksums, copies both files, runs SQLite `PRAGMA integrity_check`, validates
safe tar members, and extracts into `FRESH_DESTINATION/runtime/` with a normal
`db.sqlite`, without changing the source backup. `restore-report.json` records
archive validation, schema epoch and elapsed time. Archive validation alone
leaves application verification `not_run`:

    bash deploy/restore-drill.sh \
      /backups/backup-manifest-2026-09-15-020000.json \
      /tmp/keyspilli-restore-drill-2026-09-15

To opt into actual application verification, supply the local web image ID,
full revision and a representative song variant **from that backup**:

    bash deploy/restore-drill.sh MANIFEST.json FRESH_DESTINATION \
      --verify-app sha256:IMAGE_ID FULL_40_CHARACTER_REVISION SONG_VARIANT_ID

The IDs must match the backup metadata and the image must already exist locally;
no image pull occurs. The verifier starts only that web image, with `--network
none`, no host listener, no worker, a read-only image filesystem and the isolated
restored runtime. It checks health/revision/schema, player document/detail and
MIDI/MusicXML plus both PDF exports, then removes its own named container even
on failure. The report distinguishes `passed`, `failed` and `not_run`, records
application elapsed time and exact identity, and never equates these structural
checks with playback/listening/keyboard acceptance. Old backups without image
metadata cannot claim a pinned application proof. Real backup execution needs
owner-approved access and enough space for a fresh full copy; fixture checks
are not a disaster-recovery certification.

Export verification checks complete MIDI header/track framing, a MusicXML note
and matching score closing tag, and PDF cross-reference offset/end markers.
The report labels this `exportValidation: framing_only`; it does not parse all
MIDI events, validate the MusicXML schema or inspect PDF page content. The fresh
destination is created atomically, so a concurrent writer's directory is refused
before backup files are copied.

### Publication reconciliation recovery

If a post-swap error leaves a `.BASE.reconciliation.json` marker in
`data/artifacts/`, mutations for that base remain blocked until the journal
is replayed:

    KEYSPILLI_DATA_DIR=/data npm run reconcile-artifacts -w @keyspilli/catalog -- BASE_ID

The CLI validates the published tree, replays the idempotent source/DB commit,
or restores the prior tree from `.BASE.old` when the swap never committed.
Do not manually delete reconciliation markers or `.BASE.old`; the CLI handles
cleanup after successful recovery.

## Artifact lock upgrade

The active lock is the persistent hidden
`.BASE_ID.lock.sqlite` file, acquired with SQLite `BEGIN EXCLUSIVE`. It is
never deleted because another writer may still hold its inode. A legacy
`.BASE_ID.lock` directory causes publication to fail closed. Stop old
writers and perform the migration manually under maintenance; do not make
backup, restore, or reconciliation silently remove a legacy lock.

The pause is a bounded filesystem snapshot boundary. It does not claim that
application transactions reached an application-level quiescent completion;
reconciliation and the restore drill remain explicit recovery checks.


## Persisted approved Chords packages

An approved song may include `artifacts/<baseId>/chord-timeline.json` alongside its six-level artifact tree. The timeline must identify the same base and carry `prepared:<source fingerprint>` provenance. The catalog loader prefers this per-song timeline over image-bundled charts; Player still verifies its source fingerprint. Runtime timeline file changes participate in cache invalidation. Publish the entire artifact tree through `publishBaseArtifact` with strict validation and the existing catalog reconciliation callback. Preserve all unrelated catalog rows and files.

This file lives inside the existing artifacts backup/restore boundary and survives immutable image upgrades. It is not a raw-upload endpoint or automatic musical approval. Verify the exact Original notes/clock and realized Chords events after publication. The `song-bundle.mts install` command remains an isolated-catalog tool, not a live catalog replacement.


## Runtime preflight and worker health

`npm run preflight` validates redacted startup configuration, opens an existing
catalog read-only with a 250 ms SQLite lock timeout, checks owned write paths,
and reports binary presence. It never creates a missing catalog or starts
imports. Optional provider/model/browser-library usability stays `unknown`
until separately exercised; an enabled flag or executable is not readiness.
Normal app startup with an explicit `KEYSPILLI_DATA_DIR` initializes/upgrades
its schema deliberately. `/api/health/live` is cheap process liveness;
`/api/health` is bounded catalog readiness and capability configuration.
The production private edge protects both routes.

The worker writes an atomic, ID-free, 4 KiB bounded heartbeat under the owned
transcribed directory. The separate `worker-health-check.ts` reader rejects
invalid/stale snapshots and reports idle/busy/draining/unfinished/health-error
states with a five-job queue sample and oldest sampled age. Production Compose
checks it every 30 seconds and allows 125 seconds for the worker's default
120-second shutdown grace. The ops checker requires a healthy heartbeat in
addition to a running container. Queue samples are bounds, not exact counts.
Queue polling must make progress: an unresolved poll stops refreshing its
heartbeat, and a rejected poll stays unhealthy until a successful retry.
The host checker independently samples up to five queued rows from the shared
catalog in read-only mode, with a query deadline. A stopped or absent worker
does not hide that queue; an unreadable catalog reports the sample unavailable.

SIGTERM stops admission and aborts supported subprocesses. Before publication,
shutdown releases only its owned lease without consuming an attempt. After an
atomic swap has been authorized, publication may finish or require existing
journal/lease recovery; shutdown does not discard the accepted artifact.
Grace expiry reports recovery pending only after a successful lease fence;
failed fencing and health-file writes remain explicit errors. Health-file
invalidation on an unwritable volume is best effort. A real worker shutdown and
production image/Compose health acceptance have not been performed by fixture
checks.


## Optional Google Drive backup replication

`deploy/replicate-backup.py` uses the installed rclone; it sends only a committed database/archive pair and its manifest to a dedicated owner-configured remote directory. Normal rclone HTTPS applies; no extra client encryption layer or new Restic repository is added. Google Drive configuration and any account restriction must be resolved by the owner first. No default remote is chosen, and deployment leaves `keyspilli_offhost_replication: false`.

Before activation, configure a private existing rclone remote and a dedicated directory such as `drive:Keyspilli/backups`. Supply only these routing values in root-owned mode-0600 `/etc/keyspilli/replication.env`: `KEYSPILLI_BACKUP_REMOTE` and `KEYSPILLI_RCLONE_CONFIG` (the latter is the path to the existing protected rclone configuration, never its contents). Validate access and run one pair explicitly:

```sh
python3 /opt/apps/keyspilli/replicate-backup.py --manifest /backups/backup-manifest-STAMP.json --remote drive:Keyspilli/backups --config /PATH/TO/EXISTING/rclone.conf
```

The helper hashes the local pair, uploads immutable named data first, downloads it through rclone's streaming verification, then sends and verifies the completion manifest last. Bounded retries share a 30-minute deadline. Partial uploads have no completion marker; retries reuse the same stamp without replacing differing committed bytes. Temporary hard links preserve a pair through local retention and are removed on exit. No remote files are deleted: remote retention is explicitly `no-remote-deletion` until the owner chooses a pruning policy. Local retention remains the existing backup-script policy.

After a verified remote pair and owner-authorized release, set `keyspilli_offhost_replication: true`. The local service triggers a separate replication service only after successful backup and writer unpause. Local backup success and off-host success remain separate in ops; an enabled but failed, missing or older-than-48-hour verified transfer fails the off-host check. The status report contains no remote/config path, account name or raw provider error. Recover an off-host pair into a fresh local directory with rclone and use the existing `restore-drill.sh` hashes/runtime verifier; no real off-host restore has been performed by the implementation fixtures.


## Input timing and hardware acceptance

The owner setup is an M-Audio Keystation 88 with Chrome or Vivaldi, playing keys
into Keyspilli's computer audio. Connect by USB, open the input tool, choose
**Connect MIDI**, allow the browser's permission request and select the Keystation
in **MIDI device**. Leave **MIDI channel** at **All channels** unless a specific
channel is intended. External arrangement MIDI output (PR-82) is deferred for
this setup. Exact keyboard generation, physical sustain/disconnect behavior and
both browser trials remain unverified.

The practice input tool keeps an unknown calibration separate from an entered zero. Keyboard/MIDI DOM timestamps use the document's monotonic clock; delayed events from a prior seek/count-in/playback epoch cannot grade the new passage. A selected MIDI device/channel and chosen sound have their own optional offset (−250…250 ms); positive subtracts delay once. Wait mode ignores compensation because it does not assess rhythmic arrival. On-screen and microphone timing are uncalibrated. Setup changes select a different binding, and media-device changes reset stored offsets and interrupt active practice.

For actual acceptance, use one keyboard, one channel and a fixed speaker/headphone path; capture a rights-cleared click/reference alongside physical attacks, compare raw and compensated errors over repeated runs, then test seek, count-in, pause, timbre change, hot unplug and pedal-up/blur release. Record the exact browser/device/audio setup and measured distribution; no hardware latency or microphone confidence has been measured by synthetic tests. Microphone practice admits only monophonic targets, reports quiet/unresolved/pitch-present signal states, and stops capture on active interruption. Repeated-note recognition and physical-hand/technique inference remain unsupported.


## Browser practice backup and sampled piano

The Home page and player saved-passages workspace expose an explicit owner-state
backup. It contains preferences, favorites/learned lists, per-song settings,
bookmarks and exact-source musical choices, with history opt-in. It excludes
song files and credentials. Import is bounded to 2 MiB, rejects unknown versions
and malformed fields, and previews merge/replace before applying. Merge retains
unrelated fields; history remains unchanged when omitted. Included history keeps
the latest 200 runs; an oversized bookmark merge is refused. Hardware calibration
is reset because a restored browser/output setup is not a measured equivalent.
Musical choices activate only when the opened source fingerprint matches and
never import cached review provenance. Legacy choices without a bounded source
fingerprint are omitted. Export before replacing; localStorage cannot provide a
cross-tab transaction. A failed restore attempts rollback and reports failure;
reload/check existing state before retrying.

Grand Piano discloses sample readiness and external requests to
`smpldsnds.github.io`. The owner chooses wait-for-samples or immediate synthesis
fallback. The current run retains its chosen timbre even if samples finish
loading; the next deliberate Play/Practice/Preview start can choose ready samples.
Failed loading permits two explicit retries in the same context, then fallback
or a deliberate reload. Initial load settlement latency is diagnostic, not
hardware audio latency. Timing offsets and stored attempts distinguish sampled
piano from fallback. Inactive contexts do not report false interruptions; active
metronome clicks remain part of the selected audio session.

Publication recovery boundaries and storage non-claims are documented in [Publication failure model](publication-failure-model.md). A publication marker alone cannot certify a complete restored tree.


## Explicit owner publication recovery

Open `/maintenance` and choose Refresh to inspect the bounded journal inventory.
This reads pending publication state without running recovery. A journal digest
binds the action; type its exact base ID and explicitly Recover to use the same
catalog writer lock and manifest/source/ownership checks as CLI reconciliation.
Changed journals return conflict; unavailable locks return locked; malformed or
incomplete state remains retained for investigation. Conversion retry remains
in the import job inbox and does not clear publication journals.

A successful action creates a bounded local recovery receipt before removing
the journal. Repeating the same digest returns that receipt without publishing
again. Download it locally for the audit trail. Inventory presence is a snapshot,
not proof that the pending tree can pass reconciliation. Never manually remove
journals or rollback trees to bypass a refusal. This contract covers process
recovery on the same local filesystem; see `publication-failure-model.md` for
storage-loss limits.

## Active arrangement export

Download defaults to Stored Original. Active MIDI/MusicXML/PDF requires the
current publication pin, a bounded canonical selection and a digest of the
actual resolved player note/chord timeline. The server recomputes that timeline
and rejects stale or different selections. PDF uses the same validated active
MusicXML and existing all-pages renderer. Exported notes describe symbolic key
intervals; sound/timbre, mix and pedal resonance are not rendered audio or
musical acceptance. Unsupported or out-of-range material is refused explicitly.
Stored Original downloads retain their existing artifacts.

Deletion journals now record owned job IDs before removal, so explicit recovery can replay upload/transcription cleanup after a database-commit interruption. Source cleanup failures retain the journal. Legacy deletion journals without that snapshot require operator investigation; do not fabricate job ownership or report complete cleanup.

## Owner harmony candidates and reversible quarantine

Maintenance privately inspects exact publication versions, including excluded lessons. Harmony drafts preview unchanged Original versus bounded chord/rest/unknown events, and download an explicitly unreviewed timeline/MIDI/XML candidate. Unsupported symbols are silent/display-only. Source listening, keyboard review and the canonical musical-admission importer remain publication requirements; this workspace cannot approve or replace accepted backing.

Owner quarantine requires a fresh version preview, a typed base and explicit per-action 7/14/30-day policy acknowledgment. It retains complete owned artifact/source bytes under the existing writer lock, hides public reads and keeps a durable restartable receipt. Maintenance offers explicit finish/undo; expiry disables undo and permits only an explicit bounded purge. It never auto-purges, resurrects jobs, overwrites newer files or transfers owner data. Inventory ceilings are 20 retained bases, 512 MiB total, 128 MiB/2,048 files per base and 100 total receipts. Ambiguous ownership or storage failure keeps the base hidden for inspection.

This additive migration advances SQLite to epoch 2. Epoch-1 images refuse that database; preserve a coherent pre-migration backup for rollback. SQLite triggers block all catalog row insertion/deletion/identity updates while a tombstone is active, including scripts outside the artifact lock. Plays remain mutable; purge removes the guard and its rows in one immediate transaction. Isolated subprocess and browser checks cover process interruption on a local filesystem; host power-loss and production restore acceptance remain separate.

## Bounded repeat import and optional learner prototypes

Repeat import supports one explicit forward barline at the first full bar and one right backward barline (two passes), in one part with constant state. No endings, nested/navigation forms, ties, grace notes, transposition or pickups are silently unfolded. Expanded note/beat/measure/grid limits apply. Canonical notes retain unique occurrence origins; MIDI sequencer-specific and standard MusicXML miscellaneous fields carry bounded occurrence maps. Re-imported metadata is explicitly declared provenance, not evidence that the parser verified source repeat notation or authorship. Native Verovio and browser export/navigation fixtures check this subset.

Chord-tone discovery remains sequential and octave-flexible. Optional held-shape and transition prototypes require owner-selected exact reference pitches and one chosen input; explicit physical releases, rolling/hold windows and raw gap/overlap are separate from pedal sound and technique. Missing/safety releases clear in-progress keys. Hardware and target playability remain unverified. Optional harmony degrees require owner-confirmed key regions and keep all analysis derived; correcting a region changes neither source chord evidence nor backing/export bytes. Independent musical teaching acceptance remains pending.

### Sheet renderer retention (roadmap PR-23)

Interactive sheet views retain a viewport window of at most five SVG strings, capped at 4 MiB using UTF-16 string-size estimates. Late responses outside that window are discarded; revisiting a page re-renders it. Worker failure uses a separately owned main-thread toolkit with the same page-at-a-time behavior. Closing a session releases its ownership. The outgoing lightweight shell is suspended during the full-player transition, so animation cannot open a competing session. Worker open/layout is atomic and mutable-toolkit messages are serialized.

The window diagnostic excludes native/WASM memory, browser DOM overhead, the prepared source XML and the existing worker's separate bounded cache. Print/all mode retains every page under a separate 64 MiB estimated SVG ceiling and fails visibly above it. Isolated Chromium checks exercise seven-page forward/back scrolls, delayed replies, forced worker unavailability and complete PDF export; they do not establish owner-device memory or latency acceptance.

### Local performance takes (roadmap PR-33)

The optional MIDI-take panel uses the existing selected input listener rather than replacing the browser's port callback. It requires opt-in plus a version-bound target, one device/channel and a paused player. Capture is temporary in this page: at most 240 seconds, 8,192 raw events and 2,048 reference notes. Internal input echo and grading are withheld during capture/replay. Device/context changes, blur/hidden state and missing physical release metadata interrupt capture; raw evidence remains downloadable. Nothing uploads or persists automatically.

Replay is limited to 1,024 performed notes/64 sounding voices, uses 0.5–2× speed and reconstructs pedal resonance separately from key duration. The visual/table overlay and JSON retain physical key intervals and unknown/synthetic endings. Performance MIDI exports elapsed seconds on piano channel 1 with explicit CC64; unobserved endings and a held pedal are closed at the take boundary, which is not physical-release evidence. Removing the local take clears the panel; downloaded files remain owner-managed. Tests cover synthetic capture/unplug, bytes, source/history invariance and rendered PCM; physical device latency and listening quality are not established.

Source CC64 is a bounded channel-scoped timeline, separate from physical key intervals and grading. Source-profile Original and exact authored studies carry supported events; reduced/derived Chords arrangements disclose omission. Same-channel overlapping physical pitches, pedal-down coinciding with key release, ambiguous cross-track same-tick changes, percussion controllers and excessive work/voices remain unsupported. A missing pedal-up ends resonance at the file boundary.

Source-aware playback disables simulated background sustain, reconstructs only source carries after seek/reset and clips resonance at loop boundaries; owner live-input pedal stays on its independent input voice path. MIDI exports preserve channels/events/EOF, and Keyspilli MusicXML retains bounded channel-map/controller metadata. Other notation players may ignore that metadata. Metadata and calibration edits retain and transform the same controller clock; artifact checks reject changed events/channels. Parser, canonical roundtrip, browser and rendered PCM proof do not establish musical/device acceptance.

### Optional measured worker budgets

`keyspilli_worker_budget` defaults to `{}`. Decoder-only probes do not enable production limits. After an isolated full tutorial/ML/stem job has measured headroom for the exact worker image, an operator can supply `image`, `evidence_sha256`, `full_job_headroom_verified: true`, bounded numeric `cpus`, integer `memory_mib`, and integer `pids`, with explicit `keyspilli_worker_budget_approved: true`. The playbook rejects mismatched images, unapproved budgets and fractional memory/PID limits. Compose uses native CPU/memory/no-swap/PID controls only for that image; rollback omits a candidate's limits. No budget was enabled by this implementation.

Run `python3 deploy/measure-worker-resources.py --image EXISTING_IMAGE --output FRESH_RECEIPT.json` only on an idle isolated Docker host. It pulls no images, mounts no owner media, runs generated 3/30/90-second decoder fixtures, then deliberately triggers memory and PID caps. Each owned container must be removed and absent from a successful Docker inventory before evidence is written. Capability dropping, no-new-privileges, read-only root and writable temporary space were checked for the decoder probe; they have not qualified the full worker, which uses model caches and the existing host-network relay.

The 2026-10-02 local receipt `docs/research/2026-10-02-local-decoder-resource-probe-3.json` records an amd64 image under aarch64 emulation, 1 CPU/384 MiB/64 PID decoder ceilings, child RSS around 77.4 MB, eight sampled PIDs and 1.29/5.97/15.78 seconds latency. The 64 MiB deliberate cap reports an actual OOM kill; the 16 PID cap produces process-capacity refusal. These timings/RSS are not native-production budgets, full-job peak usage or web headroom evidence. Separate deployed-limit/read-only-path/health/lease-recovery acceptance remains required.

Failed subprocesses with increased cgroup v2 `oom`, `oom_kill` or `pids.events:max`, or native ENOMEM/EAGAIN, stop as `RESOURCE_BLOCKED`. This proves runtime capacity pressure, not the responsible child. Cancellation/timeouts keep their own classification; SIGKILL/137 alone does not establish OOM. [Linux cgroup v2 event semantics](https://docs.kernel.org/admin-guide/cgroup-v2.html) define the counters. Unknown/unavailable counters stay unknown. A killed entire worker cannot write its own error; existing lease recovery and Docker OOM state must be assessed by operations. Resource failures do not automatically retry, switch transcription routes or publish partial output. The private jobs view offers an explicit capacity state; an operator can recover after reviewing limits.

The deployment fixture check uses the existing Ansible control runtime's Python with Jinja2/PyYAML: `python deploy/test_worker_resources.py`. It runs only extracted local assertions and template rendering, never the deploy tasks or a production inventory.

## Explicit private offline practice pack

One opted-in pinned Original can replace the previous local pack. The owner confirms rights/private-browser storage and chooses 1, 7 or 30 days; bounds are 8 MiB, four minutes, 4,096 notes and 256 measures. Native IndexedDB commits replacement atomically; quota refusal preserves the previous pack. The service worker caches only the three generated public shell assets under `/offline/`; it never caches owner routes, API responses or authentication material. Integrity digests detect changed bytes but do not certify musical review.

Offline reload starts locked. Lock/interruption stops audio and hides the selected lesson; locking is not encryption or an owner identity boundary. Explicit removal and observed expiry delete the IDB entry and notify open offline pages; other exports/backups cannot be revoked, and browser/device compromise remains outside this local lock. An offline copy cannot learn about online deletion/review changes; use the explicit current-version check when connected. Practice/results remain temporary and separate from ordinary history.

## Optional auxiliary audio ownership

Normal playback, rhythm taps and MIDI-take recording/replay share one synchronous ownership guard. Completion, cancellation, interruption and unmount release the owner. MIDI capture keeps its raw physical intervals and pedal evidence; frozen-target replay shares the performed replay note/voice/duration limits. No simultaneous internal input echo or grading is enabled during those prototypes.
