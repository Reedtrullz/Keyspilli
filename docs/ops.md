# Keyspilli ops

## Deploy (VPS with Docker)

```bash
# on the VPS, with this repo present:
git pull
docker compose up -d --build
```

- `web` serves the app on port 3000 (internal).
- `worker` polls the SQLite job table and processes YouTube conversions.
- `caddy` fronts everything on :80/:443. Set `DOMAIN=keyspilli.example.com` in
  `.env` for automatic HTTPS; without it Caddy serves plain HTTP on port 80.
- All state lives in the `keyspilli_data` volume (`/data`): `db.sqlite`,
  `artifacts/`, `seed-midi/`, `transcribed/`.

## First run on a fresh volume

The catalog must be built before the app is useful:

```bash
docker compose run --rm web sh -c "
  cd /app && \
  node /app/apps/web/server.js & sleep 2; kill %1
"
```

Simpler: build the catalog locally and copy the volume contents, or run the
pipeline inside the web image:

```bash
docker compose run --rm web node packages/catalog/scripts/pipeline.ts
```

(The web image includes the full monorepo build context; the standalone server
is only in the runtime layer, so pipeline runs use `node --import tsx` on the
TS sources when available in the image.)

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
