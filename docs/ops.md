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

## Health / version contract

`/api/health` returns `{status: "healthy", version, commit, image}`. The
playbook refuses to deploy unless the container reports the exact git SHA.

## Backups

Nightly cron on the VPS:

```cron
0 3 * * * /path/to/repo/deploy/backup.sh >> /var/log/keyspilli-backup.log 2>&1
```

Backups land in `/backups` (mount or copy off-box): a consistent SQLite copy
plus a tarball of `artifacts/`, retained 14 days.

Restore:

```bash
docker compose stop worker
docker compose run --rm -v keyspilli_data:/data -v /backups:/backups web \
  sh -c "cp /backups/db-LATEST.sqlite /data/db.sqlite && tar -xzf /backups/artifacts-LATEST.tar.gz -C /data"
docker compose start worker
```

## Adding songs to the catalog

1. Put MIDI/XML in `data/seed-midi/`.
2. Add an entry to `catalog/manifest.json` (id, title, artist, sourceFile…).
3. Run `npm run pipeline`.
4. Commit `catalog/manifest.json`.

## YouTube conversion notes

- The worker uses `yt-dlp` + Basic Pitch (CPU). Long videos are slow; the UI
  recommends solo-piano covers under 5 minutes.
- Backend: ONNX (no TensorFlow needed). On the Mac for fast local development,
  set `KEYSPILLI_BP_SERIALIZATION=coreml` (CoreML is ~10× faster than CPU).
- Worker logs via `docker compose logs -f worker`.

## Useful commands

```bash
docker compose logs -f web
docker compose logs -f worker
docker compose run --rm web node --import tsx packages/catalog/scripts/pipeline.ts
```
