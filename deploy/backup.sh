#!/usr/bin/env bash
# F08: data-only backup. The host runner owns locking and Docker pause state.
set -euo pipefail

DATA_DIR="${KEYSPILLI_DATA_DIR:-/data}"
BACKUP_DIR="${KEYSPILLI_BACKUP_DIR:-/backups}"
POLICY="${KEYSPILLI_STORAGE_POLICY:-$(dirname "$0")/keyspilli-storage.py}"
STAMP="$(date +%F-%H%M%S)"

mkdir -p "$BACKUP_DIR"
for name in db-$STAMP.sqlite artifacts-$STAMP.tar.gz backup-manifest-$STAMP.json; do
  [[ ! -e "$BACKUP_DIR/$name" ]] || { echo "backup failed: timestamp collision; refusing overwrite" >&2; exit 1; }
done
tmp_dir="$(mktemp -d "$BACKUP_DIR/.keyspilli-backup-$STAMP.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT
trap 'exit 143' TERM INT

[[ -f "$DATA_DIR/db.sqlite" ]] || { echo "backup failed: missing SQLite database at $DATA_DIR/db.sqlite" >&2; exit 1; }
[[ -d "$DATA_DIR/artifacts" ]] || { echo "backup failed: missing artifact directory at $DATA_DIR/artifacts" >&2; exit 1; }

db_tmp="$tmp_dir/db-$STAMP.sqlite"
archive_tmp="$tmp_dir/artifacts-$STAMP.tar.gz"
manifest_tmp="$tmp_dir/backup-manifest-$STAMP.json"

python3 - "$DATA_DIR/db.sqlite" "$db_tmp" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1])
dst = sqlite3.connect(sys.argv[2])
try:
    src.backup(dst)
    if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise RuntimeError("backup database integrity check failed")
finally:
    dst.close()
    src.close()
PY

archive_paths=(artifacts)
source_dir_count=0
for candidate in seed-midi transcribed uploads manifest.json learner-review.json review-receipts harmony-candidates; do
  if [[ -e "$DATA_DIR/$candidate" ]]; then
    archive_paths+=("$candidate")
    [[ -d "$DATA_DIR/$candidate" ]] && source_dir_count=$((source_dir_count + 1))
  fi
done
(( source_dir_count > 0 )) || { echo "backup failed: no source material found under $DATA_DIR" >&2; exit 1; }

# The ordinary artifacts/ tree includes hidden reconciliation journals and .old
# trees without a second, easy-to-forget glob.
COPYFILE_DISABLE=1 tar -czf "$archive_tmp" -C "$DATA_DIR" "${archive_paths[@]}"
tar -tzf "$archive_tmp" >/dev/null

python3 - "$db_tmp" "$archive_tmp" "$manifest_tmp" "$STAMP" <<'PY'
import hashlib, json, os, re, sqlite3, sys

db, archive, manifest, stamp = sys.argv[1:]
def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

with sqlite3.connect(f"file:{db}?mode=ro", uri=True) as database:
    schema_epoch = database.execute("PRAGMA user_version").fetchone()[0]
def image_metadata(role):
    image_id = os.environ.get(f"KEYSPILLI_BACKUP_{role}_IMAGE_ID", "")
    revision = os.environ.get(f"KEYSPILLI_BACKUP_{role}_REVISION", "")
    return {
        "id": image_id if re.fullmatch(r"sha256:[a-f0-9]{64}", image_id) else None,
        "revision": revision if re.fullmatch(r"[a-f0-9]{40}", revision) else None,
    }
payload = {
    "schemaVersion": 1,
    "catalogSchemaEpoch": schema_epoch,
    "images": {"web": image_metadata("WEB"), "worker": image_metadata("WORKER")},
    "stamp": stamp,
    "dbFile": os.path.basename(db),
    "dbSha256": sha256(db),
    "dbBytes": os.path.getsize(db),
    "archiveFile": os.path.basename(archive),
    "archiveSha256": sha256(archive),
    "archiveBytes": os.path.getsize(archive),
    "complete": True,
}
with open(manifest, "w", encoding="utf-8") as stream:
    json.dump(payload, stream, indent=2, sort_keys=True)
    stream.write("\n")
PY

# Flush payloads before publication; retirement must not outrun durable data.
python3 - "$db_tmp" "$archive_tmp" "$manifest_tmp" <<'PY'
import os, sys
for name in sys.argv[1:]:
    with open(name, "rb") as stream:
        os.fsync(stream.fileno())
PY
sync_directory() {
  python3 - "$BACKUP_DIR" <<'PY'
import os, sys
fd = os.open(sys.argv[1], os.O_RDONLY)
try:
    os.fsync(fd)
finally:
    os.close(fd)
PY
}
# Exclusive hardlink publication cannot overwrite a same-stamp recovery file.
# Publish and sync data before the completion marker, then sync it too.
ln "$db_tmp" "$BACKUP_DIR/db-$STAMP.sqlite"
rm "$db_tmp"
ln "$archive_tmp" "$BACKUP_DIR/artifacts-$STAMP.tar.gz"
rm "$archive_tmp"
sync_directory
ln "$manifest_tmp" "$BACKUP_DIR/backup-manifest-$STAMP.json"
rm "$manifest_tmp"
sync_directory

# Re-verify the published cohort before permitting retention. This data-only
# path runs under the host runner's flock (or an isolated fixture directory).
python3 "$POLICY" verify --lock-held --manifest "$BACKUP_DIR/backup-manifest-$STAMP.json"

echo "backup complete: $BACKUP_DIR ($STAMP)"
