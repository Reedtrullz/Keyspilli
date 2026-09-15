#!/usr/bin/env python3
"""Fixture tests for the stdlib-only authenticated live verifier."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "deploy/keyspilli-live-verifier.py"


class FixtureServer(HTTPServer):
    allow_reuse_address = True


def run_verifier(fixture: dict, port: int) -> tuple[int, str]:
    class Handler(BaseHTTPRequestHandler):
        def send_json(self, status: int, payload: object) -> None:
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            path = urlsplit(self.path).path
            authenticated = self.headers.get("Authorization", "").startswith("Basic ")
            if path == "/api/health":
                if not authenticated:
                    self.send_response(401)
                    self.end_headers()
                else:
                    self.send_json(200, fixture["health"])
                return
            if path != "/api/songs" or not authenticated:
                self.send_response(401 if not authenticated else 404)
                self.end_headers()
                return

            query = parse_qs(urlsplit(self.path).query)
            limit = int(query.get("limit", ["200"])[0])
            offset = int(query.get("offset", ["0"])[0])
            songs = fixture["songs"]
            if fixture.get("shape") == "list":
                self.send_json(200, songs)
                return
            page = songs[offset : offset + limit]
            if fixture.get("shape") == "short-page" and offset == 0:
                page = page[:100]
            if fixture.get("shape") == "repeat" and offset:
                page = songs[:limit]
            total = fixture.get("reported_total", len(songs))
            self.send_json(200, {"songs": page, "total": total})

        def log_message(self, *_args: object) -> None:
            pass

    server = FixtureServer(("127.0.0.1", port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    fixture_file = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    try:
        json.dump({
            **fixture,
            "base_url": f"http://127.0.0.1:{port}",
            "username": "test-user",
            "password": "test-pass",
        }, fixture_file)
        fixture_file.close()
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--fixture", fixture_file.name],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return result.returncode, result.stdout + result.stderr
    finally:
        server.shutdown()
        server.server_close()
        Path(fixture_file.name).unlink(missing_ok=True)


def make_fixture(**overrides: object) -> dict:
    fixture = {
        "health": {"status": "healthy", "version": "abc123def456"},
        "songs": [{"id": "test-song-e", "baseId": "test-song", "title": "Test", "tempo": 120, "difficulty": "easy"}],
        "expected_sha": "abc123def456",
    }
    fixture.update(overrides)
    return fixture


def result_for(fixture: dict, port: int) -> tuple[int, dict]:
    code, output = run_verifier(fixture, port)
    return code, json.loads(output)


def test_valid_flat_api_and_pagination() -> None:
    songs = [{"id": f"song-{i}", "baseId": f"song-{i}", "title": f"Song {i}", "tempo": 120} for i in range(250)]
    songs[240]["baseId"] = "target"
    songs[240]["tempo"] = 75
    code, result = result_for(make_fixture(songs=songs, verify_base_id="target"), 18901)
    assert code == 0 and result["status"] == "passed", result
    assert result["checks"]["catalog"]["totalSongs"] == 250
    assert result["checks"]["base"]["tempos"] == [75]
    print("  PASS: authenticated flat API pagination and target tempo")


def test_version_mismatch() -> None:
    code, result = result_for(make_fixture(expected_sha="wrong"), 18902)
    assert code == 1 and any("version_mismatch" in item for item in result["failures"]), result
    print("  PASS: version mismatch fails")


def test_base_and_tempo_failures() -> None:
    code, result = result_for(make_fixture(verify_base_id="missing"), 18903)
    assert code == 1 and any("base_not_found" in item for item in result["failures"]), result
    code, result = result_for(make_fixture(
        verify_base_id="silent",
        songs=[{"id": "silent-e", "baseId": "silent", "title": "Silent", "tempo": 0}],
    ), 18904)
    assert code == 1 and any("base_no_valid_tempo" in item for item in result["failures"]), result
    print("  PASS: missing and zero-tempo targets fail")


def test_malformed_pages_fail_closed() -> None:
    for port, shape in ((18905, "list"), (18906, "short-page"), (18907, "repeat")):
        code, result = result_for(make_fixture(
            songs=[{"id": f"song-{i}", "baseId": f"song-{i}", "title": "Song", "tempo": 120} for i in range(250)],
            shape=shape,
        ), port)
        assert code == 1 and any("catalog_check_failed" in item for item in result["failures"]), result
    print("  PASS: malformed, short, and repeating pages fail closed")


def test_missing_and_duplicate_ids_fail_closed() -> None:
    for port, songs in (
        (18909, [{"baseId": "missing-id", "tempo": 120}]),
        (18910, [{"id": "same", "baseId": "one", "tempo": 120}, {"id": "same", "baseId": "two", "tempo": 120}]),
    ):
        code, result = result_for(make_fixture(songs=songs), port)
        assert code == 1 and any("missing or duplicate song id" in item for item in result["failures"]), result
    print("  PASS: missing and duplicate song ids fail closed")


def test_empty_catalog_fails() -> None:
    code, result = result_for(make_fixture(songs=[]), 18908)
    assert code == 1 and "catalog_empty" in result["failures"], result
    print("  PASS: empty catalog fails")


if __name__ == "__main__":
    print("Running F07 live-verifier tests...")
    test_valid_flat_api_and_pagination()
    test_version_mismatch()
    test_base_and_tempo_failures()
    test_malformed_pages_fail_closed()
    test_missing_and_duplicate_ids_fail_closed()
    test_empty_catalog_fails()
    print("All F07 verifier tests passed.")
