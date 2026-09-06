#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
# Colima/Docker Desktop cannot always mount the host's system temp directory;
# keep this run-local directory under the checkout and remove it on exit.
scratch_dir="$root_dir/.tmp-edge-test.$$"
mkdir -p "$scratch_dir"
container_name="keyspilli-edge-test-$$"
port="${KEYSPILLI_EDGE_TEST_PORT:-38199}"
backend_port="${KEYSPILLI_EDGE_TEST_BACKEND_PORT:-38200}"
password='temporary-edge-test-password-2026'
backend_pid=''

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  if [ -n "$backend_pid" ]; then
    kill "$backend_pid" >/dev/null 2>&1 || true
    wait "$backend_pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$scratch_dir"
}
trap cleanup EXIT

hash="$(printf '%s\n' "$password" | docker run --rm -i caddy:2.6.2 caddy hash-password --algorithm bcrypt)"
cat >"$scratch_dir/backend.py" <<'PY'
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({key.lower(): value for key, value in self.headers.items()}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_POST = do_GET

    def log_message(self, *_args):
        pass


HTTPServer(("0.0.0.0", int(sys.argv[1])), Handler).serve_forever()
PY
cat >"$scratch_dir/Caddyfile" <<EOF
http://example.test {
  basicauth {
    owner $hash
  }
  reverse_proxy host.docker.internal:$backend_port {
    header_up -Authorization
  }
}
EOF

docker run --rm \
  -v "$scratch_dir/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.6.2 \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1

docker run -d --name "$container_name" -p "${port}:80" \
  --add-host host.docker.internal:host-gateway \
  -v "$scratch_dir/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.6.2 \
  caddy run --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1

python3 "$scratch_dir/backend.py" "$backend_port" >/dev/null 2>&1 &
backend_pid=$!

for _ in $(seq 1 30); do
  status="$(curl -sS -o /dev/null -w '%{http_code}' -H 'Host: example.test' "http://127.0.0.1:${port}/" || true)"
  [ "$status" = 401 ] && break
  sleep 0.2
done

status_for() {
  local path="$1"
  shift
  curl -sS -o /dev/null -w '%{http_code}' -H 'Host: example.test' "$@" "http://127.0.0.1:${port}${path}"
}

[ "$(status_for /)" = 401 ]
[ "$(status_for / -u "owner:wrong-password")" = 401 ]
[ "$(status_for / -u "owner:${password}")" = 200 ]
[ "$(status_for /uploads)" = 401 ]
[ "$(status_for /uploads -u "owner:${password}")" = 200 ]

browser_headers="$(curl -sS -u "owner:${password}" -H 'Host: example.test' "http://127.0.0.1:${port}/")"
printf '%s' "$browser_headers" | python3 -c 'import json, sys; headers = json.load(sys.stdin); assert "authorization" not in headers'
machine_headers="$(curl -sS -u "owner:${password}" -H 'X-Keyspilli-Api-Token: Bearer machine-test-token' -H 'Host: example.test' "http://127.0.0.1:${port}/")"
printf '%s' "$machine_headers" | python3 -c 'import json, sys; headers = json.load(sys.stdin); assert headers.get("x-keyspilli-api-token") == "Bearer machine-test-token"; assert "authorization" not in headers'

playbook="$root_dir/deploy/playbook.yml"
template="$root_dir/deploy/templates/keyspilli-caddy-block.j2"
grep -q 'KEYSPILLI_ACCESS_USERNAME' "$playbook"
grep -q 'KEYSPILLI_ACCESS_PASSWORD' "$playbook"
grep -q 'keyspilli_access_password_hash' "$playbook"
grep -q 'basicauth' "$template"
grep -q 'status_code: \[401\]' "$playbook"
grep -q 'url_username:' "$playbook"
grep -q 'url_password:' "$playbook"
grep -q 'force_basic_auth: true' "$playbook"
grep -q 'header_up -Authorization' "$template"

printf '%s\n' 'access-boundary local Caddy canary: PASS'
