#!/usr/bin/env python3
"""Verify the authenticated production health and catalog API."""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

PAGE_SIZE = 200
MAX_PAGES = 100
MAX_SONGS = PAGE_SIZE * MAX_PAGES


def _auth_header(username: str, password: str) -> str:
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return f"Basic {token}"


def _fetch_json(url: str, auth: str, retries: int = 3, timeout: int = 15) -> Any:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "Accept": "application/json",
                    "Authorization": auth,
                    "User-Agent": "Keyspilli-LiveVerifier/1",
                },
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                if response.status != 200:
                    raise RuntimeError(f"unexpected HTTP status {response.status}")
                return json.loads(response.read().decode("utf-8"))
        except Exception as error:
            last_error = error
            if attempt + 1 < retries:
                time.sleep(1)
    raise RuntimeError(f"fetch failed after {retries} attempts: {last_error}")


def _anonymous_status(url: str) -> int:
    request = urllib.request.Request(url, headers={"User-Agent": "Keyspilli-LiveVerifier/1"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def _paginate_songs(base_url: str, auth: str) -> list[dict[str, Any]]:
    songs: list[dict[str, Any]] = []
    song_ids: set[str] = set()
    offset = 0
    expected_total: int | None = None

    for page_number in range(MAX_PAGES):
        data = _fetch_json(f"{base_url}/api/songs?limit={PAGE_SIZE}&offset={offset}", auth)
        if not isinstance(data, dict) or not isinstance(data.get("songs"), list):
            raise RuntimeError("catalog response is not an object with a songs list")
        total = data.get("total")
        if not isinstance(total, int) or isinstance(total, bool) or total < 0 or total > MAX_SONGS:
            raise RuntimeError("catalog response has an invalid total")
        if expected_total is None:
            expected_total = total
        elif total != expected_total:
            raise RuntimeError("catalog total changed during pagination")

        page = data["songs"]
        if any(not isinstance(song, dict) for song in page):
            raise RuntimeError("catalog response contains a non-object song")
        for song in page:
            song_id = song.get("id")
            if not isinstance(song_id, str) or not song_id or song_id in song_ids:
                raise RuntimeError("catalog response contains a missing or duplicate song id")
            song_ids.add(song_id)
        if len(page) > PAGE_SIZE:
            raise RuntimeError("catalog page exceeds the production limit")
        songs.extend(page)
        if expected_total is not None and len(songs) > expected_total:
            raise RuntimeError("catalog page results exceed the advertised total")
        if len(songs) > MAX_SONGS:
            raise RuntimeError("catalog exceeds the verifier bound")
        if len(songs) == expected_total:
            return songs
        if not page or len(page) < PAGE_SIZE:
            raise RuntimeError("catalog pagination ended before the advertised total")
        offset += len(page)
        if page_number + 1 == MAX_PAGES:
            raise RuntimeError("catalog pagination exceeded the verifier bound")

    raise RuntimeError("catalog pagination exceeded the verifier bound")


def verify_live(base_url: str, auth: str, expected_sha: str, verify_base_id: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"status": "failed", "checks": {}, "failures": []}
    health_url = f"{base_url.rstrip('/')}/api/health"

    try:
        anonymous_status = _anonymous_status(health_url)
        result["checks"]["anonymousHealth"] = {"status": anonymous_status}
        if anonymous_status != 401:
            result["failures"].append(f"anonymous_health_not_401:{anonymous_status}")
    except Exception as error:
        result["failures"].append(f"anonymous_health_error:{type(error).__name__}")

    try:
        health = _fetch_json(health_url, auth, retries=5)
        if not isinstance(health, dict):
            raise RuntimeError("health response is not an object")
        result["checks"]["health"] = {"status": health.get("status"), "version": health.get("version")}
        if health.get("status") != "healthy":
            result["failures"].append(f"health_not_healthy:{health.get('status')}")
        if health.get("version") != expected_sha:
            result["failures"].append(f"version_mismatch:expected={expected_sha},got={health.get('version')}")
    except Exception as error:
        result["failures"].append(f"health_check_failed:{type(error).__name__}:{error}")

    try:
        songs = _paginate_songs(base_url.rstrip('/'), auth)
        result["checks"]["catalog"] = {"totalSongs": len(songs)}
        if verify_base_id:
            matches = [song for song in songs if song.get("baseId") == verify_base_id]
            if not matches:
                result["failures"].append(f"base_not_found:{verify_base_id}")
            else:
                tempos = [song.get("tempo") for song in matches]
                result["checks"]["base"] = {"baseId": verify_base_id, "variants": len(matches), "tempos": tempos}
                if not any(isinstance(tempo, (int, float)) and not isinstance(tempo, bool) and tempo > 0 for tempo in tempos):
                    result["failures"].append(f"base_no_valid_tempo:{verify_base_id}")
        elif not songs:
            result["failures"].append("catalog_empty")
        elif not any(isinstance(song.get("tempo"), (int, float)) and not isinstance(song.get("tempo"), bool) and song["tempo"] > 0 for song in songs):
            result["failures"].append("no_songs_with_tempo")
    except Exception as error:
        result["failures"].append(f"catalog_check_failed:{type(error).__name__}:{error}")

    result["status"] = "passed" if not result["failures"] else "failed"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Keyspilli authenticated live catalog verifier")
    parser.add_argument("--fixture", help="JSON fixture with base_url, username, password, expected_sha, and base_id")
    args = parser.parse_args()

    if args.fixture:
        fixture = json.loads(open(args.fixture, encoding="utf-8").read())
        base_url = fixture["base_url"]
        auth = _auth_header(fixture["username"], fixture["password"])
        expected_sha = fixture["expected_sha"]
        verify_base_id = fixture.get("verify_base_id")
    else:
        base_url = os.environ["KEYSPILLI_DEPLOY_URL"]
        auth = _auth_header(os.environ["KEYSPILLI_ACCESS_USERNAME"], os.environ["KEYSPILLI_ACCESS_PASSWORD"])
        expected_sha = os.environ["KEYSPILLI_EXPECTED_SHA"]
        verify_base_id = os.environ.get("KEYSPILLI_VERIFY_BASE_ID") or None

    result = verify_live(base_url, auth, expected_sha, verify_base_id)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
