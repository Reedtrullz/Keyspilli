#!/usr/bin/env bash
# F08: data-only backup. The host runner owns locking and Docker pause state.
set -euo pipefail

DATA_DIR="${KEYSPILLI_DATA_DIR:-/data}"
BACKUP_DIR="${KEYSPILLI_BACKUP_DIR:-/backups}"
RETENTION_DAYS="${KEYSPILLI_RETENTION_DAYS:-14}"
STAMP="$(date +%F-%H%M%S)"

mkdir -p "$BACKUP_DIR"
tmp_dir="$(mktemp -d "$BACKUP_DIR/.keyspilli-backup-$STAMP.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

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
for candidate in seed-midi transcribed uploads manifest.json learner-review.json; do
  if [[ -e "$DATA_DIR/$candidate" ]]; then
    archive_paths+=("$candidate")
    [[ -d "$DATA_DIR/$candidate" ]] && source_dir_count=$((source_dir_count + 1))
  fi
done
(( source_dir_count > 0 )) || { echo "backup failed: no source material found under $DATA_DIR" >&2; exit 1; }

# The ordinary artifacts/ tree includes hidden reconciliation journals and .old
# trees without a second, easy-to-forget glob.
tar -czf "$archive_tmp" -C "$DATA_DIR" "${archive_paths[@]}"
tar -tzf "$archive_tmp" >/dev/null

python3 - "$db_tmp" "$archive_tmp" "$manifest_tmp" "$STAMP" <<'PY'
import hashlib, json, os, sys

db, archive, manifest, stamp = sys.argv[1:]
def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

payload = {
    "schemaVersion": 1,
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

# Publish data first and the completion marker last. Readers only trust a
# manifest whose two named files and hashes all match.
mv "$db_tmp" "$BACKUP_DIR/db-$STAMP.sqlite"
mv "$archive_tmp" "$BACKUP_DIR/artifacts-$STAMP.tar.gz"
mv "$manifest_tmp" "$BACKUP_DIR/backup-manifest-$STAMP.json"

python3 - "$BACKUP_DIR" "$RETENTION_DAYS" <<'PY'
import hashlib, json, re, sys, time
from pathlib import Path

root = Path(sys.argv[1])
cutoff = time.time() - int(sys.argv[2]) * 86400
stamp_re = re.compile(r"^\d{4}-\d{2}-\d{2}-\d{6}$")
def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

for manifest_path in root.glob("backup-manifest-*.json"):
    if manifest_path.stat().st_mtime >= cutoff:
        continue
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        stamp = manifest["stamp"]
        db_name = manifest["dbFile"]
        archive_name = manifest["archiveFile"]
        db = root / manifest["dbFile"]
        archive = root / manifest["archiveFile"]
        if (not manifest.get("complete") or not isinstance(stamp, str) or not stamp_re.fullmatch(stamp)
                or manifest_path.name != f"backup-manifest-{stamp}.json"
                or db_name != f"db-{stamp}.sqlite"
                or archive_name != f"artifacts-{stamp}.tar.gz"
                or not db.is_file() or not archive.is_file()
                or sha256(db) != manifest["dbSha256"]
                or sha256(archive) != manifest["archiveSha256"]):
            continue
        for path in (manifest_path, db, archive):
            path.unlink()
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        continue
PY

echo "backup complete: $BACKUP_DIR ($STAMP)"
