#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

cat >"$scratch/healthy.json" <<'JSON'
{
  "diskFreeBytes": 37580963840,
  "web": {"running": true, "healthy": true, "restarts": 0, "versionMatches": true, "sourceDiscoveryConfigured": true, "directAudioAmt": false},
  "worker": {"running": true, "restarts": 0},
  "backup": {"timerEnabled": true, "timerActive": true, "lastResult": "success", "latestDbAgeHours": 2, "latestArchiveAgeHours": 2},
  "tlsDaysRemaining": 42,
  "caddyValid": true,
  "anonymousStatus": 401,
  "providerCounts": {"candidatesFound": 1, "noCandidates": 0, "rateLimited": 0, "unavailable": 0, "notConfigured": 0}
}
JSON

python3 "$repo_root/deploy/keyspilli-ops-check.py" --fixture "$scratch/healthy.json" >"$scratch/healthy-result.json"
python3 - "$scratch/healthy-result.json" <<'PY'
import json, sys
result = json.load(open(sys.argv[1]))
assert result["status"] == "healthy", result
assert result["checks"]["disk"]["status"] == "healthy", result
PY

python3 - "$scratch/healthy.json" "$scratch/low-disk.json" <<'PY'
import json, sys
value = json.load(open(sys.argv[1]))
value["diskFreeBytes"] = 29 * 1024 ** 3
json.dump(value, open(sys.argv[2], "w"))
PY
if python3 "$repo_root/deploy/keyspilli-ops-check.py" --fixture "$scratch/low-disk.json" >"$scratch/low-disk-result.json"; then
  echo "low disk fixture unexpectedly passed" >&2
  exit 1
fi
python3 - "$scratch/low-disk-result.json" <<'PY'
import json, sys
result = json.load(open(sys.argv[1]))
assert result["status"] == "failed", result
assert "disk_below_30_gib" in result["failures"], result
PY

python3 - "$scratch/healthy.json" "$scratch/stale-backup.json" <<'PY'
import json, sys
value = json.load(open(sys.argv[1]))
value["backup"]["latestDbAgeHours"] = 50
json.dump(value, open(sys.argv[2], "w"))
PY
if python3 "$repo_root/deploy/keyspilli-ops-check.py" --fixture "$scratch/stale-backup.json" >"$scratch/stale-backup-result.json"; then
  echo "stale backup fixture unexpectedly passed" >&2
  exit 1
fi
python3 - "$scratch/stale-backup-result.json" <<'PY'
import json, sys
result = json.load(open(sys.argv[1]))
assert result["status"] == "failed", result
assert "latest_db_backup_older_than_48h" in result["failures"], result
PY

echo "ops check fixtures passed"
